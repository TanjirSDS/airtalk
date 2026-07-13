import Link from 'next/link'
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@airtalk/db'
import {
  AnalyticsCharts,
  type BreakdownBar,
  type OutcomePoint,
  type TrendPoint,
} from '../../components/analytics-charts'
import { UNCLASSIFIED_COLOR } from '../../components/dashboard-charts'
import { ClockIcon, GaugeIcon, PhoneIcon, SparkleIcon, TimerIcon } from '../../components/icons'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import {
  bucketKey,
  buildBuckets,
  chooseGranularity,
  estimatedCostCents,
  includedRateCentsPerMin,
  successRate,
} from '../../lib/analytics-math'
import { applyCallFilters, formatCents, formatDuration, parseCallFilters } from '../../lib/call-filters'
import { activeOrg, currentUsage } from '../../lib/org'
import { OUTCOME_COLORS, OUTCOMES } from '../../lib/outcome'
import { userClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'

// ponytail: JS aggregation over one bounded, RLS-scoped fetch (the fetchRecentCalls
// pattern). Row cap keeps a wide custom range from an unbounded pull — move the
// aggregation into a SQL view / RPC when call volume makes the transfer bite.
const ROW_CAP = 20_000

type Breakdown = 'agent' | 'outcome' | 'dow'
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Row {
  started_at: string | null
  duration_secs: number | null
  outcome: string | null
  direction: string | null
  agent_id: string | null
  analysis: { success?: boolean } | null
}

async function fetchCalls(db: SupabaseClient, filters: ReturnType<typeof parseCallFilters>): Promise<Row[]> {
  const { data, error } = await applyCallFilters(
    db.from('calls').select('started_at, duration_secs, outcome, direction, agent_id, analysis'),
    filters
  )
    .order('started_at', { ascending: false })
    .limit(ROW_CAP)
  if (error) throw new Error(error.message)
  return (data ?? []) as Row[]
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const org = await activeOrg()
  if (!org) return null

  const params = await searchParams
  // Default range: trailing 30 days (server-side new Date() is fine).
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const daysAgo = (n: number) => {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - n)
    return iso(d)
  }
  const filters = parseCallFilters(params)
  const from = filters.from ?? daysAgo(29)
  const to = filters.to ?? iso(today)
  filters.from = from
  filters.to = to
  filters.search = undefined // analytics controls have no number search
  const breakdown = (params.breakdown as Breakdown) || 'agent'

  const db = await userClient()
  const [{ data: agents }, calls, usage, { data: plan }] = await Promise.all([
    db.from('agents').select('id, name').order('name'),
    fetchCalls(db, filters),
    currentUsage(org.orgId),
    db.from('plans').select('price_cents, included_minutes').eq('id', org.plan.id).maybeSingle(),
  ])
  const agentName = new Map((agents ?? []).map((a) => [a.id, a.name]))

  // ── Metrics ───────────────────────────────────────────────────────────────
  const totalSecs = calls.reduce((s, c) => s + (c.duration_secs ?? 0), 0)
  const answered = calls.filter((c) => (c.duration_secs ?? 0) > 0)
  const totalMinutes = totalSecs / 60
  const rate = successRate(calls.map((c) => ({ analysisSuccess: c.analysis?.success ?? null, outcome: c.outcome })))

  // Est. cost (rule 5: estimate only). Overage is the current period's figure —
  // add it only when the selected range reaches into the current UTC month.
  const includedRate = includedRateCentsPerMin(plan?.price_cents ?? 0, plan?.included_minutes ?? 0)
  const monthStart = iso(today).slice(0, 8) + '01'
  const overage = to >= monthStart ? (usage?.overage_minutes ?? 0) : 0
  const estCost = estimatedCostCents(totalMinutes, includedRate, overage)

  const stats: { label: string; value: string; hint: string; icon: ReactNode }[] = [
    { label: 'Calls', value: String(calls.length), hint: `${from} → ${to}`, icon: <PhoneIcon className="h-4.5 w-4.5" /> },
    { label: 'Total minutes', value: String(Math.round(totalMinutes)), hint: `${answered.length} answered`, icon: <ClockIcon className="h-4.5 w-4.5" /> },
    { label: 'Avg duration', value: answered.length ? formatDuration(Math.round(totalSecs / answered.length)) : '—', hint: 'per answered call', icon: <TimerIcon className="h-4.5 w-4.5" /> },
    { label: 'Answer rate', value: calls.length ? `${Math.round((answered.length / calls.length) * 100)}%` : '—', hint: 'calls with talk time', icon: <GaugeIcon className="h-4.5 w-4.5" /> },
    { label: 'Success rate', value: rate == null ? '—' : `${Math.round(rate * 100)}%`, hint: 'EL verdict / outcome', icon: <SparkleIcon className="h-4.5 w-4.5" /> },
    { label: 'Est. cost', value: formatCents(estCost), hint: 'estimated — not billing truth', icon: <ClockIcon className="h-4.5 w-4.5" /> },
  ]

  // ── Chart datasets (server-side aggregation) ───────────────────────────────
  const granularity = chooseGranularity(from, to)
  const buckets = buildBuckets(from, to, granularity)
  const trendMap = new Map(buckets.map((b) => [b, { calls: 0, secs: 0 }]))
  const outcomeMap = new Map<string, Record<string, number>>(buckets.map((b) => [b, {}]))
  for (const c of calls) {
    if (!c.started_at) continue
    const b = bucketKey(c.started_at, granularity)
    const t = trendMap.get(b)
    if (t) {
      t.calls++
      t.secs += c.duration_secs ?? 0
    }
    const o = outcomeMap.get(b)
    if (o) {
      const key = c.outcome ?? 'unclassified'
      o[key] = (o[key] ?? 0) + 1
    }
  }
  const trend: TrendPoint[] = buckets.map((b) => {
    const t = trendMap.get(b)!
    return { bucket: b, calls: t.calls, minutes: Math.round(t.secs / 60) }
  })
  const outcomeKeys = [...OUTCOMES, 'unclassified']
  const outcomes: OutcomePoint[] = buckets.map((b) => {
    const counts = outcomeMap.get(b)!
    const point: OutcomePoint = { bucket: b }
    for (const k of outcomeKeys) point[k] = counts[k] ?? 0
    return point
  })

  // Breakdown horizontal bars
  const tally = new Map<string, number>()
  for (const c of calls) {
    let key: string
    if (breakdown === 'agent') key = c.agent_id ? (agentName.get(c.agent_id) ?? 'Unknown agent') : 'Unassigned'
    else if (breakdown === 'outcome') key = c.outcome ?? 'unclassified'
    else key = c.started_at ? DOW[(new Date(c.started_at).getUTCDay() + 6) % 7] : 'Unknown'
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  let bars: BreakdownBar[]
  if (breakdown === 'dow') {
    bars = DOW.map((d) => ({ name: d, calls: tally.get(d) ?? 0, color: null })).filter((b) => b.calls > 0)
  } else {
    bars = [...tally.entries()]
      .map(([name, calls]) => ({
        name,
        calls,
        color: breakdown === 'outcome' ? (OUTCOME_COLORS[name as keyof typeof OUTCOME_COLORS] ?? UNCLASSIFIED_COLOR) : null,
      }))
      .sort((a, b) => b.calls - a.calls)
  }
  const breakdownTitle = breakdown === 'agent' ? 'Calls by agent' : breakdown === 'outcome' ? 'Calls by outcome' : 'Calls by day of week'

  // Controls: presets + form (mirrors /calls). qs preserves current filters.
  const qs = (overrides: Record<string, string>) => {
    const base: Record<string, string | undefined> = {
      agent: filters.agent,
      direction: filters.direction,
      from,
      to,
      breakdown,
    }
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...overrides })) if (v) sp.set(k, v)
    return sp.toString()
  }
  const presets = [
    { label: '7 days', from: daysAgo(6), to: iso(today) },
    { label: '30 days', from: daysAgo(29), to: iso(today) },
    { label: '90 days', from: daysAgo(89), to: iso(today) },
  ]

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">Call performance across your voice agents.</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => {
          const active = from === p.from && to === p.to
          return (
            <Link key={p.label} href={`/analytics?${qs({ from: p.from, to: p.to })}`}>
              <Button variant={active ? 'default' : 'outline'} size="sm">
                {p.label}
              </Button>
            </Link>
          )
        })}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Agent</span>
          <Select name="agent" defaultValue={filters.agent ?? ''} className="w-44">
            <option value="">All agents</option>
            {agents?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Direction</span>
          <Select name="direction" defaultValue={filters.direction ?? ''} className="w-32">
            <option value="">All</option>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Breakdown</span>
          <Select name="breakdown" defaultValue={breakdown} className="w-40">
            <option value="agent">By agent</option>
            <option value="outcome">By outcome</option>
            <option value="dow">By day of week</option>
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">From</span>
          <Input type="date" name="from" defaultValue={from} className="w-38" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">To</span>
          <Input type="date" name="to" defaultValue={to} className="w-38" />
        </label>
        <Button type="submit">Apply</Button>
      </form>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label} className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand">{s.icon}</span>
            </div>
            <div className="stat-num mt-3 text-[1.6rem] leading-none">{s.value}</div>
            <p className="mt-2 text-xs text-muted-foreground">{s.hint}</p>
          </Card>
        ))}
      </div>

      <AnalyticsCharts trend={trend} outcomes={outcomes} breakdown={bars} breakdownTitle={breakdownTitle} granularity={granularity} />
    </div>
  )
}
