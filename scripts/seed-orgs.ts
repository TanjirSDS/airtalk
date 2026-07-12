// Phase 4 acceptance seed: two orgs with one owner each (no signup funnel —
// this script IS the org-creation path). Also adopts any pre-Phase-4 rows
// (org_id null) into org A so existing data stays visible.
//
//   npm run seed-orgs -- ownerA@example.com ownerB@example.com
//
// Idempotent: re-running updates rather than duplicates.

import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { getEnv, serviceClient } from '@airtalk/db'

const [emailA = 'owner-a@airtalk.test', emailB = 'owner-b@airtalk.test'] = process.argv.slice(2)

const ORGS = [
  { name: 'Org A (Acme Plumbing)', plan: 'starter', email: emailA },
  { name: 'Org B (Bright Dental)', plan: 'growth', email: emailB },
] as const

async function main() {
  getEnv()
  const db = serviceClient()

  const { data: plans, error: plansErr } = await db.from('plans').select('id, included_minutes')
  if (plansErr) throw new Error(`plans: ${plansErr.message} — did you apply 0004_orgs_rls.sql?`)

  const orgIds: string[] = []
  for (const spec of ORGS) {
    // user: magic-link only, so just create it confirmed; no password needed
    const { data: created, error: userErr } = await db.auth.admin.createUser({
      email: spec.email,
      email_confirm: true,
    })
    let userId = created?.user?.id
    if (userErr) {
      const { data: list } = await db.auth.admin.listUsers()
      userId = list?.users.find((u) => u.email === spec.email)?.id
      if (!userId) throw new Error(`create user ${spec.email}: ${userErr.message}`)
    }

    const cap = plans!.find((p) => p.id === spec.plan)!.included_minutes
    const { data: existing } = await db.from('orgs').select('id').eq('name', spec.name).maybeSingle()
    let orgId = existing?.id
    if (!orgId) {
      const { data: org, error } = await db
        .from('orgs')
        .insert({ name: spec.name, plan_id: spec.plan, minutes_cap: cap })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      orgId = org.id
    }
    orgIds.push(orgId!)

    const { error: memberErr } = await db
      .from('org_members')
      .upsert({ org_id: orgId, user_id: userId, role: 'owner' })
    if (memberErr) throw new Error(memberErr.message)
    console.log(`✓ ${spec.name} (${spec.plan}, cap ${cap} min) — owner ${spec.email}`)
  }

  // Adopt pre-Phase-4 rows so they don't vanish behind RLS.
  for (const table of ['agents', 'phone_numbers', 'calls'] as const) {
    const { data, error } = await db.from(table).update({ org_id: orgIds[0] }).is('org_id', null).select('id')
    if (error) throw new Error(`adopt ${table}: ${error.message}`)
    if (data?.length) console.log(`✓ adopted ${data.length} orphan ${table} rows into org A`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
