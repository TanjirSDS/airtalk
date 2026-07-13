import type { ReactElement } from 'react'
import { getEnv, serviceClient } from '@airtalk/db'
import { suggestionTitle } from '@airtalk/engine/templates'
import {
  AgentLearningEmail,
  PaymentFailedEmail,
  UsageCappedEmail,
  UsageWarnEmail,
  WeeklySummaryEmail,
  WelcomeEmail,
} from '../emails'
import { expireDunning, reportOverageDaily } from './billing'
import { DUNNING_GRACE_DAYS } from './billing-math'
import { appUrl, orgOwnerEmails, sendEmail } from './email'
import { makeEngine } from './engine'
import {
  appProbes,
  downTransitions,
  fetchStatuspage,
  runHealthChecks,
  STATUS_PAGES,
  type CheckResult,
} from './health'
import { dialChunk } from './campaign-runner'
import { inngest } from './inngest'
import { extractSuggestions, type CallForLearning } from './learning'
import { normalizeStoredConfigSafe } from './types'
import { externalNumber, recordOptOut } from './opt-out'
import { classifyCall, deriveOutcome } from './outcome'
import { reconcileYesterday } from './reconcile'
import { stripeClient } from './stripe'
import { evaluateAlert, type AlertRow } from './alerts'
import { attemptDelivery } from './webhooks-out'

// All async work lives here as Inngest functions: retries with backoff come
// from the platform (default 4 retries), and anything that exhausts them is
// dead-lettered to Sentry via onFailure.

const deadLetter = async ({ error, event }: { error: Error; event: { name: string } }) => {
  console.error(`inngest dead-letter (${event.name}):`, error)
  if (process.env.SENTRY_DSN) {
    const Sentry = await import('@sentry/nextjs')
    Sentry.captureException(error, { tags: { source: 'inngest' } })
  }
}

/** Outcome classification, moved off the webhook path (Phase 3 → Phase 6). */
const classifyRecordedCall = inngest.createFunction(
  { id: 'classify-call', retries: 3, onFailure: deadLetter, triggers: [{ event: 'call/recorded' }] },
  async ({ event }) => {
    const providerCallId = event.data.providerCallId as string
    const db = serviceClient()
    const { data: call } = await db
      .from('calls')
      .select('id, org_id, direction, from_e164, to_e164, transcript, outcome, analysis')
      .eq('provider_call_id', providerCallId)
      .maybeSingle()
    if (!call) return 'call row gone'
    if (call.outcome) return 'already classified'
    // Phase 12: classify for the rich label (when a key exists), then let EL's
    // native analysis take precedence where decisive (deriveOutcome). EL analysis
    // alone can still set outcome='failed' with no key.
    const key = getEnv().OPENAI_API_KEY
    const result = key ? await classifyCall(call.transcript, key) : null
    const derived = deriveOutcome(result, call.analysis)
    if (!derived) return key ? 'classifier returned nothing' : 'no analysis, no OPENAI_API_KEY — skipped'
    await db.from('calls').update({ outcome: derived.outcome, summary: derived.summary }).eq('id', call.id)
    // Phase 7: "remove me" → permanent do-not-call entry + scrub pending contacts.
    if (derived.outcome === 'opt_out' && call.org_id) {
      const e164 = externalNumber(call)
      if (e164) await recordOptOut(db, call.org_id, e164)
    }
    return derived.outcome
  }
)

/**
 * Phase 7 outbound runner (rule 3). One loop per campaign: each tick dials a
 * small chunk, then sleeps 30s — so pause/kill (a status flip in the DB) stops
 * dialing within 30 seconds. Out-of-window ticks sleep 15 minutes. Concurrency
 * is 1 per campaign, so a resume while an old loop is mid-sleep can't double-dial.
 */
const campaignRun = inngest.createFunction(
  {
    id: 'campaign-run',
    retries: 2,
    onFailure: deadLetter,
    concurrency: { limit: 1, key: 'event.data.campaignId' },
    triggers: [{ event: 'campaign/run' }],
  },
  async ({ event, step }) => {
    const campaignId = event.data.campaignId as string
    // ponytail: iteration cap is a runaway backstop — 5000 ticks ≈ 52 days of
    // window-waits; raise if a campaign legitimately runs longer.
    for (let i = 0; i < 5000; i++) {
      const res = await step.run(`chunk-${i}`, () => dialChunk(serviceClient(), makeEngine(), campaignId))
      if (res.kind === 'stopped' || res.kind === 'done') return res
      await step.sleep(`tick-${i}`, res.kind === 'wait' ? '15m' : '30s')
    }
    return { kind: 'iteration-cap' }
  }
)

/** Nightly reconciliation + billing follow-ups (was the Vercel cron; rule 5). */
const reconcileDaily = inngest.createFunction(
  { id: 'reconcile-daily', retries: 2, onFailure: deadLetter, triggers: [{ cron: 'TZ=UTC 0 3 * * *' }] },
  async ({ step }) => {
    const db = serviceClient()
    const engine = makeEngine()
    const summary = await step.run('reconcile', () => reconcileYesterday(db, engine))
    const overage = await step.run('report-overage', () => reportOverageDaily(db, stripeClient()))
    const dunning = await step.run('expire-dunning', () => expireDunning(db, engine))
    return { ...summary, overageOrgsReported: overage, dunningPaused: dunning }
  }
)

/** Every 5 minutes: our reachability probes + upstream status pages → provider_status
 *  (the dashboard incident banner reads it); Sentry alert on each healthy→down edge. */
const statusPoll = inngest.createFunction(
  { id: 'status-poll', retries: 0, onFailure: deadLetter, triggers: [{ cron: '*/5 * * * *' }] },
  async () => {
    const db = serviceClient()
    const [{ checks }, elevenStatus, twilioStatus] = await Promise.all([
      runHealthChecks(appProbes(db, stripeClient(), makeEngine())),
      fetchStatuspage(STATUS_PAGES.elevenlabs_status),
      fetchStatuspage(STATUS_PAGES.twilio_status),
    ])
    const next: Record<string, CheckResult> = {
      ...checks,
      elevenlabs_status: elevenStatus,
      twilio_status: twilioStatus,
    }

    const { data: prevRows } = await db.from('provider_status').select('provider, ok')
    const prevOk = Object.fromEntries((prevRows ?? []).map((r) => [r.provider, r.ok as boolean]))
    for (const alert of downTransitions(prevOk, next)) {
      console.error(`provider down — ${alert}`)
      if (process.env.SENTRY_DSN) {
        const Sentry = await import('@sentry/nextjs')
        Sentry.captureMessage(`provider down — ${alert}`, 'error')
      }
    }

    const now = new Date().toISOString()
    const { error } = await db.from('provider_status').upsert(
      Object.entries(next).map(([provider, r]) => ({
        provider,
        ok: r.ok,
        detail: r.detail ?? null,
        checked_at: now,
      })),
      { onConflict: 'provider' }
    )
    if (error) throw new Error(error.message)
    return Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v.ok]))
  }
)

// --- Emails -----------------------------------------------------------------

async function emailOwners(orgId: string, subject: string, build: (orgName: string) => ReactElement) {
  const db = serviceClient()
  const { data: org } = await db.from('orgs').select('name').eq('id', orgId).maybeSingle()
  if (!org) return 'org gone'
  const to = await orgOwnerEmails(db, orgId)
  const sent = await sendEmail(to, subject, build(org.name))
  return sent ? `sent to ${to.length} owner(s)` : 'skipped (no RESEND_API_KEY or no owners)'
}

const welcomeEmail = inngest.createFunction(
  { id: 'email-welcome', onFailure: deadLetter, triggers: [{ event: 'org/created' }] },
  ({ event }) =>
    emailOwners(event.data.orgId as string, 'Welcome to Airtalk', (orgName) =>
      WelcomeEmail({ orgName, appUrl: appUrl() })
    )
)

const usageWarnEmail = inngest.createFunction(
  { id: 'email-usage-warn', onFailure: deadLetter, triggers: [{ event: 'usage/warned' }] },
  ({ event }) =>
    emailOwners(event.data.orgId as string, 'Airtalk: 80% of your minutes used', (orgName) =>
      UsageWarnEmail({
        orgName,
        minutesUsed: event.data.minutesUsed as number,
        capMinutes: event.data.capMinutes as number,
        appUrl: appUrl(),
      })
    )
)

const usageCappedEmail = inngest.createFunction(
  { id: 'email-usage-capped', onFailure: deadLetter, triggers: [{ event: 'usage/capped' }] },
  ({ event }) =>
    emailOwners(event.data.orgId as string, 'Airtalk: minute cap reached', (orgName) =>
      UsageCappedEmail({
        orgName,
        capMinutes: event.data.capMinutes as number,
        policy: event.data.policy as string,
        appUrl: appUrl(),
      })
    )
)

const paymentFailedEmail = inngest.createFunction(
  { id: 'email-payment-failed', onFailure: deadLetter, triggers: [{ event: 'billing/payment-failed' }] },
  ({ event }) =>
    emailOwners(event.data.orgId as string, 'Airtalk: payment failed — action needed', (orgName) =>
      PaymentFailedEmail({ orgName, graceDays: DUNNING_GRACE_DAYS, appUrl: appUrl() })
    )
)

/** Monday 14:00 UTC: last-7-days digest per org with any calls. */
const weeklySummary = inngest.createFunction(
  { id: 'weekly-summary', onFailure: deadLetter, triggers: [{ cron: 'TZ=UTC 0 14 * * 1' }] },
  async ({ step }) => {
    const db = serviceClient()
    const { data: orgs, error } = await db.from('orgs').select('id, name')
    if (error) throw new Error(error.message)
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString()

    let sentCount = 0
    for (const org of orgs ?? []) {
      const sent = await step.run(`summary-${org.id}`, async () => {
        const { data: calls } = await db
          .from('calls')
          .select('duration_secs, outcome, summary')
          .eq('org_id', org.id)
          .gte('started_at', since)
        if (!calls?.length) return false

        const byOutcome = new Map<string, number>()
        for (const c of calls) if (c.outcome) byOutcome.set(c.outcome, (byOutcome.get(c.outcome) ?? 0) + 1)
        const outcomes = [...byOutcome.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([outcome, count]) => ({ outcome, count }))
        // ponytail: "top questions" = summaries of question calls, first five —
        // add clustering/LLM aggregation when digests need to get smarter.
        const topQuestions = calls
          .filter((c) => c.outcome === 'question_answered' && c.summary)
          .slice(0, 5)
          .map((c) => c.summary as string)

        const to = await orgOwnerEmails(db, org.id)
        return sendEmail(
          to,
          'Your week on Airtalk',
          WeeklySummaryEmail({
            orgName: org.name,
            calls: calls.length,
            minutes: calls.reduce((m, c) => m + (c.duration_secs ?? 0), 0) / 60,
            outcomes,
            topQuestions,
            appUrl: appUrl(),
          })
        )
      })
      if (sent) sentCount++
    }
    return { orgs: (orgs ?? []).length, sent: sentCount }
  }
)

/**
 * Phase 8: Monday 13:00 UTC (an hour before the weekly summary) — every agent
 * on an adaptive plan gets one structured LLM pass over its week of
 * transcripts; results land as pending agent_suggestions rows and the org's
 * owners get the "your agent learned" email. Idempotent per (agent, week):
 * a re-run skips agents that already have rows for the week.
 */
const agentLearning = inngest.createFunction(
  { id: 'agent-learning', retries: 1, onFailure: deadLetter, triggers: [{ cron: 'TZ=UTC 0 13 * * 1' }] },
  async ({ step }) => {
    const db = serviceClient()
    const key = getEnv().OPENAI_API_KEY
    if (!key) return 'no OPENAI_API_KEY — skipped'

    const { data: adaptivePlans, error: planErr } = await db
      .from('plans')
      .select('id')
      .eq('adaptive_enabled', true)
    if (planErr) throw new Error(planErr.message)
    const planIds = (adaptivePlans ?? []).map((p) => p.id)
    if (!planIds.length) return 'no adaptive plans'
    const { data: orgs, error } = await db.from('orgs').select('id, name').in('plan_id', planIds)
    if (error) throw new Error(error.message)

    const since = new Date(Date.now() - 7 * 86_400_000)
    const week = since.toISOString().slice(0, 10) // the Monday the week started (cron runs Mondays)

    let totalSuggestions = 0
    let totalCostCents = 0
    let emailed = 0
    for (const org of orgs ?? []) {
      const { data: agents } = await db.from('agents').select('id, name, config').eq('org_id', org.id)
      const digest: { agentId: string; agentName: string; titles: string[] }[] = []

      for (const agent of agents ?? []) {
        const res = await step.run(`learn-${agent.id}`, async () => {
          const stored = normalizeStoredConfigSafe(agent.config)
          if (!stored?.seed) return null // no seed profile → nothing to extract against (Phase 11)
          const { count } = await db
            .from('agent_suggestions')
            .select('id', { count: 'exact', head: true })
            .eq('agent_id', agent.id)
            .eq('week', week)
          if (count) return null // already learned this week

          const { data: calls } = await db
            .from('calls')
            .select('id, outcome, transcript')
            .eq('agent_id', agent.id)
            .gte('started_at', since.toISOString())
            .not('transcript', 'is', null)
            .order('started_at', { ascending: false })
          const usable = ((calls ?? []) as CallForLearning[]).filter(
            (c) => Array.isArray(c.transcript) && c.transcript.length > 0
          )
          if (!usable.length) return null

          const result = await extractSuggestions(stored.seed, usable, key)
          if (!result) return null
          if (result.suggestions.length) {
            const { error: insErr } = await db.from('agent_suggestions').insert(
              result.suggestions.map((s) => ({
                org_id: org.id,
                agent_id: agent.id,
                week,
                type: s.type,
                suggestion: s.suggestion,
                evidence: s.evidence,
              }))
            )
            if (insErr) throw new Error(insErr.message)
          }
          // item 2: cost-log per run
          console.log(
            `agent-learning ${agent.id}: ${usable.length} calls (${result.skippedCalls} over token budget), ` +
              `${result.suggestions.length} suggestions, ~${result.costCents.toFixed(3)}¢ ` +
              `(${result.promptTokens}+${result.completionTokens} tokens)`
          )
          return {
            costCents: result.costCents,
            titles: result.suggestions.map((s) => suggestionTitle(s.type, s.suggestion)),
          }
        })
        if (res) {
          totalCostCents += res.costCents
          totalSuggestions += res.titles.length
          if (res.titles.length) digest.push({ agentId: agent.id, agentName: agent.name, titles: res.titles })
        }
      }

      if (digest.length) {
        const orgSuggestions = digest.reduce((n, d) => n + d.titles.length, 0)
        const sent = await step.run(`email-${org.id}`, async () => {
          const to = await orgOwnerEmails(db, org.id)
          return sendEmail(
            to,
            `Your agent learned ${orgSuggestions} new thing${orgSuggestions === 1 ? '' : 's'} this week`,
            AgentLearningEmail({
              orgName: org.name,
              agents: digest,
              totalSuggestions: orgSuggestions,
              appUrl: appUrl(),
            })
          )
        })
        if (sent) emailed++
      }
    }
    return {
      orgs: (orgs ?? []).length,
      suggestions: totalSuggestions,
      emailed,
      costCents: Math.round(totalCostCents * 1000) / 1000,
    }
  }
)

/**
 * Phase 17: outbound webhook delivery. attemptDelivery throws on a non-terminal
 * failure so Inngest retries with backoff; at the attempt cap it marks the row
 * 'dead' + Sentry and returns. NOT wrapped in step.run — each Inngest retry must
 * genuinely re-run the POST (and re-read the incremented attempts).
 */
const webhookDeliver = inngest.createFunction(
  { id: 'webhook-deliver', retries: 5, onFailure: deadLetter, triggers: [{ event: 'webhook/deliver' }] },
  ({ event }) => attemptDelivery(serviceClient(), event.data.deliveryId as string)
)

/**
 * Phase 17: alert evaluator, every 15 minutes. retries:0 (like status-poll) —
 * evaluateAlert persists crossing state, so a retry with the pre-fire snapshot
 * would double-fire; the next tick catches anything a crash skipped. Each alert
 * is isolated in try/catch so one bad rule can't block the rest.
 */
const alertEvaluate = inngest.createFunction(
  { id: 'alert-evaluate', retries: 0, onFailure: deadLetter, triggers: [{ cron: '*/15 * * * *' }] },
  async () => {
    const db = serviceClient()
    const { data: alerts, error } = await db.from('alerts').select('*').eq('enabled', true)
    if (error) throw new Error(error.message)
    let fired = 0
    for (const alert of (alerts ?? []) as AlertRow[]) {
      try {
        if (await evaluateAlert(db, alert)) fired++
      } catch (e) {
        console.error(`alert ${alert.id} eval failed:`, e)
      }
    }
    return { evaluated: (alerts ?? []).length, fired }
  }
)

export const functions = [
  classifyRecordedCall,
  campaignRun,
  reconcileDaily,
  statusPoll,
  webhookDeliver,
  alertEvaluate,
  welcomeEmail,
  usageWarnEmail,
  usageCappedEmail,
  paymentFailedEmail,
  weeklySummary,
  agentLearning,
]
