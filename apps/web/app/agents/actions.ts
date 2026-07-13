'use server'

import { randomBytes } from 'node:crypto'
import { getEnv, serviceClient, type SupabaseClient } from '@airtalk/db'
import type { AgentConfig } from '@airtalk/engine'
import {
  applySuggestionToPrompt,
  buildAgentConfig,
  DEFAULT_ANALYSIS,
  ensureDisclosureAndConduct,
  normalizeStoredConfig,
  type AgentType,
  type BusinessProfile,
  type StoredAgentConfig,
  type SuggestionPayload,
  type SuggestionType,
  type TemplateKey,
} from '@airtalk/engine/templates'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { calcomBookingTool, listEventTypes } from '../../lib/calcom'
import { appUrl } from '../../lib/email'
import { makeEngine } from '../../lib/engine'
import { generateAgentDraft } from '../../lib/generate-agent'
import { activeOrg, type ActiveOrg } from '../../lib/org'
import { userClient } from '../../lib/supabase-server'

// Phase 4: all DB access here goes through the RLS-scoped user client, so a
// member can only ever touch their own org's rows — no manual org checks.

async function requireOrg(): Promise<ActiveOrg> {
  const org = await activeOrg()
  if (!org) throw new Error('You are not a member of any organization')
  return org
}

/** updated_by (Phase 10): the signed-in user's email, set on every mutation. */
async function currentUserEmail(db: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await db.auth.getUser()
  return user?.email ?? 'system'
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

function validConfig(c: AgentConfig | undefined): c is AgentConfig {
  return !!c && typeof c.name === 'string' && typeof c.systemPrompt === 'string' && typeof c.voiceId === 'string'
}

/**
 * The one create path (rule 4: provider agent → row → version 1). Every surface
 * — the create modal, import, duplicate and the signup wizard — funnels here.
 * agentConfig never carries provider ids, so a fresh provider agent is minted.
 */
async function createStoredAgent(
  db: SupabaseClient,
  org: ActiveOrg,
  stored: StoredAgentConfig,
  email: string
): Promise<string> {
  if (!validConfig(stored.agentConfig)) throw new Error('Invalid agent configuration')
  // Plan limit (Phase 4). Create surfaces show it as UX — this is the real gate.
  const { count } = await db
    .from('agents')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.orgId)
  if ((count ?? 0) >= org.plan.maxAgents) {
    throw new Error(`Your ${org.plan.name} plan allows ${org.plan.maxAgents} agent(s)`)
  }

  // Phase 12: seed Retell-parity post-call analysis + an explicit public widget on
  // NEW agents (existing agents pick these up on next save — never a mass-PATCH).
  const agentConfig: AgentConfig = {
    ...stored.agentConfig,
    analysis: stored.agentConfig.analysis ?? DEFAULT_ANALYSIS,
    widget: stored.agentConfig.widget ?? { public: true },
  }
  const seeded: StoredAgentConfig = { ...stored, agentConfig }

  const { providerAgentId } = await makeEngine().createAgent(agentConfig)
  const { data, error } = await db
    .from('agents')
    .insert({
      org_id: org.orgId,
      name: agentConfig.name,
      provider: 'elevenlabs',
      provider_agent_id: providerAgentId,
      config: seeded,
      agent_type: seeded.agentType,
      updated_by: email,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  await insertVersion(db, data.id, seeded)
  return data.id
}

export async function createAgentAction(input: {
  agentType: AgentType
  /** null for scratch / generated / imported agents. */
  template: TemplateKey | null
  seed?: BusinessProfile
  agentConfig: AgentConfig
  /** Signup flow continues to the number step; default is the agent page. */
  redirectTo?: string
}) {
  const db = await userClient()
  let id: string
  try {
    const org = await requireOrg()
    const email = await currentUserEmail(db)
    const stored: StoredAgentConfig = {
      agentType: input.agentType,
      template: input.template,
      ...(input.seed ? { seed: input.seed } : {}),
      agentConfig: input.agentConfig,
    }
    id = await createStoredAgent(db, org, stored, email)
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

/** Freeform-first edit (Phase 10/11): the prompt text is the source of truth.
 *  firstMessage '' ⇒ user speaks first. llm/language are concrete (picker-driven).
 *  Phase 12: the whole settings accordion (speech/transcription/call/analysis/
 *  widget) rides this ONE save — one updateAgent + one version row (rule 4). */
export async function updateAgentAction(
  agentId: string,
  input: {
    name: string
    systemPrompt: string
    firstMessage: string
    voiceId: string
    llm?: string
    language?: string
    speech?: AgentConfig['speech']
    transcription?: AgentConfig['transcription']
    call?: AgentConfig['call']
    analysis?: AgentConfig['analysis']
    widget?: AgentConfig['widget']
  }
) {
  const db = await userClient()
  try {
    const email = await currentUserEmail(db)
    const agent = await getAgentRow(db, agentId)
    const stored = normalizeStoredConfig(agent.config)
    const agentConfig: AgentConfig = {
      ...stored.agentConfig,
      name: input.name.trim() || stored.agentConfig.name,
      systemPrompt: input.systemPrompt,
      firstMessage: input.firstMessage,
      voiceId: input.voiceId,
      ...(input.llm ? { llm: input.llm } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.speech && { speech: input.speech }),
      ...(input.transcription && { transcription: input.transcription }),
      ...(input.call && { call: input.call }),
      ...(input.analysis && { analysis: input.analysis }),
      ...(input.widget && { widget: input.widget }),
    }
    if (!validConfig(agentConfig)) throw new Error('Name, prompt and voice are required')
    await makeEngine().updateAgent(agent.provider_agent_id, agentConfig)
    const newStored: StoredAgentConfig = { ...stored, agentConfig }
    const { error } = await db
      .from('agents')
      .update({
        name: agentConfig.name,
        config: newStored,
        updated_by: email,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agentId)
    if (error) throw new Error(error.message)
    const version = await insertVersion(db, agentId, newStored)
    revalidatePath(`/agents/${agentId}`)
    return { version }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** Re-applies an old version via the adapter and appends it as the newest version. */
export async function rollbackAgentAction(agentId: string, version: number) {
  const db = await userClient()
  const email = await currentUserEmail(db)
  const agent = await getAgentRow(db, agentId)
  const { data: old, error } = await db
    .from('agent_config_versions')
    .select('config')
    .eq('agent_id', agentId)
    .eq('version', version)
    .single()
  if (error) throw new Error(error.message)
  const stored = normalizeStoredConfig(old.config)
  await makeEngine().updateAgent(agent.provider_agent_id, stored.agentConfig)
  const { error: updErr } = await db
    .from('agents')
    .update({
      name: stored.agentConfig.name,
      config: stored,
      updated_by: email,
      updated_at: new Date().toISOString(),
    })
    .eq('id', agentId)
  if (updErr) throw new Error(updErr.message)
  await insertVersion(db, agentId, stored)
  revalidatePath(`/agents/${agentId}`)
}

/** Copy an agent: fresh provider agent + row "Copy of X" + version 1 (rule 4). */
export async function duplicateAgentAction(agentId: string) {
  const db = await userClient()
  try {
    const org = await requireOrg()
    const email = await currentUserEmail(db)
    const agent = await getAgentRow(db, agentId)
    const stored = normalizeStoredConfig(agent.config)
    const copy: StoredAgentConfig = {
      ...stored,
      agentConfig: { ...stored.agentConfig, name: `Copy of ${stored.agentConfig.name}` },
    }
    await createStoredAgent(db, org, copy, email)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  revalidatePath('/agents')
}

/**
 * Delete an agent. Blocked (rule 3) while a campaign is running/paused — stop it
 * first. Numbers are detached at the provider before delete; 0009's FKs then
 * null out call history / number rows and cascade away done/draft campaigns.
 */
export async function deleteAgentAction(agentId: string) {
  const db = await userClient()
  try {
    const agent = await getAgentRow(db, agentId)
    const { data: camp } = await db
      .from('campaigns')
      .select('name, status')
      .eq('agent_id', agentId)
      .in('status', ['running', 'paused'])
      .limit(1)
      .maybeSingle()
    if (camp) {
      throw new Error(`Agent is used by the ${camp.status} campaign “${camp.name}”. Stop it first.`)
    }
    const engine = makeEngine()
    const { data: numbers } = await db
      .from('phone_numbers')
      .select('provider_number_id')
      .eq('agent_id', agentId)
    for (const n of numbers ?? []) {
      if (n.provider_number_id) await engine.detachNumber(n.provider_number_id).catch(() => {})
    }
    if (agent.provider_agent_id) await engine.deleteAgent(agent.provider_agent_id)
    const { error } = await db.from('agents').delete().eq('id', agentId)
    if (error) throw new Error(error.message)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  revalidatePath('/agents')
}

/**
 * "Generate from prompt": draft an agent with gpt-4o-mini, then ALWAYS append the
 * disclosure greeting + conduct rules server-side before it can be saved. Returns
 * the draft; the modal assembles the full config and calls createAgentAction.
 */
export async function generateDraftAction(description: string) {
  try {
    await requireOrg()
    const key = getEnv().OPENAI_API_KEY
    if (!key) return { error: 'Prompt generation is not configured' }
    const draft = await generateAgentDraft(description, key)
    if (!draft) return { error: 'Could not generate a draft — try describing the business differently' }
    // Rule: always append the disclosure + conduct sections to whatever the model
    // returns before it can be saved (voiceId is set by the caller at assembly).
    const finished = ensureDisclosureAndConduct({ ...draft, voiceId: '' }, draft.name)
    return {
      draft: {
        name: finished.name,
        systemPrompt: finished.systemPrompt,
        firstMessage: finished.firstMessage,
      },
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Phase 8/11: apply reviewed suggestions (one or a batch). Each selected row is
 * folded into the freeform prompt TEXT via managed sections (## FAQs, ## Learned
 * adjustments — see merge.ts), the adapter gets ONE update, and ONE new version
 * row is appended, so a batch-apply is a single rollback target. Rows that can't
 * merge (kb_gaps, duplicates) are skipped, not failed. Now works for every agent
 * (freeform-first) — no template/seed required.
 */
export async function applySuggestionsAction(agentId: string, formData: FormData) {
  const db = await userClient()
  const org = await requireOrg()
  if (!org.plan.adaptiveEnabled) throw new Error('Adaptive learning requires the Pro plan')
  const email = await currentUserEmail(db)
  const ids = (formData.getAll('id') as string[]).filter(Boolean)
  if (!ids.length) throw new Error('No suggestions selected')
  // The single-card FAQ form lets the owner edit the drafted answer before applying.
  const answerOverride = ids.length === 1 ? (formData.get('answer') as string | null)?.trim() : null

  const agent = await getAgentRow(db, agentId)
  const stored = normalizeStoredConfig(agent.config)

  const { data: rows, error } = await db
    .from('agent_suggestions')
    .select('id, type, suggestion')
    .eq('agent_id', agentId)
    .eq('status', 'pending')
    .in('id', ids)
  if (error) throw new Error(error.message)

  let prompt = stored.agentConfig.systemPrompt
  const applied: string[] = []
  for (const row of rows ?? []) {
    const payload: SuggestionPayload = { ...(row.suggestion as SuggestionPayload) }
    if (answerOverride) payload.a = answerOverride
    const merged = applySuggestionToPrompt(prompt, row.type as SuggestionType, payload)
    if (merged) {
      prompt = merged
      applied.push(row.id)
    }
  }
  if (!applied.length) {
    throw new Error('Nothing could be applied — knowledge gaps need information only you can add')
  }

  const agentConfig: AgentConfig = { ...stored.agentConfig, systemPrompt: prompt }
  await makeEngine().updateAgent(agent.provider_agent_id, agentConfig)
  const newStored: StoredAgentConfig = { ...stored, agentConfig }
  const { error: updErr } = await db
    .from('agents')
    .update({
      name: agentConfig.name,
      config: newStored,
      updated_by: email,
      updated_at: new Date().toISOString(),
    })
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

// Knowledge base moved to /knowledge in Phase 13: docs are created there and
// attached per-agent via setKbAttachmentAction (app/knowledge/actions.ts). The
// builder rail's Knowledge Base section calls that same action.

/**
 * Phase 7: connect Cal.com and turn the booking agent's capture-only flow into
 * real booking — store the org's key, attach the check_availability_and_book
 * tool at the provider, and re-render the prompt with liveBooking on (rule 4:
 * the config change lands as a new version row). Reads the booking `seed`; Phase
 * 11's prompt-first rework will let this operate on the prompt directly.
 */
export async function connectCalcomAction(agentId: string, formData: FormData) {
  const db = await userClient()
  try {
    const org = await requireOrg()
    if (org.role !== 'owner') throw new Error('Only the org owner can connect a calendar')
    const email = await currentUserEmail(db)
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
    const stored = normalizeStoredConfig(agent.config)
    if (stored.template !== 'booking' || !stored.seed) {
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
    const profile: BusinessProfile = { ...stored.seed, liveBooking: true }
    const agentConfig = buildAgentConfig('booking', profile)
    await engine.updateAgent(agent.provider_agent_id, agentConfig)
    const newStored: StoredAgentConfig = { ...stored, seed: profile, agentConfig }
    const { error: updErr } = await db
      .from('agents')
      .update({ config: newStored, updated_by: email, updated_at: new Date().toISOString() })
      .eq('id', agentId)
    if (updErr) throw new Error(updErr.message)
    await insertVersion(db, agentId, newStored)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  revalidatePath(`/agents/${agentId}`)
}

/**
 * Custom LLM (agent_type 'custom_llm'): point the agent at a BYO OpenAI-compatible
 * endpoint. The API key is stored as an ElevenLabs workspace secret — only the
 * returned secret id ever touches our DB (acceptance: key lands in EL secrets).
 * A blank apiKey keeps the existing secret; changing the key mints a new one.
 * ponytail: superseded secrets are left in the workspace — prune them at the
 * provider if they ever pile up.
 */
export async function updateCustomLlmAction(
  agentId: string,
  input: { url: string; modelId?: string; apiKey?: string }
) {
  const db = await userClient()
  try {
    const email = await currentUserEmail(db)
    const agent = await getAgentRow(db, agentId)
    const stored = normalizeStoredConfig(agent.config)
    const url = input.url.trim()
    if (!/^https:\/\//i.test(url)) throw new Error('Enter a valid https:// endpoint URL')

    const engine = makeEngine()
    let apiKeySecretId = stored.agentConfig.customLlm?.apiKeySecretId
    const apiKey = input.apiKey?.trim()
    if (apiKey) {
      const { secretId } = await engine.createSecret(`custom-llm-${agentId.slice(0, 8)}-${Date.now()}`, apiKey)
      apiKeySecretId = secretId
    }

    const agentConfig: AgentConfig = {
      ...stored.agentConfig,
      customLlm: {
        url,
        ...(input.modelId?.trim() ? { modelId: input.modelId.trim() } : {}),
        ...(apiKeySecretId ? { apiKeySecretId } : {}),
      },
    }
    await engine.updateAgent(agent.provider_agent_id, agentConfig)
    const newStored: StoredAgentConfig = { ...stored, agentConfig }
    const { error } = await db
      .from('agents')
      .update({ config: newStored, updated_by: email, updated_at: new Date().toISOString() })
      .eq('id', agentId)
    if (error) throw new Error(error.message)
    const version = await insertVersion(db, agentId, newStored)
    revalidatePath(`/agents/${agentId}`)
    return { version }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Share toggle (Phase 11). ON: mint (or reuse) a share_token and make the provider
 * agent public so the signed-out widget works. OFF: null the token so
 * /share/agent/<token> 404s (the provider stays public — the in-app test widget
 * relies on it). Returns the token for the copy-link UI.
 */
export async function setShareAction(agentId: string, enabled: boolean) {
  const db = await userClient()
  try {
    const agent = await getAgentRow(db, agentId)
    let token: string | null = null
    if (enabled) {
      token = agent.share_token ?? randomBytes(16).toString('hex')
      if (agent.provider_agent_id) await makeEngine().setAgentPublic(agent.provider_agent_id, true)
    }
    const { error } = await db.from('agents').update({ share_token: token }).eq('id', agentId)
    if (error) throw new Error(error.message)
    revalidatePath(`/agents/${agentId}`)
    return { token }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** Inline-editable version label (Phase 11). Empty clears it. */
export async function renameVersionAction(agentId: string, version: number, label: string) {
  const db = await userClient()
  const { error } = await db
    .from('agent_config_versions')
    .update({ label: label.trim() || null })
    .eq('agent_id', agentId)
    .eq('version', version)
  if (error) return { error: error.message }
  revalidatePath(`/agents/${agentId}`)
  return {}
}
