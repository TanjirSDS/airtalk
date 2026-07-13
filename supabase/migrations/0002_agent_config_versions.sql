-- Phase 2, rule 4: agent configs are versioned. Every save (create, edit,
-- rollback) appends a row here; rollback re-applies an old row's config and
-- appends it as the newest version. config = { template, profile, agentConfig }.

create table agent_config_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  version int not null,
  config jsonb not null,
  created_at timestamptz not null default now(),
  unique (agent_id, version) -- also catches concurrent-save races
);

create index agent_config_versions_agent_idx on agent_config_versions (agent_id, version desc);
