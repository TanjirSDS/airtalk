import { describe, expect, it } from 'vitest'
import { applySuggestionToProfile } from './merge'
import { receptionist } from './receptionist'
import type { BusinessProfile } from './shared'

const profile: BusinessProfile = {
  businessName: "Joe's Plumbing",
  industry: 'plumbing',
  hours: 'Mon–Fri 8–6',
  services: ['drain cleaning'],
  faqs: [{ q: 'Do you service Riverside?', a: 'No.' }],
  greetingStyle: 'friendly',
  voiceId: 'v1',
}

describe('applySuggestionToProfile', () => {
  it('appends a new FAQ', () => {
    const out = applySuggestionToProfile(profile, 'faq_addition', {
      q: 'Do you do gutter cleaning?',
      a: 'Yes, from $99.',
    })
    expect(out?.faqs).toHaveLength(2)
    expect(out?.faqs[1]).toEqual({ q: 'Do you do gutter cleaning?', a: 'Yes, from $99.' })
    expect(profile.faqs).toHaveLength(1) // pure — input untouched
  })

  it('replaces the answer when the question already exists (wrong-FAQ fix)', () => {
    const out = applySuggestionToProfile(profile, 'faq_addition', {
      q: 'do you service riverside?',
      a: 'Yes, we do.',
    })
    expect(out?.faqs).toHaveLength(1)
    expect(out?.faqs[0].a).toBe('Yes, we do.')
  })

  it('is a no-op for exact duplicates and malformed payloads', () => {
    expect(
      applySuggestionToProfile(profile, 'faq_addition', { q: 'Do you service Riverside?', a: 'No.' })
    ).toBeNull()
    expect(applySuggestionToProfile(profile, 'faq_addition', { q: 'Only a question' })).toBeNull()
    expect(applySuggestionToProfile(profile, 'prompt_tweak', {})).toBeNull()
  })

  it('appends prompt tweaks and escalation rules to extraInstructions, deduped', () => {
    const one = applySuggestionToProfile(profile, 'prompt_tweak', {
      instruction: 'Always mention the weekend emergency line.',
    })!
    expect(one.extraInstructions).toEqual(['Always mention the weekend emergency line.'])
    const dup = applySuggestionToProfile(one, 'escalation_rule', {
      instruction: 'Always mention the weekend emergency line.',
    })
    expect(dup).toBeNull()
  })

  it('never auto-applies kb_gap', () => {
    expect(applySuggestionToProfile(profile, 'kb_gap', { topic: 'gutter cleaning pricing' })).toBeNull()
  })

  it('applied instructions render in the generated prompt', () => {
    const out = applySuggestionToProfile(profile, 'escalation_rule', {
      instruction: 'If the caller mentions flooding, escalate immediately.',
    })!
    const prompt = receptionist(out).systemPrompt
    expect(prompt).toContain('## Learned adjustments')
    expect(prompt).toContain('If the caller mentions flooding, escalate immediately.')
    // and the base profile renders without the section
    expect(receptionist(profile).systemPrompt).not.toContain('Learned adjustments')
  })
})
