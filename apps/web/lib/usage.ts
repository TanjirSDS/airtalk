import type { SupabaseClient } from '@airtalk/db'
import type { VoiceEngine } from '@airtalk/engine'
import { emit } from './events'

export type UsageCrossing = 'warn' | 'cap' | null

/** Which threshold did this call push the period across? Crossing-based so a
 *  warn/pause fires exactly once, not on every call past the line. */
export function usageCrossing(prevMinutes: number, newMinutes: number, capMinutes: number): UsageCrossing {
  if (prevMinutes < capMinutes && newMinutes >= capMinutes) return 'cap'
  if (prevMinutes < capMinutes * 0.8 && newMinutes >= capMinutes * 0.8) return 'warn'
  return null
}

/** A specific period's usage row via the service client (reconciliation). */
export async function currentPeriodUsage(db: SupabaseClient, orgId: string, periodStart: string) {
  const { data } = await db
    .from('usage_periods')
    .select('minutes_used, minutes_cap, overage_minutes')
    .eq('org_id', orgId)
    .eq('period_start', periodStart)
    .maybeSingle()
  return data
}

/** Pause = stop answering: mark agents paused and detach their numbers at the
 *  provider. phone_numbers rows keep agent_id + provider_number_id so resume
 *  can re-attach. Idempotent. */
export async function pauseOrgAgents(db: SupabaseClient, engine: VoiceEngine, orgId: string) {
  await db.from('agents').update({ status: 'paused' }).eq('org_id', orgId).eq('status', 'active')
  const { data: numbers } = await db
    .from('phone_numbers')
    .select('provider_number_id')
    .eq('org_id', orgId)
    .not('provider_number_id', 'is', null)
  for (const n of numbers ?? []) {
    await engine
      .detachNumber(n.provider_number_id)
      .catch((e) => console.error(`detachNumber(${n.provider_number_id}) failed:`, e))
  }
}

/** Undo pauseOrgAgents (payment recovered, cap raised): reactivate agents and
 *  re-attach their numbers at the provider. Idempotent. */
export async function resumeOrgAgents(db: SupabaseClient, engine: VoiceEngine, orgId: string) {
  await db.from('agents').update({ status: 'active' }).eq('org_id', orgId).eq('status', 'paused')
  const { data: numbers } = await db
    .from('phone_numbers')
    .select('provider_number_id, agents(provider_agent_id)')
    .eq('org_id', orgId)
    .not('provider_number_id', 'is', null)
    .not('agent_id', 'is', null)
  for (const n of numbers ?? []) {
    const providerAgentId = (n.agents as any)?.provider_agent_id
    if (!providerAgentId) continue
    await engine
      .attachNumber(n.provider_number_id, providerAgentId)
      .catch((e) => console.error(`attachNumber(${n.provider_number_id}) failed:`, e))
  }
}

/**
 * Atomically add a call's seconds to the org's current usage period (SQL
 * function — never read-modify-write) and enforce thresholds:
 * 80% → warn (email later, log for now); 100% → pause or count overage
 * per the org's overage_policy. db must be the service client.
 */
export async function recordCallUsage(
  db: SupabaseClient,
  engine: VoiceEngine,
  orgId: string,
  durationSecs: number
) {
  const { data, error } = await db.rpc('record_call_usage', {
    p_org_id: orgId,
    p_secs: durationSecs,
  })
  if (error) throw new Error(`record_call_usage: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return

  const crossing = usageCrossing(row.prev_minutes, row.new_minutes, row.cap_minutes)
  if (crossing === 'warn') {
    console.warn(`org ${orgId} passed 80% of its minute cap (${row.new_minutes}/${row.cap_minutes})`)
    // Phase 6: owner email rides Inngest; crossing-based, so it fires exactly once.
    await emit('usage/warned', {
      orgId,
      minutesUsed: row.new_minutes,
      capMinutes: row.cap_minutes,
    })
  } else if (crossing === 'cap') {
    const { data: org } = await db.from('orgs').select('overage_policy').eq('id', orgId).maybeSingle()
    if (org?.overage_policy === 'pause') {
      console.warn(`org ${orgId} hit its minute cap — pausing agents`)
      await pauseOrgAgents(db, engine, orgId)
    }
    // 'overage': record_call_usage already accumulates overage_minutes.
    await emit('usage/capped', {
      orgId,
      capMinutes: row.cap_minutes,
      policy: org?.overage_policy ?? 'pause',
    })
  }
}
