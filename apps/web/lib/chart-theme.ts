'use client'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'

// Shared recharts chrome (grid/axes/tooltip colors) for light+dark. recharts
// sets colors as SVG attributes that don't resolve var(), so the chrome is
// picked from the resolved theme here — the CVD-validated OUTCOME_COLORS series
// hues stay fixed in both themes (Phase 9 decision). One source for the
// dashboard overview + the analytics page.
export function useChartTheme() {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'

  const GRID = dark ? '#262b37' : '#e6e9ef'
  const AXIS = dark ? '#333a48' : '#dbdfe7'
  const BRAND = dark ? '#8486f4' : '#5457e5'
  const CARD = dark ? '#13161e' : '#ffffff'
  return {
    dark,
    GRID,
    AXIS,
    BRAND,
    CARD,
    tick: { fill: dark ? '#8b97a8' : '#616b7a', fontSize: 12 },
    axisLine: { stroke: AXIS },
    tooltipStyle: {
      background: CARD,
      border: `1px solid ${GRID}`,
      borderRadius: 12,
      color: dark ? '#e8ecf3' : '#0c0e14',
      fontSize: 12,
    },
  }
}
