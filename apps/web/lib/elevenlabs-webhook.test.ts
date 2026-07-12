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
  const rpcCalls: { name: string; args: any }[] = []
  const db = {
    tables,
    rpcCalls,
    // record_call_usage stand-in; stays below thresholds so no enforcement runs
    rpc(name: string, args: any) {
      rpcCalls.push({ name, args })
      return Promise.resolve({
        data: [{ prev_minutes: 0, new_minutes: args.p_secs / 60, cap_minutes: 750 }],
        error: null,
      })
    },
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

  it('counts usage once per call — replays and unknown agents add nothing', async () => {
    const db = fakeDb()
    const sig = sign(body)

    // no agents row → no org to bill
    await handleElevenLabsWebhook(body, sig, engine, db)
    expect(db.rpcCalls).toHaveLength(0)

    // with an org-owned agent: first delivery records 42s exactly once
    const db2 = fakeDb()
    db2.tables.agents.push({
      id: 'ag_1',
      org_id: 'org_1',
      provider_agent_id: 'agent_placeholder0000000000000000',
    })
    await handleElevenLabsWebhook(body, sig, engine, db2)
    await handleElevenLabsWebhook(body, sig, engine, db2) // replay → duplicate ignored
    expect(db2.rpcCalls).toEqual([
      { name: 'record_call_usage', args: { p_org_id: 'org_1', p_secs: 42 } },
    ])
    expect(db2.tables.calls[0].org_id).toBe('org_1')
  })
})
