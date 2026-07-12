import type { ReactElement } from 'react'
import { getEnv, type SupabaseClient } from '@airtalk/db'

// Resend's sandbox sender — works without domain verification, dev only.
const FROM_FALLBACK = 'Airtalk <onboarding@resend.dev>'

/** Origin for links inside emails. */
export function appUrl(): string {
  return getEnv().APP_URL ?? 'http://localhost:3000'
}

/**
 * Send one transactional email via Resend. No RESEND_API_KEY → skipped
 * (returns false), same pattern as the optional OpenAI key. Failures throw so
 * the Inngest wrapper can retry.
 */
export async function sendEmail(to: string[], subject: string, react: ReactElement): Promise<boolean> {
  const env = getEnv()
  if (!env.RESEND_API_KEY || to.length === 0) return false
  const { Resend } = await import('resend')
  const resend = new Resend(env.RESEND_API_KEY)
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM ?? FROM_FALLBACK,
    to,
    subject,
    react,
  })
  if (error) throw new Error(`resend: ${error.message}`)
  return true
}

/** Email addresses of an org's owners. db must be the service client (auth.admin). */
export async function orgOwnerEmails(db: SupabaseClient, orgId: string): Promise<string[]> {
  const { data: owners, error } = await db
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'owner')
  if (error) throw new Error(error.message)
  const emails: string[] = []
  for (const o of owners ?? []) {
    const { data } = await db.auth.admin.getUserById(o.user_id)
    if (data?.user?.email) emails.push(data.user.email)
  }
  return emails
}
