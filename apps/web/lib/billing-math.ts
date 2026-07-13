// Phase 5 money math — pure, unit-tested (CLAUDE.md rule 7). No Stripe imports.

export const ANNUAL_DISCOUNT = 0.15
export const OVERAGE_CENTS_PER_MIN = 35 // $0.35/min
export const OVERAGE_METER_EVENT = 'overage_minutes'
export const DUNNING_GRACE_DAYS = 7

export function annualPriceCents(monthlyCents: number): number {
  return Math.round(monthlyCents * 12 * (1 - ANNUAL_DISCOUNT))
}

/** Effective cost of an included minute (plan price spread over its minutes), in
 *  cents. Shown on the builder next to the flat overage rate. 0 if no minutes. */
export function includedRateCentsPerMin(priceCents: number, includedMinutes: number): number {
  return includedMinutes > 0 ? priceCents / includedMinutes : 0
}

/** Whole overage minutes not yet reported to Stripe. Meter events are additive,
 *  so the daily job sends this delta and bumps overage_reported by the same
 *  amount. Partial minutes wait until they complete a whole one. */
export function overageDelta(overageMinutes: number, reportedMinutes: number): number {
  return Math.max(0, Math.floor(overageMinutes) - Math.floor(reportedMinutes))
}

export type PlanChange =
  | { action: 'upgrade'; planId: string; minutesCap: number } // applies now
  | { action: 'downgrade'; pendingPlanId: string } // applies next period
  | { action: 'none' }

/** Upgrade mid-cycle = new cap immediately (Stripe prorates the charge);
 *  downgrade = pending until the next period. Price decides the direction. */
export function planChange(
  current: { id: string; price_cents: number },
  next: { id: string; price_cents: number; included_minutes: number }
): PlanChange {
  if (next.id === current.id) return { action: 'none' }
  return next.price_cents > current.price_cents
    ? { action: 'upgrade', planId: next.id, minutesCap: next.included_minutes }
    : { action: 'downgrade', pendingPlanId: next.id }
}

/** Whole days of payment-failed grace remaining; 0 = pause the agents. */
export function graceDaysLeft(paymentFailedAt: Date, now: Date): number {
  const elapsedDays = (now.getTime() - paymentFailedAt.getTime()) / 86_400_000
  return Math.max(0, Math.ceil(DUNNING_GRACE_DAYS - elapsedDays))
}
