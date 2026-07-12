import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SignupSteps } from '../../../components/signup-steps'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card'
import { activeOrg } from '../../../lib/org'
import { userClient } from '../../../lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function SignupDonePage() {
  const org = await activeOrg()
  if (!org) redirect('/signup')

  const db = await userClient()
  const { data: number } = await db
    .from('phone_numbers')
    .select('e164, agents(name)')
    .eq('org_id', org.orgId)
    .limit(1)
    .maybeSingle()
  if (!number) redirect('/signup/number')
  const agentName = (number.agents as { name?: string } | null)?.name

  return (
    <div className="mx-auto mt-10 max-w-xl space-y-6">
      <SignupSteps current={5} />
      <Card>
        <CardHeader>
          <CardTitle>🎉 {agentName ?? 'Your agent'} is live</CardTitle>
          <CardDescription>Try it right now — call your new number from your phone.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-3xl font-semibold tracking-tight">{number.e164}</p>
          <p className="text-sm text-muted-foreground">
            Every call shows up in your dashboard with a transcript, recording, and outcome.
            You can tweak your agent&apos;s script, voice, and knowledge anytime.
          </p>
          <Link
            href="/dashboard"
            className="block rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Go to your dashboard →
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
