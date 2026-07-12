import { serviceClient } from '@airtalk/db'
import { makeEngine } from '../../../lib/engine'
import { appProbes, runHealthChecks } from '../../../lib/health'
import { stripeClient } from '../../../lib/stripe'

export const dynamic = 'force-dynamic'

// DB + Stripe + ElevenLabs reachability. 503 when anything is down so uptime
// monitors and load balancers see it. Public route → booleans only; failure
// details go to provider_status/Sentry via the status-poll job instead.
export async function GET() {
  const { ok, checks } = await runHealthChecks(appProbes(serviceClient(), stripeClient(), makeEngine()))
  return Response.json(
    { ok, checks: Object.fromEntries(Object.entries(checks).map(([name, c]) => [name, c.ok])) },
    { status: ok ? 200 : 503 }
  )
}
