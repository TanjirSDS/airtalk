-- Phase 16: QA reporting gate + simulation testing.

-- Plan gate for /qa (reporting). Mirrors the max_numbers seed pattern (0012):
-- ADD COLUMN with a default, then one UPDATE per plan that differs.
-- Growth + Pro get QA; Starter keeps the default false. (The Detailed Calls tab
-- is additionally Pro-only — enforced in the app, no separate flag.)
alter table plans add column qa_enabled boolean not null default false;
update plans set qa_enabled = true where id = 'growth';
update plans set qa_enabled = true where id = 'pro';

-- Simulation test cases (agent builder → Simulation section). One row per saved
-- test; Run overwrites last_result with the provider's simulated-conversation
-- verdict. agent_id cascades on delete (a test case is meaningless without its
-- agent, like agent_suggestions/campaigns in 0008/0007).
create table agent_test_cases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  name text not null,
  -- The scripted persona/goal the simulated user follows.
  user_prompt text not null,
  -- Extra success criterion the simulation is graded against (goal prompt).
  success_criteria text not null,
  -- { passed: bool|null, transcript: [{role, message}], summary?, ranAt: iso }.
  last_result jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index agent_test_cases_agent_idx on agent_test_cases (agent_id);

alter table agent_test_cases enable row level security;
-- is_org_member() already ORs is_admin() (Phase 6), so admins see every org.
create policy agent_test_cases_org_rw on agent_test_cases for all to authenticated
  using (is_org_member(org_id)) with check (is_org_member(org_id));
