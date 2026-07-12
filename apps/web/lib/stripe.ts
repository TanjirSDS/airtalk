import Stripe from 'stripe'
import { getEnv } from '@airtalk/db'

let cached: Stripe | undefined

/** Server-only Stripe client (webhook, cron, server actions). */
export function stripeClient(): Stripe {
  cached ??= new Stripe(getEnv().STRIPE_SECRET_KEY)
  return cached
}
