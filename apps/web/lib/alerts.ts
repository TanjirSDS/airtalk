// Phase 17 alert evaluator (service-role side). One pass per enabled alert:
// gather the metric's inputs over its window, run the pure derivation +
// crossing decision (lib/alerts-eval.ts), persist the crossing state, and on a
// fire insert an alert_events row + notify the chosen channels. Driven by the
// alert-evaluate Inngest cron (lib/jobs.ts) every 15 minutes.

import type { SupabaseClient } from '@airtalk/db'
import {
  ALERT_METRIC_LABELS,
  ALERT_OPERATOR_LABELS,
  compare,
  computeMetric,
  evaluateCrossing,
  type AlertMetric,
  type AlertOperator,
  type MetricInputs,
} from './alerts-eval'
import { includedRateCentsPerMin } from './billing-math'
import { AlertEmail } from '../emails'
import { appUrl, sendEmail } from './email'
import { currentPeriodUsage } from './usage'
import { enqueueWebhookEvent } from './webhooks-out'

export interface AlertRow {
  id: string
  org_id: string
  name: string
  metric: AlertMetric
  operator: AlertOperator
  threshold: number | string
  window_mins: number
  agent_id: string | null
  channels: { emails?: string[]; endpointIds?: string[] } | null
  cooldown_mins: number
  last_state: boolean
  last_fired_at: string | null
}

async function gatherInputs(db: SupabaseClient, alert: AlertRow, nowMs: number): Promise<MetricInputs> {
  const i: MetricInputs = { calls: [] }
  const m = alert.metric
  if (m === 'failure_rate' || m === 'call_count' || m === 'est_cost_cents') {
    const windowStart = new Date(nowMs - alert.window_mins * 60_000).toISOString()
    let q = db.from('calls').select('outcome, duration_secs').eq('org_id', alert.org_id).gte('started_at', windowStart)
    if (alert.agent_id) q = q.eq('agent_id', alert.agent_id)
    const { data } = await q
    i.calls = data ?? []
    if (m === 'est_cost_cents') {
      const { data: org } = await db.from('orgs').select('plan_id').eq('id', alert.org_id).maybeSingle()
      const { data: plan } = org
        ? await db.from('plans').select('price_cents, included_minutes').eq('id', org.plan_id).maybeSingle()
        : { data: null }
      i.includedRateCentsPerMin = plan ? includedRateCentsPerMin(plan.price_cents, plan.included_minutes) : 0
    }
  } else if (m === 'usage_pct') {
    const period = new Date(nowMs).toISOString().slice(0, 8) + '01'
    i.usage = await currentPeriodUsage(db, alert.org_id, period)
  } else if (m === 'provider_down') {
    // Same "currently down" definition as the dashboard incident banner: ok=false
    // and checked within the last hour.
    const cutoff = new Date(nowMs - 3_600_000).toISOString()
    const { count } = await db
      .from('provider_status')
      .select('provider', { count: 'exact', head: true })
      .eq('ok', false)
      .gte('checked_at', cutoff)
    i.providersDown = count ?? 0
  }
  return i
}

/** Evaluate one alert; returns true if it fired. db must be the service client. */
export async function evaluateAlert(db: SupabaseClient, alert: AlertRow, nowMs: number = Date.now()): Promise<boolean> {
  const inputs = await gatherInputs(db, alert, nowMs)
  const value = computeMetric(alert.metric, inputs)
  const conditionMet = compare(value, alert.operator, Number(alert.threshold))
  const { fire, newState } = evaluateCrossing({
    conditionMet,
    lastState: alert.last_state,
    lastFiredAt: alert.last_fired_at,
    cooldownMins: alert.cooldown_mins,
    now: nowMs,
  })

  // Persist crossing state every eval (fires-once even if notification fails).
  const patch: Record<string, unknown> = { last_state: newState }
  if (fire) patch.last_fired_at = new Date(nowMs).toISOString()
  await db.from('alerts').update(patch).eq('id', alert.id)
  if (!fire) return false

  const emails = alert.channels?.emails?.filter(Boolean) ?? []
  const endpointIds = alert.channels?.endpointIds?.filter(Boolean) ?? []
  const notifiedVia = [...emails.map((e) => `email:${e}`), ...endpointIds.map((id) => `webhook:${id}`)]

  const { data: fireRow } = await db
    .from('alert_events')
    .insert({
      alert_id: alert.id,
      value,
      payload: {
        metric: alert.metric,
        operator: alert.operator,
        threshold: Number(alert.threshold),
        windowMins: alert.window_mins,
        notifiedVia,
      },
    })
    .select('id')
    .maybeSingle()

  // Email channel — best-effort (the fire is already recorded; a next-tick
  // re-fire is impossible now that last_state is set).
  if (emails.length) {
    const { data: org } = await db.from('orgs').select('name').eq('id', alert.org_id).maybeSingle()
    await sendEmail(
      emails,
      `Airtalk alert: ${alert.name}`,
      AlertEmail({
        orgName: org?.name ?? 'your workspace',
        alertName: alert.name,
        metricLabel: ALERT_METRIC_LABELS[alert.metric],
        operatorLabel: ALERT_OPERATOR_LABELS[alert.operator],
        value,
        threshold: Number(alert.threshold),
        appUrl: appUrl(),
      })
    ).catch((e) => console.error('alert email failed:', e))
  }

  // Webhook channel — deliver alert.fired to the chosen endpoints, keyed by the
  // fire id so retries/reconcile can't double-send. Payload is our neutral shape.
  if (endpointIds.length && fireRow?.id) {
    await enqueueWebhookEvent(db, {
      orgId: alert.org_id,
      eventType: 'alert.fired',
      eventKey: fireRow.id,
      payload: {
        alertId: alert.id,
        name: alert.name,
        metric: alert.metric,
        operator: alert.operator,
        threshold: Number(alert.threshold),
        value,
        windowMins: alert.window_mins,
        firedAt: new Date(nowMs).toISOString(),
      },
      endpointIds,
    }).catch((e) => console.error('alert webhook enqueue failed:', e))
  }

  return true
}
