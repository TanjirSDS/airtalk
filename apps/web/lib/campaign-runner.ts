import type { SupabaseClient } from '@airtalk/db'
import type { VoiceEngine } from '@airtalk/engine'
import {
  CHUNK_SIZE,
  clampWindow,
  estimatedSpendCents,
  isDialableNow,
  type CallingWindow,
} from './campaign-math'

// One runner tick (rule 3: cap + kill switch on every money loop). The Inngest
// function calls this between sleeps, so pause/kill are honored within one tick
// (≤30s) and every tick re-reads status, spend, and the do-not-call list from
// the database — nothing about the campaign is cached across ticks.

export type ChunkResult =
  | { kind: 'stopped' } // paused/killed/deleted — the loop exits
  | { kind: 'done'; reason: 'exhausted' | 'spend_cap' }
  | { kind: 'dialed'; count: number }
  | { kind: 'wait'; why: string } // nothing dialable right now — long sleep

export async function dialChunk(
  db: SupabaseClient,
  engine: VoiceEngine,
  campaignId: string,
  now = new Date()
): Promise<ChunkResult> {
  const { data: campaign } = await db
    .from('campaigns')
    .select('id, org_id, status, calling_window, spend_cap_cents, agents(status, provider_agent_id)')
    .eq('id', campaignId)
    .maybeSingle()
  if (!campaign || campaign.status !== 'running') return { kind: 'stopped' }

  const agent = campaign.agents as unknown as { status: string; provider_agent_id: string | null } | null
  if (!agent?.provider_agent_id || agent.status !== 'active') {
    // Cap/dunning pause detached the org's numbers — dialing would just fail.
    return { kind: 'wait', why: 'agent paused' }
  }

  // Spend guard: completed call minutes + a flat estimate per call in flight.
  const { data: dialed } = await db
    .from('campaign_contacts')
    .select('provider_call_id, status')
    .eq('campaign_id', campaignId)
    .not('provider_call_id', 'is', null)
  const inFlight = (dialed ?? []).filter((c) => c.status === 'calling').length
  let completedSecs = 0
  const ids = (dialed ?? []).map((c) => c.provider_call_id as string)
  for (let i = 0; i < ids.length; i += 200) {
    const { data: calls } = await db
      .from('calls')
      .select('duration_secs')
      .in('provider_call_id', ids.slice(i, i + 200))
    completedSecs += (calls ?? []).reduce((s, c) => s + (c.duration_secs ?? 0), 0)
  }
  if (estimatedSpendCents(completedSecs, inFlight) >= campaign.spend_cap_cents) {
    await db.from('campaigns').update({ status: 'done' }).eq('id', campaignId)
    return { kind: 'done', reason: 'spend_cap' }
  }

  const { data: pending } = await db
    .from('campaign_contacts')
    .select('id, e164, vars')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .limit(200)
  if (!pending?.length) {
    await db.from('campaigns').update({ status: 'done' }).eq('id', campaignId)
    return { kind: 'done', reason: 'exhausted' }
  }

  // Dial-time opt-out scrub: numbers opted out since upload are never dialed.
  const { data: optedOut } = await db
    .from('opt_outs')
    .select('e164')
    .eq('org_id', campaign.org_id)
    .in('e164', pending.map((c) => c.e164))
  const optedSet = new Set((optedOut ?? []).map((o) => o.e164))
  if (optedSet.size) {
    await db
      .from('campaign_contacts')
      .update({ status: 'opted_out' })
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .in('e164', [...optedSet])
  }

  const window = clampWindow(campaign.calling_window as Partial<CallingWindow>)
  const dialable = pending
    .filter((c) => !optedSet.has(c.e164))
    .filter((c) => isDialableNow(c.e164, window, now))
    .slice(0, CHUNK_SIZE)
  if (!dialable.length) return { kind: 'wait', why: 'outside calling window' }

  let count = 0
  for (const contact of dialable) {
    try {
      const { providerCallId } = await engine.startOutboundCall(
        agent.provider_agent_id,
        contact.e164,
        (contact.vars ?? undefined) as Record<string, string> | undefined
      )
      await db
        .from('campaign_contacts')
        .update({ status: 'calling', provider_call_id: providerCallId })
        .eq('id', contact.id)
      count++
    } catch (e) {
      console.error(`campaign ${campaignId}: dial ${contact.e164} failed:`, e)
      await db.from('campaign_contacts').update({ status: 'failed' }).eq('id', contact.id)
    }
  }
  return { kind: 'dialed', count }
}
