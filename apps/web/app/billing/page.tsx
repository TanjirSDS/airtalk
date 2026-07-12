import { annualPriceCents } from '../../lib/billing-math'
import { activeOrg, currentUsage } from '../../lib/org'
import { userClient } from '../../lib/supabase-server'
import { choosePlanAction, portalAction } from './actions'

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  const org = await activeOrg()
  if (!org) return null // middleware already gates unauthenticated traffic

  const db = await userClient()
  const [{ data: plans }, usage] = await Promise.all([
    db
      .from('plans')
      .select('id, name, price_cents, included_minutes, max_agents')
      .order('price_cents'),
    currentUsage(org.orgId),
  ])
  const isOwner = org.role === 'owner'

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Current plan: <span className="font-medium text-foreground">{org.plan.name}</span>
          {org.pendingPlanId && ` — switching to ${org.pendingPlanId} next period`}
          {usage &&
            ` · ${Math.round(usage.minutes_used)} of ${usage.minutes_cap} minutes used this month` +
              (usage.overage_minutes > 0 ? ` (${Math.round(usage.overage_minutes)} overage)` : '')}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {(plans ?? []).map((p) => {
          const isCurrent = p.id === org.plan.id
          return (
            <div key={p.id} className={`rounded-lg border p-4 ${isCurrent ? 'border-foreground' : ''}`}>
              <div className="flex items-baseline justify-between">
                <h2 className="font-medium">{p.name}</h2>
                {isCurrent && <span className="text-xs text-muted-foreground">current</span>}
                {org.pendingPlanId === p.id && (
                  <span className="text-xs text-muted-foreground">next period</span>
                )}
              </div>
              <p className="mt-2 text-2xl font-semibold">
                ${p.price_cents / 100}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="text-xs text-muted-foreground">
                or ${(annualPriceCents(p.price_cents) / 100).toLocaleString()}/yr (15% off)
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {p.included_minutes.toLocaleString()} min · up to {p.max_agents} agent
                {p.max_agents === 1 ? '' : 's'}
              </p>
              {isOwner && !isCurrent && (
                <form action={choosePlanAction} className="mt-4 flex gap-2">
                  <input type="hidden" name="plan" value={p.id} />
                  <button
                    name="interval"
                    value="monthly"
                    className="rounded border px-3 py-1 text-sm hover:bg-muted"
                  >
                    Monthly
                  </button>
                  <button
                    name="interval"
                    value="annual"
                    className="rounded border px-3 py-1 text-sm hover:bg-muted"
                  >
                    Annual
                  </button>
                </form>
              )}
            </div>
          )
        })}
      </div>

      <div className="text-sm text-muted-foreground">
        {isOwner ? (
          <form action={portalAction}>
            <button type="submit" className="underline hover:text-foreground">
              Manage billing — cards, invoices, cancel
            </button>
          </form>
        ) : (
          <p>Ask the org owner to change plans or payment details.</p>
        )}
        <p className="mt-2">
          Upgrades apply immediately (prorated). Downgrades take effect at the next billing period.
        </p>
      </div>
    </div>
  )
}
