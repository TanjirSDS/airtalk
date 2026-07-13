-- Phase 8: adaptive agents — weekly LLM-extracted improvement suggestions,
-- reviewed on /agents/[id]/learning and merged into the config as new versions.

create table agent_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  -- UTC date of the Monday the analyzed week started; the weekly cron skips
  -- agents that already have rows for the week, so re-runs are idempotent.
  week date not null,
  type text not null
    check (type in ('faq_addition', 'prompt_tweak', 'kb_gap', 'escalation_rule')),
  suggestion jsonb not null,
  -- [{"callId": "<calls.id>", "quote": "verbatim transcript line"}]
  evidence jsonb not null default '[]',
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'dismissed')),
  -- agent_config_versions.version created when this was applied (rollback target).
  applied_version int,
  created_at timestamptz not null default now()
);
create index agent_suggestions_agent_idx on agent_suggestions (agent_id, status);
create index agent_suggestions_week_idx on agent_suggestions (agent_id, week);

alter table agent_suggestions enable row level security;
-- Members review (select) and resolve (status update via the apply/dismiss
-- actions). Rows are only created by the weekly cron (service role) — no
-- insert policy on purpose.
create policy agent_suggestions_org_read on agent_suggestions for select to authenticated
  using (is_org_member(org_id));
create policy agent_suggestions_org_update on agent_suggestions for update to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));
