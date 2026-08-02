-- Extends cv_analyses with the lifecycle information required to know
-- which analysis (if any) is currently authoritative, and whether its
-- CV facts and/or AI recommendations are still trustworthy. Does not
-- remove or repurpose any existing column: status (processing lifecycle)
-- and review_status (user review lifecycle) are untouched and remain
-- independent of the new is_current/recommendations_state pair added
-- here — a third, orthogonal dimension: system-determined validity.
alter table public.cv_analyses
  add column preferences_version integer,
  add column is_current boolean not null default false,
  add column superseded_at timestamptz,
  add column recommendations_state text not null default 'current'
    check (recommendations_state in ('current', 'stale', 'superseded'));

comment on column public.cv_analyses.preferences_version is
  'The job_preferences.version this analysis''s preference_snapshot / ai_career_profile was generated against. Compared against the user''s live job_preferences.version to detect staleness (see mark_cv_analyses_stale_on_preferences_change).';
comment on column public.cv_analyses.is_current is
  'Whether this is the record future job matching should read. At most one true row per user (see cv_analyses_one_current_per_user). Distinct from review_status: an analysis can remain "approved" (a historical fact) after it stops being current.';
comment on column public.cv_analyses.superseded_at is
  'Set when this analysis stops being current because its CV was replaced (recommendations_state = superseded). Null otherwise.';
comment on column public.cv_analyses.recommendations_state is
  'current: cv_facts and ai_career_profile both match the live CV and preferences. stale: cv_facts still valid (same CV), but preferences_version is behind job_preferences.version — ai_career_profile needs a career_profile_refresh, cv_facts remain reusable and do not need reparsing. superseded: the CV itself was replaced — the entire result, including cv_facts, is no longer relevant to the user''s current CV.';

-- A superseded result can never also be "the" current one — enforced at
-- the database layer rather than trusted to application code.
alter table public.cv_analyses
  add constraint cv_analyses_current_not_superseded
  check (not (is_current and recommendations_state = 'superseded'));

-- At most one CURRENT analysis per user at any time — the record future
-- job matching must read. Independent of, and in addition to, the
-- existing cv_analyses_one_approved_per_user index from Phase 4A: review
-- status is a permanent historical fact (a user approved this specific
-- result on this date), while is_current is a live pointer that can move
-- away from it when the referenced CV or preferences change without
-- rewriting that history.
create unique index cv_analyses_one_current_per_user
  on public.cv_analyses (user_id)
  where is_current = true;

-- --- Automatic supersession / staleness consistency triggers ---
--
-- Both are SECURITY DEFINER, not the invoker-privilege default: they run
-- as a side effect of a normal user's own legitimate UPDATE to their own
-- cvs or job_preferences row (already permitted by existing RLS), but
-- must then write to cv_analyses — a table with no insert/update policy
-- for the authenticated role at all (Phase 4A, deliberately). Without
-- security definer, that inner write would fail with a permission error
-- and abort the user's own preference/CV save. This mirrors exactly why
-- handle_new_user and handle_new_user_subscription are security definer:
-- one controlled, narrowly-scoped privileged write path, not a broadened
-- RLS policy on cv_analyses itself.
--
-- Neither trigger fires in practice yet in this phase: nothing sets
-- cv_analyses.is_current = true (no approval function exists — Phase 6
-- documents, but does not implement, the approval transaction that
-- would), and nothing sets cvs.is_active = false (the Replace CV action
-- is deferred — see 20260805090010_add_cvs_versioning.sql). Both are
-- still added now, correctly, so they are already in force the moment
-- those future features start writing to their respective tables — no
-- further migration will be needed for this part.

-- Fires when a CV stops being the user's active CV. Whatever analysis
-- was current for that CV is no longer valid at all, including its CV
-- facts — mark it superseded and no longer current. review_status is
-- deliberately left untouched: "this was approved on this date" remains
-- true even after the CV it was based on is replaced.
create or replace function public.mark_cv_analyses_superseded_on_cv_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active = false and old.is_active = true then
    update public.cv_analyses
    set is_current = false,
        recommendations_state = 'superseded',
        superseded_at = now()
    where cv_id = new.id and is_current = true;
  end if;
  return new;
end;
$$;

create trigger mark_cv_analyses_superseded_on_cv_change_trigger
  after update on public.cvs
  for each row
  execute function public.mark_cv_analyses_superseded_on_cv_change();

-- Fires when job_preferences.version increments. The current analysis's
-- CV facts are still valid (same CV) but its AI conclusions were
-- generated against an older preferences version — mark recommendations
-- stale without demoting is_current, since this is still "the" record
-- until a career_profile_refresh produces a newer one; cv_facts remain
-- reusable and must not be reparsed for a preferences-only change.
create or replace function public.mark_cv_analyses_stale_on_preferences_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.version is distinct from old.version then
    update public.cv_analyses
    set recommendations_state = 'stale'
    where user_id = new.user_id
      and is_current = true
      and recommendations_state = 'current'
      and (preferences_version is null or preferences_version <> new.version);
  end if;
  return new;
end;
$$;

create trigger mark_cv_analyses_stale_on_preferences_change_trigger
  after update on public.job_preferences
  for each row
  execute function public.mark_cv_analyses_stale_on_preferences_change();
