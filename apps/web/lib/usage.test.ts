import { describe, expect, it } from 'vitest'
import { usageCrossing } from './usage'

// cap 100 → warn line at 80
describe('usageCrossing', () => {
  it('is null while safely under the warn line', () => {
    expect(usageCrossing(10, 50, 100)).toBeNull()
  })

  it('fires warn exactly when crossing 80%', () => {
    expect(usageCrossing(79, 81, 100)).toBe('warn')
    expect(usageCrossing(81, 90, 100)).toBeNull() // already past — no repeat
  })

  it('fires cap exactly when crossing 100%', () => {
    expect(usageCrossing(99, 101, 100)).toBe('cap')
    expect(usageCrossing(101, 150, 100)).toBeNull() // already over — no repeat
  })

  it('one call crossing both lines reports cap, not warn', () => {
    expect(usageCrossing(70, 120, 100)).toBe('cap')
  })

  it('landing exactly on a line counts as crossed', () => {
    expect(usageCrossing(70, 80, 100)).toBe('warn')
    expect(usageCrossing(99, 100, 100)).toBe('cap')
  })
})
