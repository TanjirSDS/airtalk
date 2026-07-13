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
