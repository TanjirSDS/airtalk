import { describe, expect, it } from 'vitest'
import { compare, computeMetric, evaluateCrossing } from './alerts-eval'

const HOUR = 3_600_000
const T0 = Date.parse('2026-07-13T12:00:00.000Z')

describe('compare', () => {
  it('honors each operator', () => {
    expect(compare(5, 'gt', 3)).toBe(true)
    expect(compare(3, 'gt', 3)).toBe(false)
    expect(compare(3, 'gte', 3)).toBe(true)
    expect(compare(2, 'lt', 3)).toBe(true)
    expect(compare(3, 'lte', 3)).toBe(true)
    expect(compare(4, 'lte', 3)).toBe(false)
  })
})

describe('computeMetric', () => {
  const calls = [
    { outcome: 'failed', duration_secs: 60 },
    { outcome: 'booked', duration_secs: 120 },
    { outcome: 'failed', duration_secs: 30 },
    { outcome: 'question_answered', duration_secs: 90 },
  ]

  it('call_count is the row count', () => {
    expect(computeMetric('call_count', { calls })).toBe(4)
    expect(computeMetric('call_count', { calls: [] })).toBe(0)
  })

  it('failure_rate is the percent of failed calls, 0 when empty', () => {
    expect(computeMetric('failure_rate', { calls })).toBe(50)
    expect(computeMetric('failure_rate', { calls: [] })).toBe(0)
  })

  it('usage_pct is used/cap %, 0 when cap missing', () => {
    expect(computeMetric('usage_pct', { calls: [], usage: { minutes_used: 675, minutes_cap: 750 } })).toBe(90)
    expect(computeMetric('usage_pct', { calls: [], usage: { minutes_used: 5, minutes_cap: 0 } })).toBe(0)
    expect(computeMetric('usage_pct', { calls: [], usage: null })).toBe(0)
  })

  it('est_cost_cents = window minutes × included rate', () => {
    // 300s = 5 min × 13¢/min = 65¢
    expect(computeMetric('est_cost_cents', { calls, includedRateCentsPerMin: 13 })).toBe(65)
    expect(computeMetric('est_cost_cents', { calls, includedRateCentsPerMin: 0 })).toBe(0)
  })

  it('provider_down is the down count', () => {
    expect(computeMetric('provider_down', { calls: [], providersDown: 2 })).toBe(2)
    expect(computeMetric('provider_down', { calls: [] })).toBe(0)
  })
})

describe('evaluateCrossing — fires once per below→above edge, respecting cooldown', () => {
  const base = { cooldownMins: 60, now: T0 }

  it('fires on the below→above crossing', () => {
    const r = evaluateCrossing({ ...base, conditionMet: true, lastState: false, lastFiredAt: null })
    expect(r).toEqual({ fire: true, newState: true })
  })

  it('does not re-fire while the condition stays met', () => {
    const r = evaluateCrossing({ ...base, conditionMet: true, lastState: true, lastFiredAt: new Date(T0).toISOString() })
    expect(r.fire).toBe(false)
    expect(r.newState).toBe(true)
  })

  it('re-arms when the condition drops below', () => {
    const r = evaluateCrossing({ ...base, conditionMet: false, lastState: true, lastFiredAt: new Date(T0).toISOString() })
    expect(r).toEqual({ fire: false, newState: false })
  })

  it('a fresh crossing within cooldown is suppressed but still re-arms state', () => {
    // dropped below then re-crossed 30 min after the last fire (< 60 min cooldown)
    const r = evaluateCrossing({
      ...base,
      conditionMet: true,
      lastState: false,
      lastFiredAt: new Date(T0 - 30 * 60_000).toISOString(),
      now: T0,
    })
    expect(r.fire).toBe(false)
    expect(r.newState).toBe(true)
  })

  it('a fresh crossing fires once the cooldown has elapsed', () => {
    const r = evaluateCrossing({
      ...base,
      conditionMet: true,
      lastState: false,
      lastFiredAt: new Date(T0 - 2 * HOUR).toISOString(),
      now: T0,
    })
    expect(r.fire).toBe(true)
    expect(r.newState).toBe(true)
  })

  it('a full cycle fires exactly once per crossing', () => {
    // Simulate: below, above (fire), above, above, below, above (fire) — cooldown 0.
    const seq = [false, true, true, true, false, true]
    let lastState = false
    let lastFiredAt: string | null = null
    const fires: number[] = []
    seq.forEach((met, tick) => {
      const now = T0 + tick * 15 * 60_000
      const r = evaluateCrossing({ conditionMet: met, lastState, lastFiredAt, cooldownMins: 0, now })
      if (r.fire) {
        fires.push(tick)
        lastFiredAt = new Date(now).toISOString()
      }
      lastState = r.newState
    })
    expect(fires).toEqual([1, 5]) // once per below→above edge, never while held above
  })
})
