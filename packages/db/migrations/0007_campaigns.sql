-- Phase 7: outbound campaigns with guardrails, a permanent per-org do-not-call
-- list, and Cal.com booking refs on calls.

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  agent_id uuid not null references agents(id),
  name text not null,
  status text not null default 'draft'
    check (status in ('draft', 'running', 'paused', 'done', 'killed')),
  -- {"startHour": 9, "endHour": 20}, recipient-local. The runner additionally
  -- clamps to the legal 8am-9pm window whatever this says (rule 3).
  calling_window jsonb not null default '{"startHour": 8, "endHour": 21}',
  spend_cap_cents int not null check (spend_cap_cents > 0),
  -- Rule 3 + TCPA: a campaign cannot be created without the uploader attesting
  -- they have consent to call the list. Who + when, kept forever.
  consent_attested_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index campaigns_org_idx on campaigns (org_id);

create table campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  e164 text not null,
  vars jsonb,
  -- Set at dial time; the post-call webhook uses it to link call_id + flip status.
  provider_call_id text,
  call_id uuid references calls(id),
  status text not null default 'pending'
    check (status in ('pending', 'calling', 'done', 'failed', 'opted_out')),
  unique (campaign_id, e164)
);
create index campaign_contacts_status_idx on campaign_contacts (campaign_id, status);
create index campaign_contacts_provider_call_idx on campaign_contacts (provider_call_id);

-- Permanent do-not-call list. Scrubbed at upload AND at dial time, so a number
-- opted out mid-campaign is never dialed by any current or future campaign.
create table opt_outs (
  org_id uuid not null references orgs(id) on delete cascade,
  e164 text not null,
  source text not null, -- 'call' (transcript request) | 'csv' | 'manual'
  created_at timestamptz not null default now(),
  primary key (org_id, e164)
);

-- 'opt_out' joins the outcome enum (0003 created the inline constraint).
alter table calls drop constraint calls_outcome_check;
alter table calls add constraint calls_outcome_check check (outcome in
  ('booked', 'lead_captured', 'question_answered', 'escalated', 'voicemail',
   'spam', 'failed', 'opt_out'));

-- Cal.com booking made mid-call by the agent tool. The calls row does not
-- exist until the post-call webhook, so the tool endpoint parks the ref here
-- and the webhook copies it onto the call row it creates.
alter table calls add column booking_ref text;
create table call_bookings (
  provider_call_id text primary key,
  booking_ref text not null,
  org_id uuid references orgs(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Per-org Cal.com credentials for the booking tool (owner-entered).
alter table orgs
  add column calcom_api_key text,
  add column calcom_event_type_id int;

-- RLS ------------------------------------------------------------------------

alter table campaigns enable row level security;
create policy campaigns_org_rw on campaigns for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

alter table campaign_contacts enable row level security;
create policy campaign_contacts_org_rw on campaign_contacts for all to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and is_org_member(c.org_id)))
  with check (exists (select 1 from campaigns c where c.id = campaign_id and is_org_member(c.org_id)));

alter table opt_outs enable row level security;
-- Members read (wizard scrub preview) and insert (manual/CSV opt-outs), but
-- never delete or update: the do-not-call list only grows from the app side.
create policy opt_outs_org_read on opt_outs for select to authenticated
  using (is_org_member(org_id));
create policy opt_outs_org_insert on opt_outs for insert to authenticated
  with check (is_org_member(org_id));

-- call_bookings: RLS on, zero policies — tool endpoint + webhook are service role.
alter table call_bookings enable row level security;
