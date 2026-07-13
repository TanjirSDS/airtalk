import type { ReactNode } from 'react'
import type { SupabaseClient } from '@airtalk/db'
import { DashboardCharts, type DayPoint, type WeekPoint } from '../../components/dashboard-charts'
import { ClockIcon, GaugeIcon, PhoneIcon, TimerIcon } from '../../components/icons'
import { userClient } from '../../lib/supabase-server'
import { Card } from '../../components/ui/card'
import { formatDuration } from '../../lib/call-filters'
import { OUTCOMES } from '../../lib/outcome'

export const dynamic = 'force-dynamic'

const WEEKS = 8
const DAYS = 30

interface CallRow {
  started_at: string | null
  duration_secs: number | null
  outcome: string | null
}

// The one dashboard query — RLS on the user client scopes it to the member's org.
async function fetchRecentCalls(db: SupabaseClient): Promise<CallRow[]> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - WEEKS * 7)
  since.setUTCHours(0, 0, 0, 0)
  const { data, error } = await db
    .from('calls')
    .select('started_at, duration_secs, outcome')
    .gte('started_at', since.toISOString())
  if (error) throw new Error(error.message)
  return data
}

function utcDayKey(d: Date) {
  return d.toISOString().slice(0, 10)
}

/** Monday of the UTC week containing d. */
function weekStart(d: Date) {
  const monday = new Date(d)
  monday.setUTCHours(0, 0, 0, 0)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return monday
}

export default async function DashboardPage() {
  // ponytail: aggregates computed in JS over one 8-week fetch — move to a SQL
  // view when call volume makes the row transfer noticeable.
  const calls = await fetchRecentCalls(await userClient())
  const now = new Date()

  const today = utcDayKey(now)
  const monthStart = today.slice(0, 8) + '01'
  const period = calls.filter((c) => c.started_at && c.started_at >= monthStart)
  const answered = period.filter((c) => (c.duration_secs ?? 0) > 0)
  const totalSecs = period.reduce((s, c) => s + (c.duration_secs ?? 0), 0)

  const stats: { label: string; value: string; hint: string; icon: ReactNode }[] = [
    {
      label: 'Calls today',
      value: String(calls.filter((c) => c.started_at?.startsWith(today)).length),
      hint: 'inbound + outbound',
      icon: <PhoneIcon className="h-4.5 w-4.5" />,
    },
    {
      label: 'Minutes this month',
      value: String(Math.round(totalSecs / 60)),
      hint: `across ${period.length} calls`,
      icon: <ClockIcon className="h-4.5 w-4.5" />,
    },
    {
      label: 'Answer rate',
      value: period.length ? `${Math.round((answered.length / period.length) * 100)}%` : '—',
      hint: 'calls with talk time',
      icon: <GaugeIcon className="h-4.5 w-4.5" />,
    },
    {
      label: 'Avg duration',
      value: answered.length ? formatDuration(Math.round(totalSecs / answered.length)) : '—',
      hint: 'per answered call',
      icon: <TimerIcon className="h-4.5 w-4.5" />,
    },
  ]

  const perDay: DayPoint[] = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - (DAYS - 1 - i))
    const key = utcDayKey(d)
    return {
      day: key.slice(5), // MM-DD
      calls: calls.filter((c) => c.started_at?.startsWith(key)).length,
    }
  })

  const byWeek: WeekPoint[] = Array.from({ length: WEEKS }, (_, i) => {
    const start = weekStart(now)
    start.setUTCDate(start.getUTCDate() - (WEEKS - 1 - i) * 7)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 7)
    const inWeek = calls.filter(
      (c) => c.started_at && c.started_at >= start.toISOString() && c.started_at < end.toISOString()
    )
    const point: WeekPoint = { week: `${start.getUTCMonth() + 1}/${start.getUTCDate()}` }
    for (const o of OUTCOMES) point[o] = inWeek.filter((c) => c.outcome === o).length
    point.unclassified = inWeek.filter((c) => !c.outcome).length
    return point
  })

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How your voice agents performed over the last eight weeks.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">{s.label}</span>
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand">
                {s.icon}
              </span>
            </div>
            <div className="stat-num mt-3 text-[2rem] leading-none">{s.value}</div>
            <p className="mt-2 text-xs text-muted-foreground">{s.hint}</p>
          </Card>
        ))}
      </div>

      <DashboardCharts perDay={perDay} byWeek={byWeek} />
    </div>
  )
}
