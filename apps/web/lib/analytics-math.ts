// Phase 15 analytics + usage derivations — pure, unit-tested (CLAUDE.md rule 7).
// No Stripe/Supabase imports. Reuses the Phase 5 money constants from billing-math
// so there is one source for the overage rate + included-minute rate.

import { includedRateCentsPerMin, OVERAGE_CENTS_PER_MIN } from './billing-math'

// ── Success-rate derivation ────────────────────────────────────────────────
// A call "succeeded" per ElevenLabs' native call-success verdict when we have it
// (calls.analysis.success, Phase 12); otherwise we fall back to the outcome label.
// This is the SINGLE definition of success used by the analytics success-rate card.
export const SUCCESS_OUTCOMES: ReadonlySet<string> = new Set([
  'booked',
  'lead_captured',
  'question_answered',
])

/** true/false when the call is classifiable, null when it is not (no EL verdict
 *  AND no outcome) — nulls are excluded from the success-rate denominator. */
export function isCallSuccess(
  analysisSuccess: boolean | null | undefined,
  outcome: string | null | undefined
): boolean | null {
  if (typeof analysisSuccess === 'boolean') return analysisSuccess
  if (outcome) return SUCCESS_OUTCOMES.has(outcome)
  return null
}

/** successful / classifiable, or null when nothing is classifiable (card → "—"). */
export function successRate(
  calls: { analysisSuccess?: boolean | null; outcome?: string | null }[]
): number | null {
  let ok = 0
  let n = 0
  for (const c of calls) {
    const s = isCallSuccess(c.analysisSuccess, c.outcome)
    if (s === null) continue
    n++
    if (s) ok++
  }
  return n ? ok / n : null
}

// ── Granularity bucketing ───────────────────────────────────────────────────
export type Granularity = 'day' | 'week'

/** Auto-pick trend granularity from the range width. */
export function chooseGranularity(fromISO: string, toISO: string): Granularity {
  const days = (Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000
  return days > 31 ? 'week' : 'day' // ponytail: >31 days buckets by week to keep the axis readable
}

/** The bucket key (UTC yyyy-mm-dd) a date falls into: the day itself, or the
 *  Monday of its UTC week. */
export function bucketKey(dateISO: string, granularity: Granularity): string {
  const d = new Date(dateISO)
  if (granularity === 'day') return d.toISOString().slice(0, 10)
  const monday = new Date(d)
  monday.setUTCHours(0, 0, 0, 0)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return monday.toISOString().slice(0, 10)
}

/** Ordered, gap-free list of bucket keys spanning [fromISO, toISO] inclusive so
 *  charts render empty buckets instead of collapsing them. */
export function buildBuckets(fromISO: string, toISO: string, granularity: Granularity): string[] {
  // Always walk one day at a time and dedupe by bucketKey — stepping by 7 from a
  // non-Monday start can skip a whole week's Monday near the range end.
  const keys: string[] = []
  const seen = new Set<string>()
  const cursor = new Date(`${fromISO.slice(0, 10)}T00:00:00Z`)
  const end = new Date(`${toISO.slice(0, 10)}T00:00:00Z`)
  let guard = 0
  while (cursor <= end && guard++ < 4000) {
    const key = bucketKey(cursor.toISOString(), granularity)
    if (!seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return keys
}

// ── Estimated cost (analytics card) ─────────────────────────────────────────
/**
 * Estimated cost of `minutes` of calls at the plan's effective included rate,
 * PLUS the period's whole overage minutes at the flat overage rate. Labeled
 * "estimated" in the UI — CLAUDE.md rule 5 keeps reconciliation the billing
 * truth. Coarse by design: overage is the whole-period figure (usage_periods),
 * not the filtered window, so a call counted here can also sit inside that
 * overage — acceptable for an estimate, never presented as an invoice.
 */
export function estimatedCostCents(
  minutes: number,
  includedRateCents: number,
  overageMinutes = 0,
  overageRateCents: number = OVERAGE_CENTS_PER_MIN
): number {
  return Math.round(minutes * includedRateCents) + Math.floor(Math.max(0, overageMinutes)) * overageRateCents
}

// ── Usage-period totals (billing Usage tab) ─────────────────────────────────
export interface UsagePeriodRow {
  minutes_used: number
  minutes_cap: number
  overage_minutes: number
  overage_reported: number
}

/** Card figures for one billing period. estTotal = plan base + whole overage;
 *  billedSoFar = only the overage already reported to Stripe (rule 5 truth). */
export function usagePeriodTotals(
  row: UsagePeriodRow,
  planPriceCents: number,
  overageRateCents: number = OVERAGE_CENTS_PER_MIN
) {
  const overageMinutes = Math.max(0, row.overage_minutes)
  return {
    includedUsed: Math.min(row.minutes_used, row.minutes_cap),
    cap: row.minutes_cap,
    overageMinutes,
    billedSoFarCents: Math.floor(Math.max(0, row.overage_reported)) * overageRateCents,
    estTotalCents: planPriceCents + Math.floor(overageMinutes) * overageRateCents,
  }
}

// Re-export so callers get the included-rate helper from one analytics import.
export { includedRateCentsPerMin, OVERAGE_CENTS_PER_MIN }
