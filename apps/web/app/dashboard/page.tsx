import { serviceClient, type SupabaseClient } from '@airtalk/db'
import { DashboardCharts, type DayPoint, type WeekPoint } from '../../components/dashboard-charts'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
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

// The one dashboard query. orgId is threaded now so Phase 4 (org_id + RLS)
// only has to pass it — every stat below derives from this result set.
async function fetchRecentCalls(db: SupabaseClient, orgId?: string): Promise<CallRow[]> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - WEEKS * 7)
  since.setUTCHours(0, 0, 0, 0)
  let q = db.from('calls').select('started_at, duration_secs, outcome').gte('started_at', since.toISOString())
  if (orgId) q = q.eq('org_id', orgId) // column lands in Phase 4
  const { data, error } = await q
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
  const calls = await fetchRecentCalls(serviceClient())
  const now = new Date()

  const today = utcDayKey(now)
  const monthStart = today.slice(0, 8) + '01'
  const period = calls.filter((c) => c.started_at && c.started_at >= monthStart)
  const answered = period.filter((c) => (c.duration_secs ?? 0) > 0)
  const totalSecs = period.reduce((s, c) => s + (c.duration_secs ?? 0), 0)

  const stats: [string, string, string][] = [
    ['Calls today', String(calls.filter((c) => c.started_at?.startsWith(today)).length), ''],
    ['Minutes this month', String(Math.round(totalSecs / 60)), `${period.length} calls`],
    [
      'Answer rate',
      period.length ? `${Math.round((answered.length / period.length) * 100)}%` : '—',
      'calls with any talk time',
    ],
    ['Avg duration', answered.length ? formatDuration(Math.round(totalSecs / answered.length)) : '—', ''],
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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(([label, value, hint]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{value}</div>
              {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <DashboardCharts perDay={perDay} byWeek={byWeek} />
    </div>
  )
}
