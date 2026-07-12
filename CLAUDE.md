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
