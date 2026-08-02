-- Extends analysis_tasks with what's needed to distinguish a full CV
-- extraction from a preferences-only refresh, and to record which
-- preferences version a task targets. Reuses existing equivalents rather
-- than duplicating columns — see the mapping below.
--
-- Existing columns already covering fields requested for this phase
-- (no change needed, listed here so the mapping is explicit and this
-- migration is never mistaken for having missed them):
--   cv_id           — already exists (analysis_tasks_cv_id_fkey)
--   started_at      — already exists
--   completed_at    — already exists
--   attempt_count   — already exists, with max_attempts + idempotency_key
--                      already providing retry/idempotency guarantees
--   error_message   — already exists as `last_error`; not duplicated

-- task_type: distinct from the existing `trigger` column. `trigger`
-- records WHY a task was created (today only 'onboarding_completed');
-- task_type records WHAT KIND of analysis work it is. The only existing
-- caller (the onboarding-completion route, via create_analysis_task) is
-- unchanged by this migration — it doesn't reference task_type, so every
-- row it inserts gets the column DEFAULT, which is correct: onboarding
-- completion is indeed a full analysis.
alter table public.analysis_tasks
  add column task_type text not null default 'full_analysis'
    check (task_type in ('full_analysis', 'career_profile_refresh'));

comment on column public.analysis_tasks.task_type is
  'full_analysis: full CV extraction + new AI Career Profile (new/replaced CV). career_profile_refresh: preferences changed, CV facts still valid, only AI recommendations need regenerating. Not yet set by any caller other than the column default — no code path creates career_profile_refresh tasks in this phase.';

-- preferences_version: the job_preferences.version this task targets.
-- Nullable — existing rows (created before job_preferences.version
-- existed) and any future caller that omits it stay null rather than
-- silently getting a wrong value.
alter table public.analysis_tasks
  add column preferences_version integer;

comment on column public.analysis_tasks.preferences_version is
  'The job_preferences.version this task was created against. Auto-populated from the user''s current job_preferences row when not explicitly supplied (see set_analysis_task_preferences_version) — never left to a client or trusted from a caller-supplied value beyond that snapshot.';

-- superseded_at: marks a task whose result would no longer matter even
-- if it finished — e.g. an older career_profile_refresh made irrelevant
-- by a later preference change. Nothing in this phase sets this column;
-- a future claim function must treat it as "do not process" (see below).
alter table public.analysis_tasks
  add column superseded_at timestamptz;

comment on column public.analysis_tasks.superseded_at is
  'Set by future orchestration logic (not this phase) when a newer task makes this one moot. A future claim function must exclude rows where this is not null, in addition to filtering on status/available_at.';

-- Auto-populates preferences_version from the user's current
-- job_preferences.version at insert time, when the caller didn't supply
-- one — this keeps the existing create_analysis_task(p_user_id, p_cv_id,
-- p_trigger) function (and every existing caller: the onboarding-
-- completion route and scripts/seed-local-automation-users.mjs) working
-- completely unchanged while still getting a correct snapshot, without
-- requiring a function signature change in this migration.
--
-- security invoker: reads job_preferences via whatever role is actually
-- executing the INSERT. When fired through create_analysis_task (itself
-- security definer), that's the function owner (postgres); when fired by
-- a future direct service_role insert, that's service_role — both
-- already have full read access to job_preferences, so no additional
-- elevated privilege is needed here.
create or replace function public.set_analysis_task_preferences_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.preferences_version is null then
    select version into new.preferences_version
    from public.job_preferences
    where user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger set_analysis_task_preferences_version_trigger
  before insert on public.analysis_tasks
  for each row
  execute function public.set_analysis_task_preferences_version();

-- No new partial unique index is added for "duplicate active tasks per
-- user/cv/task_type/preferences_version": the EXISTING
-- analysis_tasks_one_active_per_cv index (unique on cv_id where status
-- in ('pending','processing') — the real, current status vocabulary,
-- confirmed by inspecting analysis_tasks_status_check) already forbids
-- any two active tasks for the same CV at all, regardless of task_type
-- or preferences_version — a strictly stronger guarantee than the
-- narrower one requested. Adding a second, looser index on top would be
-- unreachable dead weight (Phase 1's own instruction: do not create
-- duplicate/redundant indexes). If the product later wants full_analysis
-- and career_profile_refresh to run concurrently for the same CV — a
-- deliberate loosening — analysis_tasks_one_active_per_cv would need to
-- be dropped and replaced with a unique index on
-- (user_id, cv_id, task_type, preferences_version) instead, in its own
-- reviewed migration.
--
-- "Rapid preference changes should eventually process only the latest
-- version" is not solved by a uniqueness constraint alone (it requires
-- deciding whether to supersede an existing pending task or update its
-- target version in place) — that decision belongs to the future claim/
-- orchestration function, not a blind trigger, and is intentionally not
-- implemented here. See the atomic claim contract documented in
-- DATABASE_PLAN.md's Phase 4B addendum.
