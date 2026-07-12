// Phase 5 acceptance against a Stripe TEST key (Stripe side only — the
// webhook→dunning→pause chain is covered by unit tests in apps/web/lib):
//
//   1. Starter monthly on a test clock, upgrade to Growth mid-cycle →
//      subscription is on the Growth price immediately, preview invoice shows
//      a proration credit for unused Starter time.
//   2. 150 overage minutes via a meter event → ≈ $52.50 metered line on the
//      upcoming invoice (meters aggregate asynchronously; we poll).
//   3. A customer with a failing card → renewal invoice payment fails
//      (subscription past_due — the deployed webhook turns this into
//      payment_failed_at, and the nightly cron pauses agents after 7 days).
//
//   npm run stripe-acceptance   (requires npm run stripe-setup first)

import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import assert from 'node:assert/strict'
import Stripe from 'stripe'
import { getEnv } from '@airtalk/db'
import { OVERAGE_METER_EVENT } from '../apps/web/lib/billing-math'

const key = getEnv().STRIPE_SECRET_KEY
assert(key.startsWith('sk_test_'), 'refusing to run acceptance against a non-test key')
const stripe = new Stripe(key)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function advanceClock(clockId: string, to: number) {
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: to })
  for (let i = 0; i < 60; i++) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId)
    if (clock.status === 'ready') return
    await sleep(2000)
  }
  throw new Error('test clock never became ready')
}

async function price(lookupKey: string) {
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 })
  assert(data[0], `price ${lookupKey} not found — run npm run stripe-setup`)
  return data[0].id
}

async function customerOnClock(clockId: string, card: string) {
  const customer = await stripe.customers.create({ name: `acceptance ${card}`, test_clock: clockId })
  const pm = await stripe.paymentMethods.attach(card, { customer: customer.id })
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } })
  return customer
}

async function main() {
  const [starterMonthly, growthMonthly, overagePrice] = await Promise.all([
    price('starter_monthly'),
    price('growth_monthly'),
    price(OVERAGE_METER_EVENT),
  ])
  const now = Math.floor(Date.now() / 1000)

  // --- 1 + 2: upgrade mid-cycle, then overage on the upcoming invoice --------
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: now })
  const customer = await customerOnClock(clock.id, 'pm_card_visa')
  let sub = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: starterMonthly, quantity: 1 }, { price: overagePrice }],
  })
  assert.equal(sub.status, 'active')
  console.log('✓ subscribed to Starter monthly (+ metered overage item)')

  await advanceClock(clock.id, now + 10 * 86_400) // day 10 of the cycle
  const licensed = sub.items.data.find((i) => i.price.recurring?.usage_type !== 'metered')!
  sub = await stripe.subscriptions.update(sub.id, {
    items: [{ id: licensed.id, price: growthMonthly }],
    proration_behavior: 'create_prorations',
  })
  const nowLicensed = sub.items.data.find((i) => i.price.recurring?.usage_type !== 'metered')!
  assert.equal(nowLicensed.price.id, growthMonthly)
  console.log('✓ upgraded Starter→Growth mid-cycle — price switched immediately')
  // (2nd/3rd agent unlock: the subscription.updated webhook sets orgs.plan_id
  //  → plans.max_agents=3 gates createAgentAction. Verified by RLS/plan tests.)

  const preview = await stripe.invoices.createPreview({
    customer: customer.id,
    subscription: sub.id,
  })
  const credit = preview.lines.data.find((l) => l.amount < 0)
  assert(credit, 'expected a proration credit line for unused Starter time')
  console.log(
    `✓ preview invoice has proration lines (credit ${credit.amount}¢): total ${preview.total}¢`
  )

  await stripe.billing.meterEvents.create({
    event_name: OVERAGE_METER_EVENT,
    identifier: `acceptance-${clock.id}`,
    payload: { stripe_customer_id: customer.id, value: '150' },
  })
  console.log('… sent 150 overage minutes, waiting for meter aggregation (can take ~1-2 min)')
  const expected = 150 * 35 // 5250¢ = $52.50
  let meteredLine: Stripe.InvoiceLineItem | undefined
  for (let i = 0; i < 30 && !meteredLine; i++) {
    await sleep(10_000)
    const p = await stripe.invoices.createPreview({ customer: customer.id, subscription: sub.id })
    meteredLine = p.lines.data.find((l) => l.amount === expected)
  }
  assert(meteredLine, `expected a ${expected}¢ metered line on the upcoming invoice`)
  console.log('✓ 150 overage minutes ≈ $52.50 on the upcoming invoice')

  // --- 3: failed payment at renewal ------------------------------------------
  const clock2 = await stripe.testHelpers.testClocks.create({ frozen_time: now })
  const customer2 = await customerOnClock(clock2.id, 'pm_card_visa') // first invoice succeeds
  const sub2 = await stripe.subscriptions.create({
    customer: customer2.id,
    items: [{ price: starterMonthly, quantity: 1 }],
  })
  assert.equal(sub2.status, 'active')
  // swap to a card that declines, then cross the renewal
  const failing = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', {
    customer: customer2.id,
  })
  await stripe.customers.update(customer2.id, {
    invoice_settings: { default_payment_method: failing.id },
  })
  await advanceClock(clock2.id, now + 32 * 86_400)
  let renewed = await stripe.subscriptions.retrieve(sub2.id)
  for (let i = 0; i < 30 && renewed.status === 'active'; i++) {
    await sleep(5000) // renewal invoice payment settles asynchronously
    renewed = await stripe.subscriptions.retrieve(sub2.id)
  }
  assert.equal(renewed.status, 'past_due')
  console.log(
    '✓ renewal payment failed → subscription past_due (invoice.payment_failed → ' +
      'payment_failed_at → agents paused after 7-day grace; that chain is unit-tested)'
  )

  console.log('\nall acceptance checks passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
