// Phase 8: one structured LLM pass per agent per week over its transcripts →
// improvement suggestions with verbatim evidence. Same optional-OPENAI_API_KEY
// pattern as outcome.ts: no key or any failure → no suggestions, never throws
// past extractSuggestions' caller.

import type { BusinessProfile, SuggestionPayload, SuggestionType } from '@airtalk/engine/templates'
import { SUGGESTION_TYPES } from '@airtalk/engine/templates'

export const LEARNING_MODEL = 'gpt-4o-mini'
// gpt-4o-mini list price, cents per 1M tokens — for the per-run cost log only.
const INPUT_CENTS_PER_M = 15
const OUTPUT_CENTS_PER_M = 60

// Token caps (item 2): per-call and whole-prompt character budgets, plus a hard
// output cap. ~4 chars/token → the prompt stays under ~15k tokens.
export const MAX_CALL_CHARS = 2_000
export const MAX_BATCH_CHARS = 60_000
export const MAX_OUTPUT_TOKENS = 1_500
export const MAX_SUGGESTIONS = 8

export interface CallForLearning {
  id: string
  outcome: string | null
  transcript: { role?: string; message?: string | null }[]
}

export interface ExtractedSuggestion {
  type: SuggestionType
  suggestion: SuggestionPayload
  evidence: { callId: string; quote: string }[]
}

export function renderCall(call: CallForLearning): string {
  const lines = (call.transcript ?? [])
    .filter((t) => t.message)
    .map((t) => `${t.role === 'agent' ? 'Agent' : 'Caller'}: ${t.message}`)
    .join('\n')
  return `### Call ${call.id} (outcome: ${call.outcome ?? 'unknown'})\n${lines.slice(0, MAX_CALL_CHARS)}`
}

/** Newest-first until the batch budget is spent; returns how many were dropped. */
export function batchCalls(calls: CallForLearning[]): { rendered: string[]; skipped: number } {
  const rendered: string[] = []
  let used = 0
  for (const call of calls) {
    const r = renderCall(call)
    if (used + r.length > MAX_BATCH_CHARS) break
    rendered.push(r)
    used += r.length
  }
  return { rendered, skipped: calls.length - rendered.length }
}

const SYSTEM_PROMPT = `You review a week of phone-call transcripts handled by an AI voice agent for a small business, and extract concrete improvements to the agent's configuration.

Emit suggestions of exactly these types:
- faq_addition: a question callers actually asked that the agent could not answer (or answered wrong). Only emit one when a correct answer is evident from the transcripts or the business facts; put the question in "q" and the answer in "a". If the same question was asked in several calls, set "frequency" to the number of calls and cite each as evidence.
- prompt_tweak: a short imperative instruction that would have made calls go better (e.g. wording to avoid, information to volunteer). Put it in "instruction".
- escalation_rule: a rule for when to hand off to a human, learned from calls that escalated or failed. Put it in "instruction".
- kb_gap: callers wanted information (or a service) the business facts do not cover and no transcript answers — only the owner can supply it. Put what is missing in "topic". Use this instead of faq_addition when you cannot know the answer.

Rules:
- Every suggestion MUST cite evidence: the call id from the "### Call <id>" header and a short verbatim quote from that transcript.
- Do not suggest what the business facts already cover. Do not invent facts, prices, or policies.
- Set "rationale" to one short line on why this helps.
- At most ${MAX_SUGGESTIONS} suggestions, most impactful first. No suggestions is a fine answer.`

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'agent_suggestions',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['suggestions'],
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'suggestion', 'evidence'],
            properties: {
              type: { type: 'string', enum: [...SUGGESTION_TYPES] },
              suggestion: {
                type: 'object',
                properties: {
                  q: { type: 'string' },
                  a: { type: 'string' },
                  instruction: { type: 'string' },
                  topic: { type: 'string' },
                  frequency: { type: 'integer' },
                  rationale: { type: 'string' },
                },
              },
              evidence: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['callId', 'quote'],
                  properties: { callId: { type: 'string' }, quote: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const

export function buildLearningMessages(profile: BusinessProfile, calls: CallForLearning[]) {
  const { rendered, skipped } = batchCalls(calls)
  const facts = [
    `Business: ${profile.businessName} (${profile.industry})`,
    `Hours: ${profile.hours}`,
    `Services: ${profile.services.join(', ') || '(none listed)'}`,
    `Current FAQs:\n${profile.faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n') || '(none)'}`,
    profile.extraInstructions?.length
      ? `Already-applied adjustments:\n${profile.extraInstructions.join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
  return {
    skipped,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `## Business facts\n${facts}\n\n## This week's transcripts (${rendered.length} calls)\n${rendered.join('\n\n')}`,
      },
    ],
  }
}

/** Validate the model output; unknown types, empty evidence, and evidence
 *  pointing at call ids that were never in the batch are dropped. */
export function parseSuggestions(content: string, validCallIds: Set<string>): ExtractedSuggestion[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return []
  }
  const raw = (parsed as { suggestions?: unknown }).suggestions
  if (!Array.isArray(raw)) return []
  const out: ExtractedSuggestion[] = []
  for (const item of raw) {
    if (out.length >= MAX_SUGGESTIONS) break
    const type = item?.type as SuggestionType
    if (!(SUGGESTION_TYPES as readonly string[]).includes(type)) continue
    const evidence = (Array.isArray(item?.evidence) ? item.evidence : [])
      .filter(
        (e: { callId?: unknown; quote?: unknown }) =>
          typeof e?.callId === 'string' && typeof e?.quote === 'string' && validCallIds.has(e.callId)
      )
      .map((e: { callId: string; quote: string }) => ({ callId: e.callId, quote: e.quote.slice(0, 500) }))
    if (!evidence.length) continue // no verifiable evidence → not a suggestion
    if (typeof item?.suggestion !== 'object' || item.suggestion === null) continue
    out.push({ type, suggestion: item.suggestion as SuggestionPayload, evidence })
  }
  return out
}

export function costCents(promptTokens: number, completionTokens: number): number {
  return (promptTokens * INPUT_CENTS_PER_M + completionTokens * OUTPUT_CENTS_PER_M) / 1_000_000
}

export interface LearningResult {
  suggestions: ExtractedSuggestion[]
  skippedCalls: number
  promptTokens: number
  completionTokens: number
  costCents: number
}

/** fetchFn is injectable so tests never talk to OpenAI. */
export async function extractSuggestions(
  profile: BusinessProfile,
  calls: CallForLearning[],
  apiKey: string,
  fetchFn: typeof fetch = fetch
): Promise<LearningResult | null> {
  if (!calls.length) return null
  const { messages, skipped } = buildLearningMessages(profile, calls)
  const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: LEARNING_MODEL,
      temperature: 0,
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: RESPONSE_FORMAT,
      messages,
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  const suggestions = parseSuggestions(
    data.choices?.[0]?.message?.content ?? '',
    new Set(calls.map((c) => c.id))
  )
  const promptTokens = data.usage?.prompt_tokens ?? 0
  const completionTokens = data.usage?.completion_tokens ?? 0
  return {
    suggestions,
    skippedCalls: skipped,
    promptTokens,
    completionTokens,
    costCents: costCents(promptTokens, completionTokens),
  }
}
