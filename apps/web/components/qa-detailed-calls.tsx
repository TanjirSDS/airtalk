'use client'
import Link from 'next/link'
import { OUTCOME_COLORS, type Outcome } from '../lib/outcome'
import { Badge } from './ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table'

export interface QaDetailedRow {
  id: string
  startedAt: string | null
  agentName: string | null
  direction: string | null
  outcome: string | null
  sentiment: string | null
  criteria: { name: string; result: string; rationale?: string }[]
}

const isPass = (r: string) => r.trim().toLowerCase() === 'success'
const label = (v: string) => v.replace(/_/g, ' ')

function CriteriaChip({ c }: { c: { name: string; result: string; rationale?: string } }) {
  const variant = isPass(c.result) ? 'live' : c.result.trim().toLowerCase() === 'failure' ? 'destructive' : 'outline'
  const chip = (
    <Badge variant={variant} className="cursor-default normal-case">
      {label(c.name)}
    </Badge>
  )
  if (!c.rationale) return chip
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="cursor-help">
          {chip}
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-sm">
        <div className="mb-1 font-medium">{label(c.name)}</div>
        <p className="text-muted-foreground">{c.rationale}</p>
      </PopoverContent>
    </Popover>
  )
}

export function QaDetailedCalls({ rows }: { rows: QaDetailedRow[] }) {
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No analysed calls in range.</p>
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Criteria</TableHead>
            <TableHead>Sentiment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap">
                <Link href={`/calls?call=${r.id}`} className="font-medium text-brand hover:underline">
                  {r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}
                </Link>
                {r.direction && <span className="ml-2 text-xs capitalize text-muted-foreground">{r.direction}</span>}
              </TableCell>
              <TableCell className="text-muted-foreground">{r.agentName ?? '—'}</TableCell>
              <TableCell>
                {r.outcome ? (
                  <span className="inline-flex items-center gap-1.5 capitalize">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: OUTCOME_COLORS[r.outcome as Outcome] ?? '#77777c' }}
                    />
                    {label(r.outcome)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {r.criteria.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {r.criteria.map((c, i) => (
                      <CriteriaChip key={i} c={c} />
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">No criteria</span>
                )}
              </TableCell>
              <TableCell className="capitalize text-muted-foreground">{r.sentiment ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
