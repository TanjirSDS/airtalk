import { describe, expect, it } from 'vitest'
import {
  bucketKey,
  buildBuckets,
  chooseGranularity,
  estimatedCostCents,
  includedRateCentsPerMin,
  isCallSuccess,
  successRate,
  usagePeriodTotals,
} from './analytics-math'

describe('success derivation', () => {
  it('prefers EL analysis verdict over the outcome label', () => {
    expect(isCallSuccess(true, 'failed')).toBe(true) // EL says success, wins
    expect(isCallSuccess(false, 'booked')).toBe(false) // EL says failure, wins
  })
  it('falls back to the outcome heuristic when no verdict', () => {
    expect(isCallSuccess(null, 'booked')).toBe(true)
    expect(isCallSuccess(undefined, 'question_answered')).toBe(true)
    expect(isCallSuccess(undefined, 'spam')).toBe(false)
  })
  it('returns null when unclassifiable (no verdict, no outcome)', () => {
    expect(isCallSuccess(undefined, null)).toBeNull()
  })
  it('successRate ignores unclassifiable calls in the denominator', () => {
    const rate = successRate([
      { analysisSuccess: true }, // ok
      { outcome: 'booked' }, // ok (heuristic)
      { outcome: 'failed' }, // classifiable, not success
      { outcome: null, analysisSuccess: null }, // excluded
    ])
    expect(rate).toBeCloseTo(2 / 3, 5)
  })
  it('successRate is null when nothing is classifiable', () => {
    expect(successRate([{ outcome: null }, { analysisSuccess: null }])).toBeNull()
    expect(successRate([])).toBeNull()
  })
})

describe('granularity + bucketing', () => {
  it('picks day for short ranges, week beyond a month', () => {
    expect(chooseGranularity('2026-07-01', '2026-07-30')).toBe('day')
    expect(chooseGranularity('2026-07-01', '2026-08-01')).toBe('day') // exactly 31 days
    expect(chooseGranularity('2026-01-01', '2026-03-01')).toBe('week')
  })
  it('bucketKey returns the day, or the Monday of the UTC week', () => {
    expect(bucketKey('2026-07-15T10:00:00Z', 'day')).toBe('2026-07-15')
    // 2026-07-15 is a Wednesday → Monday is 2026-07-13
    expect(bucketKey('2026-07-15T10:00:00Z', 'week')).toBe('2026-07-13')
    // Monday maps to itself
    expect(bucketKey('2026-07-13T00:00:00Z', 'week')).toBe('2026-07-13')
  })
  it('buildBuckets is ordered, gap-free and inclusive', () => {
    expect(buildBuckets('2026-07-01', '2026-07-04', 'day')).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
    ])
    // weekly buckets dedupe to distinct Mondays across the span
    expect(buildBuckets('2026-07-01', '2026-07-20', 'week')).toEqual([
      '2026-06-29',
      '2026-07-06',
      '2026-07-13',
      '2026-07-20',
    ])
  })
  it('buildBuckets tolerates a reversed range without hanging', () => {
    expect(buildBuckets('2026-07-04', '2026-07-01', 'day')).toEqual([])
  })
})

describe('estimated cost (analytics card, rule-5 estimate)', () => {
  const rate = includedRateCentsPerMin(49_900, 750) // starter effective ~66.53¢/min
  it('minutes × included rate, rounded to cents', () => {
    expect(estimatedCostCents(100, rate)).toBe(Math.round(100 * rate))
  })
  it('adds whole period overage minutes at the flat overage rate', () => {
    // 150 whole overage minutes × 35¢ = $52.50 on top of the minutes estimate
    expect(estimatedCostCents(0, rate, 150.7)).toBe(150 * 35)
    expect(estimatedCostCents(0, rate, 150.7, 35)).toBe(5250)
  })
  it('never lets negative overage subtract', () => {
    expect(estimatedCostCents(0, rate, -20)).toBe(0)
  })
})

describe('usage-period totals (billing Usage tab)', () => {
  it('within cap: no overage, est total = plan base', () => {
    const t = usagePeriodTotals(
      { minutes_used: 400, minutes_cap: 750, overage_minutes: 0, overage_reported: 0 },
      49_900
    )
    expect(t.includedUsed).toBe(400)
    expect(t.cap).toBe(750)
    expect(t.overageMinutes).toBe(0)
    expect(t.billedSoFarCents).toBe(0)
    expect(t.estTotalCents).toBe(49_900)
  })
  it('over cap: acceptance 900 used / 750 cap = 150 overage ≈ $52.50, capped included', () => {
    const t = usagePeriodTotals(
      { minutes_used: 900, minutes_cap: 750, overage_minutes: 150, overage_reported: 100 },
      49_900
    )
    expect(t.includedUsed).toBe(750) // clamped to the cap
    expect(t.overageMinutes).toBe(150)
    expect(t.billedSoFarCents).toBe(100 * 35) // only what's been reported to Stripe
    expect(t.estTotalCents).toBe(49_900 + 150 * 35) // 49,900 + 5,250
  })
})
