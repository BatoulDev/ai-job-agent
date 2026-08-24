-- Hardens grants on public.rate_limit_events, found during the rate-limiting
-- review (2026-08-22) to still grant `anon` TRUNCATE, REFERENCES, and TRIGGER
-- — the original migration (20260821090000_add_ai_task_and_cv_replace_rate_
-- limits.sql) revoked only `from public, authenticated`, omitting `anon`,
-- unlike the sibling table auth_rate_limit_events
-- (20260822110000_add_login_rate_limiting.sql), which correctly revoked
-- `from public, authenticated, anon` from the start.
--
-- Empirically confirmed via information_schema.table_privileges against the
-- running local database before this migration: anon held TRUNCATE,
-- REFERENCES, and TRIGGER on rate_limit_events (Postgres grants these to the
-- table owner's role tree by default unless explicitly revoked — they were
-- never intentionally granted). None of SELECT/INSERT/UPDATE/DELETE were
-- ever granted to anon, so this was not exploitable through the standard
-- PostgREST/anon-key REST surface (TRUNCATE isn't PostgREST-reachable), but
-- it is a genuine least-privilege inconsistency worth closing — this table
-- holds abuse-signal data (which user replaced their CV or requested a
-- feedback-driven re-analysis, and when) and must be exactly as locked down
-- as auth_rate_limit_events.
--
-- No RLS change: RLS was already enabled with zero policies (doubly-enforced
-- default-deny — see the original migration's own comment on this table).
-- No SECURITY DEFINER function is touched; replace_cv() and
-- charge_feedback_task_quota() keep reading/writing this table as their
-- owner, unaffected by grants on the table itself.
revoke all on public.rate_limit_events from public, anon, authenticated;

-- Restated for clarity/idempotency — unchanged from the original migration,
-- this is the only access service_role needs on rate_limit_events.
grant select, insert, update, delete on public.rate_limit_events to service_role;
