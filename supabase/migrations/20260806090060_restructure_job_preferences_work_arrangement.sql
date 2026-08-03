-- Renames the ambiguous remote_preference column to work_arrangement and
-- widens its vocabulary from ('onsite','hybrid','remote','open') to
-- ('remote','onsite','hybrid','flexible') — 'open' meant exactly the same
-- thing 'flexible' now means (open to remote/hybrid/on-site), so existing
-- rows are remapped, not dropped. Adds job_market_coverage (Pro+Lebanon
-- remote/flexible coverage choice — see enforce_job_preferences_eligibility
-- in 20260806090090) and custom_target_roles/custom_locations ("Other"
-- free-text entries, kept distinct from the reference-table selections in
-- job_preference_target_roles/job_preference_locations).
--
-- target_roles/location (the old scalar free-text columns) are left
-- untouched and frozen — historical data preserved, new code stops
-- writing to them in favor of the join tables + custom_* arrays.
alter table public.job_preferences
  rename column remote_preference to work_arrangement;

alter table public.job_preferences
  rename constraint job_preferences_remote_preference_check to job_preferences_work_arrangement_check;

alter table public.job_preferences
  drop constraint job_preferences_work_arrangement_check;

update public.job_preferences
set work_arrangement = 'flexible'
where work_arrangement = 'open';

alter table public.job_preferences
  add constraint job_preferences_work_arrangement_check
  check (work_arrangement in ('remote', 'onsite', 'hybrid', 'flexible'));

alter table public.job_preferences
  add column job_market_coverage text
    check (job_market_coverage in (
      'lebanon_only',
      'remote_lebanon_applicants',
      'remote_mena',
      'remote_worldwide'
    )),
  add column custom_target_roles text[],
  add column custom_locations text[];

comment on column public.job_preferences.work_arrangement is
  'remote | onsite | hybrid | flexible. Renamed from remote_preference; "open" values were remapped to "flexible".';
comment on column public.job_preferences.job_market_coverage is
  'Only meaningful for a Lebanon-resident Pro user with work_arrangement in (remote, flexible) — see enforce_job_preferences_eligibility_trigger. Null otherwise.';
comment on column public.job_preferences.custom_target_roles is
  '"Other role" free-text entries, counted together with job_preference_target_roles toward the 1-5 max (see save_job_preferences).';
comment on column public.job_preferences.custom_locations is
  '"Other location" free-text entries, counted together with job_preference_locations.';

-- Re-point the version-bump trigger's change-tracking list at the renamed
-- column plus the three new ones, so version continues to increment
-- exactly when real preference data changes (see
-- 20260805090000_add_job_preferences_versioning.sql for why this matters
-- to cv_analyses staleness detection).
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
    or new.work_arrangement is distinct from old.work_arrangement
    or new.job_type is distinct from old.job_type
    or new.experience_level is distinct from old.experience_level
    or new.additional_notes is distinct from old.additional_notes
    or new.job_market_coverage is distinct from old.job_market_coverage
    or new.custom_target_roles is distinct from old.custom_target_roles
    or new.custom_locations is distinct from old.custom_locations
  ) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;

  return new;
end;
$$;
