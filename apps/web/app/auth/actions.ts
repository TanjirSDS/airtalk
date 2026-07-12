'use server'

import { headers } from 'next/headers'
import { getEnv } from '@airtalk/db'
import { rateLimit } from '../../lib/ratelimit'
import { userClient } from '../../lib/supabase-server'

export interface MagicLinkState {
  sent?: boolean
  error?: string
}

/**
 * The one place magic links are sent (login AND signup) — server-side so it
 * can be rate limited per IP and per email. signup creates the auth user;
 * login keeps Phase 4's no-silent-signup behavior.
 */
export async function sendMagicLinkAction(
  _prev: MagicLinkState | null,
  formData: FormData
): Promise<MagicLinkState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const mode = formData.get('mode') === 'signup' ? 'signup' : 'login'
  if (!/.+@.+\..+/.test(email)) return { error: 'Enter a valid email address.' }

  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const [byIp, byEmail] = await Promise.all([
    rateLimit('auth', `otp:${ip}`),
    rateLimit('auth', `otp:${email}`),
  ])
  if (!byIp.success || !byEmail.success) {
    return { error: 'Too many attempts — try again in a few minutes.' }
  }

  const origin = h.get('origin') ?? getEnv().APP_URL ?? `https://${h.get('host')}`
  const next = mode === 'signup' ? '/signup/org' : '/dashboard'
  const db = await userClient()
  const { error } = await db.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      shouldCreateUser: mode === 'signup',
    },
  })
  if (error) return { error: error.message }
  return { sent: true }
}
