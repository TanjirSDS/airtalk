-- Phase 17: alerting (/alerts) + outbound integrations (/integrations).

-- Alerts: member-managed threshold rules the 15-minute evaluator checks.
-- last_state / last_fired_at carry the crossing state so we fire once per
-- below→above edge (the Phase 4 usage "fires once" philosophy) and honor cooldown.
create table alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  metric text not null check (metric in ('failure_rate', 'call_count', 'usage_pct', 'est_cost_cents', 'provider_down')),
  operator text not null check (operator in ('gt', 'gte', 'lt', 'lte')),
  threshold numeric not null,
  window_mins int not null default 60,
  agent_id uuid references agents(id) on delete cascade, -- null = all agents in the org
  channels jsonb not null default '{}'::jsonb,           -- { emails: text[], endpointIds: uuid[] }
  enabled boolean not null default true,
  cooldown_mins int not null default 60,
  last_state boolean not null default false, -- was the condition met at the previous eval
  last_fired_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index alerts_org_idx on alerts (org_id);

alter table alerts enable row level security;
-- is_org_member() already ORs is_admin() (Phase 6), so admins manage every org.
create policy alerts_org_rw on alerts for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Alert fires: one row per crossing. Rows come from the evaluator (service role).
create table alert_events (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references alerts(id) on delete cascade,
  fired_at timestamptz not null default now(),
  value numeric,
  payload jsonb -- { metric, operator, threshold, windowMins, notifiedVia: text[] }
);
create index alert_events_alert_idx on alert_events (alert_id, fired_at desc);

alter table alert_events enable row level security;
-- read-only for members via the parent alert's org; writes are service-role only.
create policy alert_events_read on alert_events for select to authenticated
  using (exists (select 1 from alerts a where a.id = alert_id and is_org_member(a.org_id)));

-- Outbound webhook endpoints (we are now the producer side of rule 2).
create table webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  url text not null,
  secret text not null,                      -- HMAC signing key; reveal-once in the UI
  events jsonb not null default '[]'::jsonb, -- ['call.completed', 'alert.fired']
  enabled boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);
create index webhook_endpoints_org_idx on webhook_endpoints (org_id);

alter table webhook_endpoints enable row level security;
create policy webhook_endpoints_org_rw on webhook_endpoints for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Delivery attempts. UNIQUE(endpoint_id, event_key) makes each event deliver at
-- most once per endpoint — mirrors webhook_events idempotency (rule 2), so a
-- webhook + reconcile double-emit for the same provider_call_id can't double-send.
create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event_type text not null,
  event_key text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'ok', 'failed', 'dead')),
  attempts int not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  unique (endpoint_id, event_key)
);
create index webhook_deliveries_endpoint_idx on webhook_deliveries (endpoint_id, created_at desc);

alter table webhook_deliveries enable row level security;
-- read-only for members via the parent endpoint's org; writes are service-role only.
create policy webhook_deliveries_read on webhook_deliveries for select to authenticated
  using (exists (select 1 from webhook_endpoints e where e.id = endpoint_id and is_org_member(e.org_id)));

-- CRM waitlist (cheapest thing per spec — a per-org interest list, no new table).
-- The "Register interest" button on /integrations appends 'hubspot'/'salesforce'.
alter table orgs add column integration_interest jsonb not null default '[]'::jsonb;
