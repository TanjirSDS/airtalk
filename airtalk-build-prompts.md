# Airtalk — AI Coding Prompts, Phase by Phase

Copy-paste prompts for Claude Code / Cursor. Run them in order — each assumes the previous phase is merged and working. Prompt 0 goes in `CLAUDE.md` (or `.cursorrules`) once; every phase prompt then inherits it.

---

## Prompt 0 — Project context (put in CLAUDE.md, not pasted per task)

```
You are building Airtalk, a multi-tenant SaaS where small businesses create AI voice
agents that answer/place phone calls. We are a THIN CONTROL PLANE over ElevenLabs
Agents (which runs the actual STT/LLM/TTS conversation and telephony via its native
Twilio integration). Our code NEVER touches audio.

STACK (do not deviate without asking):
- Turborepo monorepo: apps/web (Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui),
  packages/engine (provider adapter), packages/db (Supabase client + types + SQL migrations)
- Supabase: Postgres + Auth + Storage. All tenant tables have org_id with RLS.
- Stripe Billing, Twilio (numbers only), ElevenLabs Agents API, Sentry, Inngest (Phase 6+).
- Deploy: Vercel. Env vars via .env.local, validated with zod in a single env.ts.

HARD RULES:
1. Provider isolation: ElevenLabs types/HTTP calls exist ONLY inside packages/engine.
   Core tables store provider + provider_*_id strings. Everything else consumes the
   VoiceEngine interface.
2. Every webhook handler: verify signature → insert into webhook_events with UNIQUE
   event_id (skip on conflict = idempotent) → store raw payload jsonb → then process.
3. Money loops (outbound calls, campaigns) always have a cap and a kill switch.
4. Agent configs are versioned: every save writes a new row in agent_config_versions.
5. Usage/billing numbers come from nightly reconciliation against the provider API,
   never from webhooks alone.
6. When an external API shape is unknown, consult current docs (ElevenLabs:
   https://elevenlabs.io/docs/api-reference, Twilio, Stripe) rather than inventing it.
7. Write a minimal test (vitest) for money math and webhook idempotency. Skip UI tests.

THE VoiceEngine INTERFACE (packages/engine/src/types.ts) — implement providers against
this, never leak past it:
  createAgent(cfg: AgentConfig) → { providerAgentId }
  updateAgent(providerAgentId, cfg: Partial<AgentConfig>) → void
  deleteAgent(providerAgentId) → void
  importNumber(twilioSid, e164) → { providerNumberId }
  attachNumber(providerNumberId, providerAgentId) → void
  startOutboundCall(providerAgentId, toE164, vars?) → { providerCallId }
  startBatch(providerAgentId, contacts[]) → { batchId }
  addKnowledge(providerAgentId, source: {url?, file?}) → { knowledgeId }
  verifyWebhook(req) → boolean
  normalizeCallEvent(payload) → CallEvent { providerCallId, direction, fromE164, toE164,
    startedAt, durationSecs, transcript, recordingUrl, status, costCents? }
```

---

## Prompt 1 — Voice loop (single tenant, no UI, no auth)

```
Phase 1 of Airtalk. Goal: prove the full voice loop with zero UI.

Build:
1. Monorepo per CLAUDE.md. apps/web deployable to Vercel with a /api/health route.
2. packages/db: SQL migration for tables (no RLS yet, single tenant):
   agents(id uuid pk, name, provider text default 'elevenlabs', provider_agent_id text,
     config jsonb, status text default 'active', created_at)
   phone_numbers(id, agent_id fk, e164 text unique, twilio_sid text,
     provider_number_id text, status)
   calls(id, agent_id fk, provider_call_id text UNIQUE, direction text,
     from_e164, to_e164, started_at timestamptz, duration_secs int,
     transcript jsonb, recording_url text, status text, cost_cents int)
   webhook_events(id, provider text, event_id text UNIQUE, payload jsonb,
     processed_at timestamptz)
3. packages/engine: ElevenLabsEngine implementing VoiceEngine. Implement createAgent,
   importNumber (ElevenLabs native Twilio integration), attachNumber,
   startOutboundCall, verifyWebhook, normalizeCallEvent. Consult the current
   ElevenLabs Agents API docs for exact endpoints/payloads
   (agents create, phone-numbers, outbound call, post-call webhook + HMAC signature).
4. scripts/bootstrap.ts (run with tsx): reads a hardcoded AgentConfig (a plumber
   receptionist prompt), calls engine.createAgent, buys a US local number via the
   Twilio REST API, engine.importNumber + attachNumber, upserts rows in agents +
   phone_numbers, prints the live number.
5. app/api/webhooks/elevenlabs/route.ts: rule-2 idempotent handler → on post-call
   event, normalizeCallEvent → upsert into calls on provider_call_id.
6. scripts/outbound-test.ts: places one outbound call via engine to a number I pass.

Env vars: ELEVENLABS_API_KEY, ELEVENLABS_WEBHOOK_SECRET, TWILIO_ACCOUNT_SID,
TWILIO_AUTH_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Validate in env.ts.

Acceptance: I run bootstrap, call the printed number from my phone, have a short
conversation, hang up — within 60s the calls row exists with duration and transcript.
outbound-test rings my phone. Webhook replayed twice creates exactly one calls row.
Write the vitest for that idempotency using a captured payload fixture.
```

## Prompt 2 — Agent builder & templates

```
Phase 2. Goal: non-technical user turns business info into a working agent.

Build:
1. packages/engine/templates: three templates — receptionist, booking, lead_qualifier.
   Each = TypeScript function (BusinessProfile) → AgentConfig. BusinessProfile:
   businessName, industry, hours, services[], faqs[{q,a}], escalationNumber?,
   greetingStyle ('professional'|'friendly'|'casual'), voiceId.
   Prompts must instruct the agent to: disclose it's an AI assistant in the greeting,
   stay on-topic, capture caller name+number+reason, offer escalation/voicemail on
   failure. Keep prompts in separate .ts files, well-commented — I will tune them.
2. Migration: agent_config_versions(id, agent_id fk, version int, config jsonb,
   created_at). Every agent save = engine.updateAgent + new version row.
3. UI (shadcn/ui): /agents list, /agents/new wizard (template → business form →
   voice picker hitting ElevenLabs voices list API → review), /agents/[id] edit page
   with version history + one-click rollback (re-applies old config via adapter).
4. Browser test call: embed the ElevenLabs web widget (or WebRTC conversation SDK)
   on the agent page behind a "Test your agent" button.
5. Knowledge base (feature-flagged, flag hardcoded true for now): upload files/URLs
   on the agent page → engine.addKnowledge; list + delete attached sources.

Acceptance: from /agents/new I create a dentist receptionist in <10 min, test-talk
to it in the browser, edit its FAQs, roll back to v1, and the provider agent
reflects each change. No ElevenLabs imports outside packages/engine (add an
eslint no-restricted-imports rule enforcing this).
```

## Prompt 3 — Calls dashboard & analytics

```
Phase 3. Goal: the daily-use dashboard.

Build:
1. /calls: paginated table (date, agent, direction, from/to, duration, outcome,
   status) with filters (agent, direction, date range, outcome) and CSV export
   (stream, don't buffer).
2. /calls/[id]: audio player for recording_url + transcript with speaker turns;
   clicking a transcript line seeks audio (ElevenLabs transcripts include
   timestamps — check payload fixture from Phase 1).
3. Outcome extraction: on post-call webhook, one cheap LLM call (gpt-4o-mini class)
   classifying the transcript → outcome enum: booked | lead_captured | question_answered
   | escalated | voicemail | spam | failed, + one-line summary. Store on calls.
   Make the model+prompt a single module with a fixture test.
4. /dashboard: cards (calls today, minutes this period, answer rate, avg duration),
   outcomes stacked bar by week, calls-per-day line (recharts). All queries scoped
   for a future org_id param.

Acceptance: with 20 seeded calls, I can answer "what happened this week and did it
book anything?" in 10 seconds without opening transcripts.
```

## Prompt 4 — Multi-tenancy & metering

```
Phase 4. Goal: real tenants, trustworthy minute counting.

Build:
1. Migrations: orgs(id, name, plan_id, stripe_customer_id, minutes_cap,
   overage_policy text default 'pause' check in ('pause','overage'), created_at);
   org_members(org_id, user_id, role); add org_id to agents, phone_numbers, calls,
   webhook_events-derived writes. RLS: members read/write only their org rows;
   service role bypasses for webhooks/jobs.
2. Supabase Auth, magic-link only, minimal /login. Middleware resolves active org.
   (No signup funnel yet — I create orgs by SQL/admin script.)
3. usage_periods(org_id, period_start date, minutes_used numeric, minutes_cap int,
   overage_minutes numeric). Post-call webhook increments atomically (SQL function,
   not read-modify-write).
4. Enforcement: at 80% email warn (log for now); at 100% → per overage_policy:
   'pause' = engine-disable org agents + banner, 'overage' = keep counting into
   overage_minutes.
5. Nightly reconciliation (Vercel cron): pull provider call list for yesterday,
   diff vs calls table, insert missing, correct durations, recompute usage_periods.
   Log discrepancies > 2 minutes to Sentry.
6. Plan limits: plans(id, name, price_cents, included_minutes, max_agents,
   kb_enabled bool, adaptive_enabled bool). Seed starter/growth/pro
   (499/750/1 · 999/1500/3 · 1499/2500/5, kb on growth+, adaptive on pro).
   Enforce max_agents in the wizard and kb_enabled on the KB tab.

Acceptance: two orgs seeded; org A cannot see org B's data (prove with a test using
two authed clients). Kill the webhook route for an hour of test calls — after
reconciliation, usage matches the provider dashboard. Cap crossing pauses agents.
```

## Prompt 5 — Stripe billing

```
Phase 5. Goal: money in, limits enforced by plan.

Build:
1. Stripe: script to idempotently create Products/Prices — Starter $499, Growth $999,
   Pro $1,499 monthly; annual prices at 15% off; one metered Price "Overage minutes"
   at $0.35/min. Store price ids in plans table.
2. Checkout session (existing org, no signup flow yet) + customer portal for
   upgrades/cards/invoices/cancel.
3. /api/webhooks/stripe (rule-2 idempotent): checkout.completed / subscription.updated
   / deleted → sync orgs.plan_id, minutes_cap, stripe ids. invoice.payment_failed →
   dunning state: 7-day grace banner → pause agents.
4. Overage: when overage_policy='overage', reconciliation job reports overage_minutes
   delta daily to the metered subscription item via Stripe usage records.
5. Plan-change edge cases: upgrade mid-cycle = new cap immediately; downgrade takes
   effect next period (store pending_plan_id). Unit-test the proration/cap math.

Acceptance: test-clock subscription upgrades Starter→Growth and the 2nd/3rd agent
unlock; simulated 900/750 min month on 'overage' shows 150 overage minutes ≈ $52.50
on the upcoming invoice; failed payment pauses agents after grace.
```

## Prompt 6 — Self-serve onboarding & launch hardening

```
Phase 6. Goal: strangers can buy without me. Launch quality.

Build:
1. Signup flow: /signup (magic link) → create org → plan picker → Stripe Checkout →
   wizard (Phase 2) → number purchase step (area-code picker calling Twilio
   available-numbers API) → live agent. One continuous flow with progress steps.
2. Emails via Resend + react-email: welcome, magic link, 80% cap warning, capped,
   payment failed, weekly summary (calls, minutes, outcomes, top questions).
3. Move async work to Inngest: outcome classification, reconciliation, emails,
   weekly summaries. Retries with backoff; dead-letter logging to Sentry.
4. Ops: Sentry (web+jobs), /api/health checking DB+Stripe+ElevenLabs reachability,
   ElevenLabs/Twilio status webhooks or polling → incident banner in dashboard.
5. Admin: /admin (role-gated) — orgs list, usage, impersonate ("view as org") for
   support, manual credit adjustment writing to usage_periods with audit note.
6. Rate-limit auth + webhook routes (upstash ratelimit). Security pass: no service
   key client-side, webhook secrets rotated, CSP headers.

Acceptance: incognito → paying org with a live agent answering a real phone call,
no manual steps. Kill ElevenLabs API key in staging → banner within 5 min, Sentry
alert, graceful dashboard (no crashes).
```

## Prompt 7 — Outbound campaigns & Cal.com booking

```
Phase 7. Goal: outbound with guardrails + real appointment booking.

Build:
1. Migrations: campaigns(id, org_id, agent_id, name, status
   draft|running|paused|done|killed, calling_window jsonb, spend_cap_cents,
   consent_attested_at, created_by); campaign_contacts(id, campaign_id, e164,
   vars jsonb, call_id, status pending|calling|done|failed|opted_out);
   opt_outs(org_id, e164, source, created_at, UNIQUE(org_id, e164)).
2. Campaign wizard: CSV upload (papaparse, preview+column mapping) → dedupe →
   scrub against opt_outs → REQUIRED consent attestation checkbox (store timestamp
   + user) → schedule within calling window.
3. Runner (Inngest): dial via engine.startBatch or startOutboundCall in chunks,
   only inside 8am–9pm recipient-local (infer tz from area code, lib), stop at
   spend cap (estimate minutes*$0.13), honor pause/kill instantly (check status
   between chunks).
4. Opt-out: post-call, if transcript shows removal request (reuse outcome
   classifier, add 'opt_out' label) → insert opt_outs + mark contact. Agent prompt
   for outbound templates must comply immediately and confirm.
5. Cal.com tool: define a "check_availability_and_book" tool on booking-template
   agents (ElevenLabs tool/webhook mechanism) → POST /api/tools/calcom with our
   HMAC → Cal.com API v2: availability lookup and booking creation → return slots /
   confirmation for the agent to speak. Store booking ref on the call row.
6. Campaign dashboard: progress, reached/voicemail/opted-out/booked, cost so far,
   big red Kill button.

Acceptance: 50-contact test campaign (my numbers) runs only in-window, one contact
says "remove me" and is never dialed by any future campaign, kill stops dialing
<30s, and a live test call books a real Cal.com slot that appears in my calendar.
```

## Prompt 8 — Adaptive learning (Pro)

```
Phase 8. Goal: the Pro feature — agents that improve from their own calls.

Build:
1. Migration: agent_suggestions(id, org_id, agent_id, week date, type
   faq_addition|prompt_tweak|kb_gap|escalation_rule, suggestion jsonb,
   evidence jsonb (call ids + quotes), status pending|applied|dismissed,
   applied_version int).
2. Weekly Inngest cron per Pro org: pull the week's transcripts per agent →
   one structured LLM pass (JSON schema output) extracting: unanswered questions
   (with frequency), calls that escalated/failed and why, FAQs answered wrong,
   requested services not in config → write agent_suggestions rows. Cap tokens;
   batch transcripts; cost-log per run.
3. Review UI on /agents/[id]/learning: suggestion cards with evidence quotes →
   Apply (merges into config via template merge functions → adapter update → new
   config version, so rollback works) or Dismiss. Batch-apply.
4. Weekly email: "Your agent learned N new answers this week" linking to review.
   If auto-apply is off (default), email lists pending suggestions.
5. Gate all of it behind plans.adaptive_enabled; upsell card on lower tiers.

Acceptance: seeded week of transcripts (include 3 repeated unanswered questions)
produces ≥3 sensible suggestions with evidence; applying one updates the live
agent and creates a version; rollback reverts it; Starter org sees upsell, not
the feature.
```

---

## How to run these

- One prompt per session/branch; merge only when the acceptance test passes for real (actual phone calls for 1, 2, 7).
- Keep captured webhook payloads as fixtures in `packages/engine/fixtures/` from Phase 1 onward — every later phase reuses them.
- After each phase, ask the coding agent to update CLAUDE.md with any decisions made (chosen endpoints, payload quirks) so the next phase inherits them.
