'use client'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
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

// Series hues live in OUTCOME_COLORS (a CVD-validated set) and stay fixed in
// both themes; only the chart chrome (grid, axes, tooltip, the stacked-bar
// spacer) follows light/dark so it recedes on either surface.
const UNCLASSIFIED = '#898781'
const label = (v: string) => v.replace('_', ' ')

export function DashboardCharts({ perDay, byWeek }: { perDay: DayPoint[]; byWeek: WeekPoint[] }) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'

  const GRID = dark ? '#262b37' : '#e6e9ef'
  const AXIS = dark ? '#333a48' : '#dbdfe7'
  const BRAND = dark ? '#8486f4' : '#5457e5'
  const CARD = dark ? '#13161e' : '#ffffff'
  const tick = { fill: dark ? '#8b97a8' : '#616b7a', fontSize: 12 }
  const axisLine = { stroke: AXIS }
  const tooltipStyle = {
    background: CARD,
    border: `1px solid ${GRID}`,
    borderRadius: 12,
    color: dark ? '#e8ecf3' : '#0c0e14',
    fontSize: 12,
  }

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
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="week" tick={tick} axisLine={axisLine} tickLine={false} />
              <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: GRID, opacity: 0.4 }} formatter={(value, name) => [value, label(String(name))]} />
              <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs text-foreground">{label(String(v))}</span>} />
              {series.map(([key, color]) => (
                // 1px spacer gap between stacked segments = the card surface
                <Bar key={key} dataKey={key} stackId="outcomes" fill={color} stroke={CARD} strokeWidth={1} maxBarSize={40} />
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
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="day" tick={tick} axisLine={axisLine} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: GRID }} />
              <Line type="monotone" dataKey="calls" stroke={BRAND} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
