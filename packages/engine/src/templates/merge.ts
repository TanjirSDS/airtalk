// Phase 8: suggestion payloads + the pure merge that folds an accepted
// suggestion into a BusinessProfile. Browser-safe (templates subpath) — the
// review UI and the apply action share these.

import type { BusinessProfile } from './shared'

export const SUGGESTION_TYPES = [
  'faq_addition',
  'prompt_tweak',
  'kb_gap',
  'escalation_rule',
] as const
export type SuggestionType = (typeof SUGGESTION_TYPES)[number]

/** agent_suggestions.suggestion jsonb — fields used depend on type. */
export interface SuggestionPayload {
  /** faq_addition */
  q?: string
  a?: string
  /** prompt_tweak | escalation_rule */
  instruction?: string
  /** kb_gap: what info the business needs to provide */
  topic?: string
  /** how many calls hit this (unanswered-question frequency) */
  frequency?: number
  /** model's one-line why */
  rationale?: string
}

/**
 * Merge one accepted suggestion into the profile, or null when it can't be
 * auto-applied: kb_gap needs the owner to supply the info, malformed payloads
 * and exact duplicates are no-ops. A faq_addition whose question already
 * exists REPLACES that answer — that's the fix for "FAQ answered wrong".
 */
export function applySuggestionToProfile(
  profile: BusinessProfile,
  type: SuggestionType,
  s: SuggestionPayload
): BusinessProfile | null {
  switch (type) {
    case 'faq_addition': {
      const q = s.q?.trim()
      const a = s.a?.trim()
      if (!q || !a) return null
      const i = profile.faqs.findIndex((f) => f.q.trim().toLowerCase() === q.toLowerCase())
      if (i >= 0) {
        if (profile.faqs[i].a.trim() === a) return null
        const faqs = [...profile.faqs]
        faqs[i] = { q: profile.faqs[i].q, a }
        return { ...profile, faqs }
      }
      return { ...profile, faqs: [...profile.faqs, { q, a }] }
    }
    case 'prompt_tweak':
    case 'escalation_rule': {
      const instruction = s.instruction?.trim()
      if (!instruction) return null
      const existing = profile.extraInstructions ?? []
      if (existing.includes(instruction)) return null
      return { ...profile, extraInstructions: [...existing, instruction] }
    }
    case 'kb_gap':
      return null
  }
}

/** One-line label for cards and the weekly email. */
export function suggestionTitle(type: SuggestionType, s: SuggestionPayload): string {
  switch (type) {
    case 'faq_addition':
      return `New FAQ: ${s.q ?? '(missing question)'}`
    case 'prompt_tweak':
      return `Prompt tweak: ${s.instruction ?? '(missing instruction)'}`
    case 'escalation_rule':
      return `Escalation rule: ${s.instruction ?? '(missing instruction)'}`
    case 'kb_gap':
      return `Knowledge gap: ${s.topic ?? '(missing topic)'}`
  }
}
