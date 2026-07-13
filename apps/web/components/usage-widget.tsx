'use client'

import Link from 'next/link'
import { cn } from '../lib/utils'
import { GaugeIcon } from './icons'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

export interface UsageData {
  minutesUsed: number
  minutesCap: number
  overageMinutes: number
  overagePolicy: 'pause' | 'overage'
  planName: string
  periodLabel: string
}

// Thresholds match the layout UsageBanner: ≥80% warn, ≥100% danger.
function tone(pct: number) {
  if (pct >= 1) return { label: 'destructive', bar: 'bg-destructive', text: 'text-destructive', soft: 'bg-danger-soft' }
  if (pct >= 0.8) return { label: 'warn', bar: 'bg-warn', text: 'text-warn', soft: 'bg-warn-soft' }
  return { label: 'ok', bar: 'bg-brand', text: 'text-brand', soft: 'bg-brand-soft' }
}

export function UsageWidget({ data, collapsed = false }: { data: UsageData; collapsed?: boolean }) {
  const { minutesUsed, minutesCap, overageMinutes, overagePolicy, planName, periodLabel } = data
  const used = Math.round(minutesUsed)
  const pct = minutesCap > 0 ? minutesUsed / minutesCap : 0
  const pctText = Math.min(999, Math.round(pct * 100))
  const width = `${Math.min(100, pct * 100)}%`
  const t = tone(pct)

  return (
    <Popover>
      <PopoverTrigger asChild>
        {collapsed ? (
          <button
            aria-label={`Usage: ${used} of ${minutesCap} minutes`}
            className="relative grid h-10 w-10 place-items-center rounded-xl border bg-card text-muted-foreground transition-colors hover:bg-muted"
          >
            <GaugeIcon className="h-5 w-5" />
            <span className={cn('absolute right-1 top-1 h-2 w-2 rounded-full', t.bar)} />
          </button>
        ) : (
          <button className="w-full rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="text-muted-foreground">Minutes</span>
              <span className={cn('tabular-nums', t.text)}>
                {used.toLocaleString()} / {minutesCap.toLocaleString()}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full rounded-full transition-all', t.bar)} style={{ width }} />
            </div>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-72">
        <div className="flex items-center justify-between">
          <p className="font-display text-sm font-semibold tracking-tight">Usage</p>
          <span className="text-xs text-muted-foreground">{periodLabel}</span>
        </div>

        <div className="mt-3 flex items-baseline gap-1.5">
          <span className={cn('stat-num text-2xl', t.text)}>{used.toLocaleString()}</span>
          <span className="text-sm text-muted-foreground">/ {minutesCap.toLocaleString()} min</span>
          <span className="ml-auto text-xs font-medium text-muted-foreground">{pctText}%</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full rounded-full', t.bar)} style={{ width }} />
        </div>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="font-medium capitalize">{planName}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Over cap</dt>
            <dd className="font-medium">
              {overagePolicy === 'overage' ? 'Billed per minute' : 'Agents pause'}
            </dd>
          </div>
          {overagePolicy === 'overage' && overageMinutes > 0 && (
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Overage so far</dt>
              <dd className="font-medium tabular-nums">{Math.round(overageMinutes).toLocaleString()} min</dd>
            </div>
          )}
        </dl>

        <Link
          href="/billing"
          className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-brand-strong hover:shadow-brand"
        >
          Upgrade plan
        </Link>
      </PopoverContent>
    </Popover>
  )
}
