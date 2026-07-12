import { describe, expect, it } from 'vitest'
import {
  annualPriceCents,
  graceDaysLeft,
  overageDelta,
  OVERAGE_CENTS_PER_MIN,
  planChange,
} from './billing-math'

const starter = { id: 'starter', price_cents: 49_900, included_minutes: 750 }
const growth = { id: 'growth', price_cents: 99_900, included_minutes: 1500 }
const pro = { id: 'pro', price_cents: 149_900, included_minutes: 2500 }

describe('annual pricing (15% off, exact cents)', () => {
  it('matches the published plans', () => {
    expect(annualPriceCents(starter.price_cents)).toBe(508_980) // $5,089.80
    expect(annualPriceCents(growth.price_cents)).toBe(1_018_980)
    expect(annualPriceCents(pro.price_cents)).toBe(1_528_980)
  })
})

describe('overage delta reporting', () => {
  it('acceptance: 900 used / 750 cap → 150 overage minutes ≈ $52.50', () => {
    const delta = overageDelta(900 - 750, 0)
    expect(delta).toBe(150)
    expect(delta * OVERAGE_CENTS_PER_MIN).toBe(5250)
  })

  it('reports only whole unreported minutes, never negative', () => {
    expect(overageDelta(10.7, 0)).toBe(10)
    expect(overageDelta(10.7, 10)).toBe(0) // partial minute waits
    expect(overageDelta(12.2, 10)).toBe(2) // next day's delta
    expect(overageDelta(5, 10)).toBe(0) // recompute shrank usage → no refunds via meter
    expect(overageDelta(0, 0)).toBe(0)
  })
})

describe('plan changes', () => {
  it('upgrade mid-cycle applies the new cap immediately', () => {
    expect(planChange(starter, growth)).toEqual({ action: 'upgrade', planId: 'growth', minutesCap: 1500 })
    expect(planChange(growth, pro)).toEqual({ action: 'upgrade', planId: 'pro', minutesCap: 2500 })
  })

  it('downgrade defers to next period via pending_plan_id', () => {
    expect(planChange(pro, growth)).toEqual({ action: 'downgrade', pendingPlanId: 'growth' })
    expect(planChange(growth, starter)).toEqual({ action: 'downgrade', pendingPlanId: 'starter' })
  })

  it('same plan is a no-op', () => {
    expect(planChange(starter, starter)).toEqual({ action: 'none' })
  })
})

describe('dunning grace', () => {
  const failedAt = new Date('2026-07-01T12:00:00Z')
  it('counts down 7 days then hits zero', () => {
    expect(graceDaysLeft(failedAt, new Date('2026-07-01T13:00:00Z'))).toBe(7)
    expect(graceDaysLeft(failedAt, new Date('2026-07-05T12:00:00Z'))).toBe(3)
    expect(graceDaysLeft(failedAt, new Date('2026-07-08T12:00:00Z'))).toBe(0)
    expect(graceDaysLeft(failedAt, new Date('2026-08-01T12:00:00Z'))).toBe(0)
  })
})
