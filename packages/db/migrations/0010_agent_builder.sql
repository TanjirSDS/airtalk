-- Phase 11: the agent builder.
-- Two additive columns; both nullable, RLS already covers both tables
-- (agents_org_rw / versions_org_rw from 0004 let members write these).

-- Inline-editable label per version, shown in the Versions panel.
alter table agent_config_versions add column label text;

-- Public share token: when set, /share/agent/<token> renders the test widget
-- signed-out. Unique so a token maps to exactly one agent; null = not shared.
-- The public route reads the agent by this token via the service role (RLS
-- keeps members' authenticated reads scoped as before).
alter table agents add column share_token text unique;
