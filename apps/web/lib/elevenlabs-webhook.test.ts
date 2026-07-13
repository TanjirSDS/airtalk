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
  const tables: Record<string, any[]> = {
    webhook_events: [],
    calls: [],
    agents: [],
    call_bookings: [],
    campaigns: [],
    campaign_contacts: [],
    opt_outs: [],
  }
  const rpcCalls: { name: string; args: any }[] = []

  // Chainable filter builder: .eq().in() then .maybeSingle() or await directly.
  function filter(rows: any[]) {
    let filtered = rows
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
          const keys = opts.onConflict.split(',')
          const existing = rows.find((r) => keys.every((k) => r[k] === row[k]))
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
            select: () => ({
              maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
              then: (resolve: (v: typeof result) => unknown) => resolve(result),
            }),
            then: (resolve: (v: typeof result) => unknown) => resolve(result),
          }
        },
        select: () => filter(rows),
        update: (patch: any) => {
          let targets = rows
          const q: any = {
            eq(col: string, v: any) {
              targets = targets.filter((r) => r[col] === v)
              return q
            },
            in(col: string, vs: any[]) {
              targets = targets.filter((r) => vs.includes(r[col]))
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

  it('copies a mid-call Cal.com booking ref onto the call row (Phase 7)', async () => {
    const db = fakeDb()
    db.tables.call_bookings.push({
      provider_call_id: 'conv_placeholder00000000000000000',
      booking_ref: 'bk_uid_1',
    })
    await handleElevenLabsWebhook(body, sign(body), engine, db)
    expect(db.tables.calls[0].booking_ref).toBe('bk_uid_1')
  })

  it('maps the post-call analysis block into calls.analysis (Phase 12)', async () => {
    const db = fakeDb()
    await handleElevenLabsWebhook(body, sign(body), engine, db)
    const analysis = db.tables.calls[0].analysis
    expect(analysis).toMatchObject({ success: true, sentiment: 'neutral' })
    expect(analysis.data).toMatchObject({ user_sentiment: 'neutral' })
    expect(analysis.criteria[0]).toMatchObject({ name: 'call_successful', result: 'success' })
  })

  it('prefers an EL failure verdict over an optimistic classifier label (Phase 12)', async () => {
    const failed = structuredClone(fixture)
    ;(failed.data.analysis as { call_successful: string }).call_successful = 'failure'
    const b = JSON.stringify(failed)
    const db = fakeDb()
    const classify = async () => ({ outcome: 'booked' as const, summary: 'booked a visit' })
    await handleElevenLabsWebhook(b, sign(b), engine, db, classify)
    expect(db.tables.calls[0].outcome).toBe('failed')
    expect(db.tables.calls[0].analysis.success).toBe(false)
  })

  it('falls back to the classifier when the payload carries no analysis (Phase 12)', async () => {
    const bare = structuredClone(fixture) as { data: { analysis?: unknown } }
    delete bare.data.analysis
    const b = JSON.stringify(bare)
    const db = fakeDb()
    const classify = async () => ({ outcome: 'question_answered' as const, summary: 'answered a question' })
    await handleElevenLabsWebhook(b, sign(b), engine, db, classify)
    expect(db.tables.calls[0].outcome).toBe('question_answered')
    expect(db.tables.calls[0].analysis).toBeNull()
  })

  it('opt_out classification adds a do-not-call row and scrubs pending contacts (Phase 7)', async () => {
    const db = fakeDb()
    db.tables.agents.push({
      id: 'ag_1',
      org_id: 'org_1',
      provider_agent_id: 'agent_placeholder0000000000000000',
    })
    db.tables.campaigns.push({ id: 'camp_1', org_id: 'org_1' })
    db.tables.campaign_contacts.push(
      { campaign_id: 'camp_1', e164: '+15559876543', status: 'pending' }, // fixture's caller
      { campaign_id: 'camp_1', e164: '+15550000001', status: 'pending' }
    )

    const classify = async () => ({ outcome: 'opt_out' as const, summary: 'asked to be removed' })
    await handleElevenLabsWebhook(body, sign(body), engine, db, classify)

    expect(db.tables.opt_outs).toEqual([
      { org_id: 'org_1', e164: '+15559876543', source: 'call' },
    ])
    expect(db.tables.campaign_contacts.map((c: any) => c.status)).toEqual(['opted_out', 'pending'])
    expect(db.tables.calls[0].outcome).toBe('opt_out')
  })
})
