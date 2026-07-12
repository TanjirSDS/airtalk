import { describe, expect, it } from 'vitest'
import { localHour, zonesFor } from './areacode-tz'
import {
  clampWindow,
  dedupeContacts,
  estimatedSpendCents,
  isDialableNow,
  normalizeE164,
} from './campaign-math'

// July dates → EDT (UTC-4) / CDT (-5) / MDT (-6) / PDT (-7), Phoenix always -7.
const at = (iso: string) => new Date(iso)

describe('area code → timezone', () => {
  it('maps known codes', () => {
    expect(zonesFor('+12125550100')).toEqual(['America/New_York'])
    expect(zonesFor('+14155550100')).toEqual(['America/Los_Angeles'])
    expect(zonesFor('+16025550100')).toEqual(['America/Phoenix'])
    expect(zonesFor('+19075550100')).toEqual(['America/Anchorage'])
  })
  it('split codes carry both candidate zones', () => {
    expect(zonesFor('+18505550100')).toEqual(['America/New_York', 'America/Chicago'])
    expect(zonesFor('+19285550100')).toEqual(['America/Phoenix', 'America/Denver'])
  })
  it('unknown / non-NANP → empty (caller falls back to conservative)', () => {
    expect(zonesFor('+19995550100')).toEqual([])
    expect(zonesFor('+447911123456')).toEqual([])
  })
  it('localHour respects DST', () => {
    expect(localHour('America/New_York', at('2026-07-15T16:00:00Z'))).toBe(12)
    expect(localHour('America/New_York', at('2026-01-15T05:00:00Z'))).toBe(0)
    expect(localHour('America/Phoenix', at('2026-07-15T16:00:00Z'))).toBe(9)
  })
})

describe('calling window (rule 3: 8am–9pm recipient-local, hard)', () => {
  it('clamps to the legal band', () => {
    expect(clampWindow({ startHour: 6, endHour: 23 })).toEqual({ startHour: 8, endHour: 21 })
    expect(clampWindow({ startHour: 9, endHour: 20 })).toEqual({ startHour: 9, endHour: 20 })
    expect(clampWindow(undefined)).toEqual({ startHour: 8, endHour: 21 })
    // inverted input can't produce an empty window
    expect(clampWindow({ startHour: 20, endHour: 9 })).toEqual({ startHour: 20, endHour: 21 })
  })

  const legal = { startHour: 8, endHour: 21 }
  it('dials a NY number at noon NY time, not at 9pm', () => {
    expect(isDialableNow('+12125550100', legal, at('2026-07-15T16:00:00Z'))).toBe(true)
    expect(isDialableNow('+12125550100', legal, at('2026-07-16T01:00:00Z'))).toBe(false) // 21:00 EDT — end is exclusive
    expect(isDialableNow('+12125550100', legal, at('2026-07-16T00:59:00Z'))).toBe(true) // 20:59 EDT
  })
  it('unknown area code needs both coasts in-window', () => {
    expect(isDialableNow('+19995550100', legal, at('2026-07-15T12:30:00Z'))).toBe(false) // 8:30 NY, 5:30 LA
    expect(isDialableNow('+19995550100', legal, at('2026-07-15T17:00:00Z'))).toBe(true) // 1pm NY, 10am LA
  })
  it('split code needs both zones in-window', () => {
    expect(isDialableNow('+18505550100', legal, at('2026-07-15T12:30:00Z'))).toBe(false) // 8:30 ET, 7:30 CT
    expect(isDialableNow('+18505550100', legal, at('2026-07-15T13:30:00Z'))).toBe(true) // 9:30 ET, 8:30 CT
  })
  it('a narrowed campaign window is respected', () => {
    // 12:00 NY is outside a 1pm–5pm window
    expect(isDialableNow('+12125550100', { startHour: 13, endHour: 17 }, at('2026-07-15T16:00:00Z'))).toBe(false)
    expect(isDialableNow('+12125550100', { startHour: 13, endHour: 17 }, at('2026-07-15T18:00:00Z'))).toBe(true)
  })
})

describe('spend estimate (rule 3: money loop cap)', () => {
  it('charges completed minutes at $0.13 plus 2 estimated minutes per in-flight call', () => {
    expect(estimatedSpendCents(0, 0)).toBe(0)
    expect(estimatedSpendCents(600, 0)).toBe(130) // 10 min
    expect(estimatedSpendCents(600, 2)).toBe(130 + 52)
    expect(estimatedSpendCents(90, 0)).toBe(20) // 1.5 min → 19.5¢ rounds to 20
  })
  it('acceptance shape: a 50-contact campaign at ~2min/call estimates $13', () => {
    expect(estimatedSpendCents(50 * 120, 0)).toBe(1300)
  })
})

describe('CSV normalization', () => {
  it('normalizes US numbers to E.164', () => {
    expect(normalizeE164('(555) 010-4477')).toBe('+15550104477')
    expect(normalizeE164('1 555 010 4477')).toBe('+15550104477')
    expect(normalizeE164('+15550104477')).toBe('+15550104477')
    expect(normalizeE164('+44 7911 123456')).toBe('+447911123456')
    expect(normalizeE164('call me maybe')).toBe(null)
    expect(normalizeE164('555-0104')).toBe(null)
  })
  it('dedupes by normalized number, first row wins', () => {
    const { contacts, invalid, duplicates } = dedupeContacts([
      { phone: '(555) 010-4477', vars: { name: 'A' } },
      { phone: '+15550104477', vars: { name: 'B' } },
      { phone: 'nope', vars: {} },
      { phone: '555 010 9999', vars: { name: 'C' } },
    ])
    expect(contacts).toEqual([
      { e164: '+15550104477', vars: { name: 'A' } },
      { e164: '+15550109999', vars: { name: 'C' } },
    ])
    expect(duplicates).toBe(1)
    expect(invalid).toEqual(['nope'])
  })
})
