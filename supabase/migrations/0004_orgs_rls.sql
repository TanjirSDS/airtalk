-- Phase 4: real tenants. plans + orgs + members, org_id on tenant tables, RLS,
-- usage_periods with atomic increment (rule: SQL function, not read-modify-write).
-- Service role (webhooks, cron, scripts) has BYPASSRLS in Supabase; members only
-- ever see their own org's rows.

create table plans (
  id text primary key,
  name text not null,
  price_cents int not null,
  included_minutes int not null,
  max_agents int not null,
  kb_enabled boolean not null default false,
  adaptive_enabled boolean not null default false
);

insert into plans (id, name, price_cents, included_minutes, max_agents, kb_enabled, adaptive_enabled) values
  ('starter', 'Starter',  499,  750, 1, false, false),
  ('growth',  'Growth',   999, 1500, 3, true,  false),
  ('pro',     'Pro',     1499, 2500, 5, true,  true);

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan_id text not null references plans(id) default 'starter',
  stripe_customer_id text,
  -- Effective monthly cap; seeded from plans.included_minutes, overridable per org.
  minutes_cap int not null,
  overage_policy text not null default 'pause' check (overage_policy in ('pause', 'overage')),
  created_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  primary key (org_id, user_id)
);

alter table agents add column org_id uuid references orgs(id);
alter table phone_numbers add column org_id uuid references orgs(id);
alter table calls add column org_id uuid references orgs(id);
-- webhook_events stays org-less: events arrive before we know the tenant; the
-- writes derived from them (calls) carry org_id, resolved via the agent.

create index agents_org_idx on agents (org_id);
create index calls_org_started_idx on calls (org_id, started_at desc);

create table usage_periods (
  org_id uuid not null references orgs(id) on delete cascade,
  period_start date not null, -- first day of the UTC month
  minutes_used numeric not null default 0,
  minutes_cap int not null,   -- snapshot of orgs.minutes_cap at first write
  overage_minutes numeric not null default 0,
  primary key (org_id, period_start)
);

-- Atomic per-call increment: one INSERT ... ON CONFLICT, so concurrent webhooks
-- can't lose updates. Returns prev/new so the caller can detect threshold
-- crossings (80% warn, 100% enforce) without a second read.
create function record_call_usage(p_org_id uuid, p_secs numeric)
returns table (prev_minutes numeric, new_minutes numeric, cap_minutes int)
language sql as $$
  insert into usage_periods (org_id, period_start, minutes_used, minutes_cap, overage_minutes)
  select p_org_id, (date_trunc('month', now() at time zone 'utc'))::date, p_secs / 60.0,
         o.minutes_cap, greatest(p_secs / 60.0 - o.minutes_cap, 0)
  from orgs o where o.id = p_org_id
  on conflict (org_id, period_start) do update set
    minutes_used = usage_periods.minutes_used + excluded.minutes_used,
    overage_minutes = greatest(
      usage_periods.minutes_used + excluded.minutes_used - usage_periods.minutes_cap, 0)
  returning minutes_used - p_secs / 60.0, minutes_used, minutes_cap;
$$;

-- Nightly reconciliation rewrites the period from the calls table (rule 5:
-- billing truth comes from reconciliation, not webhook increments).
create function recompute_usage(p_org_id uuid, p_period date)
returns void language plpgsql as $$
declare v numeric;
begin
  select coalesce(sum(duration_secs)::numeric / 60.0, 0) into v
  from calls
  where org_id = p_org_id and started_at >= p_period
    and started_at < p_period + interval '1 month';
  insert into usage_periods (org_id, period_start, minutes_used, minutes_cap, overage_minutes)
  select p_org_id, p_period, v, o.minutes_cap, greatest(v - o.minutes_cap, 0)
  from orgs o where o.id = p_org_id
  on conflict (org_id, period_start) do update set
    minutes_used = excluded.minutes_used,
    overage_minutes = greatest(excluded.minutes_used - usage_periods.minutes_cap, 0);
end $$;

-- Usage writes are service-role only; members must not be able to spoof usage.
revoke execute on function record_call_usage(uuid, numeric) from public, anon, authenticated;
revoke execute on function recompute_usage(uuid, date) from public, anon, authenticated;

-- RLS ---------------------------------------------------------------------

-- security definer so policies can check membership without recursing into
-- org_members' own RLS.
create function is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid());
$$;

alter table plans enable row level security;
create policy plans_read on plans for select to authenticated using (true);

alter table orgs enable row level security;
create policy orgs_member_read on orgs for select to authenticated using (is_org_member(id));

alter table org_members enable row level security;
create policy own_memberships on org_members for select to authenticated using (user_id = auth.uid());
-- membership management is service-role/admin-script only for now

alter table agents enable row level security;
create policy agents_org_rw on agents for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

alter table phone_numbers enable row level security;
create policy phone_numbers_org_rw on phone_numbers for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

alter table calls enable row level security;
create policy calls_org_rw on calls for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

alter table agent_config_versions enable row level security;
create policy versions_org_rw on agent_config_versions for all to authenticated
  using (exists (select 1 from agents a where a.id = agent_id and is_org_member(a.org_id)))
  with check (exists (select 1 from agents a where a.id = agent_id and is_org_member(a.org_id)));

alter table usage_periods enable row level security;
create policy usage_org_read on usage_periods for select to authenticated using (is_org_member(org_id));

-- webhook_events: RLS on, zero policies — service role only.
alter table webhook_events enable row level security;
