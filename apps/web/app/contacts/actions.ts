'use server'

import { revalidatePath } from 'next/cache'
import { activeOrg } from '../../lib/org'
import { userClient } from '../../lib/supabase-server'

export interface ContactPatch {
  first_name?: string | null
  last_name?: string | null
  external_id?: string | null
  notes?: string | null
  dnc?: boolean
}

const empty = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null)

/** Shared by the /contacts detail panel and the call drawer's Contact panel.
 *  RLS scopes the update to the caller's org — no explicit org check needed. */
export async function updateContactAction(id: string, patch: ContactPatch): Promise<{ error?: string }> {
  const db = await userClient()
  const clean: ContactPatch = {}
  if ('first_name' in patch) clean.first_name = empty(patch.first_name)
  if ('last_name' in patch) clean.last_name = empty(patch.last_name)
  if ('external_id' in patch) clean.external_id = empty(patch.external_id)
  if ('notes' in patch) clean.notes = empty(patch.notes)
  if ('dnc' in patch) clean.dnc = !!patch.dnc
  const { error } = await db.from('contacts').update(clean).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/contacts')
  revalidatePath('/calls')
  return {}
}

export interface ImportRow {
  e164: string
  first_name?: string
  last_name?: string
  external_id?: string
  notes?: string
}

/** CSV import: merge on (org_id, e164). Names/external_id/notes are updated;
 *  dnc is never in the payload, so an existing opt-out flag is never cleared. */
export async function importContactsAction(rows: ImportRow[]): Promise<{ imported: number; skipped: number; error?: string }> {
  const org = await activeOrg()
  if (!org) return { imported: 0, skipped: 0, error: 'No active workspace' }
  const db = await userClient()

  let skipped = 0
  const payload = rows
    .map((r) => {
      const e164 = (r.e164 ?? '').replace(/[^\d+]/g, '')
      if (e164.replace(/\D/g, '').length < 7) {
        skipped++
        return null
      }
      return {
        org_id: org.orgId,
        e164,
        first_name: empty(r.first_name),
        last_name: empty(r.last_name),
        external_id: empty(r.external_id),
        notes: empty(r.notes),
      }
    })
    .filter(Boolean) as Record<string, unknown>[]

  if (!payload.length) return { imported: 0, skipped, error: skipped ? 'No valid phone numbers found' : undefined }

  const { error } = await db.from('contacts').upsert(payload, { onConflict: 'org_id,e164' })
  if (error) return { imported: 0, skipped, error: error.message }
  revalidatePath('/contacts')
  return { imported: payload.length, skipped }
}

export interface RelatedCall {
  id: string
  started_at: string | null
  direction: string | null
  outcome: string | null
  from_e164: string | null
  to_e164: string | null
}

export async function getContactCallsAction(contactId: string): Promise<RelatedCall[]> {
  const db = await userClient()
  const { data } = await db
    .from('calls')
    .select('id, started_at, direction, outcome, from_e164, to_e164')
    .eq('contact_id', contactId)
    .order('started_at', { ascending: false })
    .limit(50)
  return (data ?? []) as RelatedCall[]
}
