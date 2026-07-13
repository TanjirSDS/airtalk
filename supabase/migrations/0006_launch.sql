-- Phase 6: launch. Platform admins (support), manual usage credits with an
-- audit trail, and provider status rows behind the incident banner.

-- Platform admins (support staff). Seeded via `npm run seed-admin -- email`.
create table admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table admin_users enable row level security;
-- A user may read their own admin bit (drives /admin gating + impersonation).
create policy own_admin_row on admin_users for select to authenticated
  using (user_id = auth.uid());
-- inserts: service role only (seed-admin script)

create function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users where user_id = auth.uid());
$$;

-- Support impersonation: admins pass every org-membership policy, so "view as
-- org" renders the real pages through the same RLS path members use.
create or replace function is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid())
      or is_admin();
$$;

-- Manual usage credits: minutes_delta is added to the period's minutes_used
-- (negative = credit). Kept as rows (not an update to usage_periods) so the
-- nightly recompute can't wipe a credit and every adjustment carries its note.
create table usage_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  period_start date not null,
  minutes_delta numeric not null,
  note text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index usage_adjustments_period_idx on usage_adjustments (org_id, period_start);
alter table usage_adjustments enable row level security;
create policy adjustments_org_read on usage_adjustments for select to authenticated
  using (is_org_member(org_id));
-- writes: service role only (admin server action)

-- recompute_usage (rule 5) now folds adjustments into the period total.
create or replace function recompute_usage(p_org_id uuid, p_period date)
returns void language plpgsql as $$
declare v numeric;
begin
  select coalesce(sum(duration_secs)::numeric / 60.0, 0) into v
  from calls
  where org_id = p_org_id and started_at >= p_period
    and started_at < p_period + interval '1 month';
  v := greatest(v + coalesce((
        select sum(minutes_delta) from usage_adjustments
        where org_id = p_org_id and period_start = p_period), 0), 0);
  insert into usage_periods (org_id, period_start, minutes_used, minutes_cap, overage_minutes)
  select p_org_id, p_period, v, o.minutes_cap, greatest(v - o.minutes_cap, 0)
  from orgs o where o.id = p_org_id
  on conflict (org_id, period_start) do update set
    minutes_used = excluded.minutes_used,
    overage_minutes = greatest(excluded.minutes_used - usage_periods.minutes_cap, 0);
end $$;

-- Provider reachability + upstream status, written by the 5-minute status-poll
-- job; the dashboard incident banner reads it.
create table provider_status (
  provider text primary key, -- db | stripe | elevenlabs | elevenlabs_status | twilio_status
  ok boolean not null,
  detail text,
  checked_at timestamptz not null default now()
);
alter table provider_status enable row level security;
create policy provider_status_read on provider_status for select to authenticated using (true);
-- writes: service role only (status poll job)
