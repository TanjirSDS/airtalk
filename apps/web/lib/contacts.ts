import type { SupabaseClient } from '@airtalk/db'
import { externalNumber } from './opt-out'

// Phase 14: a contact is one row per (org, phone number). The post-call webhook
// creates + links it (it has the e164); reconcile-inserted rows have no phone
// number on the provider list payload, so they self-heal here on the nightly
// pass (and via the backfill script) once a real payload fills from/to.

/** Idempotent: insert on conflict do nothing, then read the id back. db must be
 *  the service client (called from webhook/cron/scripts, RLS-bypassed). */
export async function upsertContact(
  db: SupabaseClient,
  orgId: string,
  e164: string
): Promise<string | null> {
  const { error } = await db
    .from('contacts')
    .upsert({ org_id: orgId, e164 }, { onConflict: 'org_id,e164', ignoreDuplicates: true })
  if (error) {
    console.error('upsertContact:', error.message)
    return null
  }
  const { data } = await db
    .from('contacts')
    .select('id')
    .eq('org_id', orgId)
    .eq('e164', e164)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Link every unlinked call that HAS a phone number to its contact. Idempotent
 * (only touches contact_id-null rows; upsertContact dedups) — run twice, same
 * counts. Powers `npm run backfill-contacts` and the nightly reconcile self-heal.
 * ponytail: two queries per call (upsert + update); fine for the unlinked delta,
 * batch by (org,number) if a backfill of millions of rows ever gets slow.
 */
export async function backfillOrgContacts(
  db: SupabaseClient,
  orgId?: string
): Promise<{ linked: number }> {
  let linked = 0
  const PAGE = 1000
  for (;;) {
    let q = db
      .from('calls')
      .select('id, org_id, direction, from_e164, to_e164')
      .is('contact_id', null)
      .not('org_id', 'is', null)
      .limit(PAGE)
    if (orgId) q = q.eq('org_id', orgId)
    const { data, error } = await q
    if (error) throw new Error(`backfill select: ${error.message}`)
    const rows = data ?? []
    // Rows without a number (reconcile inserts) can't be linked — stop when a
    // page yields no linkable row, or we'd loop forever on the same page.
    let linkedThisPage = 0
    for (const c of rows) {
      const e164 = externalNumber(c)
      if (!e164 || !c.org_id) continue
      const contactId = await upsertContact(db, c.org_id, e164)
      if (!contactId) continue
      const { error: upd } = await db.from('calls').update({ contact_id: contactId }).eq('id', c.id)
      if (upd) throw new Error(`backfill link: ${upd.message}`)
      linked++
      linkedThisPage++
    }
    if (rows.length < PAGE || linkedThisPage === 0) break
  }
  return { linked }
}
