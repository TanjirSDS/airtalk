// Phase 5: idempotently create the Stripe catalog and store the ids in plans.
//
//   - One Product per plan (matched by metadata.plan_id) + one for overage.
//   - Prices via lookup_key (starter_monthly, starter_annual, …, overage_minutes).
//     Prices are immutable: an amount change creates a replacement price and
//     moves the lookup_key over (transfer_lookup_key).
//   - One billing Meter 'overage_minutes' (sum), which the metered price bills
//     at $0.35/min. Usage lands via meter events from the daily cron.
//
//   npm run stripe-setup   (requires 0005_billing.sql applied)

import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import Stripe from 'stripe'
import { getEnv, serviceClient } from '@airtalk/db'
import { annualPriceCents, OVERAGE_CENTS_PER_MIN, OVERAGE_METER_EVENT } from '../apps/web/lib/billing-math'

async function ensureProduct(stripe: Stripe, existing: Stripe.Product[], key: string, name: string) {
  const found = existing.find((p) => p.metadata.plan_id === key)
  return found ?? (await stripe.products.create({ name, metadata: { plan_id: key } }))
}

async function ensurePrice(
  stripe: Stripe,
  opts: {
    lookupKey: string
    product: string
    unitAmount: number
    recurring: Stripe.PriceCreateParams.Recurring
  }
): Promise<Stripe.Price> {
  const { data } = await stripe.prices.list({ lookup_keys: [opts.lookupKey], limit: 1 })
  const existing = data[0]
  if (existing && existing.unit_amount === opts.unitAmount) return existing
  if (existing) {
    console.warn(
      `price ${opts.lookupKey}: amount ${existing.unit_amount} → ${opts.unitAmount}, creating replacement`
    )
  }
  return stripe.prices.create({
    currency: 'usd',
    product: opts.product,
    unit_amount: opts.unitAmount,
    recurring: opts.recurring,
    lookup_key: opts.lookupKey,
    transfer_lookup_key: true,
  })
}

async function main() {
  const stripe = new Stripe(getEnv().STRIPE_SECRET_KEY)
  const db = serviceClient()

  const { data: plans, error } = await db.from('plans').select('id, name, price_cents')
  if (error || !plans?.length) throw new Error(`plans: ${error?.message ?? 'empty'} — apply migrations first`)
  if (plans.some((p) => p.price_cents < 10_000)) {
    throw new Error('plans.price_cents looks like dollars — apply 0005_billing.sql first')
  }

  const products = (await stripe.products.list({ active: true, limit: 100 })).data

  const meters = (await stripe.billing.meters.list({ status: 'active', limit: 100 })).data
  const meter =
    meters.find((m) => m.event_name === OVERAGE_METER_EVENT) ??
    (await stripe.billing.meters.create({
      display_name: 'Overage minutes',
      event_name: OVERAGE_METER_EVENT,
      default_aggregation: { formula: 'sum' },
      customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
      value_settings: { event_payload_key: 'value' },
    }))

  const overageProduct = await ensureProduct(stripe, products, 'overage', 'Airtalk Overage minutes')
  const overagePrice = await ensurePrice(stripe, {
    lookupKey: OVERAGE_METER_EVENT,
    product: overageProduct.id,
    unitAmount: OVERAGE_CENTS_PER_MIN,
    recurring: { interval: 'month', usage_type: 'metered', meter: meter.id },
  })

  for (const plan of plans) {
    const product = await ensureProduct(stripe, products, plan.id, `Airtalk ${plan.name}`)
    const monthly = await ensurePrice(stripe, {
      lookupKey: `${plan.id}_monthly`,
      product: product.id,
      unitAmount: plan.price_cents,
      recurring: { interval: 'month' },
    })
    const annual = await ensurePrice(stripe, {
      lookupKey: `${plan.id}_annual`,
      product: product.id,
      unitAmount: annualPriceCents(plan.price_cents),
      recurring: { interval: 'year' },
    })
    const { error: upErr } = await db
      .from('plans')
      .update({
        stripe_product_id: product.id,
        stripe_price_monthly_id: monthly.id,
        stripe_price_annual_id: annual.id,
        stripe_overage_price_id: overagePrice.id,
      })
      .eq('id', plan.id)
    if (upErr) throw new Error(`plans update ${plan.id}: ${upErr.message}`)
    console.log(
      `${plan.id}: ${monthly.id} ($${plan.price_cents / 100}/mo), ${annual.id} ` +
        `($${annualPriceCents(plan.price_cents) / 100}/yr)`
    )
  }
  console.log(`overage: ${overagePrice.id} ($${OVERAGE_CENTS_PER_MIN / 100}/min, meter ${meter.id})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
