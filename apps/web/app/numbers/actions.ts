'use server'

import { getEnv, serviceClient } from '@airtalk/db'
import type { SipNumberConfig } from '@airtalk/engine'
import { revalidatePath } from 'next/cache'
import { makeEngine } from '../../lib/engine'
import { numberPurchaseBlocked, purchaseNumber, releaseNumber } from '../../lib/numbers'
import { activeOrg, type ActiveOrg } from '../../lib/org'
import { userClient } from '../../lib/supabase-server'

// Rule 3: adding/removing numbers spends (or stops) money — every action is
// owner-gated and re-checks the plan cap server-side. RLS scopes every read/write
// to the caller's org, so cross-org ids simply miss.

async function requireOwner(): Promise<ActiveOrg> {
  const org = await activeOrg()
  if (!org) throw new Error('You are not a member of any organization')
  if (org.role !== 'owner') throw new Error('Only the workspace owner can manage numbers')
  return org
}

/** Numbers that count toward the plan cap: everything not released. */
async function activeNumberCount(orgId: string): Promise<number> {
  const db = await userClient()
  const { count } = await db
    .from('phone_numbers')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .neq('status', 'released')
  return count ?? 0
}

/** Assign a number to an agent, or pass null to unassign. */
export async function assignNumberAction(
  numberId: string,
  agentId: string | null
): Promise<{ error?: string }> {
  const db = await userClient()
  await requireOwner()
  const { data: number } = await db
    .from('phone_numbers')
    .select('provider_number_id, status')
    .eq('id', numberId)
    .maybeSingle()
  if (!number?.provider_number_id) return { error: 'Number not found.' }
  if (number.status === 'released') return { error: 'That number was released.' }

  const engine = makeEngine()
  try {
    if (agentId) {
      const { data: agent } = await db
        .from('agents')
        .select('provider_agent_id')
        .eq('id', agentId)
        .maybeSingle()
      if (!agent?.provider_agent_id) return { error: 'Agent not found.' }
      await engine.attachNumber(number.provider_number_id, agent.provider_agent_id)
    } else {
      await engine.detachNumber(number.provider_number_id)
    }
  } catch (e) {
    console.error('number assign failed:', e)
    return { error: 'Could not update the assignment — try again.' }
  }
  const { error } = await db.from('phone_numbers').update({ agent_id: agentId }).eq('id', numberId)
  if (error) return { error: error.message }
  revalidatePath('/numbers')
  return {}
}

/** Buy a Twilio number and register it UNASSIGNED (the user assigns an agent
 *  from the table). Releases the number if provider wiring fails (rule 3). */
export async function buyNumberAction(e164: string): Promise<{ error?: string }> {
  const org = await requireOwner()
  if (!/^\+1\d{10}$/.test(e164)) return { error: 'Pick a number from the list.' }

  const svc = serviceClient()
  const { data: orgRow } = await svc
    .from('orgs')
    .select('stripe_subscription_id')
    .eq('id', org.orgId)
    .maybeSingle()
  const blocked = numberPurchaseBlocked({
    hasSubscription: !!orgRow?.stripe_subscription_id,
    existingNumbers: await activeNumberCount(org.orgId),
    maxNumbers: org.plan.maxNumbers,
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

  const db = await userClient()
  try {
    const { providerNumberId } = await makeEngine().importNumber(bought.twilioSid, bought.e164)
    const { error } = await db.from('phone_numbers').insert({
      org_id: org.orgId,
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
    return { error: 'We could not finish setting up that number (it was not charged) — try again.' }
  }
  revalidatePath('/numbers')
  return {}
}

/** Register a SIP-trunk number at the provider (no Twilio). Plan cap still applies. */
export async function importSipNumberAction(formData: FormData): Promise<{ error?: string }> {
  const org = await requireOwner()

  const e164 = (formData.get('e164') as string | null)?.trim() ?? ''
  const label = (formData.get('label') as string | null)?.trim() ?? ''
  const address = (formData.get('address') as string | null)?.trim() ?? ''
  const transport = ((formData.get('transport') as string | null)?.trim() || 'auto') as SipNumberConfig['transport']
  const username = (formData.get('username') as string | null)?.trim() || undefined
  const password = (formData.get('password') as string | null) || undefined
  const allowed = (formData.get('allowedAddresses') as string | null)?.trim()

  if (!/^\+\d{7,15}$/.test(e164)) return { error: 'Enter the number in E.164 format, e.g. +15551234567.' }
  if (!label) return { error: 'Give the trunk a label.' }
  if (!address) return { error: 'Enter the SIP server address.' }

  const svc = serviceClient()
  const { data: orgRow } = await svc
    .from('orgs')
    .select('stripe_subscription_id')
    .eq('id', org.orgId)
    .maybeSingle()
  if (!orgRow?.stripe_subscription_id) return { error: 'Pick a plan before adding a number.' }
  if ((await activeNumberCount(org.orgId)) >= org.plan.maxNumbers) {
    const plural = org.plan.maxNumbers === 1 ? '' : 's'
    return { error: `Your plan allows up to ${org.plan.maxNumbers} phone number${plural}. Upgrade for more.` }
  }

  let providerNumberId: string
  try {
    const cfg: SipNumberConfig = {
      e164,
      label,
      address,
      transport,
      username,
      password,
      allowedAddresses: allowed
        ? allowed.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined,
    }
    ;({ providerNumberId } = await makeEngine().importSipNumber(cfg))
  } catch (e) {
    console.error('SIP import failed:', e)
    return { error: 'Could not register that SIP number — check the details and try again.' }
  }

  const db = await userClient()
  const { error } = await db.from('phone_numbers').insert({
    org_id: org.orgId,
    e164,
    twilio_sid: null, // no Twilio SID → the UI reads this as a "sip" number
    provider_number_id: providerNumberId,
    status: 'active',
  })
  if (error) {
    await makeEngine().deleteNumber(providerNumberId).catch(() => {})
    return { error: error.message }
  }
  revalidatePath('/numbers')
  return {}
}

/** Release: detach at provider → delete the EL phone-number record → release at
 *  Twilio (stops the monthly charge). SIP numbers skip the Twilio step. */
export async function releaseNumberAction(numberId: string): Promise<{ error?: string }> {
  await requireOwner()
  const db = await userClient()
  const { data: number } = await db
    .from('phone_numbers')
    .select('provider_number_id, twilio_sid, agent_id, status')
    .eq('id', numberId)
    .maybeSingle()
  if (!number) return { error: 'Number not found.' }
  if (number.status === 'released') return {}

  const engine = makeEngine()
  try {
    if (number.provider_number_id) {
      if (number.agent_id) await engine.detachNumber(number.provider_number_id).catch(() => {})
      await engine.deleteNumber(number.provider_number_id)
    }
    if (number.twilio_sid) {
      const env = getEnv()
      await releaseNumber(
        { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN },
        number.twilio_sid
      )
    }
  } catch (e) {
    console.error('number release failed:', e)
    return { error: 'Could not fully release the number — try again.' }
  }
  const { error } = await db
    .from('phone_numbers')
    .update({ status: 'released', agent_id: null })
    .eq('id', numberId)
  if (error) return { error: error.message }
  revalidatePath('/numbers')
  return {}
}
