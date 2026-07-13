'use server'

import { randomBytes } from 'node:crypto'
import { serviceClient, type SupabaseClient } from '@airtalk/db'
import { revalidatePath } from 'next/cache'
import { listEventTypes } from '../../lib/calcom'
import { activeOrg, type ActiveOrg } from '../../lib/org'
import { userClient } from '../../lib/supabase-server'

const CRM_PROVIDERS = ['hubspot', 'salesforce'] as const

async function requireOrg(): Promise<ActiveOrg> {
  const org = await activeOrg()
  if (!org) throw new Error('You are not a member of any organization')
  return org
}

async function requireOwner(): Promise<ActiveOrg> {
  const org = await requireOrg()
  if (org.role !== 'owner') throw new Error('Only the workspace owner can manage integrations')
  return org
}

async function currentUserEmail(db: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await db.auth.getUser()
  return user?.email ?? 'system'
}

// ── Cal.com (org-level credentials; the per-agent enable toggle lives in the
//    agent builder — setAgentBookingAction). Moved here from the per-agent form. ──
export async function connectCalcomAction(formData: FormData): Promise<{ error?: string }> {
  try {
    const org = await requireOwner()
    const apiKey = (formData.get('apiKey') as string | null)?.trim()
    const eventTypeId = Number(formData.get('eventTypeId'))
    if (!apiKey || !Number.isInteger(eventTypeId) || eventTypeId <= 0) {
      throw new Error('A Cal.com API key and event type id are required')
    }
    // Validate the key + id against Cal.com before storing anything.
    const eventTypes = await listEventTypes(apiKey).catch(() => {
      throw new Error('Cal.com rejected that API key')
    })
    if (!eventTypes.some((t) => t.id === eventTypeId)) {
      const available = eventTypes.map((t) => `${t.id} (${t.title})`).join(', ') || 'none'
      throw new Error(`Event type ${eventTypeId} not found for that key. Available: ${available}`)
    }
    // orgs are member-read-only under RLS — billing-style owner-gated service write.
    const { error } = await serviceClient()
      .from('orgs')
      .update({ calcom_api_key: apiKey, calcom_event_type_id: eventTypeId })
      .eq('id', org.orgId)
    if (error) throw new Error(error.message)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  revalidatePath('/integrations')
  return {}
}

export async function disconnectCalcomAction(): Promise<{ error?: string }> {
  try {
    const org = await requireOwner()
    // ponytail: this only clears the org key — agents already toggled to live
    // booking keep the tool attached and will error at call time until a key is
    // reconnected. Disable booking per-agent in the builder to fully turn it off.
    const { error } = await serviceClient()
      .from('orgs')
      .update({ calcom_api_key: null, calcom_event_type_id: null })
      .eq('id', org.orgId)
    if (error) throw new Error(error.message)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  revalidatePath('/integrations')
  return {}
}

// ── Outbound webhook endpoints ──────────────────────────────────────────────
export async function createWebhookEndpointAction(input: {
  url: string
  events: string[]
}): Promise<{ error?: string; secret?: string }> {
  const db = await userClient()
  try {
    const org = await requireOrg()
    const url = input.url?.trim()
    if (!url || !/^https:\/\//i.test(url)) throw new Error('Endpoint URL must be an https:// address')
    const events = (input.events ?? []).filter((e) => e === 'call.completed' || e === 'alert.fired')
    if (!events.length) throw new Error('Select at least one event to send')
    const secret = `whsec_${randomBytes(24).toString('hex')}`
    const { error } = await db.from('webhook_endpoints').insert({
      org_id: org.orgId,
      url,
      secret,
      events,
      created_by: await currentUserEmail(db),
    })
    if (error) throw new Error(error.message)
    revalidatePath('/integrations')
    // Reveal-once: the secret is returned here and masked on every later read.
    return { secret }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function setWebhookEndpointEnabledAction(id: string, enabled: boolean): Promise<{ error?: string }> {
  const db = await userClient()
  await requireOrg()
  // Kill switch (rule 3 spirit): attemptDelivery re-checks `enabled` per attempt,
  // so flipping this off stops in-flight and future deliveries immediately.
  const { error } = await db.from('webhook_endpoints').update({ enabled }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/integrations')
  return {}
}

export async function deleteWebhookEndpointAction(id: string): Promise<{ error?: string }> {
  const db = await userClient()
  await requireOrg()
  const { error } = await db.from('webhook_endpoints').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/integrations')
  return {}
}

// ── CRM waitlist (cheapest thing: a jsonb list on orgs) ─────────────────────
export async function registerInterestAction(provider: string): Promise<{ error?: string }> {
  try {
    const org = await requireOrg()
    if (!CRM_PROVIDERS.includes(provider as (typeof CRM_PROVIDERS)[number])) throw new Error('Unknown integration')
    const svc = serviceClient()
    const { data: row } = await svc.from('orgs').select('integration_interest').eq('id', org.orgId).maybeSingle()
    const current: string[] = Array.isArray(row?.integration_interest) ? row!.integration_interest : []
    if (current.includes(provider)) return {}
    // orgs is member-read-only under RLS → service write, but any member may ask.
    const { error } = await svc
      .from('orgs')
      .update({ integration_interest: [...current, provider] })
      .eq('id', org.orgId)
    if (error) throw new Error(error.message)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  revalidatePath('/integrations')
  return {}
}
