'use server'

import type { SupabaseClient } from '@airtalk/db'
import { revalidatePath } from 'next/cache'
import type { AlertMetric, AlertOperator } from '../../lib/alerts-eval'
import { activeOrg, type ActiveOrg } from '../../lib/org'
import { userClient } from '../../lib/supabase-server'

const METRICS: AlertMetric[] = ['failure_rate', 'call_count', 'usage_pct', 'est_cost_cents', 'provider_down']
const OPERATORS: AlertOperator[] = ['gt', 'gte', 'lt', 'lte']

export interface AlertInput {
  name: string
  metric: AlertMetric
  operator: AlertOperator
  threshold: number
  windowMins: number
  agentId: string | null
  channels: { emails: string[]; endpointIds: string[] }
  cooldownMins: number
}

async function requireOrg(): Promise<ActiveOrg> {
  const org = await activeOrg()
  if (!org) throw new Error('You are not a member of any organization')
  return org
}

async function currentUserEmail(db: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await db.auth.getUser()
  return user?.email ?? 'system'
}

/** Shared validation → the DB row shape (minus org_id/created_by). */
function toRow(input: AlertInput) {
  const name = input.name?.trim()
  if (!name) throw new Error('Give the alert a name')
  if (!METRICS.includes(input.metric)) throw new Error('Unknown metric')
  if (!OPERATORS.includes(input.operator)) throw new Error('Unknown condition')
  if (!Number.isFinite(input.threshold)) throw new Error('Threshold must be a number')
  const windowMins = Math.round(input.windowMins)
  if (!Number.isInteger(windowMins) || windowMins < 1) throw new Error('Time window must be at least 1 minute')
  const cooldownMins = Math.round(input.cooldownMins)
  if (!Number.isInteger(cooldownMins) || cooldownMins < 0) throw new Error('Cooldown cannot be negative')
  const emails = (input.channels?.emails ?? []).map((e) => e.trim()).filter((e) => /.+@.+\..+/.test(e))
  const endpointIds = (input.channels?.endpointIds ?? []).filter(Boolean)
  if (!emails.length && !endpointIds.length) throw new Error('Add at least one email or webhook endpoint to notify')
  return {
    name,
    metric: input.metric,
    operator: input.operator,
    threshold: input.threshold,
    window_mins: windowMins,
    agent_id: input.agentId || null,
    channels: { emails, endpointIds },
    cooldown_mins: cooldownMins,
  }
}

export async function createAlertAction(input: AlertInput): Promise<{ error?: string }> {
  const db = await userClient()
  try {
    const org = await requireOrg()
    const { error } = await db
      .from('alerts')
      .insert({ ...toRow(input), org_id: org.orgId, created_by: await currentUserEmail(db) })
    if (error) throw new Error(error.message)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  revalidatePath('/alerts')
  return {}
}

export async function updateAlertAction(id: string, input: AlertInput): Promise<{ error?: string }> {
  const db = await userClient()
  try {
    await requireOrg()
    // Editing the rule re-arms it (crossing state stale after a threshold change).
    const { error } = await db
      .from('alerts')
      .update({ ...toRow(input), last_state: false })
      .eq('id', id)
    if (error) throw new Error(error.message)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  revalidatePath('/alerts')
  return {}
}

export async function setAlertEnabledAction(id: string, enabled: boolean): Promise<{ error?: string }> {
  const db = await userClient()
  await requireOrg()
  const { error } = await db.from('alerts').update({ enabled }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/alerts')
  return {}
}

export async function deleteAlertAction(id: string): Promise<{ error?: string }> {
  const db = await userClient()
  await requireOrg()
  const { error } = await db.from('alerts').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/alerts')
  return {}
}
