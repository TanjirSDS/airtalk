import { describe, expect, it } from 'vitest'
import { applySuggestionToPrompt, FAQ_HEADING, LEARNED_HEADING } from './merge'
import { getSection } from './managed'

const BASE = `You are the AI phone assistant for Joe's Plumbing.

## Your job on every call
Answer questions and take messages.`

describe('applySuggestionToPrompt', () => {
  it('appends a new FAQ, creating the ## FAQs section', () => {
    const out = applySuggestionToPrompt(BASE, 'faq_addition', {
      q: 'Do you do gutter cleaning?',
      a: 'Yes, from $99.',
    })!
    expect(out).toContain(FAQ_HEADING)
    expect(getSection(out, FAQ_HEADING)).toContain('Q: Do you do gutter cleaning?\nA: Yes, from $99.')
    expect(BASE).not.toContain('## FAQs') // pure — input untouched
  })

  it('replaces the answer when the question already exists (wrong-FAQ fix)', () => {
    const withFaq = applySuggestionToPrompt(BASE, 'faq_addition', {
      q: 'Do you service Riverside?',
      a: 'No.',
    })!
    const fixed = applySuggestionToPrompt(withFaq, 'faq_addition', {
      q: 'do you service riverside?', // case-insensitive match
      a: 'Yes, we do now.',
    })!
    const faqs = getSection(fixed, FAQ_HEADING)!
    expect(faqs).toContain('A: Yes, we do now.')
    expect(faqs).not.toContain('A: No.')
  })

  it('applying the same FAQ twice replaces rather than duplicates (acceptance)', () => {
    const once = applySuggestionToPrompt(BASE, 'faq_addition', { q: 'Are you open Sunday?', a: 'No.' })!
    // exact duplicate → no-op
    expect(applySuggestionToPrompt(once, 'faq_addition', { q: 'Are you open Sunday?', a: 'No.' })).toBeNull()
    // same question, new answer → replaces, still exactly one entry
    const twice = applySuggestionToPrompt(once, 'faq_addition', { q: 'Are you open Sunday?', a: 'Yes, 10-2.' })!
    expect(twice.match(/Q: Are you open Sunday\?/g)).toHaveLength(1)
    expect(getSection(twice, FAQ_HEADING)).toContain('A: Yes, 10-2.')
  })

  it('is a no-op for malformed payloads', () => {
    expect(applySuggestionToPrompt(BASE, 'faq_addition', { q: 'Only a question' })).toBeNull()
    expect(applySuggestionToPrompt(BASE, 'prompt_tweak', {})).toBeNull()
  })

  it('appends prompt tweaks and escalation rules to ## Learned adjustments, deduped', () => {
    const one = applySuggestionToPrompt(BASE, 'prompt_tweak', {
      instruction: 'Always mention the weekend emergency line.',
    })!
    expect(getSection(one, LEARNED_HEADING)).toBe('- Always mention the weekend emergency line.')
    // same instruction via a different type → still a duplicate → no-op
    expect(
      applySuggestionToPrompt(one, 'escalation_rule', {
        instruction: 'always mention the weekend emergency line.',
      })
    ).toBeNull()
    const two = applySuggestionToPrompt(one, 'escalation_rule', {
      instruction: 'If the caller mentions flooding, escalate immediately.',
    })!
    expect(getSection(two, LEARNED_HEADING)!.split('\n')).toHaveLength(2)
  })

  it('never auto-applies kb_gap', () => {
    expect(applySuggestionToPrompt(BASE, 'kb_gap', { topic: 'gutter cleaning pricing' })).toBeNull()
  })
})
