'use server'

import type { SupabaseClient } from '@airtalk/db'
import type { KnowledgeSource } from '@airtalk/engine'
import { revalidatePath } from 'next/cache'
import { makeEngine } from '../../lib/engine'
import { activeOrg, type ActiveOrg } from '../../lib/org'
import { userClient } from '../../lib/supabase-server'

// Multi-tenant fence (item 1): every read/write below goes through the RLS-scoped
// user client, so a member only ever touches their own org's kb_documents rows —
// the shared workspace KB is never enumerated to a user.

async function requireKb(): Promise<ActiveOrg> {
  const org = await activeOrg()
  if (!org) throw new Error('You are not a member of any organization')
  if (!org.plan.kbEnabled) throw new Error('Knowledge base requires the Growth plan or higher')
  return org
}

async function currentUserEmail(db: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await db.auth.getUser()
  return user?.email ?? 'system'
}

/** Create a provider KB doc from url/text/file, then register it in kb_documents. */
export async function createKbDocAction(formData: FormData): Promise<{ error?: string }> {
  const db = await userClient()
  const org = await requireKb()
  const name = (formData.get('name') as string | null)?.trim()
  const sourceType = formData.get('sourceType') as KnowledgeSource['type'] | null
  if (!name) return { error: 'Give the document a name.' }

  const engine = makeEngine()
  let created: { knowledgeId: string }
  try {
    if (sourceType === 'url') {
      const url = (formData.get('url') as string | null)?.trim()
      if (!url) return { error: 'Enter a URL.' }
      created = await engine.createKnowledgeDoc({ name, url })
    } else if (sourceType === 'text') {
      const text = (formData.get('text') as string | null)?.trim()
      if (!text) return { error: 'Enter some text.' }
      created = await engine.createKnowledgeDoc({ name, text })
    } else if (sourceType === 'file') {
      const file = formData.get('file') as File | null
      if (!file || file.size === 0) return { error: 'Choose a file to upload.' }
      created = await engine.createKnowledgeDoc({ name, file: { name: file.name, data: file } })
    } else {
      return { error: 'Pick a source type.' }
    }
  } catch (e) {
    console.error('KB doc create failed:', e)
    return { error: 'Could not create that document — check the source and try again.' }
  }

  const { error } = await db.from('kb_documents').insert({
    org_id: org.orgId,
    provider_kb_id: created.knowledgeId,
    name,
    source_type: sourceType,
    created_by: await currentUserEmail(db),
  })
  if (error) {
    // The registry insert failed — don't leave an orphaned workspace doc behind.
    await engine.removeKnowledge(created.knowledgeId).catch(() => {})
    return { error: error.message }
  }
  revalidatePath('/knowledge')
  return {}
}

/** Delete everywhere: force-delete at the provider (auto-detaches from every agent)
 *  then drop our row. */
export async function deleteKbDocAction(docId: string): Promise<{ error?: string }> {
  const db = await userClient()
  await requireKb()
  const { data: doc } = await db
    .from('kb_documents')
    .select('provider_kb_id')
    .eq('id', docId)
    .maybeSingle()
  if (!doc) return { error: 'Document not found.' }
  await makeEngine().removeKnowledge(doc.provider_kb_id)
  const { error } = await db.from('kb_documents').delete().eq('id', docId)
  if (error) return { error: error.message }
  revalidatePath('/knowledge')
  return {}
}

/** Attach or detach one doc to one agent. Shared by the /knowledge manage dialog
 *  and the agent builder's Knowledge Base section, so both surfaces stay in sync. */
export async function setKbAttachmentAction(
  docId: string,
  agentId: string,
  attached: boolean
): Promise<{ error?: string }> {
  const db = await userClient()
  await requireKb()
  const [{ data: doc }, { data: agent }] = await Promise.all([
    db.from('kb_documents').select('provider_kb_id, name, source_type').eq('id', docId).maybeSingle(),
    db.from('agents').select('provider_agent_id').eq('id', agentId).maybeSingle(),
  ])
  if (!doc || !agent) return { error: 'Document or agent not found.' }
  if (!agent.provider_agent_id) return { error: 'That agent is not provisioned yet.' }

  const engine = makeEngine()
  try {
    if (attached) {
      await engine.attachKnowledge(agent.provider_agent_id, {
        knowledgeId: doc.provider_kb_id,
        name: doc.name,
        type: doc.source_type as KnowledgeSource['type'],
      })
    } else {
      await engine.detachKnowledge(agent.provider_agent_id, doc.provider_kb_id)
    }
  } catch (e) {
    console.error('KB attachment change failed:', e)
    return { error: 'Could not update attachment — try again.' }
  }
  revalidatePath('/knowledge')
  revalidatePath(`/agents/${agentId}`)
  return {}
}
