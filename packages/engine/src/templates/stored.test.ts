import { describe, expect, it } from 'vitest'
import type { AgentConfig } from '../types'
import {
  normalizeStoredConfig,
  normalizeStoredConfigSafe,
  scratchAgentConfig,
  type BusinessProfile,
} from './index'

const agentConfig: AgentConfig = {
  name: 'Bright Smiles — Receptionist',
  systemPrompt: 'You are the AI receptionist...',
  firstMessage: "Hi, I'm the AI assistant.",
  voiceId: 'voice_123',
}

const profile: BusinessProfile = {
  businessName: 'Bright Smiles',
  industry: 'dentist',
  hours: 'Mon–Fri 9–5',
  services: ['checkups'],
  faqs: [],
  greetingStyle: 'friendly',
  voiceId: 'voice_123',
}

describe('normalizeStoredConfig', () => {
  it('maps v1 {template, profile, agentConfig} → v2 with profile as seed', () => {
    const v1 = { template: 'receptionist', profile, agentConfig }
    const out = normalizeStoredConfig(v1)
    expect(out).toEqual({ agentType: 'single', template: 'receptionist', seed: profile, agentConfig })
  })

  it('wraps a bootstrap-era plain AgentConfig (template null, no seed)', () => {
    const out = normalizeStoredConfig(agentConfig)
    expect(out).toEqual({ agentType: 'single', template: null, agentConfig })
    expect(out.seed).toBeUndefined()
  })

  it('passes a v2 config through unchanged', () => {
    const v2 = { agentType: 'custom_llm' as const, template: null, agentConfig }
    expect(normalizeStoredConfig(v2)).toEqual(v2)
  })

  // The migrate script relies on this: a re-run must be a byte-identical no-op.
  it('is idempotent for every shape', () => {
    for (const input of [
      { template: 'booking', profile, agentConfig },
      agentConfig,
      { agentType: 'single', template: 'booking', seed: profile, agentConfig },
    ]) {
      const once = normalizeStoredConfig(input)
      const twice = normalizeStoredConfig(once)
      expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
    }
  })

  it('safe variant returns null for null/garbage instead of throwing', () => {
    expect(normalizeStoredConfigSafe(null)).toBeNull()
    expect(normalizeStoredConfigSafe({ nope: 1 })).toBeNull()
    expect(() => normalizeStoredConfig(null)).toThrow()
  })
})

describe('scratchAgentConfig', () => {
  const cfg = scratchAgentConfig({ businessName: 'Acme Co', hours: '24/7' }, 'voice_9')

  it('keeps the AI-disclosure greeting', () => {
    expect(cfg.firstMessage).toMatch(/AI assistant/i)
  })

  it('keeps the conduct rules incl. the opt-out rule (rule 7)', () => {
    expect(cfg.systemPrompt).toMatch(/NAME, PHONE NUMBER, and the REASON/)
    expect(cfg.systemPrompt).toMatch(/not to be called again/i)
  })

  it('threads the chosen voice and business name through', () => {
    expect(cfg.voiceId).toBe('voice_9')
    expect(cfg.systemPrompt).toContain('Acme Co')
  })
})
