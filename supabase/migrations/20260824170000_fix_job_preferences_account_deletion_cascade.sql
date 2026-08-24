-- Fixes a production account-deletion defect: admin.deleteUser(userId) fails
-- with an opaque GoTrue 500 (AuthRetryableFetchError) for any user whose
-- job_preferences row has at least one job_preference_target_roles or
-- job_preference_locations child row.
--
-- ── Root cause ────────────────────────────────────────────────────────────────
-- bump_job_preferences_version_for_child() (20260806090070/20260806090080) is
-- an AFTER INSERT OR DELETE ROW trigger on the two child join tables that
-- UPDATEs the parent job_preferences row on every child-row change. When
-- auth.users is deleted, Postgres cascades the single DELETE statement
-- through job_preferences (on delete cascade) to its child join rows (on
-- delete cascade) in the same statement. The child rows' AFTER DELETE
-- trigger then tries to UPDATE the parent job_preferences row that the same
-- cascading statement is already deleting, which Postgres rejects with
-- "tuple to be updated was already modified by an operation triggered by the
-- current command." An IF EXISTS pre-check on the parent would not help:
-- the parent row does exist at that point (it is merely later in the same
-- cascade), so the conflicting UPDATE would still be attempted and still
-- fail the same way.
--
-- ── Why removal, not a cascade-safe rewrite ─────────────────────────────────
-- Since 20260818090000_preferences_updated_lifecycle.sql, save_job_preferences
-- (the single documented atomic entrypoint for the preferences save flow — see
-- 20260806090100's header comment) already detects join-table changes itself
-- (comparing before/after role and location id arrays) and bumps
-- job_preferences.selection_version exactly once per logical save when they
-- differ; bump_job_preferences_version (the BEFORE trigger on job_preferences
-- itself, unchanged by this migration) then bumps .version off that column
-- change. bump_job_preferences_version_for_child() has therefore been fully
-- redundant with that authoritative path since 20260818090000 — worse, it is
-- actively harmful there: save_job_preferences deletes and re-inserts child
-- rows individually, so each row-level INSERT/DELETE fires this trigger and
-- issues its own extra "version = version + 1" UPDATE, on top of the single
-- intended selection_version-driven bump — silently violating the "at most
-- one intended version increment per logical save" invariant. Removing the
-- child triggers both fixes the account-deletion cascade conflict and
-- restores exactly-once version semantics for normal preference edits, with
-- no alternative table/trigger redesign needed. Direct (non-RPC) client
-- writes to the child tables remain technically possible under existing RLS
-- (unchanged here — save_job_preferences is SECURITY INVOKER and needs those
-- grants to run at all) but are not used anywhere in this codebase; the
-- application's only write path to these tables is save_job_preferences.
drop trigger if exists bump_job_preferences_version_for_target_roles
  on public.job_preference_target_roles;

drop trigger if exists bump_job_preferences_version_for_locations
  on public.job_preference_locations;

drop function if exists public.bump_job_preferences_version_for_child();

comment on table public.job_preference_target_roles is
  'Selected reference target roles for a job_preferences row (1-5 total combined with custom_target_roles — enforced in save_job_preferences). Parent-version bumping for changes to this table happens exclusively inside save_job_preferences (via selection_version), not via a trigger on this table — see 20260824170000 for why a child-table AFTER trigger that UPDATEs the parent is unsafe under auth.users cascade deletion.';

comment on table public.job_preference_locations is
  'Selected reference preferred locations for a job_preferences row (required when work_arrangement is onsite/hybrid/flexible — enforced in save_job_preferences). Parent-version bumping for changes to this table happens exclusively inside save_job_preferences (via selection_version), not via a trigger on this table — see 20260824170000 for why a child-table AFTER trigger that UPDATEs the parent is unsafe under auth.users cascade deletion.';

comment on column public.job_preferences.version is
  'Monotonically increasing, server-computed only (see bump_job_preferences_version and save_job_preferences). Never trust a client-supplied value for this column. Invariant: no trigger on job_preference_target_roles/job_preference_locations may UPDATE this row on delete — doing so previously conflicted with the same-statement auth.users→job_preferences cascade delete during account deletion (see 20260824170000).';
