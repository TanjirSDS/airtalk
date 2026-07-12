'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getEnv, serviceClient } from '@airtalk/db'
import { startCheckout } from '../../lib/billing'
import { makeEngine } from '../../lib/engine'
import { emit } from '../../lib/events'
import {
  numberPurchaseBlocked,
  purchaseNumber,
  releaseNumber,
  searchAvailableNumbers,
  type AvailableNumber,
} from '../../lib/numbers'
import { activeOrg } from '../../lib/org'
import { stripeClient } from '../../lib/stripe'
import { userClient } from '../../lib/supabase-server'

// The self-serve funnel's server actions. Each step re-validates its
// prerequisites server-side — the pages' redirects are UX, these are the gates.

export async function createOrgAction(
  _prev: { error?: string } | null,
  formData: FormData
): Promise<{ error?: string }> {
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Give your workspace a name.' }
  if (name.length > 80) return { error: 'Keep the name under 80 characters.' }

  const db = await userClient()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) redirect('/signup')

  // One org per user in self-serve; a second visit just continues the flow.
  const { data: existing } = await db.from('org_members').select('org_id').limit(1).maybeSingle()
  if (!existing) {
    // Org + owner membership are service-role writes (members can't insert
    // either under RLS — Phase 4 kept membership management out of user reach).
    const svc = serviceClient()
    const { data: starter } = await svc.from('plans').select('included_minutes').eq('id', 'starter').single()
    const { data: org, error } = await svc
      .from('orgs')
      .insert({ name, minutes_cap: starter?.included_minutes ?? 750 })
      .select('id')
      .single()
    if (error) return { error: error.message }
    const { error: memberErr } = await svc
      .from('org_members')
      .insert({ org_id: org.id, user_id: user.id, role: 'owner' })
    if (memberErr) return { error: memberErr.message }
    await emit('org/created', { orgId: org.id })
  }
  redirect('/signup/plan')
}

async function requireOwner() {
  const org = await activeOrg()
  if (!org) redirect('/signup')
  if (org.role !== 'owner') throw new Error('only the org owner can do this')
  return org
}

async function origin() {
  const h = await headers()
  return h.get('origin') ?? getEnv().APP_URL ?? `https://${h.get('host')}`
}

export async function signupCheckoutAction(formData: FormData) {
  const org = await requireOwner()
  const svc = serviceClient()
  const { data: row } = await svc.from('orgs').select('stripe_subscription_id').eq('id', org.orgId).maybeSingle()
  if (row?.stripe_subscription_id) redirect('/signup/agent') // already paid — continue

  const planId = String(formData.get('plan'))
  const interval = formData.get('interval') === 'annual' ? ('annual' as const) : ('monthly' as const)
  const url = await startCheckout(svc, stripeClient(), org.orgId, planId, interval, await origin(), {
    success: '/signup/agent?checkout=success',
    cancel: '/signup/plan',
  })
  redirect(url)
}

export async function searchNumbersAction(
  areaCode: string
): Promise<{ numbers?: AvailableNumber[]; error?: string }> {
  const org = await activeOrg()
  if (!org) return { error: 'Sign in first.' }
  const code = areaCode.trim()
  if (code && !/^\d{3}$/.test(code)) return { error: 'Area code is three digits, e.g. 415.' }
  const env = getEnv()
  try {
    const numbers = await searchAvailableNumbers(
      { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN },
      code || null
    )
    if (!numbers.length) return { error: `No numbers available${code ? ` in ${code}` : ''} — try another area code.` }
    return { numbers }
  } catch (e) {
    console.error('number search failed:', e)
    return { error: 'Number search failed — try again in a moment.' }
  }
}

export async function buyNumberAction(e164: string): Promise<{ error?: string }> {
  const org = await requireOwner()
  if (!/^\+1\d{10}$/.test(e164)) return { error: 'Pick a number from the list.' }

  const db = await userClient()
  const svc = serviceClient()
  const [{ data: orgRow }, { count: numberCount }, { data: agent }] = await Promise.all([
    svc.from('orgs').select('stripe_subscription_id').eq('id', org.orgId).maybeSingle(),
    db.from('phone_numbers').select('id', { count: 'exact', head: true }).eq('org_id', org.orgId),
    db
      .from('agents')
      .select('id, provider_agent_id')
      .eq('org_id', org.orgId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])
  const blocked = numberPurchaseBlocked({
    hasSubscription: !!orgRow?.stripe_subscription_id,
    hasAgent: !!agent,
    existingNumbers: numberCount ?? 0,
  })
  if (blocked) return { error: blocked }

  const env = getEnv()
  const creds = { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN }
  let bought: { twilioSid: string; e164: string }
  try {
    bought = await purchaseNumber(creds, e164)
  } catch (e) {
    console.error('number purchase failed:', e)
    return { error: 'That number was just taken or the purchase failed — search again.' }
  }

  // Money is now spent — if wiring the number up fails, release it so the org
  // isn't billed for a dead number (rule 3).
  try {
    const engine = makeEngine()
    const { providerNumberId } = await engine.importNumber(bought.twilioSid, bought.e164)
    await engine.attachNumber(providerNumberId, agent!.provider_agent_id)
    const { error } = await db.from('phone_numbers').insert({
      org_id: org.orgId,
      agent_id: agent!.id,
      e164: bought.e164,
      twilio_sid: bought.twilioSid,
      provider_number_id: providerNumberId,
      status: 'active',
    })
    if (error) throw new Error(error.message)
  } catch (e) {
    console.error(`number setup failed after purchase (${bought.twilioSid}) — releasing:`, e)
    await releaseNumber(creds, bought.twilioSid).catch((re) =>
      console.error(`release of ${bought.twilioSid} ALSO failed — release manually in Twilio:`, re)
    )
    return { error: 'We could not finish setting up that number (it was not purchased) — try again.' }
  }
  redirect('/signup/done')
}
