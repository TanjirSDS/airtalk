import { describe, expect, it } from 'vitest'
import { parseAdjustment } from './admin-adjustment'

describe('parseAdjustment (manual credits are money)', () => {
  it('accepts a credit with a note', () => {
    expect(parseAdjustment('-100', 'refund for outage 2026-07-10')).toEqual({
      minutesDelta: -100,
      note: 'refund for outage 2026-07-10',
    })
  })

  it('rejects zero, NaN, and out-of-band values', () => {
    expect(parseAdjustment('0', 'valid note')).toHaveProperty('error')
    expect(parseAdjustment('abc', 'valid note')).toHaveProperty('error')
    expect(parseAdjustment('999999', 'valid note')).toHaveProperty('error')
  })

  it('requires a real audit note', () => {
    expect(parseAdjustment('-100', '')).toHaveProperty('error')
    expect(parseAdjustment('-100', '  x ')).toHaveProperty('error')
  })
})
