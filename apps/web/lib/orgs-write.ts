import { serviceClient } from '@airtalk/db'

// Create an org + owner membership for a user. Service-role writes: members
// can't insert orgs or memberships under RLS (Phase 4 kept membership
// management out of user reach). Shared by the signup funnel (createOrgAction)
// and the workspace switcher's "Create workspace" (createWorkspaceAction) so
// both provision identically. Not a 'use server' module — server-only, imported
// only by server actions, so `userId` is never client-supplied.
export async function provisionOrg(
  userId: string,
  name: string
): Promise<{ orgId?: string; error?: string }> {
  const svc = serviceClient()
  const { data: starter } = await svc
    .from('plans')
    .select('included_minutes')
    .eq('id', 'starter')
    .single()
  const { data: org, error } = await svc
    .from('orgs')
    .insert({ name, minutes_cap: starter?.included_minutes ?? 750 })
    .select('id')
    .single()
  if (error || !org) return { error: error?.message ?? 'Could not create workspace.' }
  const { error: memberErr } = await svc
    .from('org_members')
    .insert({ org_id: org.id, user_id: userId, role: 'owner' })
  if (memberErr) return { error: memberErr.message }
  return { orgId: org.id }
}
