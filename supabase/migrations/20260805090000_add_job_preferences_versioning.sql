-- Adds a monotonically increasing version to job_preferences so a future
-- cv_analyses row can record exactly which preferences it was generated
-- against (preference_snapshot already stores the data; version gives it
-- a comparable, incrementing identity — see
-- 20260805090030_extend_cv_analyses_lifecycle.sql).
--
-- job_preferences is the one table in this schema still directly
-- writable by its owning user via RLS (job_preferences_update_own) —
-- unlike subscriptions/payment_attempts/analysis_tasks/cv_analyses, which
-- are service_role-only. That makes the "never trust a client-provided
-- version" requirement concrete: a client could include an arbitrary
-- "version" value in its UPDATE/upsert payload, so the authoritative
-- value must be computed inside the database, not merely defaulted.
alter table public.job_preferences
  add column version integer not null default 1;

comment on column public.job_preferences.version is
  'Monotonically increasing, server-computed only (see bump_job_preferences_version). Never trust a client-supplied value for this column.';

-- Recomputes version itself on every insert and update, ignoring
-- whatever the client sent. On insert: always 1 (defense in depth on top
-- of the column DEFAULT, in case a client-supplied "version" appears in
-- an insert payload). On update: increments only when a real preference
-- data column actually changed — an update that only touches derived/
-- technical state (currently just updated_at, maintained by the existing
-- set_job_preferences_updated_at trigger) leaves version untouched.
--
-- security invoker (default, matches set_updated_at): this only reads
-- OLD/NEW of the same row the invoking statement is already updating —
-- no elevated privilege is needed, since the user already has UPDATE
-- rights on their own job_preferences row via existing RLS.
create or replace function public.bump_job_preferences_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    return new;
  end if;

  if (
    new.target_roles is distinct from old.target_roles
    or new.location is distinct from old.location
    or new.remote_preference is distinct from old.remote_preference
    or new.job_type is distinct from old.job_type
    or new.experience_level is distinct from old.experience_level
    or new.additional_notes is distinct from old.additional_notes
  ) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;

  return new;
end;
$$;

create trigger bump_job_preferences_version_trigger
  before insert or update on public.job_preferences
  for each row
  execute function public.bump_job_preferences_version();
