import { cookies } from 'next/headers'
import { cache } from 'react'
import { userClient } from './supabase-server'

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
  plan: { id: string; name: string; maxAgents: number; kbEnabled: boolean; adaptiveEnabled: boolean }
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
        'id, name, minutes_cap, overage_policy, payment_failed_at, pending_plan_id, plans!orgs_plan_id_fkey(id, name, max_agents, kb_enabled, adaptive_enabled)'
      )
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!org) return null
    const plan = org.plans as unknown as {
      id: string
      name: string
      max_agents: number
      kb_enabled: boolean
      adaptive_enabled: boolean
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
        kbEnabled: plan.kb_enabled,
        adaptiveEnabled: plan.adaptive_enabled,
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
          'id, name, minutes_cap, overage_policy, payment_failed_at, pending_plan_id, plans!orgs_plan_id_fkey(id, name, max_agents, kb_enabled, adaptive_enabled)'
        )
        .eq('id', viewAs)
        .maybeSingle()
      if (org) {
        const plan = org.plans as unknown as {
          id: string
          name: string
          max_agents: number
          kb_enabled: boolean
          adaptive_enabled: boolean
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
            kbEnabled: plan.kb_enabled,
            adaptiveEnabled: plan.adaptive_enabled,
          },
        }
      }
    }
    // non-admin (or dangling org id): the cookie is meaningless — ignore it.
  }

  const { data } = await db
    .from('org_members')
    .select(
      'org_id, role, orgs(name, minutes_cap, overage_policy, payment_failed_at, pending_plan_id, plans!orgs_plan_id_fkey(id, name, max_agents, kb_enabled, adaptive_enabled))'
    )
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
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
      kbEnabled: org.plans.kb_enabled,
      adaptiveEnabled: org.plans.adaptive_enabled,
    },
  }
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
