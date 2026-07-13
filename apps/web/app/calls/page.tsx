import Link from 'next/link'
import { CallDrawer } from '../../components/call-drawer'
import { CallsTable } from '../../components/calls-table'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { fetchCallDetail } from '../../lib/call-detail-data'
import { applyCallFilters, parseCallFilters } from '../../lib/call-filters'
import { OUTCOMES } from '../../lib/outcome'
import { userClient } from '../../lib/supabase-server'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const filters = parseCallFilters(params)
  const page = Math.max(1, Number(params.page) || 1)
  const callId = typeof params.call === 'string' ? params.call : null
  const db = await userClient()

  const [{ data: agents }, { data: calls, count, error }, detail] = await Promise.all([
    db.from('agents').select('id, name').order('name'),
    applyCallFilters(
      db
        .from('calls')
        .select(
          'id, started_at, direction, from_e164, to_e164, duration_secs, cost_cents, outcome, status, agents(name)',
          { count: 'exact' }
        ),
      filters
    )
      .order('started_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    callId ? fetchCallDetail(callId) : Promise.resolve(null),
  ])
  if (error) throw new Error(error.message)

  const total = count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const qs = (overrides: Record<string, string>) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...filters, ...overrides })) if (v) sp.set(k, v)
    return sp.toString()
  }
  const queryWithoutCall = qs(page > 1 ? { page: String(page) } : {})

  // Date-range presets layered on from/to. new Date() here is server-side (fine).
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const daysAgo = (n: number) => {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - n)
    return iso(d)
  }
  const presets = [
    { label: 'Today', from: iso(today), to: iso(today) },
    { label: '7 days', from: daysAgo(6), to: iso(today) },
    { label: '30 days', from: daysAgo(29), to: iso(today) },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Calls</h1>
        <a href={`/calls/export?${qs({})}`}>
          <Button variant="outline">Export CSV</Button>
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => {
          const active = filters.from === p.from && filters.to === p.to
          return (
            <Link key={p.label} href={`/calls?${qs({ from: p.from, to: p.to, page: '' })}`}>
              <Button variant={active ? 'default' : 'outline'} size="sm">
                {p.label}
              </Button>
            </Link>
          )
        })}
        {(filters.from || filters.to) && (
          <Link href={`/calls?${qs({ from: '', to: '', page: '' })}`}>
            <Button variant="ghost" size="sm">
              Clear dates
            </Button>
          </Link>
        )}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Search number</span>
          <Input name="search" defaultValue={filters.search ?? ''} placeholder="e.g. 555 1234" className="w-48" />
        </label>
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
          <span className="mb-1 block text-muted-foreground">Outcome</span>
          <Select name="outcome" defaultValue={filters.outcome ?? ''} className="w-44">
            <option value="">All</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o.replace('_', ' ')}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">From</span>
          <Input type="date" name="from" defaultValue={filters.from ?? ''} className="w-38" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">To</span>
          <Input type="date" name="to" defaultValue={filters.to ?? ''} className="w-38" />
        </label>
        <Button type="submit">Filter</Button>
      </form>

      <CallsTable rows={calls ?? []} queryWithoutCall={queryWithoutCall} selectedId={callId} />

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} call{total === 1 ? '' : 's'} · page {page} of {pages}
        </span>
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={`/calls?${qs({ page: String(page - 1) })}`}>
              <Button variant="outline">Previous</Button>
            </Link>
          )}
          {page < pages && (
            <Link href={`/calls?${qs({ page: String(page + 1) })}`}>
              <Button variant="outline">Next</Button>
            </Link>
          )}
        </div>
      </div>

      <CallDrawer detail={detail} closeHref={`/calls?${queryWithoutCall}`} />
    </div>
  )
}
