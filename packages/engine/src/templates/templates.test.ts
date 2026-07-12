import { describe, expect, it } from 'vitest'
import { buildAgentConfig, templates, type BusinessProfile, type TemplateKey } from './index'

const profile: BusinessProfile = {
  businessName: 'Bright Smiles Dental',
  industry: 'dentist',
  hours: 'Mon–Fri 9am–5pm',
  services: ['checkups', 'whitening'],
  faqs: [{ q: 'Do you take insurance?', a: 'Yes, most major plans.' }],
  escalationNumber: '+15550001111',
  greetingStyle: 'friendly',
  voiceId: 'voice_123',
}

// The product guarantees every template makes: AI disclosure in the greeting,
// on-topic + capture-details + escalation rules in the prompt, only stated facts.
describe.each(Object.keys(templates) as TemplateKey[])('%s template', (key) => {
  const cfg = buildAgentConfig(key, profile)

  it('discloses AI in the greeting', () => {
    expect(cfg.firstMessage).toMatch(/AI assistant/i)
  })

  it('embeds business facts and FAQs', () => {
    expect(cfg.systemPrompt).toContain('Bright Smiles Dental')
    expect(cfg.systemPrompt).toContain('Do you take insurance?')
    expect(cfg.systemPrompt).toContain('Mon–Fri 9am–5pm')
  })

  it('instructs capture of name+number+reason and escalation', () => {
    expect(cfg.systemPrompt).toMatch(/NAME, PHONE NUMBER, and the REASON/)
    expect(cfg.systemPrompt).toContain('+15550001111')
    expect(cfg.systemPrompt).toMatch(/stay strictly on-topic/i)
  })

  it('passes the chosen voice through', () => {
    expect(cfg.voiceId).toBe('voice_123')
  })
})

it('falls back to take-a-message when no escalation number', () => {
  const { systemPrompt } = buildAgentConfig('receptionist', { ...profile, escalationNumber: undefined })
  expect(systemPrompt).toMatch(/take a detailed message/i)
})
