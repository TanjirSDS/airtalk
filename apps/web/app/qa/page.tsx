import Link from 'next/link'
import type { ReactNode } from 'react'
import type { SupabaseClient } from '@airtalk/db'
import { QaSuccessTrend } from '../../components/qa-charts'
import { QaDetailedCalls, type QaDetailedRow } from '../../components/qa-detailed-calls'
import { GaugeIcon, PhoneIcon, QaIcon, SparkleIcon } from '../../components/icons'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { applyCallFilters, parseCallFilters } from '../../lib/call-filters'
import { activeOrg } from '../../lib/org'
import { qaStats, successTrend, topQuestions, type QaCall } from '../../lib/qa-math'
import { userClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'

// ponytail: JS aggregation over one bounded, RLS-scoped fetch (the analytics
// pattern). Move into a SQL view/RPC if call volume ever makes the transfer bite.
const ROW_CAP = 20_000

type Tab = 'overview' | 'questions' | 'calls'

type CallRow = QaCall & { id: string; agent_id: string | null; direction: string | null }

async function fetchQaCalls(db: SupabaseClient, filters: ReturnType<typeof parseCallFilters>): Promise<CallRow[]> {
  const { data, error } = await applyCallFilters(
    db.from('calls').select('id, started_at, outcome, analysis, agent_id, direction'),
    filters
  )
    .order('started_at', { ascending: false })
    .limit(ROW_CAP)
  if (error) throw new Error(error.message)
  return (data ?? []) as CallRow[]
}

function pct(n: number | null): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`
}
function sentimentLabel(score: number | null): string {
  if (score == null) return '—'
  return score > 0.33 ? 'Positive' : score < -0.33 ? 'Negative' : 'Neutral'
}

export default async function QaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const org = await activeOrg()
  if (!org) return null

  // Plan gate: Growth + Pro see QA; Starter sees the upsell (mirrors /knowledge).
  if (!org.plan.qaEnabled) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="overflow-hidden">
          <div className="flex flex-col items-center gap-4 bg-brand-soft px-8 py-10 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white shadow-brand">
              <QaIcon className="h-7 w-7" />
            </span>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-brand">Growth feature</div>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">Measure how well your agents perform</h1>
            </div>
          </div>
          <div className="space-y-5 p-8 text-sm text-muted-foreground">
            <p>
              QA rolls up every call&apos;s success evaluation and the questions your agents couldn&apos;t answer
              into one scoreboard — success rate, resolution rate, escalations, and the top questions to teach
              your agents next. Available on the Growth plan and higher.
            </p>
            <Link href="/billing" className="block">
              <Button size="lg" className="w-full">
                Upgrade plan
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  const params = await searchParams
  const tab = (['overview', 'questions', 'calls'].includes(params.tab as string) ? params.tab : 'overview') as Tab
  const isPro = org.plan.id === 'pro'

  // Shared filter bar: agent + date range (default trailing 30 days, like analytics).
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
  filters.search = undefined // QA has no number search

  const db = await userClient()
  const { data: agents } = await db.from('agents').select('id, name').order('name')
  const agentName = new Map((agents ?? []).map((a) => [a.id, a.name]))

  // Preserve current filters + swap one param (tab nav + presets).
  const qs = (overrides: Record<string, string>) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries({ tab, agent: filters.agent, from, to, ...overrides }))
      if (v) sp.set(k, v)
    return sp.toString()
  }
  // "Configure QA Settings" → the selected agent's builder, Post-Call Data Extraction.
  const configAgentId = filters.agent ?? agents?.[0]?.id
  const configHref = configAgentId ? `/agents/${configAgentId}?section=extraction` : '/agents'

  const TABS: { key: Tab; label: string; show: boolean }[] = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'questions', label: 'Top Questions', show: true },
    { key: 'calls', label: 'Detailed Calls', show: isPro },
  ]

  let content: ReactNode
  if (tab === 'questions') {
    content = await QuestionsTab({ db, agentId: filters.agent, adaptive: org.plan.adaptiveEnabled })
  } else if (tab === 'calls') {
    content = isPro ? await CallsTab({ db, filters, agentName }) : <ProUpsell feature="Detailed Calls" />
  } else {
    content = await OverviewTab({ db, filters, from, to, configHref })
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">QA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How well your agents handle calls — from success evaluation and what they&apos;re still learning.
        </p>
      </header>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.filter((t) => t.show).map((t) => {
          const active = tab === t.key
          return (
            <Link
              key={t.key}
              href={`/qa?${qs({ tab: t.key })}`}
              className={
                active
                  ? 'border-b-2 border-brand px-4 py-2 text-sm font-semibold text-foreground'
                  : 'border-b-2 border-transparent px-4 py-2 text-sm text-muted-foreground hover:text-foreground'
              }
            >
              {t.label}
            </Link>
          )
        })}
      </div>

      {/* Filter bar (Top Questions ignores dates; agent applies to all tabs). */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />
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
        {tab !== 'questions' && (
          <>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">From</span>
              <Input type="date" name="from" defaultValue={from} className="w-38" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">To</span>
              <Input type="date" name="to" defaultValue={to} className="w-38" />
            </label>
          </>
        )}
        <Button type="submit">Apply</Button>
      </form>

      {content}
    </div>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────────
async function OverviewTab({
  db,
  filters,
  from,
  to,
  configHref,
}: {
  db: SupabaseClient
  filters: ReturnType<typeof parseCallFilters>
  from: string
  to: string
  configHref: string
}) {
  const calls = await fetchQaCalls(db, filters)
  const s = qaStats(calls)
  const trend = successTrend(calls, from, to)

  const stats: { label: string; value: string; hint: string; icon: ReactNode }[] = [
    { label: 'Calls analysed', value: String(s.analysed), hint: 'with analysis or an outcome', icon: <PhoneIcon className="h-4.5 w-4.5" /> },
    { label: 'Success rate', value: pct(s.successRate), hint: 'all criteria passed', icon: <SparkleIcon className="h-4.5 w-4.5" /> },
    { label: 'Resolution rate', value: pct(s.resolutionRate), hint: 'not escalated / failed', icon: <GaugeIcon className="h-4.5 w-4.5" /> },
    { label: 'Escalation rate', value: pct(s.escalationRate), hint: 'handed to a human', icon: <GaugeIcon className="h-4.5 w-4.5" /> },
    { label: 'Avg sentiment', value: sentimentLabel(s.avgSentiment), hint: 'when captured', icon: <SparkleIcon className="h-4.5 w-4.5" /> },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {from} → {to}
        </p>
        <Link href={configHref}>
          <Button variant="outline" size="sm">
            Configure QA settings
          </Button>
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {stats.map((st) => (
          <Card key={st.label} className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{st.label}</span>
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand">{st.icon}</span>
            </div>
            <div className="stat-num mt-3 text-[1.6rem] leading-none">{st.value}</div>
            <p className="mt-2 text-xs text-muted-foreground">{st.hint}</p>
          </Card>
        ))}
      </div>
      <QaSuccessTrend points={trend.points} per={trend.granularity} />
    </div>
  )
}

// ── Top Questions ────────────────────────────────────────────────────────────
async function QuestionsTab({
  db,
  agentId,
  adaptive,
}: {
  db: SupabaseClient
  agentId?: string
  adaptive: boolean
}) {
  // Source: Phase 8 agent_suggestions faq_addition rows (pending + applied).
  let q = db
    .from('agent_suggestions')
    .select('suggestion, evidence, status, agent_id')
    .eq('type', 'faq_addition')
    .in('status', ['pending', 'applied'])
  if (agentId) q = q.eq('agent_id', agentId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const questions = topQuestions((data ?? []) as any[])

  if (questions.length === 0) {
    // The feed is the Pro-only weekly learning extraction — point non-adaptive plans at it.
    return (
      <Card className="p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <SparkleIcon className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">No questions surfaced yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          {adaptive
            ? 'Your Pro agents review their calls every week and surface the questions callers asked that they couldn’t answer. They’ll appear here once the weekly review runs.'
            : 'This list is fed by the weekly call review that Pro agents run on themselves — the questions callers asked that your agents couldn’t answer. Upgrade to Pro to turn it on.'}
        </p>
        {!adaptive && (
          <Link href="/billing" className="mt-5 inline-block">
            <Button>Upgrade to Pro</Button>
          </Link>
        )}
      </Card>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Question</th>
            <th className="px-4 py-2 font-medium">Calls</th>
            <th className="px-4 py-2 font-medium">Suggested answer</th>
            <th className="px-4 py-2 font-medium">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((qn, i) => (
            <tr key={i} className="border-b last:border-0 align-top">
              <td className="px-4 py-3 font-medium">{qn.question}</td>
              <td className="px-4 py-3 tabular-nums">{qn.count}</td>
              <td className="px-4 py-3 text-muted-foreground">{qn.answer ?? '—'}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {qn.evidence.slice(0, 5).map((e, j) => (
                    <Link
                      key={j}
                      href={`/calls?call=${e.callId}`}
                      title={e.quote}
                      className="text-xs text-brand hover:underline"
                    >
                      call {j + 1}
                    </Link>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Detailed Calls (Pro) ─────────────────────────────────────────────────────
async function CallsTab({
  db,
  filters,
  agentName,
}: {
  db: SupabaseClient
  filters: ReturnType<typeof parseCallFilters>
  agentName: Map<string, string>
}) {
  const calls = await fetchQaCalls(db, filters)
  // "Analysed" = has native analysis OR our outcome (the Overview definition).
  const rows: QaDetailedRow[] = calls
    .filter((c) => c.analysis != null || c.outcome != null)
    .map((c) => ({
      id: c.id,
      startedAt: c.started_at ?? null,
      agentName: c.agent_id ? (agentName.get(c.agent_id) ?? null) : null,
      direction: c.direction,
      outcome: c.outcome,
      sentiment: c.analysis?.sentiment ?? null,
      criteria: c.analysis?.criteria ?? [],
    }))
  return <QaDetailedCalls rows={rows} />
}

function ProUpsell({ feature }: { feature: string }) {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand">
        <SparkleIcon className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-lg font-semibold">{feature} is a Pro feature</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Drill into every analysed call — per-criterion pass/fail, rationale, and sentiment — on the Pro plan.
      </p>
      <Link href="/billing" className="mt-5 inline-block">
        <Button>Upgrade to Pro</Button>
      </Link>
    </Card>
  )
}
