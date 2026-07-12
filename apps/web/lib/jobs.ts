import type { ReactElement } from 'react'
import { getEnv, serviceClient } from '@airtalk/db'
import {
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
import { externalNumber, recordOptOut } from './opt-out'
import { classifyCall } from './outcome'
import { reconcileYesterday } from './reconcile'
import { stripeClient } from './stripe'

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
      .select('id, org_id, direction, from_e164, to_e164, transcript, outcome')
      .eq('provider_call_id', providerCallId)
      .maybeSingle()
    if (!call) return 'call row gone'
    if (call.outcome) return 'already classified'
    const key = getEnv().OPENAI_API_KEY
    if (!key) return 'no OPENAI_API_KEY — skipped'
    const result = await classifyCall(call.transcript, key)
    if (!result) return 'classifier returned nothing'
    await db.from('calls').update({ outcome: result.outcome, summary: result.summary }).eq('id', call.id)
    // Phase 7: "remove me" → permanent do-not-call entry + scrub pending contacts.
    if (result.outcome === 'opt_out' && call.org_id) {
      const e164 = externalNumber(call)
      if (e164) await recordOptOut(db, call.org_id, e164)
    }
    return result.outcome
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

export const functions = [
  classifyRecordedCall,
  campaignRun,
  reconcileDaily,
  statusPoll,
  welcomeEmail,
  usageWarnEmail,
  usageCappedEmail,
  paymentFailedEmail,
  weeklySummary,
]
