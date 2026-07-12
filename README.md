# Airtalk

Thin control plane over ElevenLabs Agents for small-business AI voice agents. See `CLAUDE.md` for architecture rules and `airtalk-build-plan.md` for the roadmap.

## Layout

- `apps/web` — Next.js 15 (health check + ElevenLabs webhook; UI from Phase 2)
- `packages/engine` — `VoiceEngine` interface + `ElevenLabsEngine` adapter (the only place provider APIs are touched)
- `packages/db` — Supabase client, zod-validated env, SQL migrations
- `scripts/` — `bootstrap.ts` (agent + number, prints live phone number), `outbound-test.ts`

## Setup

1. `npm install`
2. `cp .env.example .env.local` and fill in real keys (ElevenLabs, Twilio, Supabase).
3. Run `packages/db/migrations/0001_init.sql` in the Supabase SQL editor.
4. `npm run bootstrap` → prints a live phone number to call.
5. In the ElevenLabs dashboard, point the post-call webhook at `https://<your-vercel-app>/api/webhooks/elevenlabs` and set `ELEVENLABS_WEBHOOK_SECRET`.
6. `npm run outbound-test -- +1XXXXXXXXXX` rings your phone.

## Checks

- `npm test` — vitest (webhook HMAC, payload normalization, idempotency)
- `npm run typecheck`
