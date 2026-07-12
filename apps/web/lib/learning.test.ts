import type { BusinessProfile } from '@airtalk/engine/templates'
import { describe, expect, it, vi } from 'vitest'
import {
  batchCalls,
  buildLearningMessages,
  costCents,
  extractSuggestions,
  MAX_BATCH_CHARS,
  MAX_SUGGESTIONS,
  parseSuggestions,
  type CallForLearning,
} from './learning'

const profile: BusinessProfile = {
  businessName: "Joe's Plumbing",
  industry: 'plumbing',
  hours: 'Mon–Fri 8–6',
  services: ['drain cleaning'],
  faqs: [{ q: 'Saturday hours?', a: '9–1.' }],
  greetingStyle: 'friendly',
  voiceId: 'v1',
}

function call(id: string, msg: string): CallForLearning {
  return {
    id,
    outcome: 'escalated',
    transcript: [
      { role: 'agent', message: 'How can I help?' },
      { role: 'user', message: msg },
    ],
  }
}

describe('transcript batching (token cap)', () => {
  it('stops at the batch budget and reports what was dropped', () => {
    const calls = Array.from({ length: 200 }, (_, i) => call(`c${i}`, 'x'.repeat(1_000)))
    const { rendered, skipped } = batchCalls(calls)
    expect(rendered.length + skipped).toBe(200)
    expect(skipped).toBeGreaterThan(0)
    expect(rendered.join('\n\n').length).toBeLessThanOrEqual(MAX_BATCH_CHARS + 2 * rendered.length)
  })

  it('puts business facts and call headers in the prompt', () => {
    const { messages } = buildLearningMessages(profile, [call('abc-123', 'Do you do gutters?')])
    expect(messages[1].content).toContain("Joe's Plumbing")
    expect(messages[1].content).toContain('Q: Saturday hours?')
    expect(messages[1].content).toContain('### Call abc-123')
    expect(messages[1].content).toContain('Caller: Do you do gutters?')
  })
})

describe('parseSuggestions', () => {
  const valid = new Set(['c1', 'c2'])

  it('keeps well-formed suggestions with verifiable evidence', () => {
    const out = parseSuggestions(
      JSON.stringify({
        suggestions: [
          {
            type: 'faq_addition',
            suggestion: { q: 'Gutters?', a: 'Yes.', frequency: 3 },
            evidence: [{ callId: 'c1', quote: 'do you do gutters' }],
          },
        ],
      }),
      valid
    )
    expect(out).toHaveLength(1)
    expect(out[0].suggestion.frequency).toBe(3)
  })

  it('drops unknown types, empty evidence, and hallucinated call ids', () => {
    const out = parseSuggestions(
      JSON.stringify({
        suggestions: [
          { type: 'rewrite_everything', suggestion: {}, evidence: [{ callId: 'c1', quote: 'q' }] },
          { type: 'prompt_tweak', suggestion: { instruction: 'x' }, evidence: [] },
          {
            type: 'kb_gap',
            suggestion: { topic: 'y' },
            evidence: [{ callId: 'not-in-batch', quote: 'q' }],
          },
        ],
      }),
      valid
    )
    expect(out).toHaveLength(0)
  })

  it('caps the count and survives non-JSON', () => {
    const many = Array.from({ length: 20 }, () => ({
      type: 'prompt_tweak',
      suggestion: { instruction: 'x' },
      evidence: [{ callId: 'c1', quote: 'q' }],
    }))
    expect(parseSuggestions(JSON.stringify({ suggestions: many }), valid)).toHaveLength(MAX_SUGGESTIONS)
    expect(parseSuggestions('the model rambled', valid)).toEqual([])
  })
})

describe('extractSuggestions', () => {
  it('returns suggestions plus a cost log from usage', async () => {
    const content = JSON.stringify({
      suggestions: [
        {
          type: 'faq_addition',
          suggestion: { q: 'Sundays?', a: 'Emergencies only.' },
          evidence: [{ callId: 'c1', quote: 'are you open sundays' }],
        },
      ],
    })
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 10_000, completion_tokens: 500 },
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch
    const res = await extractSuggestions(profile, [call('c1', 'Are you open Sundays?')], 'sk-test', fetchFn)
    expect(res?.suggestions).toHaveLength(1)
    // 10k in @ 15¢/M + 500 out @ 60¢/M
    expect(res?.costCents).toBeCloseTo(costCents(10_000, 500))
    expect(res?.costCents).toBeCloseTo(0.18, 5)
  })

  it('returns null on API failure and empty input', async () => {
    const fail = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    expect(await extractSuggestions(profile, [call('c1', 'hi')], 'sk-test', fail)).toBeNull()
    expect(await extractSuggestions(profile, [], 'sk-test', fail)).toBeNull()
  })
})
