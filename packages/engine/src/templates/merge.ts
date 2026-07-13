// Phase 8 suggestion payloads + Phase 11's prompt-first merge: fold an accepted
// suggestion into the freeform prompt TEXT via managed sections (see managed.ts).
// Browser-safe (templates subpath) — the review UI and the apply action share these.

import { getSection, setSection } from './managed'

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

// Managed sections applied suggestions land in. Distinct from a template's
// rendered "## Frequently asked questions" so a freeform edit never clobbers it.
export const FAQ_HEADING = '## FAQs'
export const LEARNED_HEADING = '## Learned adjustments'

// ponytail: single-line Q/A per FAQ — a multi-line answer would need a smarter
// parser. Add one if answers ever grow past a sentence.
function parseFaqs(body: string): { q: string; a: string }[] {
  const faqs: { q: string; a: string }[] = []
  let q: string | null = null
  for (const line of body.split('\n')) {
    const qm = line.match(/^Q:\s*(.*)/)
    const am = line.match(/^A:\s*(.*)/)
    if (qm) q = qm[1].trim()
    else if (am && q !== null) {
      faqs.push({ q, a: am[1].trim() })
      q = null
    }
  }
  return faqs
}

function serializeFaqs(faqs: { q: string; a: string }[]): string {
  return faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n')
}

function bullets(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

/**
 * Apply one accepted suggestion to the prompt, or return null when it can't be
 * auto-applied: kb_gap needs the owner to supply the info, malformed payloads and
 * exact duplicates are no-ops. A faq_addition whose question already exists in the
 * "## FAQs" section REPLACES that answer — that's the fix for "FAQ answered wrong"
 * and why applying the same FAQ twice can never duplicate it. Missing section
 * anchors are appended to the prompt end (see setSection).
 */
export function applySuggestionToPrompt(
  prompt: string,
  type: SuggestionType,
  s: SuggestionPayload
): string | null {
  switch (type) {
    case 'faq_addition': {
      const q = s.q?.trim()
      const a = s.a?.trim()
      if (!q || !a) return null
      const faqs = parseFaqs(getSection(prompt, FAQ_HEADING) ?? '')
      const i = faqs.findIndex((f) => f.q.toLowerCase() === q.toLowerCase())
      if (i >= 0) {
        if (faqs[i].a === a) return null // no change
        faqs[i] = { q: faqs[i].q, a }
      } else {
        faqs.push({ q, a })
      }
      return setSection(prompt, FAQ_HEADING, serializeFaqs(faqs))
    }
    case 'prompt_tweak':
    case 'escalation_rule': {
      const instruction = s.instruction?.trim()
      if (!instruction) return null
      const items = bullets(getSection(prompt, LEARNED_HEADING) ?? '')
      if (items.some((b) => b.toLowerCase() === instruction.toLowerCase())) return null
      items.push(instruction)
      return setSection(prompt, LEARNED_HEADING, items.map((b) => `- ${b}`).join('\n'))
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
