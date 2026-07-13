# Airtalk — Project Context

You are building Airtalk, a multi-tenant SaaS where small businesses create AI voice
agents that answer/place phone calls. We are a THIN CONTROL PLANE over ElevenLabs
Agents (which runs the actual STT/LLM/TTS conversation and telephony via its native
Twilio integration). Our code NEVER touches audio.

## STACK (do not deviate without asking)

- Turborepo monorepo: apps/web (Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui),
  packages/engine (provider adapter), packages/db (Supabase client + types + SQL migrations)
- Supabase: Postgres + Auth + Storage. All tenant tables have org_id with RLS.
- Stripe Billing, Twilio (numbers only), ElevenLabs Agents API, Sentry, Inngest (Phase 6+).
- Deploy: Vercel. Env vars via .env.local, validated with zod in a single env.ts.

## HARD RULES

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

## THE VoiceEngine INTERFACE (packages/engine/src/types.ts)

Implement providers against this, never leak past it:

```
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

## Phase decisions log

(Updated after each phase: chosen endpoints, payload quirks, decisions made.)

### Phase 1 skeleton (2026-07-12)
- ElevenLabs endpoints (verified against docs): POST /v1/convai/agents/create,
  PATCH/DELETE /v1/convai/agents/{id}, POST /v1/convai/phone-numbers (Twilio import,
  takes account sid+token), PATCH /v1/convai/phone-numbers/{id} (assign agent_id),
  POST /v1/convai/twilio/outbound-call, POST /v1/convai/batch-calling/submit.
- Outbound/batch calls need agent_phone_number_id — engine looks it up via
  GET /v1/convai/phone-numbers by assigned agent.
- providerCallId = ElevenLabs conversation_id. Webhooks carry no event id, so
  webhook_events.event_id = `${type}:${conversation_id}`.
- HMAC: `elevenlabs-signature: t=<unix>,v0=<hex hmac-sha256("t.body")>` — implemented
  from docs, VERIFY against a live webhook when keys exist.
- metadata.cost is ElevenLabs credits, not cents → calls.cost_cents left null until
  reconciliation (rule 5).
- fixtures/post-call-transcription.json is SYNTHETIC — replace with a captured live
  payload during Phase 1 acceptance.
- Single env.ts lives in packages/db/src/env.ts (lazy getEnv() so Vercel builds
  without secrets); engine gets keys via constructor, never reads env.

### Phase 2 agents UI (2026-07-12)
- Voices list: GET /v2/voices (current endpoint; paginated, page_size max 100 —
  engine reads first page only for now). Fields: voice_id, name, preview_url, category.
- Test widget: `<elevenlabs-convai agent-id>` + script
  https://unpkg.com/@elevenlabs/convai-widget-embed. Requires the agent PUBLIC with
  auth disabled. Exposed provider-neutrally via VoiceEngine.testWidgetEmbed()
  (descriptor {scriptSrc, tagName, attrs}); the React component knows no provider.
- Knowledge base: DELETE /v1/convai/knowledge-base/{id}?force=true deletes AND
  auto-detaches from dependent agents (so removeKnowledge needs no manual detach).
  Attachment entry shape {type, id, name} verified (usage_mode optional, default 'auto').
- agents.config and agent_config_versions.config store
  { template, profile, agentConfig } — keeping the BusinessProfile is what lets the
  edit page re-run the template and rollback restore the form. Rollback re-applies
  via adapter and APPENDS a new version row (history is append-only, rule 4).
  Bootstrap-era agents (plain AgentConfig in config) render read-only in the UI.
- Templates are browser-safe via the '@airtalk/engine/templates' subpath export
  (pure TS, no node/provider imports) so client components can use TEMPLATE_INFO.
- Rule 1 is now machine-enforced: root eslint.config.mjs no-restricted-imports
  blocks elevenlabs imports outside packages/engine (`npm run lint`).

### Phase 3 dashboard (2026-07-12)
- Recordings: post-call webhooks carry NO audio URL — audio comes from
  GET /v1/convai/conversations/{id}/audio (verified against docs), exposed as
  VoiceEngine.fetchRecording() and proxied at /api/calls/[id]/audio. Buffered,
  not streamed: a Content-Length makes <audio> seeking reliable and recordings
  are a few MB. calls.recording_url stays for providers with real URLs (proxy
  302s to it when set).
- Outcome extraction: apps/web/lib/outcome.ts is the single model+prompt module
  (gpt-4o-mini, temperature 0, response_format json_object). OPENAI_API_KEY is
  OPTIONAL in env.ts — no key → classify returns null, calls keep outcome null.
  Injected into handleElevenLabsWebhook as a classify fn: best-effort, a
  classifier failure never fails the webhook. Enum enforced twice: parseOutcome
  and the 0003 check constraint.
- Transcript turns carry time_in_call_secs (see fixture) → click-to-seek in
  components/call-player.tsx.
- /calls and /calls/export share lib/call-filters.ts so table and CSV always
  agree; export streams via ReadableStream pull() at 1000 rows/page.
- Dashboard: one 8-week calls query (fetchRecentCalls threads a future orgId
  param for Phase 4 RLS), aggregation in JS, recharts. Outcome→color map in
  outcome.ts validated with the dataviz palette checker (CVD ΔE 16.2).
- npm run seed-calls: 20 deterministic synthetic calls (upsert on
  provider_call_id seed-conv-NN, idempotent).
- Migration 0003 NOT applied anywhere yet: no Airtalk Supabase project or
  .env.local exists as of Phase 3 — apply 0001–0003 when the stack is stood up.

### Phase 4 tenants + usage (2026-07-12)
- 0004: plans (text ids starter/growth/pro, seeded), orgs, org_members,
  org_id on agents/phone_numbers/calls. webhook_events stays org-less (events
  arrive before the tenant is known); the calls rows derived from them carry
  org_id via the agent.
- Usage: usage_periods pk (org_id, period_start=UTC month). record_call_usage()
  is ONE insert..on conflict statement returning prev/new/cap so callers detect
  threshold crossings without a second read; recompute_usage() rewrites a period
  from the calls table (rule 5). Both revoked from authenticated — members
  could otherwise spoof usage via rpc.
- RLS: is_org_member() security definer (avoids org_members policy recursion);
  service role bypasses via BYPASSRLS. App reads/writes moved from
  serviceClient to an RLS-scoped userClient (@supabase/ssr, lib/supabase-server.ts)
  — Postgres does the org filtering, pages barely changed. serviceClient
  remains ONLY in webhooks/cron/scripts. Rows with org_id null are invisible
  to members; npm run seed-orgs adopts them into org A.
- Auth: magic-link only (signInWithOtp shouldCreateUser:false — no signup
  funnel). middleware.ts refreshes the session cookie and gates everything
  except /login, /auth, /api/{webhooks,cron,health}. Active org = first
  membership, resolved per-request in lib/org.ts (React cache()); add an
  org-switcher cookie when someone actually has two orgs.
- Webhook now checks call pre-existence before upsert: reconciliation may have
  inserted the call first, and usage must be counted exactly once. A usage/rpc
  failure never fails the webhook (reconciliation self-heals).
- Enforcement is crossing-based (fires once): 80% → console.warn (email later);
  100% → per overage_policy: 'pause' sets agents.status=paused + detaches
  numbers at the provider, 'overage' just accumulates overage_minutes. Detach =
  PATCH /v1/convai/phone-numbers/{id} {agent_id: null} (nullable per docs
  2026-07-12) — phone_numbers rows keep agent_id so resume can re-attach.
  Banner in layout.tsx at ≥80%/≥100%.
- Reconciliation: engine.listCalls uses GET /v1/convai/conversations with
  call_start_{after,before}_unix + cursor pagination (verified 2026-07-12).
  Diff matches by provider_call_id, NOT started_at window (clock skew would
  fake missing calls). /api/cron/reconcile (vercel.json in apps/web, 03:00 UTC,
  Bearer CRON_SECRET) inserts missing calls, fixes durations, recompute_usage
  per affected org+month, re-enforces caps. Discrepancy > 2 min →
  Sentry.captureMessage (SENTRY_DSN optional; instrumentation.ts no-ops without).
- Plan gates: max_agents enforced in createAgentAction (wizard page shows the
  limit as UX only); kb_enabled replaced lib/flags.ts KNOWLEDGE_BASE_ENABLED.
- New VoiceEngine methods: detachNumber(providerNumberId),
  listCalls(afterUnix, beforeUnix) → ProviderCall[].
- RLS isolation + live usage-math tests in packages/db/src/rls.test.ts —
  auto-skip without .env.local (still no Supabase project as of Phase 4).
  Acceptance items needing live infra (webhook-outage reconciliation vs
  provider dashboard, cap-crossing pause) remain to be run after `seed-orgs`.

### Phase 5 billing (2026-07-12)
- 0005 fixes plans.price_cents: Phase 4 seeded DOLLARS (499) — now real cents
  (49900). scripts/stripe-setup refuses to run against unfixed rows.
- Stripe's classic usage-records API is legacy (verified 2026-07-12): overage
  uses Billing Meters — one meter 'overage_minutes' (sum, customer_mapping
  by_id), metered price $0.35/min via recurring.meter. Usage lands as meter
  events keyed by stripe_customer_id, so no subscription_item id is stored.
- npm run stripe-setup: idempotent via price lookup_keys ({plan}_monthly,
  {plan}_annual, overage_minutes) + product metadata.plan_id; amount drift →
  replacement price + transfer_lookup_key (prices are immutable). Annual =
  round(monthly×12×0.85), exact cents for all three plans. Ids stored in plans
  (stripe_overage_price_id duplicated per row — one global price, no new table).
- Overage reporting rides the nightly reconcile cron AFTER recompute_usage
  (rule 5): delta = floor(overage_minutes) − floor(overage_reported) per
  current period, sent as ONE meter event/org/day with identifier
  `overage:{orgId}:{date}` — Stripe dedupes identifiers ~24h, so cron re-runs
  can't double-bill. usage_periods.overage_reported is the running ledger.
- Plan changes (lib/billing.ts): upgrade = subscriptions.update with
  create_prorations (webhook raises cap immediately, releases any pending
  schedule); downgrade = subscription schedule (from_subscription, 2 phases,
  end_behavior release) + orgs.pending_plan_id — plan_id flips when the phase
  transition fires customer.subscription.updated. Stripe-node v19/Basil:
  current_period_start/end live on subscription ITEMS, not the subscription.
- Webhook /api/webhooks/stripe (rule 2, event_id = Stripe evt id):
  syncSubscription matches the sub's price ids against plans and sets
  plan_id/minutes_cap, then recompute_usage so the period's cap snapshot +
  overage follow mid-cycle. invoice.payment_failed sets payment_failed_at
  ONCE (.is null guard — Stripe retries must not reset the 7-day grace);
  invoice.paid clears it and resumes agents (resumeOrgAgents = re-attach
  numbers, inverse of Phase 4 pause). Cap-raise also resumes, but never while
  payment_failed_at is set. Dunning pause enforced by the nightly cron when
  grace expires.
- Checkout (existing org, client_reference_id = org id) appends the metered
  overage item only when overage_policy='overage'; reportOverageDaily
  self-heals subs missing the item (policy flipped later). Portal for
  cards/invoices/cancel. Billing writes go through serviceClient (orgs are
  member-read-only under RLS) gated on role='owner' in the server action.
- Money math is pure + tested in apps/web/lib/billing-math.ts (annual cents,
  overage delta incl. the 900/750→150min≈$52.50 acceptance case, upgrade-now
  vs downgrade-pending, grace countdown). Webhook idempotency tested with
  stripe.webhooks.generateTestHeaderString (offline).
- npm run stripe-acceptance: test-clock harness (test key only) — Starter→
  Growth mid-cycle proration, 150 meter minutes ≈ $52.50 on the preview
  invoice (meters aggregate async; polls ~1-2 min), failing card at renewal →
  past_due. Not yet run: no .env.local/Stripe account as of Phase 5 — run
  stripe-setup + stripe-acceptance when the stack is stood up; webhook secret
  comes from the dashboard endpoint or `stripe listen`.

### Phase 6 launch (2026-07-12)
- Signup funnel /signup → org → plan → agent → number → done, resumable: every
  page checks its prerequisite (user → membership → stripe_subscription_id →
  agent → phone_number) and redirects forward/back; the server actions in
  app/signup/actions.ts re-validate everything (pages are UX, actions are the
  gate). Magic-link send moved into ONE server action (app/auth/actions.ts,
  shared by login+signup) so it could be rate-limited; signup passes
  shouldCreateUser:true, login stays false. /auth/callback honors ?next= (same-
  origin paths only). Middleware routes org-less users to /signup/org (one
  indexed RLS select per authed page request — JWT claim if it ever hurts).
- Numbers: lib/numbers.ts (raw Twilio REST like bootstrap.ts — rule 1 fences
  only ElevenLabs). Search AvailablePhoneNumbers/US/Local.json (AreaCode,
  VoiceEnabled, PageSize=10), buy IncomingPhoneNumbers.json (PhoneNumber only —
  US local needs no address/bundle). Rule 3 guards in numberPurchaseBlocked():
  no sub / no agent / already-has-number (one number per org in self-serve).
  On import/attach failure after purchase → releaseNumber (DELETE stops the
  monthly charge).
- Emails: Resend v6 accepts `react:` directly BUT @react-email/render must be
  installed (optional peer dep — silent runtime throw without it). Templates in
  apps/web/emails/index.tsx; lib/email.ts no-ops without RESEND_API_KEY (same
  pattern as OPENAI_API_KEY). Magic-link email CANNOT be sent from app code —
  it's GoTrue's mailer; point Supabase at Resend SMTP (smtp.resend.com, user
  "resend") in the dashboard, template configurable there or via Management API.
- Inngest v4 (breaking vs v3: triggers live IN the config object —
  createFunction({id, retries, onFailure, triggers:[{event|cron}]}, handler);
  keys read from INNGEST_EVENT_KEY/SIGNING_KEY; INNGEST_DEV=1 for local).
  lib/jobs.ts: classify-call (event call/recorded), reconcile-daily (03:00 UTC
  cron, replaced vercel.json — file deleted), status-poll (*/5), weekly-summary
  (Mon 14:00 UTC), 4 email functions. Dead-letter = onFailure → Sentry.
  lib/events.ts emit() returns false on send failure → webhook falls back to
  inline classification, so no-Inngest dev still works. /api/inngest is in
  middleware PUBLIC_PREFIXES (signed requests).
- Crossing-based emails reuse Phase 4/5 fires-once guards: usage warn/cap ride
  usageCrossing; payment-failed rides the `.is('payment_failed_at', null)`
  update, which now .select('id')s the rows it marked to know WHO to email.
- Ops: VoiceEngine.ping() (GET /v1/user, free) added for health probes.
  lib/health.ts: runHealthChecks (5s/probe timeout), statuspage.io parsing
  (status.elevenlabs.io + status.twilio.com /api/v2/status.json, indicator
  none=ok), downTransitions (alert only on ok→down edge). status-poll writes
  provider_status (0006); IncidentBanner in layout shows rows down <1h old.
  /api/health returns booleans only (public route — details go to Sentry).
  Acceptance path: killed key → poll marks elevenlabs down ≤5 min → banner +
  Sentry.captureMessage. agents/new + signup/agent render a notice instead of
  crashing when listVoices fails.
- Admin: admin_users table (0006), seeded via npm run seed-admin. is_org_member
  now ORs is_admin() → RLS lets admins read/write every org, so "view as org"
  = admin-view-org cookie honored by activeOrg() (role:'admin', which never
  passes the 'owner' billing gates) and real pages render through normal RLS.
  Middleware skips the org-less redirect for /admin and when the cookie is set.
  Credit adjustments: usage_adjustments rows (note + created_by audit),
  recompute_usage (0006) folds sum(minutes_delta) in and clamps at 0 — nightly
  reconcile can't wipe a credit (rule 5). Bounds in lib/admin-adjustment.ts.
- Security: lib/ratelimit.ts (Upstash sliding window; auth 8/15m per-IP AND
  per-email, webhooks 300/min/IP pre-signature; fails OPEN when Redis is down
  or env absent). CSP + nosniff/frame/referrer headers in next.config.mjs
  ('unsafe-inline' script-src — Next inline bootstrap; nonces later). Cron
  route now fails CLOSED without CRON_SECRET. Audited: service key server-only.
  Webhook secret rotation: nothing live yet — rotate ELEVENLABS_WEBHOOK_SECRET
  + STRIPE_WEBHOOK_SECRET when real endpoints exist.
- Sentry: instrumentation.ts adds onRequestError (captureRequestError);
  instrumentation-client.ts inits browser SDK off NEXT_PUBLIC_SENTRY_DSN. No
  withSentryConfig wrapper (source maps can come later).
- Migration 0006 NOT applied anywhere yet (still no Supabase project). Full
  acceptance (incognito → paying org → live call; kill key in staging) needs
  the stack stood up: apply 0001–0006, stripe-setup, Inngest Vercel
  integration, Resend domain + Supabase SMTP, seed-admin.

### Phase 7 outbound + booking (2026-07-13)
- 0007: campaigns / campaign_contacts (unique(campaign_id,e164), provider_call_id
  set at dial time) / opt_outs (pk (org_id,e164), grows-only from the app: member
  select+insert, no delete) / call_bookings / calls.booking_ref / orgs.calcom_*.
  calls_outcome_check re-created with 'opt_out'.
- Runner dials via startOutboundCall in chunks of 5, NOT startBatch — the batch
  API can't honor per-contact tz windows, the spend cap, or kill between chunks.
  Inngest 'campaign-run' (concurrency 1 per campaignId so resume can't
  double-dial): loop { dialChunk → sleep 30s (15m when out-of-window) }, so
  pause/kill = a status flip picked up ≤30s later. Every tick re-reads status,
  spend (completed call minutes ×13¢ + 2min-estimate per in-flight call,
  lib/campaign-math.ts, tested) and re-scrubs opt_outs — opt-outs land even
  mid-campaign. Cap/exhaustion → status 'done'.
- Recipient-local window: lib/areacode-tz.ts, hand-maintained NANP map; split
  area codes (850, 812, 605, 208, 928…) list BOTH zones and must be in-window
  in all; unknown codes require both coasts in-window. Wizard hours are clamped
  to 8–21 in clampWindow whatever the jsonb says.
- Wizard: papaparse client-side, phone column guessed by header regex, all other
  CSV columns ride as dynamic vars. Consent checkbox is UX; the server action is
  the gate (consent_attested_at + created_by). Upload scrub keeps rows as
  status 'opted_out' for visibility. Agent-ownership check via RLS-scoped select
  (the runner uses the service role, so create is where cross-org agent ids die).
- Opt-out: outcome classifier gained 'opt_out' (overrides other labels);
  recordOptOut (lib/opt-out.ts) rides BOTH classify paths (Inngest job + inline
  webhook fallback). conductRules rule 7 tells every agent to comply immediately
  and confirm. Contact linking: post-call webhook flips campaign_contacts
  'calling'→'done' by provider_call_id (outbound only).
- ElevenLabs tools (verified docs 2026-07-12): standalone POST /v1/convai/tools
  + agent PATCH prompt.tool_ids — inline prompt.tools was REMOVED 2025-07-23.
  System values injected per-property via {"dynamic_variable":
  "system__conversation_id"|"system__caller_id"}. setAgentTools replaces
  tool_ids then deletes the old tools (idempotent, no orphans). Secret header is
  a plain string in tool config (visible to our own workspace) — switch to
  /v1/convai/secrets if untrusted members ever join. VERIFY on a live call:
  ElevenLabs response body → LLM needs no envelope; 20s default timeout.
- Cal.com v2 (verified docs 2026-07-12; cal-api-version is PER-ENDPOINT):
  GET /v2/slots '2024-09-04' (slots keyed by date), POST /v2/bookings
  '2026-02-25' (attendee needs only name+timeZone → phone-only booking works;
  booking ref = data.uid), event-types '2024-06-14' via /v2/me username.
  Slot-taken = plain 400 (no distinct 409) → tool answers "offer another slot".
  One tool 'check_availability_and_book' (action check|book); caller tz from
  areacode-tz so slots read in the callee's local time. Booking ref parked in
  call_bookings mid-call (calls row doesn't exist yet), webhook copies it over.
  Connect UI on the booking agent's page (owner-gated, key validated against
  /v2/me before storing; org-level creds on orgs) → setAgentTools + prompt
  re-render with profile.liveBooking=true as a new version row (rule 4).
- New env (optional): AGENT_TOOLS_SECRET (≥16 chars) — tool route 401s without
  it and Cal.com connect refuses; APP_URL required for the tool URL.
- /api/tools is in middleware PUBLIC_PREFIXES (secret-header auth, not session).
- Acceptance still needs live infra: apply 0007, set AGENT_TOOLS_SECRET, run the
  50-contact campaign (window + kill <30s), say "remove me" on one, live
  Cal.com booking landing in the calendar. Ceilings: reconcile doesn't backfill
  booking_ref for webhook-missed calls; stale 'calling' contacts (dial ok,
  webhook lost) stay 'calling' until reconciliation inserts the call — contact
  flip only happens on the webhook path.

### Phase 8 adaptive agents (2026-07-13)
- 0008: agent_suggestions (org_id, agent_id, week = Monday-UTC of the analyzed
  week, type, suggestion jsonb, evidence jsonb [{callId, quote}], status,
  applied_version). RLS: member select+update (apply/dismiss), NO insert
  policy — rows only come from the cron (service role). Idempotency = the cron
  skips agents that already have rows for (agent_id, week); no unique needed.
- Extraction (lib/learning.ts, mirrors outcome.ts: injectable fetch, optional
  OPENAI_API_KEY): ONE gpt-4o-mini pass per agent per week, response_format
  json_schema. Caps: 2k chars/call, 60k chars/batch newest-first (skipped
  count logged), max_tokens 1500, ≤8 suggestions. parseSuggestions drops
  suggestions whose evidence callIds aren't in the batch (hallucination
  guard) — no verifiable evidence, no suggestion. Cost-log per run from
  usage tokens at list price ($0.15/$0.60 per M).
- Type mapping decided: unanswered/wrong FAQs → faq_addition (model must have
  the answer evident from transcripts/facts; "answered wrong" = faq_addition
  whose q matches an existing FAQ, merge REPLACES the answer); escalated/
  failed calls → escalation_rule; requested-but-unlisted services → kb_gap
  (only the owner knows if they offer it — never auto-applied, dismiss-only
  card in the UI).
- Merge is pure + browser-safe: templates/merge.ts applySuggestionToProfile
  (null = can't apply: kb_gap, dupes, malformed). prompt_tweak/escalation_rule
  append to profile.extraInstructions → "## Learned adjustments" section
  rendered by conductRules for all templates. Tested in merge.test.ts.
- Apply (applySuggestionsAction, batch and single are the same path): merge
  all selected into the profile → ONE adapter update → ONE version row →
  rows marked applied with applied_version. So a batch-apply is a single
  rollback target (rule 4). FAQ cards have an editable answer input
  (single-apply only). Gate: org.plan.adaptiveEnabled (plans.adaptive_enabled
  existed since 0004, pro-only); /agents/[id]/learning shows the upsell card
  on lower tiers, agents page header links to it.
- Cron 'agent-learning' Mon 13:00 UTC (before the 14:00 weekly summary):
  adaptive-plan orgs → per-agent step.run → insert suggestions → per-org
  "Your agent learned N new things" email listing pending items (no
  auto-apply exists; everything lands pending, the email always lists).
  No OPENAI_API_KEY → whole run no-ops, bootstrap-era agents (no profile)
  skipped.
- npm run seed-learning: 12 transcripted calls in the last week (3 questions
  repeated 2–3×, an escalation pattern, a wrong-answer correction) for the
  first agent with an org. Acceptance needs live infra (still no Supabase/
  OpenAI env): apply 0008, seed-learning, trigger agent-learning in the
  Inngest dev UI, then apply/rollback on /agents/[id]/learning.

### Phase 9 UI infrastructure (2026-07-13)
- Pure UI phase — NO provider/schema changes (0001–0008 unchanged, eslint
  provider fence untouched). Everything phases 10–18 build on lands here.
- shadcn/ui, Tailwind v4 / React 19 style (function components, no forwardRef —
  ref rides props; `data-slot`-free). New primitives in components/ui/:
  dialog, sheet (dialog-based, side cva), drawer (vaul), dropdown-menu, popover,
  tooltip, tabs, table, command (cmdk), accordion, switch, checkbox, skeleton,
  sonner (Toaster), avatar, separator, scroll-area, slider. All restyled to
  Signal tokens (rounded-lg/xl, bg-popover, shadow-pop, brand focus ring). The
  hand-rolled badge/button/card/input/label/select/textarea are LEFT AS-IS
  (their APIs are consumed widely; shadcn versions weren't drop-in) — new code
  uses whichever fits. components.json added (new-york, cssVariables, aliases).
  Added `@/*` → `./*` path alias in apps/web/tsconfig.json so new ui files use
  `@/lib/utils`; existing relative imports keep working.
- New deps (web workspace): next-themes, sonner, cmdk, vaul, tw-animate-css,
  and @radix-ui/react-{dialog,dropdown-menu,tabs,tooltip,popover,accordion,
  switch,checkbox,avatar,separator,scroll-area,slider,slot}. tw-animate-css is
  the Tailwind-v4 successor to tailwindcss-animate — `@import 'tw-animate-css'`
  gives animate-in/fade/zoom/slide used by the overlay primitives. Radix
  accordion height animation needs keyframes we define ourselves:
  --animate-accordion-{down,up} in @theme + @keyframes reading
  --radix-accordion-content-height.
- Dark tokens: @theme is the LIGHT baseline; a plain `.dark {}` selector
  redefines the SAME --color-* names with dark values. Tailwind v4 utilities
  compile to `var(--color-x)` (verified in built CSS: .bg-card ->
  var(--color-card)), so bg-*/text-*/border-* switch automatically when
  next-themes toggles `.dark` on <html> — no `dark:` variants needed anywhere.
  `@custom-variant dark (&:where(.dark, .dark *))` is declared for one-off
  overrides. Added --color-popover(-foreground) (shadcn needs it). Shadows
  darkened in .dark (light rgba(12,14,20) shadows vanish on dark); brand hue
  kept; live/warn/destructive stay saturated. `color-scheme: light|dark` on html
  for native controls.
- WHAT FOUGHT BACK: a comment `every bg-*/text-*/border-* utility` inside
  globals.css — the `*/` sequences PREMATURELY CLOSE the CSS comment, leaking
  the rest as invalid CSS. Symptom was insidious: `next build` still "succeeded"
  but emitted a truncated stylesheet with ZERO custom-color utilities (dark mode
  silently dead). Never put `*/` inside a CSS comment; and verify the built CSS,
  not just the exit code. (No @source needed — Tailwind auto-detection scans the
  worktree fine once the comment is valid.)
- next-themes: attribute="class", defaultTheme="system", enableSystem,
  disableTransitionOnChange; suppressHydrationWarning on <html>; its pre-paint
  inline script needs the CSP 'unsafe-inline' script-src we already ship → no
  flash. options are system/light/dark (radio group in the account menu).
  useTheme consumers (Toaster, account-menu, dashboard-charts) guard on a
  mounted flag to avoid hydration mismatch.
- Charts (dashboard-charts.tsx): recharts sets colors as SVG attributes, which
  don't resolve var(), so chrome (grid/axes/tooltip/line/bar-spacer) is picked
  from resolvedTheme via useTheme+mounted. OUTCOME_COLORS fills are the
  CVD-validated set and DON'T change per theme (saturated enough on dark cards).
- Sidebar v2 (app-shell.tsx): desktop <aside> collapses 264px↔72px icon rail
  (Tooltip labels when railed); mobile is a left Sheet. Collapse persisted in
  cookie `sidebar-collapsed` (client writes document.cookie; layout reads it SSR
  for initialCollapsed → no flash). NAV is one array; "Calls"→"Call History";
  canonical future order noted in a comment so later phases just insert an item
  + its icon. SidebarBody is MODULE-scope (not nested) so toggling never
  remounts the switcher/menus.
- Workspace switcher (top): shows active org + plan, dropdown lists
  listMemberships() + "Create workspace" (dialog → createWorkspaceAction). Multi
  org via cookie `active-org`, honored by activeOrg() AFTER admin-view-org (that
  keeps precedence) and only for orgs the user is a member of (else falls back
  to first membership — never strands the user). Org creation is shared:
  lib/orgs-write.ts provisionOrg() (service-role org+owner-membership, server
  only — not a 'use server' export so userId is never client-supplied) is reused
  by BOTH signup's createOrgAction and the switcher's createWorkspaceAction.
  Switch = set cookie + redirect('/dashboard') so every RSC re-renders scoped to
  the new org. seed-orgs extended: owner A is also a member of org B so one user
  sees both workspaces (switcher acceptance).
- Usage widget (usage-widget.tsx, above the account menu — the switcher is now
  the org identity, so no separate "org card"): collapsed pill (used/cap + bar,
  ≥80% warn / ≥100% danger, same thresholds as the layout UsageBanner) →
  popover with period, plan, overage policy + overage minutes, Upgrade→/billing.
  Data from currentUsage() (cap falls back to org.minutesCap before first call).
- Account menu (bottom): avatar + email, theme radio (system/light/dark), Sign
  out (existing layout signOut action, threaded through as a prop).
- Toasts: <Toaster/> mounted in root layout (theme-aware). Used for switch
  errors / would-be create feedback where a redirect doesn't already say it.
- Misc: app/page.tsx `/`→redirect('/dashboard'); loading.tsx skeletons for
  dashboard/agents/calls/campaigns/billing; shared <EmptyState icon title
  description cta?/> (server-safe) for future pages.
- Cookie names introduced: `active-org` (switcher), `sidebar-collapsed` (rail).
- Acceptance verified here: npm run lint + build clean, provider fence intact,
  96 tests pass, built CSS confirmed to carry every custom-color utility as
  var() + the .dark overrides. Live visual checks (theme persistence across
  reloads, dark legibility of every page, mobile slide-over, switcher swapping
  data with a 2-org user) still need the stack stood up — no Supabase/env as of
  Phase 9. Run seed-orgs (now cross-membered) once it is.

### Phase 10 agents surface + freeform-first (2026-07-13)
- Migration 0009: agents.agent_type ('single'|'flow'|'custom_llm', default
  'single'), agents.updated_at (default now()), agents.updated_by (user email).
  Every agent-mutating server action sets updated_at/updated_by. 0009 ALSO
  relaxes delete-blocking FKs so the new delete works: calls.agent_id +
  phone_numbers.agent_id → ON DELETE SET NULL (keep call history, free numbers),
  campaigns.agent_id → ON DELETE CASCADE. The delete ACTION still blocks while a
  campaign is running/paused (rule 3) and detaches numbers at the provider first.
- StoredAgentConfig v2 = { agentType, template: TemplateKey|null, seed?:
  BusinessProfile, agentConfig }. agentConfig.systemPrompt is AUTHORITATIVE —
  templates only SEED it once; the prompt text is thereafter the source of truth.
  Moved to '@airtalk/engine/templates' (stored.ts, browser-safe) so the migrate
  script + web share it; apps/web/lib/types.ts re-exports. normalizeStoredConfig
  (throws) + normalizeStoredConfigSafe (null) reshape v1 {template,profile,
  agentConfig}→profile becomes seed, and bootstrap-era plain AgentConfig→wrapped,
  with FIXED key order so re-normalize is byte-identical.
- scripts/migrate-agent-config.ts (npm run migrate-agent-config): normalizes
  agents.config AND agent_config_versions.config (both keyed on their own `id`;
  versions.agent_id is NOT unique). Idempotent via a key-order-STABLE compare —
  Postgres jsonb canonicalizes key order, so a plain stringify compare would
  rewrite every v2 row each run; stable() sorts keys at every level → true no-op
  on re-runs. agentConfig is never touched. Nothing re-renders from profile now.
- Edit is freeform (agent-prompt-form.tsx replaces the profile form + AgentEdit-
  Form, deleted): edit name/firstMessage/systemPrompt/voice directly; Save pushes
  exactly that to the provider + appends a version (rule 4). updateAgentAction
  signature changed to {name, systemPrompt, firstMessage, voiceId}.
- The ONE path still re-rendering from seed: learning-apply (applySuggestions-
  Action) + Cal.com connect (connectCalcomAction), both now read stored.seed and
  guard on it (template-seeded agents only; freeform/scratch fall through). Phase
  11 reworks learning-merge to edit prompt text directly — merge.ts untouched
  here. jobs.ts learning cron reads stored.seed via normalizeStoredConfigSafe.
- Template registry grew 3→8 (catalog.ts holds the 5 new builders; every builder
  reuses greeting()/businessFacts()/conductRules()/TONE so the disclosure greeting
  + opt-out rule 7 are guaranteed — templates.test now 33 tests): receptionist,
  after_hours (Receptionist); booking (Appointment Booking); lead_qualifier (Lead
  Qualification); outbound_sales, win_back (Outbound Sales, custom outbound
  greeting so it isn't "thanks for calling"); support, order_status (Customer
  Support). TEMPLATE_INFO gained {category}; TEMPLATE_CATEGORIES exported. Build-
  from-scratch = scratchAgentConfig(seed, voiceId) (bare role + facts + conduct,
  template null). Generate = lib/generate-agent.ts (gpt-4o-mini, injectable fetch
  like outcome.ts, OPENAI_API_KEY optional → card hidden); generateDraftAction
  ALWAYS appends disclosure + conduct server-side via ensureDisclosureAndConduct
  before returning the draft.
- Create surface: one createAgentAction({agentType, template, seed?, agentConfig,
  redirectTo?}) funnels the modal, import, duplicate, and the signup wizard
  through a private createStoredAgent (plan gate → provider create → row →
  version 1). The modal (create-agent-modal.tsx) builds agentConfig CLIENT-side
  (buildAgentConfig/scratchAgentConfig are browser-safe): Step A type cards
  (Single Prompt; Conversational Flow disabled "coming soon" until Phase 18;
  Other options→Custom LLM, which for now creates a normal single-prompt agent
  badged custom_llm); Step B category-tabbed template grid + scratch + generate.
  Selecting + Create creates immediately and redirects to /agents/[id]. /agents/
  new is now just redirect('/agents'); signup/agent still renders AgentWizard.
- Agents list is a table (agents-table.tsx) not cards: Agent Name, Type badge,
  Voice (resolved from listVoices once/request), Phone (phone_numbers), Edited by
  (updated_by + relative time). Client-side name search. Row ⋮: Duplicate
  (createStoredAgent copy "Copy of X"), Export (client JSON download {agentType,
  template, agentConfig} — provider ids live in a column, never in config),
  Delete (confirm dialog). Top-bar Import = upload that JSON → createAgentAction.
- Acceptance verified offline: typecheck + lint (provider fence intact) + build
  clean, 124 tests pass (stored.test: normalize idempotency/v1→v2/bootstrap +
  scratch disclosure/opt-out; templates.test 33). migrate idempotency proven via
  the stable() key-order compare. Live acceptance still needs the stack stood up
  (no Supabase/OpenAI/provider env as of Phase 10): apply 0009, run
  migrate-agent-config twice, create via template/scratch/generate, duplicate +
  export + import round-trip, delete a scratch agent (provider GET → 404) and
  confirm it's blocked while a campaign is running/paused.

### Phase 11 agent builder (2026-07-13)
- Migration 0010: agent_config_versions.label (inline-editable),
  agents.share_token text UNIQUE null. RLS from 0004 already covers both
  (agents_org_rw / versions_org_rw) — no new policy. The public /share route
  reads the agent by token via serviceClient (unauthenticated visitors have no
  RLS scope) — capability access by a 32-hex random token, like /api/tools.
- VERIFIED EL fields (2026-07-13, rule 6), all cited in code:
  - first_message = conversation_config.agent.first_message. Non-empty ⇒ AI
    speaks that line; EMPTY string ⇒ user speaks first (agent waits). A
    model-GENERATED opening is NOT a first-class single-agent field — it only
    exists as workflow node `entry_behavior` (generate_immediately|wait_for_
    user|auto). So the Welcome control ships two live modes (static / user-first)
    and shows "AI improvises opening" DISABLED ("coming with Conversational
    Flow", Phase 18). Do not wire generated-first for single agents.
  - LLM: prompt.llm, default gemini-2.5-flash. MODEL_INFO (templates subpath,
    browser-safe) is a CURATED safe subset — the doc summarizer surfaced newer
    ids (qwen*, gpt-oss-*, glm-*, top gpt-5.x) that looked irregular; confirm
    against a live GET before adding. Source:
    elevenlabs.io/docs/eleven-agents/customization/llm + .../api-reference/agents/create.
  - language = agent.language. Additional languages = top-level language_presets,
    a per-language override MAP (each entry needs `overrides`), NOT a plain list
    → DEFERRED (single primary-language select only).
  - Timezone/current-time: NO config field — system dynamic vars
    system__time / system__time_utc / system__timezone. Implemented as a managed
    "## Current time" prompt section ({{system__time_utc}} + the business tz),
    set from the Handbook's timezone popover. Round-trips in the prompt (source
    of truth), needs no schema/config field.
  - Widget dynamic vars: attribute `dynamic-variables` = a JSON-object string.
    testWidgetEmbed() now returns dynamicVariablesAttr; TestWidget stays
    provider-blind (only knows "there's an attr for vars"). Test inputs persist
    per-agent in localStorage (airtalk:test-inputs:{id}) and remount the widget
    (React key on the vars) so a live call echoes them back.
  - Public toggle: platform_settings.auth.enable_auth (false = public). New
    engine.setAgentPublic(id, isPublic). Sits behind a $ref in the create schema
    — confirm on a live GET. Share ON mints token + setAgentPublic(true); OFF
    nulls the token so /share/agent/<token> 404s (provider stays public — the
    in-app test widget relies on it). No expiry v1.
  - Custom LLM: prompt.llm='custom-llm' + prompt.custom_llm {url, model_id?,
    api_key:{secret_id}}. Secrets: POST /v1/convai/secrets {type:'new',name,
    value} → {secret_id}. New engine.createSecret(). updateCustomLlmAction stores
    the key as a workspace secret and persists ONLY the secret id — the key never
    touches our DB (superseded secrets are left at the provider; prune if they
    pile up). AgentConfig gained customLlm {url, modelId?, apiKeySecretId?};
    toProviderConfig routes it. custom_llm is already enabled in the Phase 10
    modal's "Other options"; the builder swaps the prompt editor for a URL/key
    form (CustomLlmForm) and reduces the right rail.
- Freeform-first LOCKED: /agents/[id] is now the builder (agent-builder.tsx,
  keyed by current version so Save/rollback remount with fresh data). Header =
  back, inline name, "Unsaved changes", Versions (Sheet), Share, primary Save.
  Save = updateAgentAction (now also takes llm/language) = ONE updateAgent + ONE
  version row (rule 4). Metadata strip: copyable Airtalk + provider ids,
  effective $/min (includedRateCentsPerMin in billing-math, "included" vs 35¢
  overage), LLM + language chips. Right column = accordion rail; Cal.com moved
  into a "Functions" section and KB into "Knowledge Base" (same gates — nothing
  regressed). agent-prompt-form.tsx deleted (superseded).
- Managed prompt sections (templates/managed.ts, browser-safe, tested):
  get/set/removeSection edit a "## Heading" block. Learning-merge reworked to
  edit the PROMPT TEXT (applySuggestionToPrompt) via "## FAQs" (faq_addition
  appends or REPLACES a matching Q/A — applying the same FAQ twice can't
  duplicate) and "## Learned adjustments" (prompt_tweak/escalation_rule bullets,
  deduped); missing anchors append at the end; kb_gap stays dismiss-only.
  applySuggestionsAction now works for EVERY agent (no template/seed needed) —
  the last seed-re-render path is gone (connectCalcomAction still uses the
  booking template's buildAgentConfig; untouched). merge.test.ts rewritten
  (prompt-text + the twice-replaces acceptance case). applySuggestionToProfile
  removed.
- Agent Handbook (handbook.ts): 3 tabs (Personality & Tone / Accuracy & Format /
  Trust & Safety) of static toggle presets, each a bullet in a managed
  "## Handbook" section (togglePreset/isPresetOn) + the timezone popover.
- Versions Sheet: inline label edit (renameVersionAction), Restore
  (rollbackAgentAction, append-only), and a dependency-free LCS line diff
  (lib/line-diff.ts, tested) of a selected version vs current.
- Acceptance verified OFFLINE (no Supabase/EL env as of Phase 11): typecheck +
  lint (provider fence intact) + build clean; 131 tests pass (merge 6, managed 4,
  line-diff 2, billing-math incl. included-rate). LIVE acceptance still needs the
  stack: apply 0010; edit prompt→Save (one PATCH + one version) and rollback;
  open a share link in incognito + toggle off → 404; set a test input and hear it
  echoed on a live call; create/update a custom_llm agent and confirm the key
  landed in EL secrets (GET /v1/convai/secrets), not our DB; confirm
  platform_settings.auth.enable_auth path and the curated LLM ids on a live GET.

### Phase 12 agent settings + native analysis (2026-07-13)
- VERIFIED EL paths (2026-07-13, rule 6; cited in elevenlabs.ts toProviderConfig).
  All map inside conversation_config / platform_settings; PATCH deep-merges
  top-level keys, so our partial configs only touch what they carry:
  - Speech → conversation_config.tts.{stability(0-1,def .5) | similarity_boost
    (0-1,def .8) | speed(def 1)}. tts is built ONCE (voice_id + speech) so neither
    clobbers the other.
  - Transcription keywords → conversation_config.asr.keywords: string[]
    ("Keywords to boost prediction probability for").
  - Call → conversation_config.conversation.max_duration_seconds (int, def 600)
    and conversation_config.turn.silence_end_call_timeout (number sec, def -1 =
    off) — max lives under .conversation, silence under .turn (two sub-objects).
  - Data collection → platform_settings.data_collection: map keyed by identifier
    → {type, description}. Our human name slugifies to the key and reappears as
    data_collection_id in results. EL type set is string/boolean/integer/number;
    our AgentConfig subset (string/number/boolean) maps 1:1.
  - Success criteria → platform_settings.evaluation.criteria: [{id, name,
    type:'prompt', conversation_goal_prompt}] (cap 30, enforced in adapter + UI).
  - Widget public → platform_settings.auth.enable_auth = !public.
  - CAVEAT: the Create/Update-agent OpenAPI truncates the platform_settings
    request-body sub-schema; data_collection/evaluation shapes are corroborated
    by the RESULTS schema, not seen field-for-field in the request body — confirm
    on a live create/GET. (§4 of the research report.)
- MCP VERDICT: skipped. conversation_config.agent.prompt.mcp_server_ids (and
  native_mcp_server_ids) are string arrays of PRE-REGISTERED server ids
  (registered via POST /v1/convai/mcp-servers), NOT server URLs — a plain
  server-URL list doesn't map. The accordion shows a "coming soon" placeholder;
  wire a real server-registration flow later.
- AgentConfig gained speech?/transcription?/call?/analysis?/widget? (provider-
  neutral); CallEvent gained analysis? {success?, criteria?[{name,result,
  rationale}], data?, sentiment?}. Sentiment is NOT native to EL — normalizeAnalysis
  surfaces a seeded "user_sentiment" data field into the neutral sentiment slot;
  otherwise it stays undefined. calls.analysis jsonb added in 0011 (nullable; no
  db type file — @airtalk/db is untyped SupabaseClient, so no type regen needed).
- ANALYSIS PAYLOAD (verified via Get-Conversation OpenAPI = same model as the
  post_call_transcription webhook): data.analysis.{call_successful:'success'|
  'failure'|'unknown', transcript_summary, evaluation_criteria_results (map<id,
  {criteria_id,result,rationale,score?}>), data_collection_results (map<id,
  {data_collection_id,value,rationale,json_schema}>)}. normalizeAnalysis is
  defensive (never throws) so an analysis-mapping failure can't fail the webhook
  (rule 2 untouched — event_id/idempotency logic unchanged; the upsert just gained
  analysis).
- OUTCOME PRECEDENCE (lib/outcome.ts deriveOutcome, pure + tested): the gpt-4o-mini
  classifier still owns the rich label, the summary, AND opt_out detection (none
  of which EL provides). EL's verdict is *preferred* only where decisive:
  opt_out is sacred (Phase 7 compliance) and wins over EL; otherwise an EL
  'failure' overrides an optimistic classifier label → 'failed'. EL 'success'/
  'unknown' has no 1:1 map to our 8-way enum (booked vs question vs lead) so the
  classifier's finer label stands. With analysis but NO classifier (no
  OPENAI_API_KEY), an EL 'failure' alone still sets 'failed'; success/unknown
  yields nothing. No analysis at all → classifier is the sole source (Phase 3
  unchanged). Applied in BOTH classify paths (Inngest classify-call now selects
  + reads calls.analysis; inline webhook fallback), so production (Inngest-first)
  and dev (inline) agree. The webhook never pre-writes outcome, so the Inngest
  "already classified" guard still lets the job run.
- PERSISTENCE: the whole accordion rides the builder's ONE Save — updateAgentAction
  now also takes speech/transcription/call/analysis/widget and merges them into
  agents.config.agentConfig (jsonb, no schema change) → ONE updateAgent + ONE
  version row (rule 4), never per-section saves. Settings state is lifted into
  AgentBuilder; dirty compares JSON of settings vs initial.
- UI: Functions + Knowledge Base stay in the server-rendered `rail` (their own
  actions, server-fetched data); the settings half (Speech / Realtime Transcription
  / Call Settings / Post-Call Data Extraction + Success Criteria / Security /
  Webhook Settings / MCPs) is a client component (settings-rail.tsx) rendered
  right below the rail — two Accordion groups stacked in the documented handoff
  order. Radix Slider/Switch, a keyword tag-input, name/type/description rows with
  +Add. Webhook Settings links to /integrations (Phase 17). Security holds the
  widget-public toggle; ShareDialog is left as-is (still forces public on share-ON
  — the two agree at the default public=true; flipping Security off breaks the
  share link + in-app test widget, as noted to the user).
- SEEDING (item 5 honored — no mass-PATCH): NEW agents are seeded at create
  (createStoredAgent) with DEFAULT_ANALYSIS (Retell parity: "Call Summary" +
  "User Sentiment" data fields, "Call Successful" success criterion) and widget
  {public:true} (keeps the test widget working). "Call Summary" overlaps EL's
  native transcript_summary but is kept for Retell parity. EXISTING agents show
  those defaults in the builder and persist them on their NEXT save only.
  SPEECH_DEFAULTS/CALL_DEFAULTS/DEFAULT_ANALYSIS live in
  templates/settings-defaults.ts (browser-safe, shared by the create action + UI).
- Fixture: post-call-transcription.json extended with a SYNTHETIC analysis block
  (call_successful/transcript_summary + evaluation_criteria_results +
  data_collection_results) — still marked SYNTHETIC; replace with a captured live
  payload once keys exist.
- Acceptance verified OFFLINE (no Supabase/EL env as of Phase 12): typecheck +
  lint (provider fence intact) + build clean; 143 tests pass (+12: normalizeCallEvent
  analysis extraction, fetch-stubbed config-mapping round-trip = the offline analog
  of "save→GET→match", deriveOutcome precedence ×6, webhook analysis-populates +
  EL-failure-precedence + classifier-fallback; idempotency test unchanged & green).
  LIVE acceptance still needs the stack: apply 0011; save each control → GET the
  EL agent and diff the verified paths (esp. the §4-caveated data_collection /
  evaluation shapes); send a post-call webhook with analysis → calls.analysis
  populated + outcome precedence; confirm one version row per multi-section save.

### Phase 13 knowledge base + phone numbers (2026-07-13)
- 0012: kb_documents (id, org_id, provider_kb_id UNIQUE, name, source_type CHECK
  IN url/file/text, created_by email, created_at) + kb_documents_org_rw RLS
  (is_org_member — already ORs is_admin). plans.max_numbers int (starter 1,
  growth 3, pro 10 — different from max_agents' 1/3/5). phone_numbers.created_at
  added (the /numbers "Added" column; backfills now()). NO phone_numbers.provider
  column — provider is DERIVED: twilio_sid present ⇒ twilio, null ⇒ sip. That's
  also the correct release gate (only a twilio_sid can be released at Twilio).
- VERIFIED EL paths (2026-07-13, rule 6; cited in elevenlabs.ts):
  - KB create: POST /v1/convai/knowledge-base/{url|text|file}, each {..., name}
    → {id, name, folder_path}. file is multipart, field `file` + form field `name`.
  - KB attach: conversation_config.agent.prompt.knowledge_base[] =
    {type: url|file|text|folder, id, name, usage_mode?(default 'auto')}. PATCH
    REPLACES the array, so attach/detach GET the current list then resend it
    appended/filtered (attachKnowledge is idempotent — dedups by id).
  - KB delete: DELETE /v1/convai/knowledge-base/{id}?force=true deletes AND
    auto-detaches from every dependent agent (exactly "delete detaches everywhere").
  - SIP import: POST /v1/convai/phone-numbers {provider:'sip_trunk', phone_number,
    label, outbound_trunk_config:{address, transport, credentials?}, inbound_trunk_
    config?:{allowed_addresses?, credentials?}} → {phone_number_id}. NESTED, not
    flat (the CreateSIPTrunkPhoneNumberRequestV2 correction). One credential set
    reused both directions (ponytail: split if per-leg auth is ever needed).
  - Number delete: DELETE /v1/convai/phone-numbers/{id} (response is "Any type" —
    don't parse it).
- Engine: addKnowledge SPLIT into createKnowledgeDoc({name,url|text|file}) →
  {knowledgeId} + attachKnowledge(agentId, {knowledgeId,name,type}) /
  detachKnowledge(agentId, knowledgeId). attach takes the descriptor (name+type
  we already hold in kb_documents) to avoid an extra provider GET — the spec's
  bare (agentId, knowledgeId) would have forced one. removeKnowledge(knowledgeId)
  DROPPED its unused providerAgentId. New importSipNumber(cfg: SipNumberConfig)
  and deleteNumber(providerNumberId). KnowledgeSource.type widened to include
  'text'. Tests: KB routing, attach dedup/detach, SIP nested payload (13 engine).
- KB is workspace-level at EL (shared across all orgs) → the multi-tenant fence
  is kb_documents + RLS; we NEVER enumerate provider docs to a user. "Used by N
  agents" and per-agent attach state are read from the PROVIDER (listKnowledge per
  org agent, parallelized) — source of truth, no join-table drift. Agent count is
  plan-capped small; ponytail note in the page for a kb_attachments cache if it grows.
- /knowledge (app/knowledge/{page,actions}.ts + components/knowledge-table.tsx):
  plan-gated on kbEnabled (upsell card mirrors the learning page, "Growth feature").
  Table (Name, Type, Used by N, Created), "+ Add Knowledge Base" modal (Name +
  URL/File/Text tabs — Radix Tabs unmounts inactive content so FormData only
  carries the active source), row menu: Manage attachments (per-agent switches) +
  Delete (warns it detaches everywhere). createKbDocAction cleans up the provider
  doc if the kb_documents insert fails (no orphans). setKbAttachmentAction is
  shared by /knowledge AND the builder rail so both surfaces stay in sync.
- Builder rail KB section rebuilt (components/agent-kb-section.tsx): lists org
  kb_documents with a switch = attached-to-this-agent, toggling setKbAttachmentAction
  (optimistic). Creation now lives on /knowledge (old per-agent URL/file add forms
  + addKnowledgeAction/removeKnowledgeAction DELETED from agents/actions.ts).
- /numbers (app/numbers/{page,actions}.ts + components/numbers-table.tsx): table
  (Number, Assigned agent = inline native <Select> → assignNumberAction attach/
  detach, Provider badge twilio|sip, Status, Added), "+" dropdown → Buy new number
  (reuses NumberPicker, now parameterized with searchAction/buyAction/onBought/bare
  props — signup passes nothing so it's byte-identical) + Connect via SIP trunk
  (label, e164, address, transport, username/password, allowed IPs). Release confirm:
  detach → deleteNumber (EL record) → Twilio releaseNumber (SIP skips it) → row
  status='released'. Buy on /numbers arrives UNASSIGNED (multi-agent orgs assign
  via the select); signup still buys-and-attaches.
- Rule 3: numberPurchaseBlocked now caps at plans.max_numbers (was hard-coded 1);
  hasAgent made OPTIONAL (only `false` blocks — signup passes it, /numbers omits it
  since it assigns later). Active-number count excludes status='released' so a
  release frees a slot. LOCKED: NO identity-verification gate (per spec). Signup
  funnel unchanged; its number counts toward the limit (passes org.plan.maxNumbers).
- Nav: Knowledge Base + Phone Numbers inserted after Agents (canonical order),
  new BookIcon + HashIcon (PhoneIcon stays Call History).
- Acceptance verified OFFLINE (no Supabase/EL env as of Phase 13): typecheck +
  lint (provider fence intact) + build clean (/knowledge + /numbers routes emit);
  151 tests, 147 pass / 4 skip live-only (+ new: 3 engine KB/SIP, kb_documents RLS
  isolation, numberPurchaseBlocked cap). LIVE acceptance still needs the stack:
  apply 0012; org B can't see org A's KB docs (rls.test kb case); attach/detach
  from /knowledge ⇄ builder reflects both ways; delete detaches everywhere; buy →
  assign → release round-trip (Twilio test creds); SIP import creates a working EL
  number record; per-plan number cap enforced server-side.

### Phase 14 call history + contacts (2026-07-13)
- 0013: contacts (id, org_id, e164, first_name, last_name, external_id, notes,
  dnc bool default false, created_at, UNIQUE(org_id, e164)) + contacts_org_rw RLS
  (is_org_member, already ORs is_admin) + calls.contact_id uuid null FK ON DELETE
  SET NULL (keep call history if a contact is deleted, mirror of the agent-delete
  rule). Migration number is 0013 (Phase 13 took 0012).
- COUNTERPARTY RULE (the number a contact keys on): externalNumber() from
  lib/opt-out.ts — from_e164 on inbound, to_e164 on outbound (the customer side,
  never our agent's number). Reused verbatim by contact linking so opt-out and
  contacts agree on "who".
- AUTO-LINK: only the post-call webhook carries from/to, so it does the real work
  — upsertContact(db, orgId, e164) (lib/contacts.ts, insert on conflict do nothing
  → select id, idempotent) BEFORE the calls upsert, then contact_id is inlined
  into that one upsert (no second update; smaller diff). The reconcile INSERT path
  has NO phone number (ProviderCall/listCalls carry none — same ceiling as Phase 7
  booking_ref), so reconcile can't link the rows it just inserted; instead it runs
  backfillOrgContacts(db, orgId) per affected org after recompute_usage — the same
  idempotent helper the script uses — so any call a real webhook has since filled
  in gets linked (self-heal), best-effort (never fails reconcile). ceiling noted:
  a reconcile-inserted row with no webhook ever stays unlinked (no e164 to key on).
- DNC-MIRROR DECISION: recordOptOut (the single choke point for both the Inngest
  classify path AND the inline webhook fallback) now also does
  contacts.update({dnc:true}) on (org_id, e164) after the opt_outs upsert. opt_outs
  stays the ONLY campaign enforcement source (the runner scrubs opt_outs, never
  contacts); contacts.dnc is DISPLAY-ONLY (a badge on /contacts + the drawer). A
  missing contact row just means nothing to flag — the update no-ops.
- backfill-contacts (npm run): scripts/backfill-contacts.ts → backfillOrgContacts
  over ALL orgs. Pages calls where contact_id is null AND a number exists (rows
  without a number, i.e. reconcile inserts, are skipped and stop the page loop so
  it can't spin). Idempotent: only touches contact_id-null rows + upsertContact
  dedups → run twice, second run links 0. ponytail: two queries per call; batch
  by (org,number) only if a millions-row backfill ever gets slow.
- CALL HISTORY: call-filters.ts extended IN PLACE (single source — table + CSV
  inherit) with search (free-text number → q.or(from_e164/to_e164 ilike); value
  stripped to [\d+] so it can't inject into PostgREST or() syntax and E.164 rows
  match cleanly) + formatCents (rule 5: null → em-dash, never estimated). /calls
  gained a Cost column (cost_cents) + date presets (Today/7d/30d, pure server-side
  <Link>s computing from/to, no client) + the search box; export/route.ts added the
  raw cost_cents column.
- DRAWER: ?call=<id> on /calls server-fetches the detail (fetchCallDetail in
  lib/call-detail-data.ts) and renders CallDrawer (a Sheet); rows are a client
  CallsTable that router.push(?call=…, {scroll:false}) merging current filters, so
  the drawer deep-links and preserves table state. /calls/[id] renders the SAME
  shared CallDetail component for direct links (rewritten off fetchCallDetail).
- CallDetail (client, components/call-detail.tsx): header (colored outcome pill
  via OUTCOME_COLORS, agent, direction, from→to, started, duration, cost) + Summary
  + Conversation analysis (calls.analysis criteria pass/fail chips + rationale +
  sentiment) + inline Contact panel (item 6, edits via updateContactAction) + Tabs.
  ponytail: CallPlayer bundles audio + click-to-seek transcript, so it IS the
  Transcription tab (default) rather than a duplicate audio element above.
- LOGS TAB SOURCE: webhook_events (which is org-less + service-role-only under RLS,
  and has NO type/created_at columns — only event_id/payload/processed_at). Read
  with serviceClient scoped to THIS call's conversation_id via
  .eq('payload->data->>conversation_id', providerCallId) — safe because the
  RLS-scoped calls fetch already proved ownership. Timeline = {type =
  event_id.split(':')[0], at = processed_at}; ZERO matching rows ⇒ "backfilled by
  nightly reconciliation" note (a reconcile insert has no webhook). Data tab =
  analysis.data extraction values + campaign_contacts.vars (joined by
  provider_call_id) for outbound.
- CONTACTS: /contacts (app/contacts/{page,actions}.ts + components/contacts-table.tsx).
  Table (Phone, First/Last, Contact ID=external_id, Calls count via calls(count)
  embed, DNC badge), client-side search (loads ≤1000, ponytail: server-side search
  when a tenant outgrows that), CSV import dialog (papaparse client-side like the
  campaign wizard; merge upsert on (org_id,e164) that OMITS dnc from the payload so
  an existing opt-out is never cleared, names/external_id/notes updated), row →
  detail Sheet (editable fields + related-calls list linking to /calls?call=<id>).
  CRM-sync banner links /integrations (Phase 17). updateContactAction is shared by
  the contacts panel AND the call drawer's Contact panel. Nav: Contacts inserted
  after Call History (canonical order), new UsersIcon.
- Acceptance verified OFFLINE (no Supabase/EL env as of Phase 14): typecheck + lint
  (provider fence intact) + build clean (/calls, /calls/[id], /contacts emit); 154
  tests, 148 pass / 6 skip live-only (+ webhook contact create+link+no-dup-on-replay,
  opt-out→dnc mirror, contacts RLS isolation case). LIVE acceptance still needs the
  stack: apply 0013; fixture webhook creates+links a contact & replay doesn't
  duplicate; backfill-contacts twice = same counts; opt-out flips contacts.dnc;
  org B can't see org A's contacts (rls.test); drawer deep-link (?call=) opens
  directly; CSV export columns match the new filters exactly.

### Phase 15 analytics + billing tabs (2026-07-13)
- PURE UI/reporting phase — NO schema change (0001–0013 unchanged, provider fence
  untouched, no migration). Everything reads existing columns. "Phase 14's column"
  the spec flagged for cost views = it just needed Phase 14 MERGED (it is); cost is
  DERIVED (calls.duration_secs + usage_periods), so no new column was required.
- Money/derivation helpers live beside billing-math in lib/analytics-math.ts (pure,
  reuses billing-math's OVERAGE_CENTS_PER_MIN + includedRateCentsPerMin — one money
  source), 14 vitest cases (analytics-math.test.ts):
  - SUCCESS-RATE derivation (isCallSuccess/successRate): ElevenLabs native verdict
    (calls.analysis.success, Phase 12) WINS when present, else the outcome heuristic
    (booked | lead_captured | question_answered = success). Unclassifiable calls (no
    verdict AND no outcome) are EXCLUDED from the denominator → rate null → card "—".
    Single definition; both the card and any future consumer route through it.
  - GRANULARITY bucketing: chooseGranularity(from,to) = day when ≤31 days else week;
    bucketKey(date, gran) = the UTC day or the Monday of its UTC week; buildBuckets
    walks ONE DAY at a time and dedupes by bucketKey (stepping by 7 from a non-Monday
    start could skip a week's Monday near the range end — the bug the test caught),
    guard-capped so a reversed/absurd range can't spin.
  - EST. COST (analytics card, estimatedCostCents): minutes × includedRate + whole
    period overage × 35¢. COARSE BY DESIGN and labelled "estimated — not billing
    truth" (rule 5): overage is the whole-period figure from usage_periods, added
    ONLY when the selected range reaches into the current UTC month, so a call can be
    double-counted at the edge — fine for an estimate, never an invoice.
  - USAGE-TAB totals (usagePeriodTotals): includedUsed = min(used, cap); overage
    minutes; billedSoFar = floor(overage_REPORTED) × 35¢ (only what reconciliation
    has sent Stripe = the rule-5 truth); estTotal = plan base price + floor(overage)
    × 35¢. Acceptance 900/750 → 150 overage ≈ $52.50 covered.
- ANALYTICS (/analytics, force-dynamic): one BOUNDED, RLS-scoped fetch (ROW_CAP
  20k) then JS aggregation in the RSC — the fetchRecentCalls pattern, only the small
  aggregated arrays cross to the client charts (no unbounded client pull). ceiling
  noted in code: move to a SQL view/RPC when volume bites. Controls row mirrors
  /calls: presets (7/30/90d) + native <input type=date> custom range + Agent /
  Direction / Breakdown (by agent | by outcome | by day-of-week) selects, reusing
  applyCallFilters/parseCallFilters (search field stripped; default range = trailing
  30 days). 6 metric cards (Calls, Total minutes, Avg duration, Answer rate, Success
  rate, Est. cost). 4 charts in AnalyticsCharts (client): Calls-per-bucket line,
  Minutes-per-bucket bars, Outcomes stacked bars (the generalized dashboard chart,
  now over day/week buckets not hardcoded weeks), Breakdown horizontal bars (recharts
  Cell per row: OUTCOME_COLORS for by-outcome, brand otherwise).
- CHART THEME shared: lib/chart-theme.ts useChartTheme() extracted from
  dashboard-charts (grid/axis/tooltip/brand for light+dark, mounted-guarded); BOTH
  dashboard-charts AND analytics-charts consume it now = the "generalize" ask. Series
  hues are the Phase-3 CVD-validated OUTCOME_COLORS + the brand token — NO new palette
  introduced, so no re-check needed (dark legibility rides the existing validation).
- BILLING (/billing → tabs): URL-driven (?tab=plan|history|usage, default plan) —
  TabBar is styled <Link>s (Tabs-primitive look) and the server renders ONLY the
  active tab, so History's Stripe call fires only when that tab is open (no
  over-fetch). Owner gating = the existing role check.
  - Plan tab: the prior plan picker + portal, moved verbatim.
  - History tab (owner-only): lib/billing.listInvoices (Stripe stays isolated in
    lib/billing) → stripe.invoices.list, mapped to a neutral InvoiceRow {id, created,
    amountCents=total, currency, status, hostedUrl}. STRIPE PAGINATION = cursor via
    starting_after (page size 12); page.has_more drives the "Load more" button. First
    page server-rendered; BillingInvoices (client) appends subsequent pages through
    loadInvoicesAction(lastId) (server action, re-checks owner). Dates rendered as
    UTC ISO slice (no toLocale) so SSR/client agree (no hydration drift). Empty state
    pre-subscription (no stripe_customer_id → listInvoices returns [] without calling
    Stripe); try/catch → friendly line if Stripe is misconfigured. Details → hosted
    invoice URL in a new tab; status Badge (paid=live, open=warn, void/uncollectible
    =destructive).
  - Usage tab: period picker = GET form over distinct usage_periods rows (monthLabel
    formatted UTC), default latest. 3 cards from usagePeriodTotals (member-readable
    via usage_org_read RLS). Minutes/day chart = BillingUsageChart (client) with a
    Day/Week toggle that re-buckets CLIENT-SIDE via the shared bucketKey (pure, no
    refetch). "Change payment methods" → existing portalAction (owner).
- DESCOPED (per spec, logged): custom dashboards / "Add chart" (analytics); "Cost by
  provider" (single provider today) — revisit when a second provider lands.
- Nav: Analytics inserted after Campaigns (canonical order), new ChartIcon.
- Acceptance verified OFFLINE (no Supabase/Stripe env as of Phase 15): typecheck +
  lint (provider fence intact) + build clean (/analytics + /billing routes emit); 162
  tests pass / 6 live-skip (+14 analytics-math: success derivation, granularity/
  bucketing incl. the skipped-week regression, est-cost, usage totals). LIVE
  acceptance still needs the stack: Usage-tab numbers vs usage_periods for the seeded
  org; invoice list against the stripe-acceptance test-clock data + links open the
  hosted invoices; filters compose under RLS with no cross-org leakage (org B);
  dark-mode chart legibility (the palette is the Phase-3-validated set).

### Phase 16 QA + simulation testing (2026-07-13)
- 0014: plans.qa_enabled boolean (default false; growth+pro → true, starter false —
  the choice: QA reporting is a paid feature like KB/adaptive, and it needs enough
  call volume to be meaningful, which starter won't have) + agent_test_cases (id,
  org_id, agent_id, name, user_prompt, success_criteria, last_result jsonb,
  updated_by, updated_at, created_at) with agent_id ON DELETE CASCADE (a test case is
  meaningless without its agent, like campaigns/agent_suggestions) + agent_test_cases
  _org_rw RLS (is_org_member, already ORs is_admin — no admin clause). qaEnabled
  threaded through all four org.ts spots (interface + MEMBER_ORG_SELECT + dev-bypass +
  admin + normal return), the established add-a-plan-flag chore.
- GATING (item 1): /qa gated on org.plan.qaEnabled → Starter sees the upsell card
  (mirrors /knowledge, "Growth feature", new QaIcon). Detailed Calls tab is
  ADDITIONALLY pro-only — gated on org.plan.id==='pro' (clearest signal; the Top
  Questions feed is also pro-fed, see below). A non-pro who forces ?tab=calls gets an
  inline Pro upsell, and the tab itself is hidden for non-pro. LOGGED: I used plan.id
  ==='pro' rather than reusing adaptiveEnabled so the two gates stay independent.
- DERIVATIONS (lib/qa-math.ts, pure + tested — rule-7 spirit, these numbers reach
  customer conversations; 19 vitest cases). Definitions:
  - analysed = calls with analysis OR an outcome (task's own definition; every seeded
    call qualifies via outcome).
  - successRate = share of CRITERIA-EVALUATED calls where EVERY success criterion
    passed (result == 'success', case-insensitive). Calls with no criteria are
    excluded from the denominator → null → card "—". (Distinct from analytics'
    successRate, which is the EL-verdict/outcome heuristic; QA follows the spec's
    "criteria all passed" wording.)
  - resolutionRate / escalationRate: over calls WITH an outcome. resolution = not in
    {escalated, failed}; escalation = outcome 'escalated' (our analog of Retell's
    transfer metric).
  - avgSentiment: sentiment label → score (positive +1 / neutral 0 / negative −1),
    averaged over calls where sentiment is present; unrecognised labels skipped. Card
    shows Positive/Neutral/Negative bands, "—" when none present.
  - successTrend REUSES analytics-math bucketKey/buildBuckets/chooseGranularity so /qa
    and /analytics split a date range identically (no second bucketing impl).
  - topQuestions aggregates agent_suggestions faq_addition rows by question (case-
    insensitive), count = model frequency ?? evidence length, ranked desc.
- /qa (force-dynamic): 3 tabs via ?tab= (server-rendered, only the active tab's data
  fetched), Link-based tab bar preserving the shared agent + date filters (native
  <form method=get>, trailing-30-day default — the analytics controls pattern). One
  bounded RLS-scoped fetch (ROW_CAP 20k) + JS aggregation. Overview = 5 stat cards
  (Calls analysed / Success / Resolution / Escalation / Avg sentiment) + success-rate
  trend line (QaSuccessTrend, reuses useChartTheme). Top Questions = table with
  evidence links into /calls?call=<id>; empty state points non-adaptive plans at Pro
  (that weekly extraction IS the feed). Detailed Calls (pro) = analysed calls with
  per-criteria pass/fail Badges + rationale Popover + sentiment, each row deep-links
  into the call drawer (/calls?call=<id>). Reuses applyCallFilters/parseCallFilters.
- "Configure QA settings" (item 5) → /agents/{selected-or-first agent}?section=
  extraction. settings-rail.tsx reads useSearchParams(); section=extraction opens the
  Post-Call Data Extraction accordion (defaultValue) + scrolls to it (id anchor). No
  duplicate editor — the criteria CONFIG stays the single source in the builder.
- SIMULATE-ENDPOINT VERDICT (item 6, rule 6): endpoint is POST /v1/convai/agents/
  {id}/simulate-conversation (verified 2026-07-13). It is DEPRECATED — EL points to
  /v1/convai/agent-testing/create + /v1/convai/agents/{id}/run-tests (a two-step
  test-suite API) — but still functional and the single-call fit for our ad-hoc
  {persona, criteria} → {verdict, transcript}. SHIPPED ENABLED (deprecated ≠
  unavailable); upgrade to the agent-testing flow if EL removes it. The Fern docs
  truncate the nested request/response schema over fetch, so the mapping is from the
  confirmed top-level fields + prior knowledge: body {simulation_specification:
  {simulated_user_config:{prompt:{prompt: userPrompt}}}, extra_evaluation_criteria?:
  [{id,name,type:'prompt',conversation_goal_prompt}] (same PromptEvaluationCriteria
  as platform_settings.evaluation.criteria), new_turns_limit default 10000}; response
  {simulated_conversation:[{role,message}], analysis:{call_successful,
  evaluation_criteria_results, transcript_summary}} — analysis is the SAME post-call
  model, so simulateConversation reuses normalizeAnalysis(). VoiceEngine gained
  simulateConversation(providerAgentId, {userPrompt, criteria?}) → {passed, transcript,
  criteria?, summary?}. UNTESTED LIVE (no EL key, like every prior phase) — confirm
  the nested request shape against a live create/GET when keys exist.
- SIMULATION UI: the builder has NO tab system (two-column editor + right rail), so
  "Simulation" ships as a full-width section BELOW the editor (a new `simulation`
  ReactNode prop on AgentBuilder, rendered like `rail`), not a literal tab — logged
  as the faithful fit for the section-based builder. Test cases are fetched server-
  side (survive the key={version} remount) and passed to SimulationPanel (client):
  test-case table, "+ Test Case" dialog (name / simulated user / success criteria),
  Run per row → runSimulationAction, a result dialog showing pass/fail + transcript.
  Run is disabled (with a notice) only when the agent has no provider_agent_id yet.
  runSimulationAction writes {passed, transcript, summary?, criteria?, ranAt} to
  last_result and appends NO version row (a simulation never mutates config, rule 4).
  No batch testing v1 (Retell's Batch Testing History out, per spec).
- SEEDS (gating seeds + demo data): seed-calls now carries a deterministic analysis
  block per non-failed call (a "Resolved" success criterion + a mapped sentiment) so
  /qa AND /analytics have real success/sentiment data (failed calls → analysis null,
  realistic). seed-learning UNCHANGED (its calls feed Top Questions via the Phase 8
  learning cron, which is pro + OPENAI_API_KEY gated and model-generated — not
  deterministic seed data). Hand-computed over seed-calls (20) + seed-learning (12) =
  32 rows: analysed 32, resolution 24/32, escalation 5/32, successRate 13/18 (13 good
  outcomes pass of 18 criteria-evaluated seed-calls rows; seed-learning has no
  analysis → excluded), avgSentiment 10/18. qa-math.test.ts mirrors both seeds
  verbatim and asserts exactly these (acceptance #1).
- Nav: QA inserted after Analytics (canonical order), new QaIcon.
- Acceptance verified OFFLINE (no Supabase/EL env as of Phase 16): typecheck + lint
  (provider fence intact) + build clean (/qa route emits, 4.76 kB); 183 tests pass / 7
  live-skip (+19 qa-math derivations incl. the seed-mirror; +2 engine simulate payload/
  response mapping; +1 agent_test_cases RLS isolation, live-skip). LIVE acceptance
  still needs the stack: apply 0014; run seed-calls + seed-learning and confirm the /qa
  Overview cards match the hand-computed numbers above; a gated (starter) org sees the
  upsell and a pro org sees Detailed Calls + Top Questions (after the learning cron
  runs); a simulation Run round-trips against a real EL agent (confirm the nested
  request shape on a live call) or is cleanly disabled; the "Configure QA settings"
  deep-link opens the extraction section.
