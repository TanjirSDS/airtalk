import Link from 'next/link'
import { AlertsManager, type AlertRow, type EndpointOption } from '../../components/alerts-manager'
import { ALERT_METRIC_LABELS, ALERT_OPERATOR_LABELS, type AlertMetric, type AlertOperator } from '../../lib/alerts-eval'
import { cn } from '../../lib/utils'
import { userClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'

const TABS = [
  { id: 'alerts', label: 'Alerting' },
  { id: 'history', label: 'Alert history' },
] as const

function fmtDate(iso: string): string {
  // UTC ISO slice — SSR/client agree without locale drift (Phase 15 pattern).
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const active = tab === 'history' ? 'history' : 'alerts'
  const db = await userClient()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Alerting</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Get notified when a metric crosses a threshold — by email or your own webhook endpoint.
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/alerts?tab=${t.id}`}
            className={cn(
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              active === t.id
                ? 'border-brand text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {active === 'alerts' ? <AlertsTab db={db} /> : <HistoryTab db={db} />}
    </div>
  )
}

async function AlertsTab({ db }: { db: Awaited<ReturnType<typeof userClient>> }) {
  const [{ data: alerts }, { data: agents }, { data: endpoints }] = await Promise.all([
    db.from('alerts').select('*').order('created_at', { ascending: false }),
    db.from('agents').select('id, name').order('name'),
    db.from('webhook_endpoints').select('id, url').eq('enabled', true).order('created_at'),
  ])
  return (
    <AlertsManager
      alerts={(alerts ?? []) as AlertRow[]}
      agents={agents ?? []}
      endpoints={(endpoints ?? []) as EndpointOption[]}
    />
  )
}

async function HistoryTab({ db }: { db: Awaited<ReturnType<typeof userClient>> }) {
  const { data: events } = await db
    .from('alert_events')
    .select('id, fired_at, value, payload, alerts(name)')
    .order('fired_at', { ascending: false })
    .limit(100)

  const rows = (events ?? []) as {
    id: string
    fired_at: string
    value: number | null
    payload: { metric?: AlertMetric; operator?: AlertOperator; threshold?: number; notifiedVia?: string[] } | null
    alerts: { name: string } | { name: string }[] | null
  }[]

  if (!rows.length) {
    return (
      <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        No alerts have fired yet.
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b">
          <tr className="text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3">Alert</th>
            <th className="px-4 py-3">Condition</th>
            <th className="px-4 py-3">Value</th>
            <th className="px-4 py-3">Fired at</th>
            <th className="px-4 py-3">Notified via</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const alert = Array.isArray(e.alerts) ? e.alerts[0] : e.alerts
            const metric = e.payload?.metric
            const op = e.payload?.operator
            return (
              <tr key={e.id} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3 font-medium">{alert?.name ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {metric ? ALERT_METRIC_LABELS[metric] : '—'} {op ? ALERT_OPERATOR_LABELS[op] : ''}{' '}
                  {e.payload?.threshold ?? ''}
                </td>
                <td className="px-4 py-3">{e.value == null ? '—' : Math.round(e.value * 100) / 100}</td>
                <td className="px-4 py-3 text-muted-foreground">{fmtDate(e.fired_at)}</td>
                <td className="px-4 py-3 text-muted-foreground">{e.payload?.notifiedVia?.join(', ') || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
