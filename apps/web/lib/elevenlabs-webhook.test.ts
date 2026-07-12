import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ElevenLabsEngine } from '@airtalk/engine'
import fixture from '../../../packages/engine/fixtures/post-call-transcription.json'
import { handleElevenLabsWebhook } from './elevenlabs-webhook'

const SECRET = 'whsec_test'

const engine = new ElevenLabsEngine({
  apiKey: 'test',
  webhookSecret: SECRET,
  twilioAccountSid: 'AC_test',
  twilioAuthToken: 'test',
})

function sign(body: string) {
  const t = Math.floor(Date.now() / 1000)
  return `t=${t},v0=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`
}

// In-memory stand-in for supabase covering exactly the calls the handler makes.
// The real idempotency guarantee is the UNIQUE constraint in 0001_init.sql;
// ignoreDuplicates mimics `on conflict do nothing`.
function fakeDb() {
  const tables: Record<string, any[]> = { webhook_events: [], calls: [], agents: [] }
  const db = {
    tables,
    from(name: string) {
      const rows = tables[name]
      return {
        upsert(row: any, opts: { onConflict: string; ignoreDuplicates?: boolean }) {
          const existing = rows.find((r) => r[opts.onConflict] === row[opts.onConflict])
          let data: any[] = []
          if (existing) {
            if (!opts.ignoreDuplicates) {
              Object.assign(existing, row)
              data = [existing]
            }
          } else {
            rows.push(row)
            data = [row]
          }
          const result = { data, error: null }
          return {
            select: () => Promise.resolve(result),
            then: (resolve: (v: typeof result) => unknown) => resolve(result),
          }
        },
        select: () => ({
          eq: (col: string, v: any) => ({
            maybeSingle: () => Promise.resolve({ data: rows.find((r) => r[col] === v) ?? null, error: null }),
          }),
        }),
        update: (patch: any) => ({
          eq: (col: string, v: any) => {
            rows.filter((r) => r[col] === v).forEach((r) => Object.assign(r, patch))
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
    },
  }
  return db as any
}

describe('elevenlabs webhook handler', () => {
  const body = JSON.stringify(fixture)

  it('rejects a bad signature and stores nothing', async () => {
    const db = fakeDb()
    const res = await handleElevenLabsWebhook(body, 't=1,v0=bad', engine, db)
    expect(res.status).toBe(401)
    expect(db.tables.webhook_events).toHaveLength(0)
  })

  it('replayed webhook creates exactly one webhook_events and one calls row', async () => {
    const db = fakeDb()
    const sig = sign(body)

    const first = await handleElevenLabsWebhook(body, sig, engine, db)
    const second = await handleElevenLabsWebhook(body, sig, engine, db)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body).toBe('duplicate ignored')
    expect(db.tables.webhook_events).toHaveLength(1)
    expect(db.tables.calls).toHaveLength(1)

    const call = db.tables.calls[0]
    expect(call.provider_call_id).toBe('conv_placeholder00000000000000000')
    expect(call.duration_secs).toBe(42)
    expect(db.tables.webhook_events[0].processed_at).toBeTruthy()
  })
})
