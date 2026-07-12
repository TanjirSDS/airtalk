import type { NextRequest } from 'next/server'
import { getEnv, serviceClient } from '@airtalk/db'
import { makeEngine } from '../../../../lib/engine'
import { reconcileYesterday } from '../../../../lib/reconcile'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // a day of calls can take a few provider pages

// Vercel cron (vercel.json) hits this nightly with `Authorization: Bearer $CRON_SECRET`.
export async function GET(req: NextRequest) {
  const secret = getEnv().CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 })
  }
  const summary = await reconcileYesterday(serviceClient(), makeEngine())
  console.log('reconcile:', summary)
  return Response.json(summary)
}
