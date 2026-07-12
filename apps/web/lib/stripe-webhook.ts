import type Stripe from 'stripe'
import type { SupabaseClient } from '@airtalk/db'
import type { VoiceEngine } from '@airtalk/engine'
import { emit } from './events'
import { currentPeriodUsage, resumeOrgAgents } from './usage'

export interface StripeWebhookDeps {
  db: SupabaseClient
  stripe: Stripe
  engine: VoiceEngine
  webhookSecret: string
}

// Rule 2: verify signature → insert webhook_events (UNIQUE event_id, skip on
// conflict = idempotent) → store raw payload → then process.
// Extracted from the route so the idempotency test can inject a fake db.
export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null,
  deps: StripeWebhookDeps
): Promise<{ status: number; body: string }> {
  let event: Stripe.Event
  try {
    event = deps.stripe.webhooks.constructEvent(rawBody, signature ?? '', deps.webhookSecret)
  } catch {
    return { status: 401, body: 'invalid signature' }
  }

  const { data: inserted, error } = await deps.db
    .from('webhook_events')
    .upsert(
      { provider: 'stripe', event_id: event.id, payload: event as unknown as Record<string, unknown> },
      { onConflict: 'event_id', ignoreDuplicates: true }
    )
    .select()
  if (error) return { status: 500, body: error.message }
  if (!inserted?.length) return { status: 200, body: 'duplicate ignored' }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.mode === 'subscription' && session.client_reference_id && session.subscription) {
        await deps.db
          .from('orgs')
          .update({
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
          })
          .eq('id', session.client_reference_id)
        const sub = await deps.stripe.subscriptions.retrieve(session.subscription as string)
        await syncSubscription(deps, sub)
      }
      break
    }

    case 'customer.subscription.updated':
      await syncSubscription(deps, event.data.object as Stripe.Subscription)
      break

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const { data: starter } = await deps.db
        .from('plans')
        .select('included_minutes')
        .eq('id', 'starter')
        .maybeSingle()
      await deps.db
        .from('orgs')
        .update({
          plan_id: 'starter',
          minutes_cap: starter?.included_minutes ?? 750,
          stripe_subscription_id: null,
          pending_plan_id: null,
        })
        .eq('stripe_customer_id', sub.customer as string)
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      // Start the 7-day grace clock exactly once — Stripe's dunning retries
      // fire this event repeatedly and must not reset the window. The .is
      // guard also means the owner email below fires once per failure, not
      // once per retry.
      const { data: marked } = await deps.db
        .from('orgs')
        .update({ payment_failed_at: new Date().toISOString() })
        .eq('stripe_customer_id', invoice.customer as string)
        .is('payment_failed_at', null)
        .select('id')
      for (const org of marked ?? []) {
        await emit('billing/payment-failed', { orgId: org.id })
      }
      break
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice
      const { data: org } = await deps.db
        .from('orgs')
        .select('id, payment_failed_at')
        .eq('stripe_customer_id', invoice.customer as string)
        .maybeSingle()
      if (org?.payment_failed_at) {
        await deps.db.from('orgs').update({ payment_failed_at: null }).eq('id', org.id)
        await resumeOrgAgents(deps.db, deps.engine, org.id)
      }
      break
    }
  }

  await deps.db
    .from('webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('event_id', event.id)

  return { status: 200, body: 'ok' }
}

/** orgs.plan_id / minutes_cap / stripe ids follow the subscription's licensed
 *  price. Fires on checkout, mid-cycle upgrades, and the scheduled phase flip
 *  that applies a pending downgrade. */
async function syncSubscription(deps: StripeWebhookDeps, sub: Stripe.Subscription) {
  const priceIds = sub.items.data.map((i) => i.price.id)
  const { data: plans } = await deps.db
    .from('plans')
    .select('id, included_minutes, stripe_price_monthly_id, stripe_price_annual_id')
  const plan = (plans ?? []).find(
    (p) => priceIds.includes(p.stripe_price_monthly_id) || priceIds.includes(p.stripe_price_annual_id)
  )
  if (!plan) return // no plan price on this subscription — not ours to sync

  const { data: org } = await deps.db
    .from('orgs')
    .select('id, minutes_cap, pending_plan_id, payment_failed_at')
    .eq('stripe_customer_id', sub.customer as string)
    .maybeSingle()
  if (!org) return

  await deps.db
    .from('orgs')
    .update({
      plan_id: plan.id,
      minutes_cap: plan.included_minutes,
      stripe_subscription_id: sub.id,
      pending_plan_id: org.pending_plan_id === plan.id ? null : org.pending_plan_id,
    })
    .eq('id', org.id)

  // The running period's cap snapshot must follow (record_call_usage computes
  // overage against usage_periods.minutes_cap). recompute_usage re-derives
  // minutes_used AND overage from the calls table with the new cap.
  const period = new Date().toISOString().slice(0, 8) + '01'
  const { error: rpcError } = await deps.db.rpc('recompute_usage', { p_org_id: org.id, p_period: period })
  if (rpcError) console.error(`recompute_usage(${org.id}) after plan sync failed:`, rpcError.message)

  // A cap raise can lift a cap-pause — but never un-pause a delinquent org.
  if (plan.included_minutes > org.minutes_cap && !org.payment_failed_at) {
    const usage = await currentPeriodUsage(deps.db, org.id, period)
    if (!usage || usage.minutes_used < plan.included_minutes) {
      await resumeOrgAgents(deps.db, deps.engine, org.id)
    }
  }
}
