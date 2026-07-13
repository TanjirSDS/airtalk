import { describe, expect, it } from 'vitest'
import {
  callPassed,
  isAnalysed,
  qaStats,
  sentimentScore,
  successTrend,
  topQuestions,
  type QaCall,
} from './qa-math'

// Mirror of the committed seed scripts (rule-7 acceptance #1). seed-calls (20
// rows) carries a deterministic analysis block; seed-learning (12 rows) sets
// outcome only. These arrays + the analysisFor() logic are copied verbatim from
// scripts/seed-calls.ts, so `qaStats(rows)` here equals SQL over both seeds.
//   seed-calls:    booked 4, lead_captured 4, question_answered 5, voicemail 2,
//                  escalated 2, spam 1, failed 2  (failed → analysis null)
//   seed-learning: escalated 3, lead_captured 4, question_answered 3, failed 1, booked 1
const SEED_CALLS = [
  'booked', 'lead_captured', 'question_answered', 'booked', 'question_answered', 'voicemail',
  'lead_captured', 'escalated', 'question_answered', 'booked', 'spam', 'failed',
  'question_answered', 'lead_captured', 'voicemail', 'booked', 'escalated', 'question_answered',
  'failed', 'lead_captured',
]
const SEED_LEARNING = [
  'escalated', 'lead_captured', 'escalated', 'lead_captured', 'escalated', 'question_answered',
  'lead_captured', 'lead_captured', 'question_answered', 'failed', 'booked', 'question_answered',
]
const GOOD = new Set(['booked', 'lead_captured', 'question_answered'])
const NEG = new Set(['escalated', 'spam'])
function seedRows(): QaCall[] {
  const calls: QaCall[] = SEED_CALLS.map((outcome) => {
    if (outcome === 'failed') return { outcome, analysis: null }
    const resolved = GOOD.has(outcome)
    return {
      outcome,
      analysis: {
        success: resolved,
        criteria: [{ name: 'Resolved', result: resolved ? 'success' : 'failure' }],
        sentiment: resolved ? 'positive' : NEG.has(outcome) ? 'negative' : 'neutral',
      },
    }
  })
  const learning: QaCall[] = SEED_LEARNING.map((outcome) => ({ outcome, analysis: null }))
  return [...calls, ...learning]
}

const withCriteria = (results: string[], extra: Partial<QaCall> = {}): QaCall => ({
  outcome: 'question_answered',
  analysis: { criteria: results.map((result, i) => ({ name: `c${i}`, result })) },
  ...extra,
})

describe('seed-data stats (matches hand-computed SQL over seed-calls + seed-learning)', () => {
  const rows = seedRows()

  it('has the 32 seeded rows', () => {
    expect(rows.length).toBe(32)
  })

  it('analysed = 32 (every row has an outcome)', () => {
    expect(qaStats(rows).analysed).toBe(32)
  })

  it('resolution rate = 24/32 (escalated 5 + failed 3 are the unresolved ones)', () => {
    expect(qaStats(rows).resolutionRate).toBeCloseTo(24 / 32, 10)
  })

  it('escalation rate = 5/32', () => {
    expect(qaStats(rows).escalationRate).toBeCloseTo(5 / 32, 10)
  })

  it('success rate = 13/18 (seed-calls: 13 good outcomes pass of 18 criteria-evaluated)', () => {
    // seed-learning rows have no analysis → not criteria-evaluated → excluded.
    expect(qaStats(rows).successRate).toBeCloseTo(13 / 18, 10)
  })

  it('avg sentiment = 10/18 (13×+1, escalated 2×−1, spam 1×−1, voicemail 2×0)', () => {
    expect(qaStats(rows).avgSentiment).toBeCloseTo(10 / 18, 10)
  })
})

describe('callPassed (all criteria must pass)', () => {
  it('true when every criterion is success', () => {
    expect(callPassed(withCriteria(['success', 'success']))).toBe(true)
  })
  it('false when any criterion fails', () => {
    expect(callPassed(withCriteria(['success', 'failure']))).toBe(false)
  })
  it('case-insensitive on the result string', () => {
    expect(callPassed(withCriteria(['Success']))).toBe(true)
  })
  it('null when never criteria-evaluated', () => {
    expect(callPassed({ outcome: 'booked', analysis: null })).toBeNull()
    expect(callPassed({ outcome: 'booked', analysis: { criteria: [] } })).toBeNull()
  })
})

describe('qaStats over analysis-bearing calls', () => {
  it('success rate = passed / criteria-evaluated (2/3), unevaluated calls excluded', () => {
    const calls: QaCall[] = [
      withCriteria(['success', 'success']),
      withCriteria(['success', 'failure']),
      withCriteria(['success']),
      { outcome: 'booked', analysis: null }, // analysed but not evaluated → excluded from rate
    ]
    const s = qaStats(calls)
    expect(s.successRate).toBeCloseTo(2 / 3, 10)
    expect(s.analysed).toBe(4)
  })

  it('avg sentiment averages only present, recognised labels', () => {
    const calls: QaCall[] = [
      { outcome: 'booked', analysis: { sentiment: 'positive' } },
      { outcome: 'escalated', analysis: { sentiment: 'negative' } },
      { outcome: 'question_answered', analysis: { sentiment: 'neutral' } },
      { outcome: 'spam', analysis: { sentiment: 'gibberish' } }, // unrecognised → skipped
      { outcome: 'voicemail', analysis: null }, // no sentiment → skipped
    ]
    expect(qaStats(calls).avgSentiment).toBeCloseTo(0, 10) // (1 + -1 + 0) / 3
  })

  it('an analysed call with no outcome is counted in analysed but not the outcome rates', () => {
    const calls: QaCall[] = [{ outcome: null, analysis: { success: true, criteria: [{ name: 'c', result: 'success' }] } }]
    const s = qaStats(calls)
    expect(s.analysed).toBe(1)
    expect(s.resolutionRate).toBeNull() // no rows with an outcome
    expect(s.successRate).toBe(1)
  })
})

describe('sentimentScore', () => {
  it('maps the three labels', () => {
    expect(sentimentScore('positive')).toBe(1)
    expect(sentimentScore('Neutral')).toBe(0)
    expect(sentimentScore('negative')).toBe(-1)
  })
  it('null for missing/unknown', () => {
    expect(sentimentScore(undefined)).toBeNull()
    expect(sentimentScore('mixed')).toBeNull()
  })
})

describe('isAnalysed', () => {
  it('true with analysis OR outcome, false with neither', () => {
    expect(isAnalysed({ outcome: 'booked', analysis: null })).toBe(true)
    expect(isAnalysed({ outcome: null, analysis: { success: true } })).toBe(true)
    expect(isAnalysed({ outcome: null, analysis: null })).toBe(false)
  })
})

describe('successTrend', () => {
  it('buckets success rate by day and preserves empty buckets', () => {
    const calls: QaCall[] = [
      withCriteria(['success'], { started_at: '2026-07-01T10:00:00Z' }),
      withCriteria(['failure'], { started_at: '2026-07-01T12:00:00Z' }),
      withCriteria(['success'], { started_at: '2026-07-03T09:00:00Z' }),
    ]
    const { granularity, points } = successTrend(calls, '2026-07-01', '2026-07-03')
    expect(granularity).toBe('day')
    expect(points.map((p) => p.bucket)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03'])
    expect(points[0].successRate).toBeCloseTo(0.5, 10) // 1 pass / 2 evaluated
    expect(points[1].successRate).toBeNull() // no calls that day
    expect(points[2].successRate).toBe(1)
  })
})

describe('topQuestions', () => {
  it('aggregates by question (case-insensitive), sums frequency, ranks desc', () => {
    const rows = [
      { suggestion: { q: 'Do you service Riverside?', a: 'Yes.', frequency: 3 }, evidence: [{ callId: 'a', quote: 'q1' }], status: 'pending' },
      { suggestion: { q: 'do you service riverside?', frequency: 2 }, evidence: [{ callId: 'b', quote: 'q2' }], status: 'applied' },
      { suggestion: { q: 'What are your hours?' }, evidence: [{ callId: 'c', quote: 'q3' }], status: 'pending' },
    ]
    const top = topQuestions(rows)
    expect(top.length).toBe(2)
    expect(top[0].question).toBe('Do you service Riverside?')
    expect(top[0].count).toBe(5) // 3 + 2
    expect(top[0].answer).toBe('Yes.') // first non-empty answer kept
    expect(top[0].evidence.length).toBe(2)
    expect(top[1].count).toBe(1) // no frequency → evidence length (1)
  })

  it('drops rows without a question', () => {
    expect(topQuestions([{ suggestion: { a: 'orphan' }, evidence: [], status: 'pending' }])).toEqual([])
  })
})
