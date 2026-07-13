// StoredAgentConfig — what we persist in agents.config and every
// agent_config_versions row. Browser-safe (pure, see shared.ts) so both the web
// app and the migrate script import it via '@airtalk/engine/templates'.

import type { AgentConfig } from '../types'
import { businessFacts, conductRules, greeting, TONE, type BusinessProfile } from './shared'
// type-only (erased at compile) → no runtime import cycle with index.ts.
import type { TemplateKey } from './index'

export type AgentType = 'single' | 'flow' | 'custom_llm'

/**
 * v2 (Phase 10): freeform-first. `agentConfig.systemPrompt` is AUTHORITATIVE — a
 * template only seeds it once. `seed` keeps the inputs the prompt was seeded from
 * (the old BusinessProfile after migration); nothing re-renders from it. The one
 * remaining consumer that still re-renders from `seed` is learning-merge, which
 * Phase 11 reworks to edit the prompt text directly.
 */
export interface StoredAgentConfig {
  agentType: AgentType
  /** Template the prompt was seeded from, or null (scratch / generated / imported). */
  template: TemplateKey | null
  seed?: BusinessProfile
  agentConfig: AgentConfig
}

/** Quick-personalize inputs from the create modal (freeform edits come later). */
export interface SeedInput {
  businessName?: string
  hours?: string
}

function isAgentConfig(c: unknown): c is AgentConfig {
  return (
    !!c &&
    typeof c === 'object' &&
    typeof (c as AgentConfig).systemPrompt === 'string' &&
    typeof (c as AgentConfig).name === 'string'
  )
}

/**
 * Normalize any stored config to v2. Deterministic key order → idempotent:
 * normalize(normalize(x)) is byte-identical, so the migrate script re-run is a no-op.
 *  - v2 {agentType,...}                         → passthrough (seed omitted if absent)
 *  - v1 {template, profile, agentConfig}        → profile becomes seed, type 'single'
 *  - bootstrap-era plain AgentConfig            → wrapped, template null
 */
export function normalizeStoredConfig(raw: unknown): StoredAgentConfig {
  const c = raw as Record<string, unknown> | null

  if (c && typeof c === 'object' && isAgentConfig(c.agentConfig)) {
    // v2 or v1 — both carry a nested agentConfig.
    if ('agentType' in c) {
      const out: StoredAgentConfig = {
        agentType: c.agentType as AgentType,
        template: (c.template as TemplateKey | null) ?? null,
        agentConfig: c.agentConfig,
      }
      if (c.seed) out.seed = c.seed as BusinessProfile
      return sortSeedLast(out)
    }
    const out: StoredAgentConfig = {
      agentType: 'single',
      template: (c.template as TemplateKey | null) ?? null,
      agentConfig: c.agentConfig,
    }
    if (c.profile) out.seed = c.profile as BusinessProfile
    return sortSeedLast(out)
  }

  if (isAgentConfig(c)) {
    return { agentType: 'single', template: null, agentConfig: c }
  }

  throw new Error('Unrecognized agent config shape')
}

/** Read-path variant: null (not throw) for null / unrecognized configs. */
export function normalizeStoredConfigSafe(raw: unknown): StoredAgentConfig | null {
  try {
    return normalizeStoredConfig(raw)
  } catch {
    return null
  }
}

// Fixed field order (agentType, template, seed?, agentConfig) so a normalized row
// re-normalizes byte-identically — the migrate script's "changed?" check stays honest.
function sortSeedLast(c: StoredAgentConfig): StoredAgentConfig {
  return c.seed
    ? { agentType: c.agentType, template: c.template, seed: c.seed, agentConfig: c.agentConfig }
    : { agentType: c.agentType, template: c.template, agentConfig: c.agentConfig }
}

/**
 * "Build from scratch": a blank-but-valid seed prompt with the mandatory sections
 * only — keeps the AI-disclosure greeting and conduct rules (incl. opt-out), ready
 * to be edited freely.
 */
export function scratchAgentConfig(seed: SeedInput, voiceId: string): AgentConfig {
  const p: BusinessProfile = {
    businessName: seed.businessName?.trim() || 'your business',
    industry: '',
    hours: seed.hours?.trim() || '',
    services: [],
    faqs: [],
    greetingStyle: 'friendly',
    voiceId,
  }
  const systemPrompt = `You are the AI phone assistant for ${p.businessName}.

${TONE[p.greetingStyle]}

## Your job on every call
(Describe what this agent should do — this is a starting point, edit it freely.)

${businessFacts(p)}

${conductRules(p)}`
  return { name: `${p.businessName} — Agent`, systemPrompt, firstMessage: greeting(p), voiceId }
}
