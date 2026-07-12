import type { NextRequest } from 'next/server'
import { getEnv, serviceClient } from '@airtalk/db'
import { makeEngine } from '../../../../lib/engine'
import { stripeClient } from '../../../../lib/stripe'
import { rateLimit } from '../../../../lib/ratelimit'
import { handleStripeWebhook } from '../../../../lib/stripe-webhook'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!(await rateLimit('webhook', `stripe:${ip}`)).success) {
    return new Response('rate limited', { status: 429 })
  }
  const res = await handleStripeWebhook(await req.text(), req.headers.get('stripe-signature'), {
    db: serviceClient(),
    stripe: stripeClient(),
    engine: makeEngine(),
    webhookSecret: getEnv().STRIPE_WEBHOOK_SECRET,
  })
  return new Response(res.body, { status: res.status })
}
