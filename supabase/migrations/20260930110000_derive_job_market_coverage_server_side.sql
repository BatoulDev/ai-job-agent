-- job_market_coverage wiring fix.
--
-- Bug: job_preferences.job_market_coverage was accepted as a raw client
-- parameter (p_job_market_coverage) on save_job_preferences, but the
-- onboarding UI (src/app/onboarding/preferences/page.tsx) always sent
-- literal null for it — there was no picker for it and no server-side
-- derivation. Result: every Pro user who enabled international search with
-- a remote/flexible work arrangement (exactly the combination the
-- onboarding UI's own copy promises international remote coverage for)
-- ended up with job_market_coverage permanently null, which
-- checkJobEligibility.ts's evaluateRemoteEligibility() treats as the most
-- restrictive tier (remote_lebanon_applicants) — silently filtering out
-- eligible international remote jobs before they ever reach AI matching.
-- Confirmed via a real browser -> RPC -> DB Playwright pass before this
-- migration (tests/e2e/preferences-job-market-coverage.spec.ts).
--
-- Fix: job_market_coverage is no longer a client-supplied value. It is
-- derived server-side, inside save_job_preferences, from already-validated
-- inputs: international_search_enabled (Pro-gated by
-- enforce_job_preferences_eligibility_trigger) and work_arrangement. This
-- keeps the frontend sending only user intent/preferences and keeps the
-- backend the sole authority over the derived entitlement value, per the
-- explicit "do not create a client-side security boundary" requirement for
-- this fix.
--
-- Derivation: international_search_enabled = true AND work_arrangement in
-- ('remote', 'flexible') => 'remote_worldwide'; otherwise null.
-- 'remote_worldwide' (not a MENA-scoped value) matches AGENTS.md's stated
-- Pro geography ("verified international remote", no MENA-only qualifier)
-- and the onboarding UI's own promise text for willing_to_relocate=false.
-- willing_to_relocate is deliberately NOT part of this derivation — it
-- gates a separate, orthogonal onsite/hybrid physical-presence path (see
-- docs/PRODUCT_MATCHING_RULES.md), not this field.
--
-- This derivation can never produce a value the pre-existing
-- enforce_job_preferences_eligibility trigger would reject: that trigger
-- already requires plan_code = 'pro', country_of_residence = 'LB', and
-- work_arrangement in ('remote', 'flexible') for any non-null
-- job_market_coverage, and international_search_enabled = true is already
-- separately Pro-gated by the same trigger.

-- ── 1. save_job_preferences: drop p_job_market_coverage as a parameter ───

drop function if exists public.save_job_preferences(
  text, text, text, text, text, text[], text[], text[], text[],
  text, boolean, boolean, text[], text, text[]
);

create or replace function public.save_job_preferences(
  p_work_arrangement                text,
  p_job_type                        text,
  p_experience_level                text,
  p_additional_notes                text,
  p_custom_target_roles             text[],
  p_custom_locations                text[],
  p_target_role_ids                 text[],
  p_location_ids                    text[],
  p_lebanon_location_scope          text default null,
  p_international_search_enabled    boolean default false,
  p_willing_to_relocate             boolean default null,
  p_relocation_location_ids         text[] default null,
  p_work_authorization_status       text default null,
  p_work_authorization_country_ids  text[] default null
)
returns public.job_preferences
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id                uuid := auth.uid();
  v_target_role_ids        text[];
  v_location_ids           text[];
  v_custom_roles           text[];
  v_custom_locations       text[];
  v_role_count             integer;
  v_row                    public.job_preferences;
  v_old_version            integer;
  v_old_role_ids           text[];
  v_old_location_ids       text[];
  v_roles_changed          boolean;
  v_locs_changed           boolean;
  v_direct_changed         boolean;
  v_international_enabled boolean;
  v_willing_to_relocate    boolean;
  v_work_auth_status       text;
  v_relocation_location_ids text[];
  v_authorized_country_ids  text[];
  v_relocation_country_codes text[];
  v_old_relocation_ids     text[];
  v_old_authorized_ids     text[];
  v_intl_changed           boolean;
  v_job_market_coverage    text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  v_target_role_ids := coalesce(
    (select array_agg(distinct x) from unnest(coalesce(p_target_role_ids, array[]::text[])) as x),
    array[]::text[]
  );
  v_location_ids := coalesce(
    (select array_agg(distinct x) from unnest(coalesce(p_location_ids, array[]::text[])) as x),
    array[]::text[]
  );

  if array_length(v_target_role_ids, 1) > 0 then
    if (
      select count(*) from public.target_roles
      where slug = any(v_target_role_ids) and is_active
    ) <> array_length(v_target_role_ids, 1) then
      raise exception 'One or more selected target roles are invalid or inactive.';
    end if;
  end if;

  -- Lebanese preferred locations must be real, active, non-relocation-market rows.
  if array_length(v_location_ids, 1) > 0 then
    if (
      select count(*) from public.locations
      where slug = any(v_location_ids) and is_active and is_relocation_market = false
    ) <> array_length(v_location_ids, 1) then
      raise exception 'One or more selected locations are invalid or inactive.';
    end if;
  end if;

  with cleaned as (
    select trim(name) as name, lower(trim(name)) as key
    from unnest(coalesce(p_custom_target_roles, array[]::text[])) as t(name)
    where trim(name) <> ''
  ),
  deduped as (
    select distinct on (key) name
    from cleaned
    order by key, name
  )
  select array_agg(d.name) into v_custom_roles
  from deduped d
  where lower(d.name) not in (
    select lower(tr.name) from public.target_roles tr where tr.slug = any(v_target_role_ids)
  );

  with cleaned as (
    select trim(name) as name, lower(trim(name)) as key
    from unnest(coalesce(p_custom_locations, array[]::text[])) as t(name)
    where trim(name) <> ''
  ),
  deduped as (
    select distinct on (key) name
    from cleaned
    order by key, name
  )
  select array_agg(d.name) into v_custom_locations
  from deduped d;

  v_role_count := array_length(v_target_role_ids, 1) + coalesce(array_length(v_custom_roles, 1), 0);
  if v_role_count < 1 or v_role_count > 5 then
    raise exception 'Select between 1 and 5 target roles.';
  end if;

  if p_work_arrangement in ('onsite', 'hybrid', 'flexible')
     and array_length(v_location_ids, 1) is null
     and array_length(v_custom_locations, 1) is null
  then
    raise exception 'At least one preferred location is required for On-site, Hybrid, or Flexible work arrangement.';
  end if;

  -- Lebanese location flexibility: required for every save going forward.
  -- Nullable at the column level only for pre-existing rows (backfilled to
  -- 'selected_only' by 20260902090010) — every new save must choose one.
  if p_lebanon_location_scope is null
     or p_lebanon_location_scope not in ('selected_only', 'selected_and_nearby', 'anywhere_in_lebanon')
  then
    raise exception 'Please choose how closely to follow your selected Lebanese locations.';
  end if;

  -- ── International preferences: normalize, then validate. Never trust
  -- an inconsistent combination from the client — child fields are always
  -- forced to their only valid state given the parent toggle, rather than
  -- rejected outright, so a client that (for example) leaves a stale
  -- willing_to_relocate value in a hidden field can never silently expand
  -- scope. Plan eligibility itself (Pro-only) is enforced separately by
  -- enforce_job_preferences_eligibility_trigger on the job_preferences
  -- insert/update below, and by the two child-table eligibility triggers
  -- for the relocation-location/authorized-country rows.
  v_international_enabled := coalesce(p_international_search_enabled, false);

  v_willing_to_relocate := case when v_international_enabled then p_willing_to_relocate else null end;

  v_relocation_location_ids := case
    when v_international_enabled and v_willing_to_relocate is true then
      coalesce((select array_agg(distinct x) from unnest(coalesce(p_relocation_location_ids, array[]::text[])) as x), array[]::text[])
    else array[]::text[]
  end;

  v_work_auth_status := case
    when v_international_enabled and v_willing_to_relocate is true then p_work_authorization_status
    else null
  end;

  v_authorized_country_ids := case
    when v_work_auth_status = 'already_authorized' then
      coalesce((select array_agg(distinct x) from unnest(coalesce(p_work_authorization_country_ids, array[]::text[])) as x), array[]::text[])
    else array[]::text[]
  end;

  if array_length(v_relocation_location_ids, 1) > 0 then
    if (
      select count(*) from public.locations
      where slug = any(v_relocation_location_ids) and is_active and is_relocation_market = true
    ) <> array_length(v_relocation_location_ids, 1) then
      raise exception 'One or more selected relocation locations are invalid or unsupported.';
    end if;
  end if;

  select coalesce(array_agg(distinct l.country_code), array[]::text[])
  into v_relocation_country_codes
  from public.locations l
  where l.slug = any(v_relocation_location_ids);

  if array_length(v_authorized_country_ids, 1) > 0 then
    if (
      select count(*) from public.countries
      where code = any(v_authorized_country_ids) and is_active
    ) <> array_length(v_authorized_country_ids, 1) then
      raise exception 'One or more authorized countries are invalid.';
    end if;

    if exists (
      select 1 from unnest(v_authorized_country_ids) as c
      where c <> all(coalesce(v_relocation_country_codes, array[]::text[]))
    ) then
      raise exception 'An authorized country must match one of your selected relocation locations.';
    end if;
  end if;

  if v_international_enabled then
    if v_willing_to_relocate is null then
      raise exception 'Please specify whether you are willing to relocate outside Lebanon.';
    end if;

    if v_willing_to_relocate then
      if array_length(v_relocation_location_ids, 1) is null then
        raise exception 'Select at least one location you would be willing to relocate to.';
      end if;
      if v_work_auth_status is null or v_work_auth_status not in ('needs_employer_support', 'already_authorized', 'unsure') then
        raise exception 'Please answer the legal work authorization question.';
      end if;
      if v_work_auth_status = 'already_authorized' and array_length(v_authorized_country_ids, 1) is null then
        raise exception 'Select at least one country where you already have legal work authorization.';
      end if;
    end if;
  end if;

  -- job_market_coverage is derived here, never accepted from the client.
  -- See this migration's header comment for the full rationale.
  v_job_market_coverage := case
    when v_international_enabled and p_work_arrangement in ('remote', 'flexible') then 'remote_worldwide'
    else null
  end;

  select version into v_old_version
  from public.job_preferences
  where user_id = v_user_id;

  insert into public.job_preferences (
    user_id, work_arrangement, job_market_coverage, job_type, experience_level,
    additional_notes, custom_target_roles, custom_locations,
    lebanon_location_scope, international_search_enabled, willing_to_relocate,
    work_authorization_status
  )
  values (
    v_user_id, p_work_arrangement, v_job_market_coverage, p_job_type,
    p_experience_level,
    nullif(trim(coalesce(p_additional_notes, '')), ''),
    v_custom_roles, v_custom_locations,
    p_lebanon_location_scope, v_international_enabled, v_willing_to_relocate,
    v_work_auth_status
  )
  on conflict (user_id) do update set
    work_arrangement              = excluded.work_arrangement,
    job_market_coverage           = excluded.job_market_coverage,
    job_type                      = excluded.job_type,
    experience_level               = excluded.experience_level,
    additional_notes               = excluded.additional_notes,
    custom_target_roles            = excluded.custom_target_roles,
    custom_locations                = excluded.custom_locations,
    lebanon_location_scope          = excluded.lebanon_location_scope,
    international_search_enabled    = excluded.international_search_enabled,
    willing_to_relocate             = excluded.willing_to_relocate,
    work_authorization_status       = excluded.work_authorization_status
  returning * into v_row;

  select array_agg(target_role_id order by target_role_id)
  into v_old_role_ids
  from public.job_preference_target_roles
  where job_preference_id = v_row.id;

  select array_agg(location_id order by location_id)
  into v_old_location_ids
  from public.job_preference_locations
  where job_preference_id = v_row.id;

  select array_agg(location_id order by location_id)
  into v_old_relocation_ids
  from public.job_preference_relocation_locations
  where job_preference_id = v_row.id;

  select array_agg(country_code order by country_code)
  into v_old_authorized_ids
  from public.job_preference_authorized_countries
  where job_preference_id = v_row.id;

  delete from public.job_preference_target_roles where job_preference_id = v_row.id;
  if array_length(v_target_role_ids, 1) > 0 then
    insert into public.job_preference_target_roles (job_preference_id, target_role_id)
    select v_row.id, x from unnest(v_target_role_ids) as x;
  end if;

  delete from public.job_preference_locations where job_preference_id = v_row.id;
  if array_length(v_location_ids, 1) > 0 then
    insert into public.job_preference_locations (job_preference_id, location_id)
    select v_row.id, x from unnest(v_location_ids) as x;
  end if;

  delete from public.job_preference_relocation_locations where job_preference_id = v_row.id;
  if array_length(v_relocation_location_ids, 1) > 0 then
    insert into public.job_preference_relocation_locations (job_preference_id, location_id)
    select v_row.id, x from unnest(v_relocation_location_ids) as x;
  end if;

  delete from public.job_preference_authorized_countries where job_preference_id = v_row.id;
  if array_length(v_authorized_country_ids, 1) > 0 then
    insert into public.job_preference_authorized_countries (job_preference_id, country_code)
    select v_row.id, x from unnest(v_authorized_country_ids) as x;
  end if;

  v_roles_changed := v_old_role_ids is distinct from (
    select array_agg(x order by x) from unnest(v_target_role_ids) as x
  );
  v_locs_changed := v_old_location_ids is distinct from (
    select array_agg(x order by x) from unnest(v_location_ids) as x
  );
  v_intl_changed := (
    v_old_relocation_ids is distinct from (select array_agg(x order by x) from unnest(v_relocation_location_ids) as x)
    or v_old_authorized_ids is distinct from (select array_agg(x order by x) from unnest(v_authorized_country_ids) as x)
  );

  if v_roles_changed or v_locs_changed or v_intl_changed then
    update public.job_preferences
    set selection_version = selection_version + 1
    where id = v_row.id;
  end if;

  v_direct_changed := (v_old_version is not null) and (v_row.version > v_old_version);

  if v_old_version is not null and (v_direct_changed or v_roles_changed or v_locs_changed or v_intl_changed) then
    perform public.enqueue_preferences_analysis_task();
  end if;

  select * into v_row from public.job_preferences where id = v_row.id;
  return v_row;
end;
$$;

revoke execute on function public.save_job_preferences(
  text, text, text, text, text[], text[], text[], text[],
  text, boolean, boolean, text[], text, text[]
) from public;
grant execute on function public.save_job_preferences(
  text, text, text, text, text[], text[], text[], text[],
  text, boolean, boolean, text[], text, text[]
) to authenticated;

comment on function public.save_job_preferences is
  'Single atomic entrypoint for saving job preferences. job_market_coverage is no longer a client parameter (removed 20260930110000): it is derived server-side from international_search_enabled and work_arrangement (remote_worldwide when international is enabled and work_arrangement is remote/flexible, else null), so the frontend can never supply a raw backend coverage value or bypass plan-entitlement derivation.';

-- ── 2. Backfill existing rows using the identical derivation logic ───────
--
-- Disable the version-bump and stale-recommendations triggers for this
-- statement only: this is a data-correctness backfill (job_market_coverage
-- should already have held this value, given the row's existing
-- international_search_enabled/work_arrangement), not a genuine user
-- preference change, so it must not bump job_preferences.version or mark
-- an otherwise-current CV analysis's recommendations stale.
-- enforce_job_preferences_eligibility_trigger is deliberately left enabled
-- as a safety net — the WHERE clause below independently mirrors its exact
-- invariants (pro plan, LB residence, remote/flexible arrangement).

alter table public.job_preferences disable trigger bump_job_preferences_version_trigger;
alter table public.job_preferences disable trigger mark_cv_analyses_stale_on_preferences_change_trigger;

update public.job_preferences jp
set job_market_coverage = 'remote_worldwide'
from public.subscriptions s, public.profiles p
where jp.user_id = s.user_id
  and jp.user_id = p.id
  and s.plan_code = 'pro'
  and p.country_of_residence = 'LB'
  and jp.international_search_enabled = true
  and jp.work_arrangement in ('remote', 'flexible')
  and jp.job_market_coverage is null;

alter table public.job_preferences enable trigger bump_job_preferences_version_trigger;
alter table public.job_preferences enable trigger mark_cv_analyses_stale_on_preferences_change_trigger;
