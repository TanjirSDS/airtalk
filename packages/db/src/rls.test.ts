// Phase 4 acceptance: org A cannot see org B's data — proven with two authed
// clients against a real Supabase (RLS lives in Postgres; it cannot be unit
// tested). Skips when no Supabase env is configured. Also exercises
// record_call_usage math live. Run: npm test (with .env.local present).

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const live = !!(URL && SERVICE_KEY && ANON_KEY)

describe.skipIf(!live)('RLS org isolation (live)', () => {
  const admin = live ? createClient(URL!, SERVICE_KEY!, { auth: { persistSession: false } }) : null!
  const stamp = `rls-test-${Date.now()}`
  const users: string[] = []
  const orgs: string[] = []
  let clientA: SupabaseClient
  let clientB: SupabaseClient

  async function makeUserAndOrg(tag: 'a' | 'b') {
    const email = `${stamp}-${tag}@airtalk.test`
    const password = `pw-${stamp}`
    const { data: u, error: uErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (uErr) throw uErr
    users.push(u.user.id)

    const { data: org, error: oErr } = await admin
      .from('orgs')
      .insert({ name: `${stamp}-org-${tag}`, plan_id: 'starter', minutes_cap: 100 })
      .select('id')
      .single()
    if (oErr) throw new Error(oErr.message)
    orgs.push(org.id)

    await admin.from('org_members').insert({ org_id: org.id, user_id: u.user.id, role: 'owner' })
    await admin
      .from('agents')
      .insert({ org_id: org.id, name: `${stamp}-agent-${tag}`, provider: 'elevenlabs' })

    const client = createClient(URL!, ANON_KEY!, { auth: { persistSession: false } })
    const { error: sErr } = await client.auth.signInWithPassword({ email, password })
    if (sErr) throw sErr
    return client
  }

  beforeAll(async () => {
    clientA = await makeUserAndOrg('a')
    clientB = await makeUserAndOrg('b')
  }, 60_000)

  afterAll(async () => {
    if (!admin) return
    for (const id of orgs) await admin.from('orgs').delete().eq('id', id) // cascades members/agents
    for (const id of users) await admin.auth.admin.deleteUser(id)
  }, 60_000)

  it('each member sees only their own org rows', async () => {
    const { data: aAgents } = await clientA.from('agents').select('name, org_id')
    const { data: bAgents } = await clientB.from('agents').select('name, org_id')
    expect(aAgents!.every((r) => r.org_id === orgs[0])).toBe(true)
    expect(bAgents!.every((r) => r.org_id === orgs[1])).toBe(true)
    expect(aAgents!.some((r) => r.name === `${stamp}-agent-a`)).toBe(true)
    expect(aAgents!.some((r) => r.name === `${stamp}-agent-b`)).toBe(false)
    expect(bAgents!.some((r) => r.name === `${stamp}-agent-a`)).toBe(false)
  }, 30_000)

  it('cannot write into another org', async () => {
    const { error } = await clientA
      .from('agents')
      .insert({ org_id: orgs[1], name: `${stamp}-intruder`, provider: 'elevenlabs' })
    expect(error).toBeTruthy() // RLS with-check rejects
    const { data } = await admin.from('agents').select('id').eq('name', `${stamp}-intruder`)
    expect(data).toHaveLength(0)
  }, 30_000)

  it('members cannot call the usage functions', async () => {
    const { error } = await clientA.rpc('record_call_usage', { p_org_id: orgs[0], p_secs: 60 })
    expect(error).toBeTruthy() // execute revoked from authenticated
  }, 30_000)

  it('record_call_usage increments atomically and accumulates overage', async () => {
    // cap is 100 min; 90 min then 20 min → 110 used, 10 overage
    const r1 = await admin.rpc('record_call_usage', { p_org_id: orgs[0], p_secs: 90 * 60 })
    expect(r1.error).toBeNull()
    expect(Number(r1.data![0].prev_minutes)).toBe(0)
    expect(Number(r1.data![0].new_minutes)).toBe(90)

    const r2 = await admin.rpc('record_call_usage', { p_org_id: orgs[0], p_secs: 20 * 60 })
    expect(Number(r2.data![0].prev_minutes)).toBe(90)
    expect(Number(r2.data![0].new_minutes)).toBe(110)

    const { data: period } = await admin
      .from('usage_periods')
      .select('minutes_used, overage_minutes, minutes_cap')
      .eq('org_id', orgs[0])
      .single()
    expect(Number(period!.minutes_used)).toBe(110)
    expect(Number(period!.overage_minutes)).toBe(10)
    expect(period!.minutes_cap).toBe(100)

    // member can read their own usage, not the other org's
    const { data: mine } = await clientA.from('usage_periods').select('org_id')
    expect(mine!.every((r) => r.org_id === orgs[0])).toBe(true)
    const { data: theirs } = await clientB.from('usage_periods').select('org_id').eq('org_id', orgs[0])
    expect(theirs).toHaveLength(0)
  }, 30_000)
})

it('rls live test env', () => {
  if (!live) console.warn('RLS tests skipped — set SUPABASE_URL / keys in .env.local to run them')
  expect(true).toBe(true)
})
