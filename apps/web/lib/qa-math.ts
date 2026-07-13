// Phase 16 QA derivations — pure, unit-tested (CLAUDE.md rule 7). These numbers
// surface in customer conversations, so they get their own tested module. No
// Supabase imports. Bucketing is reused from analytics-math so /qa and /analytics
// split a date range into the same buckets.
import { bucketKey, buildBuckets, chooseGranularity } from './analytics-math'

/** The slice of a `calls` row QA reads. `analysis` is the Phase 12 CallAnalysis jsonb. */
export interface QaCall {
  outcome: string | null
  analysis: {
    success?: boolean
    criteria?: { name: string; result: string; rationale?: string }[]
    sentiment?: string
  } | null
  started_at?: string | null
}

// Outcomes that count as NOT resolved (mirrors Retell's transfer/failure buckets).
const NOT_RESOLVED = new Set(['escalated', 'failed'])

/** "Analysed" = the call produced a QA signal: native analysis OR our outcome
 *  label (the task's definition). Both seed scripts set outcome but not analysis,
 *  so every seeded call is analysed. */
export function isAnalysed(c: QaCall): boolean {
  return c.analysis != null || c.outcome != null
}

// ElevenLabs grades each success criterion 'success' | 'failure'; compare loosely.
const isPass = (result: string) => result.trim().toLowerCase() === 'success'

/** Whether a call passed QA: it has ≥1 success criterion and every one passed.
 *  null = the call was never criteria-evaluated (excluded from the success rate). */
export function callPassed(c: QaCall): boolean | null {
  const crit = c.analysis?.criteria
  if (!crit || crit.length === 0) return null
  return crit.every((x) => isPass(x.result))
}

// Sentiment isn't native to EL (Phase 12), but a seeded "user_sentiment" field
// surfaces into analysis.sentiment. Map the common labels to [-1, 1] to average.
const SENTIMENT_SCORE: Record<string, number> = { positive: 1, neutral: 0, negative: -1 }
export function sentimentScore(s: string | undefined): number | null {
  if (!s) return null
  const v = SENTIMENT_SCORE[s.trim().toLowerCase()]
  return v === undefined ? null : v
}

export interface QaStats {
  analysed: number
  /** Share of criteria-evaluated calls that fully passed. null = none evaluated. */
  successRate: number | null
  /** Share of calls (with an outcome) not escalated/failed. */
  resolutionRate: number | null
  /** Share of calls (with an outcome) whose outcome is 'escalated'. */
  escalationRate: number | null
  /** Mean sentiment score in [-1, 1], over calls where sentiment is present. */
  avgSentiment: number | null
}

export function qaStats(calls: QaCall[]): QaStats {
  const analysed = calls.filter(isAnalysed)
  const withOutcome = calls.filter((c) => c.outcome != null)
  const evaluated = analysed.map(callPassed).filter((p): p is boolean => p !== null)
  const sentiments = analysed
    .map((c) => sentimentScore(c.analysis?.sentiment))
    .filter((s): s is number => s !== null)
  const rate = (n: number, d: number) => (d ? n / d : null)
  return {
    analysed: analysed.length,
    successRate: rate(evaluated.filter(Boolean).length, evaluated.length),
    resolutionRate: rate(withOutcome.filter((c) => !NOT_RESOLVED.has(c.outcome!)).length, withOutcome.length),
    escalationRate: rate(withOutcome.filter((c) => c.outcome === 'escalated').length, withOutcome.length),
    avgSentiment: sentiments.length ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : null,
  }
}

export interface QaTrendPoint {
  bucket: string // yyyy-mm-dd
  successRate: number | null
  analysed: number
}

/** Success rate bucketed over [fromISO, toISO], same day/week split as analytics. */
export function successTrend(
  calls: QaCall[],
  fromISO: string,
  toISO: string
): { granularity: 'day' | 'week'; points: QaTrendPoint[] } {
  const granularity = chooseGranularity(fromISO, toISO)
  const buckets = buildBuckets(fromISO, toISO, granularity)
  const map = new Map(buckets.map((b) => [b, { passed: 0, evaluated: 0, analysed: 0 }]))
  for (const c of calls) {
    if (!c.started_at) continue
    const m = map.get(bucketKey(c.started_at, granularity))
    if (!m) continue
    if (isAnalysed(c)) m.analysed++
    const p = callPassed(c)
    if (p !== null) {
      m.evaluated++
      if (p) m.passed++
    }
  }
  return {
    granularity,
    points: buckets.map((b) => {
      const m = map.get(b)!
      return { bucket: b, analysed: m.analysed, successRate: m.evaluated ? m.passed / m.evaluated : null }
    }),
  }
}

// ── Top Questions (agent_suggestions faq_addition rows) ──────────────────────

/** The faq_addition suggestion shape we read (see merge.ts SuggestionPayload). */
export interface FaqSuggestionRow {
  suggestion: { q?: string; a?: string; frequency?: number } | null
  evidence: { callId: string; quote: string }[] | null
  status: string
}
export interface TopQuestion {
  question: string
  /** How many calls hit this — the model's frequency, else evidence count. */
  count: number
  answer?: string
  evidence: { callId: string; quote: string }[]
}

/** Aggregate faq_addition suggestions into a ranked "top questions" table.
 *  The same question can appear across agents/weeks, so merge case-insensitively. */
export function topQuestions(rows: FaqSuggestionRow[]): TopQuestion[] {
  const map = new Map<string, TopQuestion>()
  for (const r of rows) {
    const q = r.suggestion?.q?.trim()
    if (!q) continue
    const evidence = r.evidence ?? []
    const bump = r.suggestion?.frequency ?? evidence.length ?? 1
    const key = q.toLowerCase()
    const existing = map.get(key)
    if (existing) {
      existing.count += bump
      existing.evidence.push(...evidence)
      if (!existing.answer && r.suggestion?.a) existing.answer = r.suggestion.a
    } else {
      map.set(key, { question: q, count: bump, answer: r.suggestion?.a, evidence: [...evidence] })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}
