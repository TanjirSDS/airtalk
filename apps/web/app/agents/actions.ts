'use server'

import { getEnv, serviceClient, type SupabaseClient } from '@airtalk/db'
import {
  applySuggestionToProfile,
  buildAgentConfig,
  type BusinessProfile,
  type SuggestionPayload,
  type SuggestionType,
  type TemplateKey,
} from '@airtalk/engine/templates'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { calcomBookingTool, listEventTypes } from '../../lib/calcom'
import { appUrl } from '../../lib/email'
import { makeEngine } from '../../lib/engine'
import { activeOrg, type ActiveOrg } from '../../lib/org'
import { userClient } from '../../lib/supabase-server'
import type { StoredAgentConfig } from '../../lib/types'

// Phase 4: all DB access here goes through the RLS-scoped user client, so a
// member can only ever touch their own org's rows — no manual org checks.

async function requireOrg(): Promise<ActiveOrg> {
  const org = await activeOrg()
  if (!org) throw new Error('You are not a member of any organization')
  return org
}

// Rule 4: every save appends a version row; version numbers are per-agent.
// ponytail: read-max+1 has a race under concurrent saves — the unique(agent_id,
// version) constraint turns that into an error instead of silent corruption.
async function insertVersion(db: SupabaseClient, agentId: string, config: StoredAgentConfig) {
  const { data } = await db
    .from('agent_config_versions')
    .select('version')
    .eq('agent_id', agentId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const version = (data?.version ?? 0) + 1
  const { error } = await db
    .from('agent_config_versions')
    .insert({ agent_id: agentId, version, config })
  if (error) throw new Error(error.message)
  return version
}

async function getAgentRow(db: SupabaseClient, id: string) {
  const { data, error } = await db.from('agents').select('*').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data
}

export async function createAgentAction(input: {
  template: TemplateKey
  profile: BusinessProfile
  /** Signup flow continues to the number step; default is the agent page. */
  redirectTo?: string
}) {
  const db = await userClient()
  let id: string
  try {
    const org = await requireOrg()
    // Plan limit (Phase 4). The wizard page also checks — this is the real gate.
    const { count } = await db
      .from('agents')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.orgId)
    if ((count ?? 0) >= org.plan.maxAgents) {
      throw new Error(`Your ${org.plan.name} plan allows ${org.plan.maxAgents} agent(s)`)
    }

    const agentConfig = buildAgentConfig(input.template, input.profile)
    const { providerAgentId } = await makeEngine().createAgent(agentConfig)
    const stored: StoredAgentConfig = { template: input.template, profile: input.profile, agentConfig }
    const { data, error } = await db
      .from('agents')
      .insert({
        org_id: org.orgId,
        name: agentConfig.name,
        provider: 'elevenlabs',
        provider_agent_id: providerAgentId,
        config: stored,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    id = data.id
    await insertVersion(db, id, stored)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  // outside try — redirect() works by throwing; same-origin paths only
  const dest =
    input.redirectTo?.startsWith('/') && !input.redirectTo.startsWith('//')
      ? input.redirectTo
      : `/agents/${id}`
  redirect(dest)
}

export async function updateAgentAction(
  agentId: string,
  input: { template: TemplateKey; profile: BusinessProfile }
) {
  const db = await userClient()
  try {
    const agent = await getAgentRow(db, agentId)
    const agentConfig = buildAgentConfig(input.template, input.profile)
    await makeEngine().updateAgent(agent.provider_agent_id, agentConfig)
    const stored: StoredAgentConfig = { template: input.template, profile: input.profile, agentConfig }
    const { error } = await db
      .from('agents')
      .update({ name: agentConfig.name, config: stored })
      .eq('id', agentId)
    if (error) throw new Error(error.message)
    const version = await insertVersion(db, agentId, stored)
    revalidatePath(`/agents/${agentId}`)
    return { version }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** Re-applies an old version via the adapter and appends it as the newest version. */
export async function rollbackAgentAction(agentId: string, version: number) {
  const db = await userClient()
  const agent = await getAgentRow(db, agentId)
  const { data: old, error } = await db
    .from('agent_config_versions')
    .select('config')
    .eq('agent_id', agentId)
    .eq('version', version)
    .single()
  if (error) throw new Error(error.message)
  const stored = old.config as StoredAgentConfig
  await makeEngine().updateAgent(agent.provider_agent_id, stored.agentConfig)
  const { error: updErr } = await db
    .from('agents')
    .update({ name: stored.agentConfig.name, config: stored })
    .eq('id', agentId)
  if (updErr) throw new Error(updErr.message)
  await insertVersion(db, agentId, stored)
  revalidatePath(`/agents/${agentId}`)
}

/**
 * Phase 8: apply reviewed suggestions (one or a batch). All selected rows merge
 * into the profile, the adapter gets ONE update, and ONE new version row is
 * appended — so a batch-apply is a single rollback target. Rows that can't
 * merge (kb_gaps, duplicates) are skipped, not failed.
 */
export async function applySuggestionsAction(agentId: string, formData: FormData) {
  const db = await userClient()
  const org = await requireOrg()
  if (!org.plan.adaptiveEnabled) throw new Error('Adaptive learning requires the Pro plan')
  const ids = (formData.getAll('id') as string[]).filter(Boolean)
  if (!ids.length) throw new Error('No suggestions selected')
  // The single-card FAQ form lets the owner edit the drafted answer before applying.
  const answerOverride = ids.length === 1 ? (formData.get('answer') as string | null)?.trim() : null

  const agent = await getAgentRow(db, agentId)
  const stored = agent.config as StoredAgentConfig | null
  if (!stored?.profile) throw new Error('This agent has no editable business profile')

  const { data: rows, error } = await db
    .from('agent_suggestions')
    .select('id, type, suggestion')
    .eq('agent_id', agentId)
    .eq('status', 'pending')
    .in('id', ids)
  if (error) throw new Error(error.message)

  let profile = stored.profile
  const applied: string[] = []
  for (const row of rows ?? []) {
    const payload: SuggestionPayload = { ...(row.suggestion as SuggestionPayload) }
    if (answerOverride) payload.a = answerOverride
    const merged = applySuggestionToProfile(profile, row.type as SuggestionType, payload)
    if (merged) {
      profile = merged
      applied.push(row.id)
    }
  }
  if (!applied.length) {
    throw new Error('Nothing could be applied — knowledge gaps need information only you can add')
  }

  const agentConfig = buildAgentConfig(stored.template, profile)
  await makeEngine().updateAgent(agent.provider_agent_id, agentConfig)
  const newStored: StoredAgentConfig = { template: stored.template, profile, agentConfig }
  const { error: updErr } = await db
    .from('agents')
    .update({ name: agentConfig.name, config: newStored })
    .eq('id', agentId)
  if (updErr) throw new Error(updErr.message)
  const version = await insertVersion(db, agentId, newStored)
  const { error: markErr } = await db
    .from('agent_suggestions')
    .update({ status: 'applied', applied_version: version })
    .in('id', applied)
  if (markErr) throw new Error(markErr.message)
  revalidatePath(`/agents/${agentId}/learning`)
  revalidatePath(`/agents/${agentId}`)
}

export async function dismissSuggestionAction(agentId: string, suggestionId: string) {
  const db = await userClient()
  const { error } = await db
    .from('agent_suggestions')
    .update({ status: 'dismissed' })
    .eq('id', suggestionId)
    .eq('status', 'pending')
  if (error) throw new Error(error.message)
  revalidatePath(`/agents/${agentId}/learning`)
}

export async function addKnowledgeAction(agentId: string, formData: FormData) {
  const db = await userClient()
  const org = await requireOrg()
  if (!org.plan.kbEnabled) throw new Error('Knowledge base requires the Growth plan or higher')
  const agent = await getAgentRow(db, agentId)
  const url = (formData.get('url') as string | null)?.trim()
  const file = formData.get('file') as File | null
  if (url) {
    await makeEngine().addKnowledge(agent.provider_agent_id, { url })
  } else if (file && file.size > 0) {
    await makeEngine().addKnowledge(agent.provider_agent_id, {
      file: { name: file.name, data: file },
    })
  }
  revalidatePath(`/agents/${agentId}`)
}

export async function removeKnowledgeAction(agentId: string, knowledgeId: string) {
  const db = await userClient()
  const agent = await getAgentRow(db, agentId)
  await makeEngine().removeKnowledge(agent.provider_agent_id, knowledgeId)
  revalidatePath(`/agents/${agentId}`)
}

/**
 * Phase 7: connect Cal.com and turn the booking agent's capture-only flow into
 * real booking — store the org's key, attach the check_availability_and_book
 * tool at the provider, and re-render the prompt with liveBooking on (rule 4:
 * the config change lands as a new version row).
 */
export async function connectCalcomAction(agentId: string, formData: FormData) {
  const db = await userClient()
  try {
    const org = await requireOrg()
    if (org.role !== 'owner') throw new Error('Only the org owner can connect a calendar')
    const env = getEnv()
    if (!env.APP_URL || !env.AGENT_TOOLS_SECRET) {
      throw new Error('APP_URL and AGENT_TOOLS_SECRET must be configured for agent tools')
    }

    const apiKey = (formData.get('apiKey') as string | null)?.trim()
    const eventTypeId = Number(formData.get('eventTypeId'))
    if (!apiKey || !Number.isInteger(eventTypeId) || eventTypeId <= 0) {
      throw new Error('A Cal.com API key and event type id are required')
    }

    const agent = await getAgentRow(db, agentId)
    const stored = agent.config as StoredAgentConfig | null
    if (stored?.template !== 'booking' || !stored.profile) {
      throw new Error('Live booking only applies to booking-template agents')
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

    const engine = makeEngine()
    await engine.setAgentTools(agent.provider_agent_id, [
      calcomBookingTool(agentId, appUrl(), env.AGENT_TOOLS_SECRET),
    ])
    const profile: BusinessProfile = { ...stored.profile, liveBooking: true }
    const agentConfig = buildAgentConfig('booking', profile)
    await engine.updateAgent(agent.provider_agent_id, agentConfig)
    const newStored: StoredAgentConfig = { template: 'booking', profile, agentConfig }
    const { error: updErr } = await db
      .from('agents')
      .update({ config: newStored })
      .eq('id', agentId)
    if (updErr) throw new Error(updErr.message)
    await insertVersion(db, agentId, newStored)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  revalidatePath(`/agents/${agentId}`)
}
