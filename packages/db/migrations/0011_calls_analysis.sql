-- Phase 12: ElevenLabs-native post-call analysis on calls.
-- normalizeCallEvent now emits a provider-neutral analysis block
-- ({success?, criteria?, data?, sentiment?}) mapped from the post-call webhook.
-- Nullable: old calls and analysis-less payloads keep it null, and the
-- gpt-4o-mini classifier stays the outcome fallback (lib/outcome.ts deriveOutcome).
alter table calls add column analysis jsonb;
