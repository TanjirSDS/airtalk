import { notFound } from 'next/navigation'
import { userClient } from './supabase-server'

export interface AdminUser {
  userId: string
  email: string
}

/** The signed-in user iff they're in admin_users (RLS lets them see their own row). */
export async function adminUser(): Promise<AdminUser | null> {
  const db = await userClient()
  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return null
  const { data } = await db.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
  return data ? { userId: user.id, email: user.email ?? '' } : null
}

/** 404 (not 403) for non-admins — /admin shouldn't even look like it exists. */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await adminUser()
  if (!admin) notFound()
  return admin
}
