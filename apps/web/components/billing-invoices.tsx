'use client'
import { useState, useTransition } from 'react'
import { loadInvoicesAction } from '../app/billing/actions'
import type { InvoiceRow } from '../lib/billing'
import { formatCents } from '../lib/call-filters'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

// Deterministic (UTC) so server + client render the same string — no hydration drift.
const fmtDate = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10)

function statusVariant(status: string) {
  if (status === 'paid') return 'live' as const
  if (status === 'open') return 'warn' as const
  if (status === 'void' || status === 'uncollectible') return 'destructive' as const
  return 'outline' as const
}

export function BillingInvoices({ initial, hasMore: initialHasMore }: { initial: InvoiceRow[]; hasMore: boolean }) {
  const [rows, setRows] = useState(initial)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No invoices yet. They appear here after your first payment.</p>
  }

  const loadMore = () =>
    start(async () => {
      setError(null)
      try {
        const next = await loadInvoicesAction(rows[rows.length - 1].id)
        setRows((r) => [...r, ...next.invoices])
        setHasMore(next.hasMore)
      } catch {
        setError('Could not load more invoices.')
      }
    })

  return (
    <div className="space-y-4">
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{fmtDate(i.created)}</TableCell>
                <TableCell className="tabular-nums">
                  {formatCents(i.amountCents)}
                  {i.currency && i.currency !== 'usd' ? ` ${i.currency.toUpperCase()}` : ''}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(i.status)}>{i.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {i.hostedUrl ? (
                    <a href={i.hostedUrl} target="_blank" rel="noreferrer" className="text-brand underline hover:no-underline">
                      View
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {hasMore && (
        <Button variant="outline" size="sm" onClick={loadMore} disabled={pending}>
          {pending ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  )
}
