import { describe, expect, it } from 'vitest'
import { lineDiff } from './line-diff'

describe('lineDiff', () => {
  it('marks added and removed lines, keeps shared ones', () => {
    const out = lineDiff('a\nb\nc', 'a\nB\nc\nd')
    expect(out).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'B' },
      { type: 'same', text: 'c' },
      { type: 'add', text: 'd' },
    ])
  })

  it('identical text is all "same"', () => {
    expect(lineDiff('x\ny', 'x\ny').every((l) => l.type === 'same')).toBe(true)
  })
})
