'use client'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { OUTCOME_COLORS, OUTCOMES } from '../lib/outcome'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

export interface DayPoint {
  day: string
  calls: number
}
export type WeekPoint = { week: string } & Partial<Record<string, number | string>>

// Chart chrome per the dataviz palette: muted ink for axes, hairline grid,
// recessive baseline. Series hues live in OUTCOME_COLORS (validated set).
const UNCLASSIFIED = '#898781'
const tick = { fill: '#71717a', fontSize: 12 }
const axisLine = { stroke: '#c3c2b7' }
const label = (v: string) => v.replace('_', ' ')

export function DashboardCharts({ perDay, byWeek }: { perDay: DayPoint[]; byWeek: WeekPoint[] }) {
  const series = [...OUTCOMES.map((o) => [o, OUTCOME_COLORS[o]] as const), ['unclassified', UNCLASSIFIED] as const]
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Outcomes by week</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byWeek} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <CartesianGrid vertical={false} stroke="#e4e4e7" />
              <XAxis dataKey="week" tick={tick} axisLine={axisLine} tickLine={false} />
              <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value, name) => [value, label(String(name))]} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs text-foreground">{label(String(v))}</span>} />
              {series.map(([key, color]) => (
                // 1px white stroke = the spacer gap between stacked segments
                <Bar key={key} dataKey={key} stackId="outcomes" fill={color} stroke="#ffffff" strokeWidth={1} maxBarSize={40} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calls per day</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={perDay} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <CartesianGrid vertical={false} stroke="#e4e4e7" />
              <XAxis dataKey="day" tick={tick} axisLine={axisLine} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
              <Tooltip />
              <Line type="monotone" dataKey="calls" stroke="#2a78d6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
