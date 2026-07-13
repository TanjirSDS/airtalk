'use client'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { bucketKey, type Granularity } from '../lib/analytics-math'
import { useChartTheme } from '../lib/chart-theme'
import { Button } from './ui/button'

// recharts hands tick/label formatters a ReactNode — accept any, format only strings.
const mmdd = (v: any) => (typeof v === 'string' ? v.slice(5) : v)

/** Minutes per day for one billing period; the Day/Week toggle re-buckets on the
 *  client (pure, no refetch) via the shared bucketKey helper. */
export function BillingUsageChart({ perDay }: { perDay: { day: string; minutes: number }[] }) {
  const [gran, setGran] = useState<Granularity>('day')
  const { GRID, BRAND, tick, axisLine, tooltipStyle } = useChartTheme()

  const data =
    gran === 'day'
      ? perDay
      : Object.entries(
          perDay.reduce<Record<string, number>>((acc, p) => {
            const k = bucketKey(`${p.day}T00:00:00Z`, 'week')
            acc[k] = (acc[k] ?? 0) + p.minutes
            return acc
          }, {})
        )
          .map(([day, minutes]) => ({ day, minutes }))
          .sort((a, b) => a.day.localeCompare(b.day))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Minutes per {gran}</h3>
        <div className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {(['day', 'week'] as const).map((g) => (
            <Button key={g} variant={gran === g ? 'default' : 'ghost'} size="sm" className="h-7 capitalize" onClick={() => setGran(g)}>
              {g}
            </Button>
          ))}
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="day" tickFormatter={mmdd} tick={tick} axisLine={axisLine} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: GRID, opacity: 0.4 }} labelFormatter={mmdd} formatter={(v) => [v, 'minutes']} />
            <Bar dataKey="minutes" fill={BRAND} radius={[3, 3, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
