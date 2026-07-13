'use client'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useChartTheme } from '../lib/chart-theme'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

export interface QaTrendPoint {
  bucket: string // yyyy-mm-dd
  successRate: number | null // 0..1, null = no criteria-evaluated calls that bucket
}

const mmdd = (v: any) => (typeof v === 'string' ? v.slice(5) : v)
const pct = (v: any) => (typeof v === 'number' ? `${v}%` : v)

export function QaSuccessTrend({ points, per }: { points: QaTrendPoint[]; per: 'day' | 'week' }) {
  const { GRID, BRAND, tick, axisLine, tooltipStyle } = useChartTheme()
  const data = points.map((p) => ({ bucket: p.bucket, rate: p.successRate == null ? null : Math.round(p.successRate * 100) }))
  const hasData = data.some((d) => d.rate != null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Success rate per {per}</CardTitle>
      </CardHeader>
      <CardContent className="h-72">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="bucket" tickFormatter={mmdd} tick={tick} axisLine={axisLine} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis domain={[0, 100]} tickFormatter={pct} tick={tick} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: GRID }} labelFormatter={mmdd} formatter={(v: any) => [pct(v), 'Success']} />
              <Line type="monotone" dataKey="rate" stroke={BRAND} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No criteria-evaluated calls in range. Add success criteria in an agent&apos;s Post-Call Data
            Extraction settings to populate this.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
