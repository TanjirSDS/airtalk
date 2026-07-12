import type Stripe from 'stripe'
import type { SupabaseClient } from '@airtalk/db'
import type { VoiceEngine } from '@airtalk/engine'
import { DUNNING_GRACE_DAYS, overageDelta, OVERAGE_METER_EVENT, planChange } from './billing-math'
import { pauseOrgAgents } from './usage'

export type BillingInterval = 'monthly' | 'annual'

async function getOrg(db: SupabaseClient, orgId: string) {
  const { data, error } = await db
    .from('orgs')
    .select('id, name, plan_id, overage_policy, stripe_customer_id, stripe_subscription_id')
    .eq('id', orgId)
    .single()
  if (error) throw new Error(`org ${orgId}: ${error.message}`)
  return data
}

async function getPlan(db: SupabaseClient, planId: string) {
  const { data, error } = await db
    .from('plans')
    .select('id, name, price_cents, included_minutes, stripe_price_monthly_id, stripe_price_annual_id, stripe_overage_price_id')
    .eq('id', planId)
    .single()
  if (error) throw new Error(`plan ${planId}: ${error.message}`)
  return data
}

function planPrice(plan: Awaited<ReturnType<typeof getPlan>>, interval: BillingInterval): string {
  const id = interval === 'annual' ? plan.stripe_price_annual_id : plan.stripe_price_monthly_id
  if (!id) throw new Error(`plan ${plan.id} has no Stripe price — run npm run stripe-setup`)
  return id
}

async function ensureCustomer(
  db: SupabaseClient,
  stripe: Stripe,
  org: { id: string; name: string; stripe_customer_id: string | null }
): Promise<string> {
  if (org.stripe_customer_id) return org.stripe_customer_id
  const customer = await stripe.customers.create({ name: org.name, metadata: { org_id: org.id } })
  await db.from('orgs').update({ stripe_customer_id: customer.id }).eq('id', org.id)
  return customer.id
}

/** First subscription for an org goes through Checkout. Returns the session URL.
 *  paths override where Stripe sends the customer back (signup flow vs billing page). */
export async function startCheckout(
  db: SupabaseClient,
  stripe: Stripe,
  orgId: string,
  planId: string,
  interval: BillingInterval,
  origin: string,
  paths?: { success?: string; cancel?: string }
): Promise<string> {
  const org = await getOrg(db, orgId)
  const plan = await getPlan(db, planId)
  const customer = await ensureCustomer(db, stripe, org)

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: planPrice(plan, interval), quantity: 1 },
  ]
  // Metered overage item rides along from day one when the org opted into
  // overage billing (metered items take no quantity).
  if (org.overage_policy === 'overage' && plan.stripe_overage_price_id) {
    lineItems.push({ price: plan.stripe_overage_price_id })
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: orgId,
    line_items: lineItems,
    subscription_data: { metadata: { org_id: orgId } },
    success_url: `${origin}${paths?.success ?? '/billing?checkout=success'}`,
    cancel_url: `${origin}${paths?.cancel ?? '/billing'}`,
  })
  if (!session.url) throw new Error('Stripe returned no checkout URL')
  return session.url
}

/** Customer portal: cards, invoices, cancel. */
export async function portalUrl(db: SupabaseClient, stripe: Stripe, orgId: string, origin: string): Promise<string> {
  const org = await getOrg(db, orgId)
  if (!org.stripe_customer_id) throw new Error('no billing account yet — pick a plan first')
  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripe_customer_id,
    return_url: `${origin}/billing`,
  })
  return session.url
}

/**
 * Upgrade mid-cycle applies immediately (Stripe prorates; the
 * customer.subscription.updated webhook raises plan_id/minutes_cap). Downgrade
 * is deferred to the next period via a subscription schedule — pending_plan_id
 * until the phase flips. Returns a URL to redirect to (checkout) or null when
 * the subscription was changed in place.
 */
export async function changePlan(
  db: SupabaseClient,
  stripe: Stripe,
  orgId: string,
  newPlanId: string,
  interval: BillingInterval,
  origin: string
): Promise<string | null> {
  const org = await getOrg(db, orgId)
  if (!org.stripe_subscription_id) return startCheckout(db, stripe, orgId, newPlanId, interval, origin)

  const [current, next] = await Promise.all([getPlan(db, org.plan_id), getPlan(db, newPlanId)])
  const change = planChange(current, next)
  if (change.action === 'none') return null

  const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id)
  const licensed = sub.items.data.find((i) => i.price.recurring?.usage_type !== 'metered')
  if (!licensed) throw new Error(`subscription ${sub.id} has no licensed item`)
  const newPrice = planPrice(next, interval)
  const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id

  if (change.action === 'upgrade') {
    // an in-flight scheduled downgrade loses to an upgrade
    if (scheduleId) await stripe.subscriptionSchedules.release(scheduleId)
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: licensed.id, price: newPrice }],
      proration_behavior: 'create_prorations',
    })
    await db.from('orgs').update({ pending_plan_id: null }).eq('id', orgId)
  } else {
    // keep every current item (incl. metered overage) until period end, then swap
    const keepItems = sub.items.data.map((i) => ({
      price: i.price.id,
      ...(i.price.recurring?.usage_type === 'metered' ? {} : { quantity: i.quantity ?? 1 }),
    }))
    const nextItems = keepItems.map((it) => (it.price === licensed.price.id ? { ...it, price: newPrice } : it))
    const schedule = scheduleId ?? (await stripe.subscriptionSchedules.create({ from_subscription: sub.id })).id
    await stripe.subscriptionSchedules.update(schedule, {
      end_behavior: 'release',
      phases: [
        {
          items: keepItems,
          start_date: licensed.current_period_start,
          end_date: licensed.current_period_end,
        },
        { items: nextItems },
      ],
    })
    await db.from('orgs').update({ pending_plan_id: newPlanId }).eq('id', orgId)
  }
  return null
}

/**
 * Daily (from the reconciliation cron, after recompute_usage — rule 5): send
 * each overage org's unreported whole minutes to the Stripe meter. The event
 * identifier makes a re-run of the same day a no-op on Stripe's side.
 */
export async function reportOverageDaily(db: SupabaseClient, stripe: Stripe, now = new Date()): Promise<number> {
  const period = now.toISOString().slice(0, 8) + '01'
  const day = now.toISOString().slice(0, 10)
  const { data: orgs, error } = await db
    .from('orgs')
    .select('id, stripe_customer_id, stripe_subscription_id, usage_periods!inner(overage_minutes, overage_reported)')
    .eq('overage_policy', 'overage')
    .eq('usage_periods.period_start', period)
    .not('stripe_customer_id', 'is', null)
    .not('stripe_subscription_id', 'is', null)
  if (error) throw new Error(error.message)

  let reported = 0
  for (const org of orgs ?? []) {
    const up = (Array.isArray(org.usage_periods) ? org.usage_periods[0] : org.usage_periods) as {
      overage_minutes: number
      overage_reported: number
    }
    const delta = overageDelta(up.overage_minutes, up.overage_reported)
    if (!delta) continue
    await ensureOverageItem(db, stripe, org.stripe_subscription_id!)
    await stripe.billing.meterEvents.create({
      event_name: OVERAGE_METER_EVENT,
      identifier: `overage:${org.id}:${day}`,
      payload: { stripe_customer_id: org.stripe_customer_id!, value: String(delta) },
    })
    // ponytail: read-modify-write is fine here — the cron is the only writer,
    // and Stripe's identifier dedupe already blocks double-billing on a re-run.
    await db
      .from('usage_periods')
      .update({ overage_reported: up.overage_reported + delta })
      .eq('org_id', org.id)
      .eq('period_start', period)
    reported++
  }
  return reported
}

/** Orgs whose overage_policy flipped to 'overage' after checkout have no
 *  metered item on the subscription yet — add it before the first report. */
async function ensureOverageItem(db: SupabaseClient, stripe: Stripe, subscriptionId: string) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  if (sub.items.data.some((i) => i.price.recurring?.usage_type === 'metered')) return
  const { data: plan } = await db
    .from('plans')
    .select('stripe_overage_price_id')
    .not('stripe_overage_price_id', 'is', null)
    .limit(1)
    .maybeSingle()
  if (!plan?.stripe_overage_price_id) throw new Error('no overage price in plans — run npm run stripe-setup')
  await stripe.subscriptionItems.create({ subscription: subscriptionId, price: plan.stripe_overage_price_id })
}

/** Daily: pause agents for orgs whose payment failure outlived the grace window.
 *  pauseOrgAgents is idempotent, so re-pausing on later days is harmless. */
export async function expireDunning(db: SupabaseClient, engine: VoiceEngine, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DUNNING_GRACE_DAYS * 86_400_000).toISOString()
  const { data: orgs, error } = await db.from('orgs').select('id').lt('payment_failed_at', cutoff)
  if (error) throw new Error(error.message)
  for (const org of orgs ?? []) await pauseOrgAgents(db, engine, org.id)
  return (orgs ?? []).length
}
