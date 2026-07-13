import { cookies } from 'next/headers'
import { cache } from 'react'
import { userClient } from './supabase-server'

/** Org-switcher cookie (Phase 9): the workspace the user last switched to.
 *  Honored by activeOrg() below when it names an org they're a member of. */
export const ACTIVE_ORG_COOKIE = 'active-org'

// Shared select for a membership row + its org + plan (used by activeOrg).
const MEMBER_ORG_SELECT =
  'org_id, role, orgs(name, minutes_cap, overage_policy, payment_failed_at, pending_plan_id, plans!orgs_plan_id_fkey(id, name, max_agents, max_numbers, kb_enabled, adaptive_enabled, qa_enabled))'

export interface ActiveOrg {
  orgId: string
  role: string
  name: string
  minutesCap: number
  overagePolicy: 'pause' | 'overage'
  /** Set while a payment failure is unresolved (Phase 5 dunning). */
  paymentFailedAt: string | null
  /** Downgrade waiting for the next billing period. */
  pendingPlanId: string | null
  plan: {
    id: string
    name: string
    maxAgents: number
    maxNumbers: number
    kbEnabled: boolean
    adaptiveEnabled: boolean
    /** Phase 16: gates /qa (reporting). Growth + Pro. */
    qaEnabled: boolean
  }
}

// The signed-in user's org, once per request. RLS already scopes every query
// to member orgs; this exists for org_id on inserts and plan/cap lookups.
// ponytail: first membership wins — add an org-switcher cookie when someone
// actually belongs to two orgs.
export const activeOrg = cache(async (): Promise<ActiveOrg | null> => {
  const db = await userClient()

  // ponytail: DEV_BYPASS_AUTH=1 → first org as owner, no signed-in user —
  // local skeleton preview only. Delete once local signup works.
  if (process.env.DEV_BYPASS_AUTH === '1') {
    const { data: org } = await db
      .from('orgs')
      .select(
        'id, name, minutes_cap, overage_policy, payment_failed_at, pending_plan_id, plans!orgs_plan_id_fkey(id, name, max_agents, max_numbers, kb_enabled, adaptive_enabled, qa_enabled)'
      )
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!org) return null
    const plan = org.plans as unknown as {
      id: string
      name: string
      max_agents: number
      max_numbers: number
      kb_enabled: boolean
      adaptive_enabled: boolean
      qa_enabled: boolean
    }
    return {
      orgId: org.id,
      role: 'owner',
      name: org.name,
      minutesCap: org.minutes_cap,
      overagePolicy: org.overage_policy,
      paymentFailedAt: org.payment_failed_at,
      pendingPlanId: org.pending_plan_id,
      plan: {
        id: plan.id,
        name: plan.name,
        maxAgents: plan.max_agents,
        maxNumbers: plan.max_numbers,
        kbEnabled: plan.kb_enabled,
        adaptiveEnabled: plan.adaptive_enabled,
        qaEnabled: plan.qa_enabled,
      },
    }
  }

  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return null

  // Phase 6 support impersonation: an admin_users member with the view-as
  // cookie set browses any org. Role 'admin' never matches the 'owner' gates,
  // so billing/purchase writes stay blocked. RLS lets the reads through
  // because is_org_member() returns true for admins (migration 0006).
  const viewAs = (await cookies()).get('admin-view-org')?.value
  if (viewAs) {
    const { data: adm } = await db.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
    if (adm) {
      const { data: org } = await db
        .from('orgs')
        .select(
          'id, name, minutes_cap, overage_policy, payment_failed_at, pending_plan_id, plans!orgs_plan_id_fkey(id, name, max_agents, max_numbers, kb_enabled, adaptive_enabled, qa_enabled)'
        )
        .eq('id', viewAs)
        .maybeSingle()
      if (org) {
        const plan = org.plans as unknown as {
          id: string
          name: string
          max_agents: number
          max_numbers: number
          kb_enabled: boolean
          adaptive_enabled: boolean
          qa_enabled: boolean
        }
        return {
          orgId: org.id,
          role: 'admin',
          name: org.name,
          minutesCap: org.minutes_cap,
          overagePolicy: org.overage_policy,
          paymentFailedAt: org.payment_failed_at,
          pendingPlanId: org.pending_plan_id,
          plan: {
            id: plan.id,
            name: plan.name,
            maxAgents: plan.max_agents,
            maxNumbers: plan.max_numbers,
            kbEnabled: plan.kb_enabled,
            adaptiveEnabled: plan.adaptive_enabled,
            qaEnabled: plan.qa_enabled,
          },
        }
      }
    }
    // non-admin (or dangling org id): the cookie is meaningless — ignore it.
  }

  // Org switcher (Phase 9): if the active-org cookie names an org the user
  // belongs to, use it; otherwise fall back to first membership. RLS also
  // scopes this select, so a cookie pointing elsewhere simply misses.
  const cookieOrgId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value
  const byCookie = cookieOrgId
    ? (
        await db
          .from('org_members')
          .select(MEMBER_ORG_SELECT)
          .eq('user_id', user.id)
          .eq('org_id', cookieOrgId)
          .maybeSingle()
      ).data
    : null
  const data =
    byCookie ??
    (await db.from('org_members').select(MEMBER_ORG_SELECT).eq('user_id', user.id).limit(1).maybeSingle())
      .data
  if (!data) return null
  const org = data.orgs as any
  return {
    orgId: data.org_id,
    role: data.role,
    name: org.name,
    minutesCap: org.minutes_cap,
    overagePolicy: org.overage_policy,
    paymentFailedAt: org.payment_failed_at,
    pendingPlanId: org.pending_plan_id,
    plan: {
      id: org.plans.id,
      name: org.plans.name,
      maxAgents: org.plans.max_agents,
      maxNumbers: org.plans.max_numbers,
      kbEnabled: org.plans.kb_enabled,
      adaptiveEnabled: org.plans.adaptive_enabled,
      qaEnabled: org.plans.qa_enabled,
    },
  }
})

export interface Membership {
  orgId: string
  name: string
  role: string
}

/** Every org the signed-in user belongs to, for the workspace switcher.
 *  RLS scopes org_members to the user's own rows. Empty under DEV_BYPASS_AUTH
 *  (no signed-in user) — the switcher then just shows the active org. */
export const listMemberships = cache(async (): Promise<Membership[]> => {
  const db = await userClient()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return []
  const { data } = await db
    .from('org_members')
    .select('org_id, role, orgs(name)')
    .eq('user_id', user.id)
  return (data ?? []).map((m) => {
    const org = m.orgs as unknown as { name?: string } | null
    return { orgId: m.org_id, name: org?.name ?? 'Workspace', role: m.role }
  })
})

/** Current UTC month's usage row for the org, or null before its first call. */
export async function currentUsage(orgId: string) {
  const db = await userClient()
  const periodStart = new Date().toISOString().slice(0, 8) + '01'
  const { data } = await db
    .from('usage_periods')
    .select('minutes_used, minutes_cap, overage_minutes')
    .eq('org_id', orgId)
    .eq('period_start', periodStart)
    .maybeSingle()
  return data
}
