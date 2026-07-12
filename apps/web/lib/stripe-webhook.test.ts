import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import { handleStripeWebhook } from './stripe-webhook'

const SECRET = 'whsec_test'
// Offline use only: constructEvent/generateTestHeaderString never hit the network.
const stripe = new Stripe('sk_test_offline')

function sign(payload: string) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET })
}

function event(id: string, type: string, object: Record<string, unknown>) {
  return JSON.stringify({ id, type, data: { object } })
}

// In-memory stand-in covering exactly the calls the handler makes. The real
// idempotency guarantee is the UNIQUE constraint in 0001_init.sql.
function fakeDb() {
  const tables: Record<string, any[]> = {
    webhook_events: [],
    orgs: [{ id: 'org_1', stripe_customer_id: 'cus_1', payment_failed_at: null }],
    plans: [],
  }
  const db = {
    tables,
    from(name: string) {
      const rows = tables[name]
      return {
        upsert(row: any, opts: { onConflict: string; ignoreDuplicates?: boolean }) {
          const existing = rows.find((r) => r[opts.onConflict] === row[opts.onConflict])
          let data: any[] = []
          if (!existing) {
            rows.push(row)
            data = [row]
          }
          return { select: () => Promise.resolve({ data, error: null }) }
        },
        select() {
          const preds: ((r: any) => boolean)[] = []
          const q: any = {
            eq(col: string, v: any) {
              preds.push((r) => r[col] === v)
              return q
            },
            not(col: string, _op: string, v: any) {
              preds.push((r) => r[col] !== v)
              return q
            },
            maybeSingle: () =>
              Promise.resolve({ data: rows.find((r) => preds.every((p) => p(r))) ?? null, error: null }),
            then(resolve: (v: any) => unknown) {
              resolve({ data: rows.filter((r) => preds.every((p) => p(r))), error: null })
            },
          }
          return q
        },
        update(patch: any) {
          const filters: [string, any][] = []
          const apply = () => {
            const hit = rows.filter((r) => filters.every(([c, v]) => r[c] === v))
            hit.forEach((r) => Object.assign(r, patch))
            return hit
          }
          const q: any = {
            eq(col: string, v: any) {
              filters.push([col, v])
              return q
            },
            is(col: string, v: any) {
              filters.push([col, v])
              return q
            },
            // Phase 6: payment_failed reads back the ids it marked (email event)
            select: () => Promise.resolve({ data: apply(), error: null }),
            then(resolve: (v: any) => unknown) {
              apply()
              resolve({ data: null, error: null })
            },
          }
          return q
        },
      }
    },
  }
  return db as any
}

const deps = (db: any) => ({ db, stripe, engine: {} as any, webhookSecret: SECRET })

describe('stripe webhook handler', () => {
  it('rejects a bad signature and stores nothing', async () => {
    const db = fakeDb()
    const res = await handleStripeWebhook(event('evt_1', 'invoice.paid', {}), 't=1,v1=bad', deps(db))
    expect(res.status).toBe(401)
    expect(db.tables.webhook_events).toHaveLength(0)
  })

  it('replayed event creates exactly one webhook_events row', async () => {
    const db = fakeDb()
    const body = event('evt_1', 'invoice.payment_failed', { customer: 'cus_1' })
    const sig = sign(body)

    const first = await handleStripeWebhook(body, sig, deps(db))
    const second = await handleStripeWebhook(body, sig, deps(db))

    expect(first.status).toBe(200)
    expect(second.body).toBe('duplicate ignored')
    expect(db.tables.webhook_events).toHaveLength(1)
    expect(db.tables.webhook_events[0].processed_at).toBeTruthy()
  })

  it('payment_failed starts the grace clock once; retries never reset it', async () => {
    const db = fakeDb()
    const first = event('evt_1', 'invoice.payment_failed', { customer: 'cus_1' })
    await handleStripeWebhook(first, sign(first), deps(db))
    const startedAt = db.tables.orgs[0].payment_failed_at
    expect(startedAt).toBeTruthy()

    // a later retry (distinct event id) must not move the clock
    const retry = event('evt_2', 'invoice.payment_failed', { customer: 'cus_1' })
    await handleStripeWebhook(retry, sign(retry), deps(db))
    expect(db.tables.orgs[0].payment_failed_at).toBe(startedAt)
  })

  it('invoice.paid clears dunning and resumes paused agents', async () => {
    const db = fakeDb()
    db.tables.orgs[0].payment_failed_at = '2026-07-01T00:00:00Z'
    db.tables.agents = [{ id: 'ag_1', org_id: 'org_1', status: 'paused', provider_agent_id: 'pa_1' }]
    db.tables.phone_numbers = [
      { org_id: 'org_1', agent_id: 'ag_1', provider_number_id: 'pn_1', agents: { provider_agent_id: 'pa_1' } },
    ]
    const attached: string[] = []
    const engine = { attachNumber: async (n: string) => void attached.push(n) } as any

    const body = event('evt_3', 'invoice.paid', { customer: 'cus_1' })
    const res = await handleStripeWebhook(body, sign(body), { db, stripe, engine, webhookSecret: SECRET })

    expect(res.status).toBe(200)
    expect(db.tables.orgs[0].payment_failed_at).toBeNull()
    expect(db.tables.agents[0].status).toBe('active')
    expect(attached).toEqual(['pn_1'])
  })
})
