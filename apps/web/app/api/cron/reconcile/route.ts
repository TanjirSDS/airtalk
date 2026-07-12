import type { NextRequest } from 'next/server'
import { getEnv, serviceClient } from '@airtalk/db'
import { expireDunning, reportOverageDaily } from '../../../../lib/billing'
import { makeEngine } from '../../../../lib/engine'
import { reconcileYesterday } from '../../../../lib/reconcile'
import { stripeClient } from '../../../../lib/stripe'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // a day of calls can take a few provider pages

// Vercel cron (vercel.json) hits this nightly with `Authorization: Bearer $CRON_SECRET`.
// Reconciliation first (rule 5 rewrites usage), then billing consumes the fresh
// numbers: overage minutes → Stripe meter, expired dunning grace → pause.
export async function GET(req: NextRequest) {
  const secret = getEnv().CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 })
  }
  const db = serviceClient()
  const engine = makeEngine()
  const summary = await reconcileYesterday(db, engine)
  let billing: Record<string, unknown>
  try {
    billing = {
      overageOrgsReported: await reportOverageDaily(db, stripeClient()),
      dunningPaused: await expireDunning(db, engine),
    }
  } catch (e) {
    // reconciliation already succeeded — surface the billing failure without
    // losing its summary; the meter-event identifier makes tomorrow's retry safe
    console.error('billing cron step failed:', e)
    billing = { error: String(e) }
  }
  console.log('reconcile:', summary, 'billing:', billing)
  return Response.json({ ...summary, billing })
}
