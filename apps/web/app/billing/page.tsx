import Link from 'next/link'
import { serviceClient } from '@airtalk/db'
import { BillingInvoices } from '../../components/billing-invoices'
import { BillingUsageChart } from '../../components/billing-usage-chart'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Select } from '../../components/ui/select'
import { usagePeriodTotals } from '../../lib/analytics-math'
import { listInvoices } from '../../lib/billing'
import { annualPriceCents } from '../../lib/billing-math'
import { formatCents } from '../../lib/call-filters'
import { activeOrg, type ActiveOrg } from '../../lib/org'
import { stripeClient } from '../../lib/stripe'
import { userClient } from '../../lib/supabase-server'
import { cn } from '../../lib/utils'
import { choosePlanAction, portalAction } from './actions'

export const dynamic = 'force-dynamic'

type Tab = 'plan' | 'history' | 'usage'
const TABS: { id: Tab; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'history', label: 'History' },
  { id: 'usage', label: 'Usage' },
]

function TabBar({ tab }: { tab: Tab }) {
  return (
    <div className="inline-flex h-10 items-center gap-1 rounded-xl bg-muted p-1 text-muted-foreground">
      {TABS.map((t) => (
        <Link
          key={t.id}
          href={`/billing?tab=${t.id}`}
          className={cn(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            tab === t.id ? 'bg-card text-foreground shadow-sm' : 'hover:text-foreground'
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const org = await activeOrg()
  if (!org) return null
  const tab: Tab = params.tab === 'history' ? 'history' : params.tab === 'usage' ? 'usage' : 'plan'
  const isOwner = org.role === 'owner'
  const period = typeof params.period === 'string' ? params.period : undefined

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Current plan: <span className="font-medium text-foreground">{org.plan.name}</span>
          {org.pendingPlanId && ` — switching to ${org.pendingPlanId} next period`}
        </p>
      </header>

      <TabBar tab={tab} />

      {tab === 'plan' && <PlanTab org={org} isOwner={isOwner} />}
      {tab === 'history' && <HistoryTab org={org} isOwner={isOwner} />}
      {tab === 'usage' && <UsageTab org={org} isOwner={isOwner} period={period} />}
    </div>
  )
}

async function PlanTab({ org, isOwner }: { org: ActiveOrg; isOwner: boolean }) {
  const db = await userClient()
  const { data: plans } = await db
    .from('plans')
    .select('id, name, price_cents, included_minutes, max_agents')
    .order('price_cents')

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        {(plans ?? []).map((p) => {
          const isCurrent = p.id === org.plan.id
          return (
            <div key={p.id} className={`rounded-lg border p-4 ${isCurrent ? 'border-foreground' : ''}`}>
              <div className="flex items-baseline justify-between">
                <h2 className="font-medium">{p.name}</h2>
                {isCurrent && <span className="text-xs text-muted-foreground">current</span>}
                {org.pendingPlanId === p.id && <span className="text-xs text-muted-foreground">next period</span>}
              </div>
              <p className="mt-2 text-2xl font-semibold">
                ${p.price_cents / 100}
                <span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="text-xs text-muted-foreground">
                or ${(annualPriceCents(p.price_cents) / 100).toLocaleString()}/yr (15% off)
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {p.included_minutes.toLocaleString()} min · up to {p.max_agents} agent{p.max_agents === 1 ? '' : 's'}
              </p>
              {isOwner && !isCurrent && (
                <form action={choosePlanAction} className="mt-4 flex gap-2">
                  <input type="hidden" name="plan" value={p.id} />
                  <button name="interval" value="monthly" className="rounded border px-3 py-1 text-sm hover:bg-muted">
                    Monthly
                  </button>
                  <button name="interval" value="annual" className="rounded border px-3 py-1 text-sm hover:bg-muted">
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
        <p className="mt-2">Upgrades apply immediately (prorated). Downgrades take effect at the next billing period.</p>
      </div>
    </div>
  )
}

async function HistoryTab({ org, isOwner }: { org: ActiveOrg; isOwner: boolean }) {
  if (!isOwner) {
    return <p className="text-sm text-muted-foreground">Ask the org owner to view invoices.</p>
  }
  try {
    const { invoices, hasMore } = await listInvoices(serviceClient(), stripeClient(), org.orgId, { limit: 12 })
    return <BillingInvoices initial={invoices} hasMore={hasMore} />
  } catch {
    return <p className="text-sm text-muted-foreground">Invoices are unavailable right now.</p>
  }
}

async function UsageTab({ org, isOwner, period }: { org: ActiveOrg; isOwner: boolean; period?: string }) {
  const db = await userClient()
  const [{ data: periods }, { data: plan }] = await Promise.all([
    db.from('usage_periods').select('period_start').eq('org_id', org.orgId).order('period_start', { ascending: false }),
    db.from('plans').select('price_cents').eq('id', org.plan.id).maybeSingle(),
  ])
  const available = (periods ?? []).map((p) => p.period_start as string)
  const fallback = new Date().toISOString().slice(0, 8) + '01'
  const selected = period && available.includes(period) ? period : (available[0] ?? fallback)

  const end = new Date(`${selected}T00:00:00Z`)
  end.setUTCMonth(end.getUTCMonth() + 1)
  const [{ data: usageRow }, { data: calls }] = await Promise.all([
    db
      .from('usage_periods')
      .select('minutes_used, minutes_cap, overage_minutes, overage_reported')
      .eq('org_id', org.orgId)
      .eq('period_start', selected)
      .maybeSingle(),
    db.from('calls').select('started_at, duration_secs').gte('started_at', selected).lt('started_at', end.toISOString()),
  ])

  const totals = usagePeriodTotals(
    usageRow ?? { minutes_used: 0, minutes_cap: org.minutesCap, overage_minutes: 0, overage_reported: 0 },
    plan?.price_cents ?? 0
  )

  // Per-day minutes across the whole selected month (empty days included).
  const secsByDay = new Map<string, number>()
  for (const c of calls ?? []) {
    if (!c.started_at) continue
    const d = c.started_at.slice(0, 10)
    secsByDay.set(d, (secsByDay.get(d) ?? 0) + (c.duration_secs ?? 0))
  }
  const perDay: { day: string; minutes: number }[] = []
  const cur = new Date(`${selected}T00:00:00Z`)
  while (cur < end) {
    const key = cur.toISOString().slice(0, 10)
    perDay.push({ day: key, minutes: Math.round((secsByDay.get(key) ?? 0) / 60) })
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  const monthLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const cards = [
    { label: 'Included minutes', value: `${Math.round(totals.includedUsed)} / ${totals.cap}`, hint: 'used this period' },
    {
      label: 'Overage minutes',
      value: String(Math.round(totals.overageMinutes)),
      hint: `billed so far: ${formatCents(totals.billedSoFarCents)}`,
    },
    { label: 'Est. total', value: formatCents(totals.estTotalCents), hint: 'estimated — not billing truth' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="get" className="flex items-end gap-2">
          <input type="hidden" name="tab" value="usage" />
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Billing period</span>
            <Select name="period" defaultValue={selected} className="w-48">
              {available.length === 0 && <option value={selected}>{monthLabel(selected)}</option>}
              {available.map((p) => (
                <option key={p} value={p}>
                  {monthLabel(p)}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="outline" size="sm">
            View
          </Button>
        </form>
        {isOwner && (
          <form action={portalAction}>
            <Button type="submit" variant="outline" size="sm">
              Change payment methods
            </Button>
          </form>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="p-5">
            <span className="text-sm font-medium text-muted-foreground">{c.label}</span>
            <div className="stat-num mt-3 text-[1.8rem] leading-none">{c.value}</div>
            <p className="mt-2 text-xs text-muted-foreground">{c.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <BillingUsageChart perDay={perDay} />
      </Card>
    </div>
  )
}
