// Phase 17 alerting — pure, unit-tested (CLAUDE.md rule 7): metric derivation +
// the crossing/cooldown decision. No Supabase/Inngest here; the evaluator cron
// (lib/alerts.ts) gathers the data and feeds these functions.

export type AlertMetric = 'failure_rate' | 'call_count' | 'usage_pct' | 'est_cost_cents' | 'provider_down'
export type AlertOperator = 'gt' | 'gte' | 'lt' | 'lte'

export const ALERT_METRIC_LABELS: Record<AlertMetric, string> = {
  failure_rate: 'Failure rate (%)',
  call_count: 'Call count',
  usage_pct: 'Usage (% of cap)',
  est_cost_cents: 'Estimated cost (¢)',
  provider_down: 'Providers down',
}

export const ALERT_OPERATOR_LABELS: Record<AlertOperator, string> = {
  gt: 'is above',
  gte: 'is at or above',
  lt: 'is below',
  lte: 'is at or below',
}

export function compare(value: number, operator: AlertOperator, threshold: number): boolean {
  switch (operator) {
    case 'gt':
      return value > threshold
    case 'gte':
      return value >= threshold
    case 'lt':
      return value < threshold
    case 'lte':
      return value <= threshold
  }
}

export interface MetricInputs {
  /** Calls inside the window (org- and, if set, agent-scoped). */
  calls: { outcome?: string | null; duration_secs?: number | null }[]
  /** Current billing period usage (usage_pct only). */
  usage?: { minutes_used: number; minutes_cap: number } | null
  /** Plan's included per-minute rate in cents (est_cost_cents only). */
  includedRateCentsPerMin?: number
  /** Count of providers currently reporting down (provider_down only). */
  providersDown?: number
}

/** The metric's current numeric value over its window. */
export function computeMetric(metric: AlertMetric, i: MetricInputs): number {
  switch (metric) {
    case 'call_count':
      return i.calls.length
    case 'failure_rate':
      // Share of window calls the classifier/EL marked 'failed', as a percent.
      return i.calls.length ? (i.calls.filter((c) => c.outcome === 'failed').length / i.calls.length) * 100 : 0
    case 'usage_pct': {
      const cap = i.usage?.minutes_cap ?? 0
      return cap > 0 ? (i.usage!.minutes_used / cap) * 100 : 0
    }
    case 'est_cost_cents': {
      // Coarse estimate (rule 5 keeps reconciliation the billing truth): window
      // minutes × the plan's included rate. No overage — a windowed alert can't
      // know the whole-period overage without double counting.
      const minutes = i.calls.reduce((m, c) => m + (c.duration_secs ?? 0), 0) / 60
      return Math.round(minutes * (i.includedRateCentsPerMin ?? 0))
    }
    case 'provider_down':
      return i.providersDown ?? 0
  }
}

export interface CrossingState {
  conditionMet: boolean
  lastState: boolean // condition state at the previous eval
  lastFiredAt: string | null
  cooldownMins: number
  now: number // ms epoch
}

/**
 * Fire only on a below→above edge (condition newly met), and only once cooldown
 * has elapsed since the last fire — the same crossing/fires-once rule Phase 4
 * uses for usage. `newState` is persisted back to alerts.last_state every eval,
 * so a crossing suppressed by cooldown won't re-arm until the condition drops
 * below and crosses again.
 */
export function evaluateCrossing(s: CrossingState): { fire: boolean; newState: boolean } {
  const crossed = s.conditionMet && !s.lastState
  const cooledDown = s.lastFiredAt == null || s.now - Date.parse(s.lastFiredAt) >= s.cooldownMins * 60_000
  return { fire: crossed && cooledDown, newState: s.conditionMet }
}
