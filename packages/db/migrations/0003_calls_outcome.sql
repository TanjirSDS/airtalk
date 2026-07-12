-- Phase 3: LLM-extracted outcome + summary on calls, and an index for the
-- /calls list + dashboard queries (both order/filter by started_at).

alter table calls
  add column outcome text check (outcome in
    ('booked', 'lead_captured', 'question_answered', 'escalated', 'voicemail', 'spam', 'failed')),
  add column summary text;

create index calls_started_at_idx on calls (started_at desc);
