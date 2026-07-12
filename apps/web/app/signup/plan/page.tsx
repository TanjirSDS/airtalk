import { redirect } from 'next/navigation'
import { signupCheckoutAction } from '../actions'
import { SignupSteps } from '../../../components/signup-steps'
import { annualPriceCents } from '../../../lib/billing-math'
import { activeOrg } from '../../../lib/org'
import { userClient } from '../../../lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function SignupPlanPage() {
  const org = await activeOrg()
  if (!org) redirect('/signup')

  const db = await userClient()
  const [{ data: orgRow }, { data: plans }] = await Promise.all([
    db.from('orgs').select('stripe_subscription_id').eq('id', org.orgId).maybeSingle(),
    db.from('plans').select('id, name, price_cents, included_minutes, max_agents, kb_enabled').order('price_cents'),
  ])
  if (orgRow?.stripe_subscription_id) redirect('/signup/agent') // paid — continue

  return (
    <div className="mx-auto mt-10 max-w-3xl space-y-6">
      <SignupSteps current={2} />
      <div>
        <h1 className="text-2xl font-semibold">Pick your plan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every plan includes an AI agent, a real phone number, transcripts, and call outcomes.
          Change or cancel anytime.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {(plans ?? []).map((p) => (
          <div key={p.id} className="flex flex-col rounded-lg border p-4">
            <h2 className="font-medium">{p.name}</h2>
            <p className="mt-2 text-2xl font-semibold">
              ${p.price_cents / 100}
              <span className="text-sm font-normal text-muted-foreground">/mo</span>
            </p>
            <p className="text-xs text-muted-foreground">
              or ${(annualPriceCents(p.price_cents) / 100).toLocaleString()}/yr (15% off)
            </p>
            <p className="mt-2 grow text-sm text-muted-foreground">
              {p.included_minutes.toLocaleString()} min/mo · up to {p.max_agents} agent
              {p.max_agents === 1 ? '' : 's'}
              {p.kb_enabled ? ' · knowledge base' : ''}
            </p>
            <form action={signupCheckoutAction} className="mt-4 flex gap-2">
              <input type="hidden" name="plan" value={p.id} />
              <button name="interval" value="monthly" className="grow rounded border px-3 py-1 text-sm hover:bg-muted">
                Monthly
              </button>
              <button name="interval" value="annual" className="grow rounded border px-3 py-1 text-sm hover:bg-muted">
                Annual
              </button>
            </form>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Payment is handled securely by Stripe — you&apos;ll be right back here after checkout.</p>
    </div>
  )
}
