import { describe, expect, it, vi } from 'vitest'
import { ElevenLabsEngine } from '@airtalk/engine'
import { attemptDelivery, enqueueWebhookEvent, OUTBOUND_SIG_HEADER, signBody } from './webhooks-out'

// Producer/consumer symmetry (rule 2): what we sign, the engine verifier accepts.
const SECRET = 'whsec_out_test'
const engine = new ElevenLabsEngine({
  apiKey: 'test',
  webhookSecret: SECRET,
  twilioAccountSid: 'AC_test',
  twilioAuthToken: 'test',
})

describe('signBody', () => {
  it('produces a header the engine verifier accepts', () => {
    const body = JSON.stringify({ type: 'call.completed', id: 'conv_1', data: { hi: true } })
    const signature = signBody(SECRET, body)
    expect(signature).toMatch(/^t=\d+,v0=[0-9a-f]{64}$/)
    expect(engine.verifyWebhook({ rawBody: body, signature })).toBe(true)
  })

  it('rejects a tampered body / wrong secret', () => {
    const body = JSON.stringify({ a: 1 })
    expect(engine.verifyWebhook({ rawBody: body + 'x', signature: signBody(SECRET, body) })).toBe(false)
    expect(engine.verifyWebhook({ rawBody: body, signature: signBody('other', body) })).toBe(false)
  })
})

// Minimal in-memory supabase stand-in covering exactly the calls the module makes.
function fakeDb(seed: { endpoints?: any[]; deliveries?: any[] } = {}) {
  const tables: Record<string, any[]> = {
    webhook_endpoints: seed.endpoints ?? [],
    webhook_deliveries: seed.deliveries ?? [],
  }
  function selectBuilder(rows: any[]) {
    let filtered = [...rows]
    const q: any = {
      eq(col: string, v: any) {
        filtered = filtered.filter((r) => r[col] === v)
        return q
      },
      in(col: string, vs: any[]) {
        filtered = filtered.filter((r) => vs.includes(r[col]))
        return q
      },
      maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
      then: (resolve: (v: any) => unknown) => resolve({ data: filtered, error: null }),
    }
    return q
  }
  const db: any = {
    tables,
    from(name: string) {
      const rows = tables[name]
      return {
        select: () => selectBuilder(rows),
        upsert(row: any, opts: { onConflict: string; ignoreDuplicates?: boolean }) {
          const keys = opts.onConflict.split(',')
          const existing = rows.find((r) => keys.every((k) => r[k] === row[k]))
          let data: any[] = []
          if (existing) {
            if (!opts.ignoreDuplicates) {
              Object.assign(existing, row)
              data = [existing]
            }
          } else {
            const stored = { id: `${name}_${rows.length + 1}`, ...row }
            rows.push(stored)
            data = [stored]
          }
          return {
            select: () => ({
              maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
              then: (resolve: (v: any) => unknown) => resolve({ data, error: null }),
            }),
          }
        },
        update(patch: any) {
          let targets = rows
          const q: any = {
            eq(col: string, v: any) {
              targets = targets.filter((r) => r[col] === v)
              return q
            },
            then: (resolve: (v: any) => unknown) => {
              targets.forEach((r) => Object.assign(r, patch))
              resolve({ data: null, error: null })
            },
          }
          return q
        },
      }
    },
  }
  return db
}

describe('enqueueWebhookEvent — idempotent per (endpoint, event_key)', () => {
  it('same event_key never queues twice for the same endpoint', async () => {
    const db = fakeDb({ endpoints: [{ id: 'ep_1', org_id: 'org_1', enabled: true, events: ['call.completed'] }] })
    const send = vi.fn(async () => true)
    const ev = { orgId: 'org_1', eventType: 'call.completed', eventKey: 'conv_1', payload: { x: 1 } }

    await enqueueWebhookEvent(db, ev, send)
    await enqueueWebhookEvent(db, ev, send) // replay / reconcile re-emit

    expect(db.tables.webhook_deliveries).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(1) // only the first (new) delivery is queued
  })

  it('fan-out only hits endpoints subscribed to the event type', async () => {
    const db = fakeDb({
      endpoints: [
        { id: 'ep_1', org_id: 'org_1', enabled: true, events: ['call.completed'] },
        { id: 'ep_2', org_id: 'org_1', enabled: true, events: ['alert.fired'] },
        { id: 'ep_3', org_id: 'org_1', enabled: false, events: ['call.completed'] }, // disabled
      ],
    })
    const send = vi.fn(async () => true)
    await enqueueWebhookEvent(db, { orgId: 'org_1', eventType: 'call.completed', eventKey: 'conv_1', payload: {} }, send)
    expect(db.tables.webhook_deliveries.map((d: any) => d.endpoint_id)).toEqual(['ep_1'])
  })

  it('an explicit endpointIds list (alerts) delivers regardless of subscription', async () => {
    const db = fakeDb({ endpoints: [{ id: 'ep_2', org_id: 'org_1', enabled: true, events: ['call.completed'] }] })
    const send = vi.fn(async () => true)
    await enqueueWebhookEvent(
      db,
      { orgId: 'org_1', eventType: 'alert.fired', eventKey: 'ae_1', payload: {}, endpointIds: ['ep_2'] },
      send
    )
    expect(db.tables.webhook_deliveries).toHaveLength(1)
  })
})

describe('attemptDelivery — status transitions + kill switch', () => {
  const endpoint = { id: 'ep_1', org_id: 'org_1', url: 'https://hook.example/x', secret: SECRET, enabled: true }
  const delivery = () => ({
    id: 'd_1',
    endpoint_id: 'ep_1',
    event_type: 'call.completed',
    event_key: 'conv_1',
    payload: { hi: 1 },
    status: 'pending',
    attempts: 0,
  })

  it('marks ok and signs the request on a 2xx', async () => {
    const db = fakeDb({ endpoints: [endpoint], deliveries: [delivery()] })
    const fetchFn = vi.fn(async () => new Response('', { status: 200 }))
    const res = await attemptDelivery(db, 'd_1', fetchFn as any)
    expect(res).toContain('ok')
    expect(db.tables.webhook_deliveries[0].status).toBe('ok')
    expect(db.tables.webhook_deliveries[0].attempts).toBe(1)
    const headers = ((fetchFn.mock.calls[0] as any[])[1] as any).headers
    expect(headers[OUTBOUND_SIG_HEADER]).toMatch(/^t=\d+,v0=[0-9a-f]{64}$/)
  })

  it('throws to request a retry while below the attempt cap', async () => {
    const db = fakeDb({ endpoints: [endpoint], deliveries: [{ ...delivery(), attempts: 2 }] })
    const fetchFn = vi.fn(async () => new Response('nope', { status: 500 }))
    await expect(attemptDelivery(db, 'd_1', fetchFn as any)).rejects.toThrow(/attempt 3 failed/)
    expect(db.tables.webhook_deliveries[0].status).toBe('failed')
    expect(db.tables.webhook_deliveries[0].attempts).toBe(3)
  })

  it('marks dead (no throw) at the attempt cap', async () => {
    const db = fakeDb({ endpoints: [endpoint], deliveries: [{ ...delivery(), attempts: 4 }] })
    const fetchFn = vi.fn(async () => new Response('nope', { status: 500 }))
    const res = await attemptDelivery(db, 'd_1', fetchFn as any)
    expect(res).toContain('dead')
    expect(db.tables.webhook_deliveries[0].status).toBe('dead')
    expect(db.tables.webhook_deliveries[0].attempts).toBe(5)
  })

  it('kill switch: a disabled endpoint stops delivery without calling fetch', async () => {
    const db = fakeDb({ endpoints: [{ ...endpoint, enabled: false }], deliveries: [delivery()] })
    const fetchFn = vi.fn(async () => new Response('', { status: 200 }))
    const res = await attemptDelivery(db, 'd_1', fetchFn as any)
    expect(res).toBe('endpoint disabled')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(db.tables.webhook_deliveries[0].status).toBe('failed')
  })

  it('never re-delivers a terminal (ok/dead) row', async () => {
    const db = fakeDb({ endpoints: [endpoint], deliveries: [{ ...delivery(), status: 'ok' }] })
    const fetchFn = vi.fn(async () => new Response('', { status: 200 }))
    expect(await attemptDelivery(db, 'd_1', fetchFn as any)).toBe('already ok')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
