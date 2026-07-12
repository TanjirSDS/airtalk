'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { serviceClient } from '@airtalk/db'
import { requireAdmin } from '../../lib/admin'
import { parseAdjustment } from '../../lib/admin-adjustment'

export async function viewAsAction(formData: FormData) {
  await requireAdmin()
  const orgId = String(formData.get('org') ?? '')
  if (!/^[0-9a-f-]{36}$/.test(orgId)) throw new Error('bad org id')
  const jar = await cookies()
  jar.set('admin-view-org', orgId, { httpOnly: true, sameSite: 'lax', path: '/' })
  redirect('/dashboard')
}

export async function exitViewAsAction() {
  // No admin gate needed: clearing the cookie is safe for anyone.
  const jar = await cookies()
  jar.delete('admin-view-org')
  redirect('/admin')
}

export async function adjustCreditAction(
  _prev: { error?: string; done?: string } | null,
  formData: FormData
): Promise<{ error?: string; done?: string }> {
  const admin = await requireAdmin()
  const orgId = String(formData.get('org') ?? '')
  if (!/^[0-9a-f-]{36}$/.test(orgId)) return { error: 'Pick an org.' }
  const parsed = parseAdjustment(String(formData.get('minutes') ?? ''), String(formData.get('note') ?? ''))
  if ('error' in parsed) return parsed

  // Adjustment row is the audit trail; recompute_usage (0006) folds it into
  // the period so the nightly reconcile can't undo it (rule 5).
  const db = serviceClient()
  const period = new Date().toISOString().slice(0, 8) + '01'
  const { error } = await db.from('usage_adjustments').insert({
    org_id: orgId,
    period_start: period,
    minutes_delta: parsed.minutesDelta,
    note: parsed.note,
    created_by: admin.userId,
  })
  if (error) return { error: error.message }
  const { error: rpcError } = await db.rpc('recompute_usage', { p_org_id: orgId, p_period: period })
  if (rpcError) return { error: `adjustment saved but recompute failed: ${rpcError.message}` }

  revalidatePath('/admin')
  return { done: `${parsed.minutesDelta > 0 ? '+' : ''}${parsed.minutesDelta} min applied` }
}
