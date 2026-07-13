'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { emit } from '../lib/events'
import { ACTIVE_ORG_COOKIE } from '../lib/org'
import { provisionOrg } from '../lib/orgs-write'
import { userClient } from '../lib/supabase-server'

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
}

// Switch the active workspace. Only honors orgs the user actually belongs to
// (RLS scopes the membership read too), then redirects to /dashboard so every
// server component re-renders against the new org.
export async function switchWorkspaceAction(orgId: string): Promise<{ error?: string } | void> {
  const db = await userClient()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) redirect('/login')
  const { data: membership } = await db
    .from('org_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .maybeSingle()
  if (!membership) return { error: 'You are not a member of that workspace.' }
  ;(await cookies()).set(ACTIVE_ORG_COOKIE, orgId, COOKIE_OPTS)
  redirect('/dashboard')
}

// "Create workspace" from the switcher. Reuses provisionOrg (the same org +
// owner-membership write the signup funnel uses), sets the active-org cookie to
// the new org, and drops into it. Billing for the new org is set up from
// /billing — this only provisions and switches.
export async function createWorkspaceAction(
  _prev: { error?: string } | null,
  formData: FormData
): Promise<{ error?: string }> {
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Give your workspace a name.' }
  if (name.length > 80) return { error: 'Keep the name under 80 characters.' }

  const db = await userClient()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) redirect('/login')

  const { orgId, error } = await provisionOrg(user.id, name)
  if (error || !orgId) return { error: error ?? 'Could not create workspace.' }
  await emit('org/created', { orgId })
  ;(await cookies()).set(ACTIVE_ORG_COOKIE, orgId, COOKIE_OPTS)
  redirect('/dashboard')
}
