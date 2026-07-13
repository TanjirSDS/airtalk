import type { SupabaseClient } from '@airtalk/db'

// Phase 7: honoring "remove me". The classifier labels the call opt_out; this
// records the number on the org's permanent do-not-call list and pulls it out
// of every campaign that hasn't dialed it yet. The runner also re-checks
// opt_outs at dial time, so a number opted out mid-campaign is never called.

/** The non-agent side of a call: who we dialed, or who called us. */
export function externalNumber(call: {
  direction: string | null
  from_e164: string | null
  to_e164: string | null
}): string | null {
  return call.direction === 'outbound' ? call.to_e164 : call.from_e164
}

/** Idempotent — safe to run on classifier retries. db must be the service client. */
export async function recordOptOut(db: SupabaseClient, orgId: string, e164: string, source = 'call') {
  const { error } = await db
    .from('opt_outs')
    .upsert({ org_id: orgId, e164, source }, { onConflict: 'org_id,e164', ignoreDuplicates: true })
  if (error) throw new Error(`opt_outs insert: ${error.message}`)

  // Phase 14: mirror onto contacts.dnc for DISPLAY. opt_outs above is the
  // enforcement source; a missing contact row just means nothing to flag yet.
  await db.from('contacts').update({ dnc: true }).eq('org_id', orgId).eq('e164', e164)

  const { data: campaigns } = await db.from('campaigns').select('id').eq('org_id', orgId)
  if (campaigns?.length) {
    await db
      .from('campaign_contacts')
      .update({ status: 'opted_out' })
      .eq('e164', e164)
      .eq('status', 'pending')
      .in('campaign_id', campaigns.map((c) => c.id))
  }
}
