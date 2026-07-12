'use server'

import { serviceClient } from '@airtalk/db'
import { buildAgentConfig, type BusinessProfile, type TemplateKey } from '@airtalk/engine/templates'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { makeEngine } from '../../lib/engine'
import type { StoredAgentConfig } from '../../lib/types'

// Rule 4: every save appends a version row; version numbers are per-agent.
// ponytail: read-max+1 has a race under concurrent saves — the unique(agent_id,
// version) constraint turns that into an error instead of silent corruption.
async function insertVersion(db: ReturnType<typeof serviceClient>, agentId: string, config: StoredAgentConfig) {
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

async function getAgentRow(db: ReturnType<typeof serviceClient>, id: string) {
  const { data, error } = await db.from('agents').select('*').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data
}

export async function createAgentAction(input: { template: TemplateKey; profile: BusinessProfile }) {
  const db = serviceClient()
  let id: string
  try {
    const agentConfig = buildAgentConfig(input.template, input.profile)
    const { providerAgentId } = await makeEngine().createAgent(agentConfig)
    const stored: StoredAgentConfig = { template: input.template, profile: input.profile, agentConfig }
    const { data, error } = await db
      .from('agents')
      .insert({
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
  redirect(`/agents/${id}`) // outside try — redirect() works by throwing
}

export async function updateAgentAction(
  agentId: string,
  input: { template: TemplateKey; profile: BusinessProfile }
) {
  const db = serviceClient()
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
  const db = serviceClient()
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

export async function addKnowledgeAction(agentId: string, formData: FormData) {
  const db = serviceClient()
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
  const db = serviceClient()
  const agent = await getAgentRow(db, agentId)
  await makeEngine().removeKnowledge(agent.provider_agent_id, knowledgeId)
  revalidatePath(`/agents/${agentId}`)
}
