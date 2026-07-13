-- Phase 10: freeform-first agents + the agents management surface.
-- agent_type badges the agent's shape; updated_at/updated_by feed the table's
-- "Edited by" column and are set in every agent-mutating server action.

alter table agents
  add column agent_type text not null default 'single'
    check (agent_type in ('single', 'flow', 'custom_llm')),
  add column updated_at timestamptz default now(),
  add column updated_by text;

-- Deleting an agent (Phase 10 management UI) must actually work. Old FKs (0001,
-- 0007) had no delete rule, so any call/number/campaign row blocked deletion.
-- Now: keep call history (agent_id → null), free attached numbers (→ null; the
-- action also detaches them at the provider), and drop the agent's campaigns.
-- The delete ACTION additionally blocks while a campaign is running/paused
-- (rule 3 money-loop safety) — you must stop it before deleting the agent.
alter table calls
  drop constraint calls_agent_id_fkey,
  add constraint calls_agent_id_fkey
    foreign key (agent_id) references agents(id) on delete set null;

alter table phone_numbers
  drop constraint phone_numbers_agent_id_fkey,
  add constraint phone_numbers_agent_id_fkey
    foreign key (agent_id) references agents(id) on delete set null;

alter table campaigns
  drop constraint campaigns_agent_id_fkey,
  add constraint campaigns_agent_id_fkey
    foreign key (agent_id) references agents(id) on delete cascade;
