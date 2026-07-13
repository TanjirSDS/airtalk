import type { SupabaseClient } from '@airtalk/db'
import type { ProviderCall, VoiceEngine } from '@airtalk/engine'
import { backfillOrgContacts } from './contacts'
import { currentPeriodUsage, pauseOrgAgents } from './usage'
import { enqueueWebhookEvent } from './webhooks-out'

export interface CallDiff {
  missing: ProviderCall[]
  durationFixes: { providerCallId: string; from: number; to: number }[]
  /** Total seconds our table was off by — the rule-5 discrepancy measure. */
  discrepancySecs: number
}

/** Pure diff of provider truth vs our calls rows (money math — tested). */
export function diffCalls(
  provider: ProviderCall[],
  local: { provider_call_id: string; duration_secs: number | null }[]
): CallDiff {
  const byId = new Map(local.map((c) => [c.provider_call_id, c.duration_secs ?? 0]))
  const missing: ProviderCall[] = []
  const durationFixes: CallDiff['durationFixes'] = []
  for (const p of provider) {
    const have = byId.get(p.providerCallId)
    if (have === undefined) missing.push(p)
    else if (have !== p.durationSecs)
      durationFixes.push({ providerCallId: p.providerCallId, from: have, to: p.durationSecs })
  }
  const discrepancySecs =
    missing.reduce((s, m) => s + m.durationSecs, 0) +
    durationFixes.reduce((s, f) => s + Math.abs(f.to - f.from), 0)
  return { missing, durationFixes, discrepancySecs }
}

async function reportDiscrepancy(msg: string) {
  console.error(msg)
  if (process.env.SENTRY_DSN) {
    const Sentry = await import('@sentry/nextjs')
    Sentry.captureMessage(msg, 'warning')
  }
}

/**
 * Rule 5: pull the provider's call list for yesterday (UTC), insert calls we
 * missed (e.g. webhook route was down), correct drifted durations, then
 * recompute usage_periods from the calls table for every affected org+month.
 * db must be the service client.
 */
export async function reconcileYesterday(db: SupabaseClient, engine: VoiceEngine, now = new Date()) {
  const dayStart = new Date(now)
  dayStart.setUTCHours(0, 0, 0, 0)
  dayStart.setUTCDate(dayStart.getUTCDate() - 1)
  const dayEnd = new Date(dayStart)
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

  const provider = await engine.listCalls(dayStart.getTime() / 1000, dayEnd.getTime() / 1000)

  // Match by provider_call_id, not started_at window — clock skew between the
  // provider and our webhook timestamps must not create phantom "missing" calls.
  const ids = provider.map((p) => p.providerCallId)
  const local: { provider_call_id: string; duration_secs: number | null; org_id: string | null }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from('calls')
      .select('provider_call_id, duration_secs, org_id')
      .in('provider_call_id', ids.slice(i, i + 200))
    if (error) throw new Error(error.message)
    local.push(...(data ?? []))
  }

  const diff = diffCalls(provider, local)

  // org lookup for missing calls, via their provider agent ids
  const agentIds = [...new Set(diff.missing.map((m) => m.providerAgentId))]
  const { data: agents } = agentIds.length
    ? await db.from('agents').select('id, org_id, provider_agent_id').in('provider_agent_id', agentIds)
    : { data: [] }
  const agentByProviderId = new Map((agents ?? []).map((a) => [a.provider_agent_id, a]))

  const affected = new Map<string, { orgId: string; period: string }>() // org+month pairs to recompute
  const touch = (orgId: string | null, startedAt: string) => {
    if (!orgId) return
    const period = startedAt.slice(0, 8) + '01'
    affected.set(`${orgId}:${period}`, { orgId, period })
  }

  if (diff.missing.length) {
    const rows = diff.missing.map((m) => {
      const agent = agentByProviderId.get(m.providerAgentId)
      touch(agent?.org_id ?? null, m.startedAt)
      return {
        agent_id: agent?.id ?? null,
        org_id: agent?.org_id ?? null,
        provider_call_id: m.providerCallId,
        direction: m.direction,
        started_at: m.startedAt,
        duration_secs: m.durationSecs,
        status: m.status,
      }
    })
    const { error } = await db.from('calls').upsert(rows, { onConflict: 'provider_call_id' })
    if (error) throw new Error(error.message)

    // Phase 17: emit call.completed for the calls the webhook never delivered
    // (keyed by provider_call_id — a no-op if the webhook already sent one).
    // These rows are sparse (no from/to/transcript — see the comment above), so
    // the payload is a minimal neutral shape. Best-effort; never fails reconcile.
    for (const m of diff.missing) {
      const orgId = agentByProviderId.get(m.providerAgentId)?.org_id
      if (!orgId) continue
      await enqueueWebhookEvent(db, {
        orgId,
        eventType: 'call.completed',
        eventKey: m.providerCallId,
        payload: {
          providerCallId: m.providerCallId,
          direction: m.direction,
          startedAt: m.startedAt,
          durationSecs: m.durationSecs,
          status: m.status,
        },
      }).catch((e) => console.error('reconcile call.completed emit failed:', e))
    }
  }

  const localById = new Map(local.map((c) => [c.provider_call_id, c]))
  for (const fix of diff.durationFixes) {
    const { error } = await db
      .from('calls')
      .update({ duration_secs: fix.to })
      .eq('provider_call_id', fix.providerCallId)
    if (error) throw new Error(error.message)
    const p = provider.find((x) => x.providerCallId === fix.providerCallId)!
    touch(localById.get(fix.providerCallId)?.org_id ?? null, p.startedAt)
  }

  for (const { orgId, period } of affected.values()) {
    const { error } = await db.rpc('recompute_usage', { p_org_id: orgId, p_period: period })
    if (error) throw new Error(`recompute_usage(${orgId}): ${error.message}`)
    // Recomputation can push an org past its cap — enforce here too.
    await enforceAfterRecompute(db, engine, orgId, period)
  }

  // Phase 14: self-heal contact links for affected orgs. The just-inserted
  // missing rows have no from/to (see contacts.ts), so this only picks up calls
  // a real webhook has since filled in — best-effort, never fails reconcile.
  for (const orgId of new Set([...affected.values()].map((a) => a.orgId))) {
    await backfillOrgContacts(db, orgId).catch((e) => console.error('backfillOrgContacts:', e))
  }

  if (diff.discrepancySecs > 120) {
    await reportDiscrepancy(
      `reconciliation: calls table was off by ${Math.round(diff.discrepancySecs / 60)} min for ` +
        `${dayStart.toISOString().slice(0, 10)} (${diff.missing.length} missing, ` +
        `${diff.durationFixes.length} duration fixes)`
    )
  }

  return {
    day: dayStart.toISOString().slice(0, 10),
    providerCalls: provider.length,
    inserted: diff.missing.length,
    corrected: diff.durationFixes.length,
    discrepancySecs: diff.discrepancySecs,
  }
}

async function enforceAfterRecompute(db: SupabaseClient, engine: VoiceEngine, orgId: string, period: string) {
  const usage = await currentPeriodUsage(db, orgId, period)
  if (!usage || usage.minutes_used < usage.minutes_cap) return
  const { data: org } = await db.from('orgs').select('overage_policy').eq('id', orgId).maybeSingle()
  if (org?.overage_policy === 'pause') await pauseOrgAgents(db, engine, orgId)
}
