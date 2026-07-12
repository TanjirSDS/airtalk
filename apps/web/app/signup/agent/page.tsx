import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Voice } from '@airtalk/engine'
import { AgentWizard } from '../../../components/agent-wizard'
import { Refresher } from '../../../components/refresher'
import { SignupSteps } from '../../../components/signup-steps'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { makeEngine } from '../../../lib/engine'
import { activeOrg } from '../../../lib/org'
import { userClient } from '../../../lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function SignupAgentPage() {
  const org = await activeOrg()
  if (!org) redirect('/signup')

  const db = await userClient()
  const [{ data: orgRow }, { count: agentCount }] = await Promise.all([
    db.from('orgs').select('stripe_subscription_id').eq('id', org.orgId).maybeSingle(),
    db.from('agents').select('id', { count: 'exact', head: true }).eq('org_id', org.orgId),
  ])

  // Checkout done but the webhook hasn't landed yet — poll until it does.
  if (!orgRow?.stripe_subscription_id) {
    return (
      <div className="mx-auto mt-10 max-w-xl space-y-6">
        <SignupSteps current={3} />
        <Card>
          <CardHeader>
            <CardTitle>Confirming your payment…</CardTitle>
            <CardDescription>
              This usually takes a few seconds. If you haven&apos;t checked out yet,{' '}
              <Link href="/signup/plan" className="underline">
                pick a plan first
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
        <Refresher />
      </div>
    )
  }

  if ((agentCount ?? 0) > 0) redirect('/signup/number') // agent exists — continue

  // Voice list comes from the provider — if it's down, say so instead of crashing.
  let voices: Voice[] | null = null
  try {
    voices = await makeEngine().listVoices()
  } catch (e) {
    console.error('listVoices failed:', e)
  }

  return (
    <div className="mx-auto mt-10 max-w-3xl space-y-6">
      <SignupSteps current={3} />
      <div>
        <h1 className="text-2xl font-semibold">Build your agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us about your business and we&apos;ll write the agent for you — you can edit
          everything later.
        </p>
      </div>
      {voices ? (
        <AgentWizard voices={voices} redirectTo="/signup/number" />
      ) : (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            The voice service is temporarily unreachable — refresh in a minute to continue setup.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
