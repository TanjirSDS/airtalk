-- Phase 14: contacts. One row per (org, phone number). Auto-created + linked by
-- the post-call webhook (external number = from_e164 inbound / to_e164 outbound).
-- dnc mirrors opt_outs for DISPLAY only — opt_outs stays the campaign enforcement
-- source; setting contacts.dnc never gates a dial.
create table contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  e164 text not null,
  first_name text,
  last_name text,
  external_id text,
  notes text,
  dnc boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, e164)
);
create index contacts_org_idx on contacts (org_id);

alter table contacts enable row level security;
-- is_org_member() already ORs is_admin() (Phase 6), so admins see every org.
create policy contacts_org_rw on contacts for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Keep call history if a contact is deleted (mirror of the agent-delete rule).
alter table calls add column contact_id uuid references contacts(id) on delete set null;
create index calls_contact_idx on calls (contact_id);
