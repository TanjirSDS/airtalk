'use client'

import { useRouter } from 'next/navigation'
import { formatCents, formatDuration, joinedAgentName } from '../lib/call-filters'
import { Badge } from './ui/badge'

export interface CallRow {
  id: string
  started_at: string | null
  direction: string | null
  from_e164: string | null
  to_e164: string | null
  duration_secs: number | null
  cost_cents: number | null
  outcome: string | null
  status: string | null
  agents: unknown
}

// Row click sets ?call=<id> (merged with the current filters) so the drawer
// opens without losing the table's filter/page state.
export function CallsTable({
  rows,
  queryWithoutCall,
  selectedId,
}: {
  rows: CallRow[]
  queryWithoutCall: string
  selectedId: string | null
}) {
  const router = useRouter()
  const open = (id: string) => {
    const sep = queryWithoutCall ? '&' : ''
    router.push(`/calls?${queryWithoutCall}${sep}call=${id}`, { scroll: false })
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Agent</th>
            <th className="px-3 py-2 font-medium">Direction</th>
            <th className="px-3 py-2 font-medium">From → To</th>
            <th className="px-3 py-2 font-medium">Duration</th>
            <th className="px-3 py-2 font-medium">Cost</th>
            <th className="px-3 py-2 font-medium">Outcome</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                No calls match these filters.
              </td>
            </tr>
          )}
          {rows.map((c) => (
            <tr
              key={c.id}
              onClick={() => open(c.id)}
              className={`cursor-pointer border-b last:border-0 hover:bg-accent ${
                selectedId === c.id ? 'bg-accent' : ''
              }`}
            >
              <td className="px-3 py-2 whitespace-nowrap">
                {c.started_at ? new Date(c.started_at).toLocaleString() : '—'}
              </td>
              <td className="px-3 py-2">{joinedAgentName(c.agents) ?? '—'}</td>
              <td className="px-3 py-2">{c.direction ?? '—'}</td>
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                {c.from_e164 ?? '?'} → {c.to_e164 ?? '?'}
              </td>
              <td className="px-3 py-2 tabular-nums">{formatDuration(c.duration_secs)}</td>
              <td className="px-3 py-2 tabular-nums">{formatCents(c.cost_cents)}</td>
              <td className="px-3 py-2">
                {c.outcome ? <Badge variant="secondary">{c.outcome.replace('_', ' ')}</Badge> : '—'}
              </td>
              <td className="px-3 py-2">{c.status ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
