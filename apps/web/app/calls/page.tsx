import Link from 'next/link'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select } from '../../components/ui/select'
import { applyCallFilters, formatDuration, joinedAgentName, parseCallFilters } from '../../lib/call-filters'
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
  const db = await userClient()

  const [{ data: agents }, { data: calls, count, error }] = await Promise.all([
    db.from('agents').select('id, name').order('name'),
    applyCallFilters(
      db
        .from('calls')
        .select('id, started_at, direction, from_e164, to_e164, duration_secs, outcome, status, agents(name)', {
          count: 'exact',
        }),
      filters
    )
      .order('started_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
  ])
  if (error) throw new Error(error.message)

  const total = count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const qs = (overrides: Record<string, string>) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...filters, ...overrides })) if (v) sp.set(k, v)
    return sp.toString()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Calls</h1>
        <a href={`/calls/export?${qs({})}`}>
          <Button variant="outline">Export CSV</Button>
        </a>
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

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium">Direction</th>
              <th className="px-3 py-2 font-medium">From → To</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Outcome</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {calls?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  No calls match these filters.
                </td>
              </tr>
            )}
            {calls?.map((c) => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-accent">
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link href={`/calls/${c.id}`} className="block">
                    {c.started_at ? new Date(c.started_at).toLocaleString() : '—'}
                  </Link>
                </td>
                <td className="px-3 py-2">{joinedAgentName(c.agents) ?? '—'}</td>
                <td className="px-3 py-2">{c.direction ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {c.from_e164 ?? '?'} → {c.to_e164 ?? '?'}
                </td>
                <td className="px-3 py-2 tabular-nums">{formatDuration(c.duration_secs)}</td>
                <td className="px-3 py-2">
                  {c.outcome ? <Badge variant="secondary">{c.outcome.replace('_', ' ')}</Badge> : '—'}
                </td>
                <td className="px-3 py-2">{c.status ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
    </div>
  )
}
