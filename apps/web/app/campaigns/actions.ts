'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { clampWindow, dedupeContacts, type CallingWindow } from '../../lib/campaign-math'
import { emit } from '../../lib/events'
import { activeOrg } from '../../lib/org'
import { userClient } from '../../lib/supabase-server'

// All writes ride the RLS-scoped user client (Phase 4 pattern): a member can
// only ever create/control campaigns in their own org.

const MAX_CONTACTS = 5000

export async function createCampaignAction(input: {
  name: string
  agentId: string
  window: CallingWindow
  spendCapCents: number
  consent: boolean
  contacts: { phone: string; vars: Record<string, string> }[]
}) {
  const db = await userClient()
  let id: string
  try {
    const org = await activeOrg()
    if (!org) throw new Error('You are not a member of any organization')
    // Rule 3 + TCPA: no attestation, no campaign. The checkbox is UX; this is the gate.
    if (input.consent !== true) {
      throw new Error('You must attest that every contact gave prior consent to be called')
    }
    if (!input.name.trim()) throw new Error('Campaign needs a name')
    if (!Number.isInteger(input.spendCapCents) || input.spendCapCents <= 0) {
      throw new Error('Spend cap must be a positive amount')
    }

    // RLS scope: a foreign agent id must 404 here — the runner dials with the
    // service role, so this is the gate that keeps campaigns on the org's own agents.
    const { data: agent } = await db.from('agents').select('id').eq('id', input.agentId).maybeSingle()
    if (!agent) throw new Error('Agent not found')

    const { contacts } = dedupeContacts(input.contacts) // re-normalize server-side
    if (!contacts.length) throw new Error('No valid phone numbers in the list')
    if (contacts.length > MAX_CONTACTS) {
      throw new Error(`Campaigns are capped at ${MAX_CONTACTS} contacts`)
    }

    // Upload-time scrub against the org's do-not-call list (the runner scrubs
    // again at dial time). Scrubbed rows are kept as opted_out for visibility.
    const opted = new Set<string>()
    const numbers = contacts.map((c) => c.e164)
    for (let i = 0; i < numbers.length; i += 500) {
      const { data } = await db
        .from('opt_outs')
        .select('e164')
        .eq('org_id', org.orgId)
        .in('e164', numbers.slice(i, i + 500))
      for (const row of data ?? []) opted.add(row.e164)
    }

    const {
      data: { user },
    } = await db.auth.getUser()
    const { data: campaign, error } = await db
      .from('campaigns')
      .insert({
        org_id: org.orgId,
        agent_id: input.agentId,
        name: input.name.trim(),
        calling_window: clampWindow(input.window),
        spend_cap_cents: input.spendCapCents,
        consent_attested_at: new Date().toISOString(),
        created_by: user!.id,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    id = campaign.id

    const rows = contacts.map((c) => ({
      campaign_id: id,
      e164: c.e164,
      vars: c.vars,
      status: opted.has(c.e164) ? 'opted_out' : 'pending',
    }))
    for (let i = 0; i < rows.length; i += 500) {
      const { error: insErr } = await db.from('campaign_contacts').insert(rows.slice(i, i + 500))
      if (insErr) throw new Error(insErr.message)
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  redirect(`/campaigns/${id}`)
}

/** Draft/paused → running, and kick the Inngest loop. */
export async function startCampaignAction(id: string) {
  const db = await userClient()
  const { data: prev, error } = await db.from('campaigns').select('status').eq('id', id).single()
  if (error) throw new Error(error.message)
  if (prev.status !== 'draft' && prev.status !== 'paused') {
    throw new Error(`Cannot start a ${prev.status} campaign`)
  }
  const { error: updErr } = await db.from('campaigns').update({ status: 'running' }).eq('id', id)
  if (updErr) throw new Error(updErr.message)
  if (!(await emit('campaign/run', { campaignId: id }))) {
    await db.from('campaigns').update({ status: prev.status }).eq('id', id)
    throw new Error('Background runner unavailable — campaign not started')
  }
  revalidatePath(`/campaigns/${id}`)
}

/** The runner sees the flip at its next tick (≤30s) and stops dialing. */
export async function pauseCampaignAction(id: string) {
  const db = await userClient()
  const { error } = await db.from('campaigns').update({ status: 'paused' }).eq('id', id).eq('status', 'running')
  if (error) throw new Error(error.message)
  revalidatePath(`/campaigns/${id}`)
}

/** Kill switch (rule 3): terminal, no resume. Dialing stops within one tick. */
export async function killCampaignAction(id: string) {
  const db = await userClient()
  const { error } = await db
    .from('campaigns')
    .update({ status: 'killed' })
    .eq('id', id)
    .in('status', ['draft', 'running', 'paused'])
  if (error) throw new Error(error.message)
  revalidatePath(`/campaigns/${id}`)
}
