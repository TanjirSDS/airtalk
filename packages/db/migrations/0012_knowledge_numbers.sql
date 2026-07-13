-- Phase 13: per-org knowledge-base doc registry + per-plan phone-number limits.
--
-- ElevenLabs' knowledge base is WORKSPACE-level (one pool shared across every
-- Airtalk org), so we NEVER list provider-side docs to a user. kb_documents is
-- our own RLS-scoped registry: which EL doc belongs to which org, what it's
-- called, where it came from. Attachment to agents lives in the agent config
-- (conversation_config...prompt.knowledge_base) at the provider, so there's no
-- join table — "used by N agents" is computed by scanning org agent configs.

create table kb_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  -- The ElevenLabs knowledge-base document id. Unique: each create call at the
  -- provider mints a distinct id, so this also stops a double-insert.
  provider_kb_id text unique not null,
  name text not null,
  source_type text not null check (source_type in ('url', 'file', 'text')),
  created_by text,               -- user email, like agents.updated_by
  created_at timestamptz not null default now()
);
create index kb_documents_org_idx on kb_documents (org_id);

alter table kb_documents enable row level security;
-- is_org_member() already ORs is_admin() (Phase 6), so admins see every org.
create policy kb_documents_org_rw on kb_documents for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Per-plan phone-number cap (replaces the one-number-per-org self-serve rule).
alter table plans add column max_numbers int not null default 1;
update plans set max_numbers = 3 where id = 'growth';
update plans set max_numbers = 10 where id = 'pro';
-- starter keeps the default 1.

-- The /numbers page shows when each number was added; phone_numbers had no
-- timestamp. Existing rows backfill to now() (default on the added column).
alter table phone_numbers add column created_at timestamptz not null default now();
