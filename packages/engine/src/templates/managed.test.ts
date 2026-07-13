import { describe, expect, it } from 'vitest'
import { getSection, hasSection, removeSection, setSection } from './managed'

const PROMPT = `You are an assistant.

## Rules
Be brief.

## Facts
Open 9-5.`

describe('managed sections', () => {
  it('reads a section body up to the next heading', () => {
    expect(getSection(PROMPT, '## Rules')).toBe('Be brief.')
    expect(getSection(PROMPT, '## Facts')).toBe('Open 9-5.')
    expect(getSection(PROMPT, '## Missing')).toBeNull()
  })

  it('appends a missing section to the end', () => {
    const out = setSection(PROMPT, '## Handbook', 'Stay on brand.')
    expect(hasSection(out, '## Handbook')).toBe(true)
    // untouched sections survive
    expect(getSection(out, '## Rules')).toBe('Be brief.')
  })

  it('replaces a section body in place without touching neighbours', () => {
    const out = setSection(PROMPT, '## Rules', 'Be very brief.')
    expect(getSection(out, '## Rules')).toBe('Be very brief.')
    expect(getSection(out, '## Facts')).toBe('Open 9-5.')
  })

  it('set → remove round-trips back to a stable prompt', () => {
    const added = setSection(PROMPT, '## Handbook', 'Stay on brand.')
    const removed = removeSection(added, '## Handbook')
    expect(hasSection(removed, '## Handbook')).toBe(false)
    // idempotent: setting the same body twice changes nothing further
    expect(setSection(added, '## Handbook', 'Stay on brand.')).toBe(added)
  })
})
