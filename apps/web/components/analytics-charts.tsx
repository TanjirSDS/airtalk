'use client'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useChartTheme } from '../lib/chart-theme'
import { OUTCOME_COLORS, OUTCOMES } from '../lib/outcome'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { UNCLASSIFIED_COLOR } from './dashboard-charts'

export interface TrendPoint {
  bucket: string // yyyy-mm-dd
  calls: number
  minutes: number
}
export type OutcomePoint = { bucket: string } & Partial<Record<string, number | string>>
export interface BreakdownBar {
  name: string
  calls: number
  color: string | null // null → brand (single-hue series)
}

const label = (v: string) => v.replace(/_/g, ' ')
// recharts hands tick/label formatters a ReactNode — accept any, format only strings.
const mmdd = (v: any) => (typeof v === 'string' ? v.slice(5) : v)

export function AnalyticsCharts({
  trend,
  outcomes,
  breakdown,
  breakdownTitle,
  granularity,
}: {
  trend: TrendPoint[]
  outcomes: OutcomePoint[]
  breakdown: BreakdownBar[]
  breakdownTitle: string
  granularity: 'day' | 'week'
}) {
  const { GRID, BRAND, CARD, tick, axisLine, tooltipStyle } = useChartTheme()
  const per = granularity === 'week' ? 'week' : 'day'
  const series = [...OUTCOMES.map((o) => [o, OUTCOME_COLORS[o]] as const), ['unclassified', UNCLASSIFIED_COLOR] as const]

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Calls per {per}</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="bucket" tickFormatter={mmdd} tick={tick} axisLine={axisLine} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: GRID }} labelFormatter={mmdd} />
              <Line type="monotone" dataKey="calls" stroke={BRAND} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Minutes per {per}</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="bucket" tickFormatter={mmdd} tick={tick} axisLine={axisLine} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: GRID, opacity: 0.4 }} labelFormatter={mmdd} formatter={(v) => [v, 'minutes']} />
              <Bar dataKey="minutes" fill={BRAND} radius={[3, 3, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Outcomes per {per}</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={outcomes} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="bucket" tickFormatter={mmdd} tick={tick} axisLine={axisLine} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: GRID, opacity: 0.4 }} labelFormatter={mmdd} formatter={(value, name) => [value, label(String(name))]} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs text-foreground">{label(String(v))}</span>} />
              {series.map(([key, color]) => (
                <Bar key={key} dataKey={key} stackId="outcomes" fill={color} stroke={CARD} strokeWidth={1} maxBarSize={40} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{breakdownTitle}</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          {breakdown.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">No data in range</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdown} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={110} tick={tick} axisLine={false} tickLine={false} tickFormatter={(v) => label(String(v))} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: GRID, opacity: 0.4 }} formatter={(v) => [v, 'calls']} labelFormatter={(v) => label(String(v))} />
                <Bar dataKey="calls" radius={[0, 3, 3, 0]} maxBarSize={26}>
                  {breakdown.map((b, i) => (
                    <Cell key={i} fill={b.color ?? BRAND} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
