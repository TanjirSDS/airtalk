-- Phase 1: single tenant, no RLS yet. org_id + RLS arrive in Phase 4.
-- Run against Supabase: paste into SQL editor or `supabase db push`.

create table agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null default 'elevenlabs',
  provider_agent_id text,
  config jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table phone_numbers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id),
  e164 text unique not null,
  twilio_sid text,
  provider_number_id text,
  status text not null default 'active'
);

create table calls (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id),
  provider_call_id text unique not null,
  direction text,
  from_e164 text,
  to_e164 text,
  started_at timestamptz,
  duration_secs int,
  transcript jsonb,
  recording_url text,
  status text,
  cost_cents int
);

-- Rule 2: every webhook lands here first; UNIQUE event_id makes replays no-ops.
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text unique not null,
  payload jsonb not null,
  processed_at timestamptz
);
