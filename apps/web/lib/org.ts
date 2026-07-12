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
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return null
  const { data } = await db
    .from('org_members')
    .select(
      'org_id, role, orgs(name, minutes_cap, overage_policy, payment_failed_at, pending_plan_id, plans(id, name, max_agents, kb_enabled, adaptive_enabled))'
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
