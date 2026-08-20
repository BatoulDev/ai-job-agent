-- Extends the location-requirement rule to include the "flexible" work
-- arrangement. Flexible includes on-site/hybrid opportunities, so users
-- must provide at least one preferred location — the same rule that
-- already applies to onsite and hybrid.
--
-- Two coordinated changes:
--
-- 1. Replaces save_job_preferences with an updated version that rejects
--    flexible + zero locations, matching the existing onsite/hybrid check.
--    All other logic is identical to 20260818090000_preferences_updated_lifecycle.sql.
--
-- 2. Updates get_onboarding_readiness() so that preferences_complete
--    requires a location when work_arrangement is flexible, matching the
--    server-side save rule.
--
-- src/lib/cvAnalysis/profileState.ts's isPreferencesComplete() must be
-- updated in the same change (kept in sync by convention — see that
-- file's comment).

-- ── 1. Replace save_job_preferences ──────────────────────────────────────────
-- Identical to 20260818090000 except the location-requirement check now
-- covers flexible in addition to onsite/hybrid.

create or replace function public.save_job_preferences(
  p_work_arrangement    text,
  p_job_market_coverage text,
  p_job_type            text,
  p_experience_level    text,
  p_additional_notes    text,
  p_custom_target_roles text[],
  p_custom_locations    text[],
  p_target_role_ids     text[],
  p_location_ids        text[]
)
returns public.job_preferences
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id          uuid := auth.uid();
  v_target_role_ids  text[];
  v_location_ids     text[];
  v_custom_roles     text[];
  v_custom_locations text[];
  v_role_count       integer;
  v_row              public.job_preferences;
  v_old_version      integer;
  v_old_role_ids     text[];
  v_old_location_ids text[];
  v_roles_changed    boolean;
  v_locs_changed     boolean;
  v_direct_changed   boolean;
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

  if array_length(v_location_ids, 1) > 0 then
    if (
      select count(*) from public.locations
      where slug = any(v_location_ids) and is_active
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

  -- Flexible includes on-site and hybrid opportunities, so at least one
  -- preferred location is required — same rule as onsite/hybrid.
  if p_work_arrangement in ('onsite', 'hybrid', 'flexible')
     and array_length(v_location_ids, 1) is null
     and array_length(v_custom_locations, 1) is null
  then
    raise exception 'At least one preferred location is required for On-site, Hybrid, or Flexible work arrangement.';
  end if;

  select version into v_old_version
  from public.job_preferences
  where user_id = v_user_id;

  insert into public.job_preferences (
    user_id, work_arrangement, job_market_coverage, job_type, experience_level,
    additional_notes, custom_target_roles, custom_locations
  )
  values (
    v_user_id, p_work_arrangement, p_job_market_coverage, p_job_type,
    p_experience_level,
    nullif(trim(coalesce(p_additional_notes, '')), ''),
    v_custom_roles, v_custom_locations
  )
  on conflict (user_id) do update set
    work_arrangement   = excluded.work_arrangement,
    job_market_coverage = excluded.job_market_coverage,
    job_type           = excluded.job_type,
    experience_level   = excluded.experience_level,
    additional_notes   = excluded.additional_notes,
    custom_target_roles = excluded.custom_target_roles,
    custom_locations   = excluded.custom_locations
  returning * into v_row;

  select array_agg(target_role_id order by target_role_id)
  into v_old_role_ids
  from public.job_preference_target_roles
  where job_preference_id = v_row.id;

  select array_agg(location_id order by location_id)
  into v_old_location_ids
  from public.job_preference_locations
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

  v_roles_changed := v_old_role_ids is distinct from (
    select array_agg(x order by x) from unnest(v_target_role_ids) as x
  );
  v_locs_changed := v_old_location_ids is distinct from (
    select array_agg(x order by x) from unnest(v_location_ids) as x
  );

  if v_roles_changed or v_locs_changed then
    update public.job_preferences
    set selection_version = selection_version + 1
    where id = v_row.id;
  end if;

  v_direct_changed := (v_old_version is not null) and (v_row.version > v_old_version);

  if v_old_version is not null and (v_direct_changed or v_roles_changed or v_locs_changed) then
    perform public.enqueue_preferences_analysis_task();
  end if;

  select * into v_row from public.job_preferences where id = v_row.id;
  return v_row;
end;
$$;

revoke execute on function public.save_job_preferences(text, text, text, text, text, text[], text[], text[], text[]) from public;
grant execute on function public.save_job_preferences(text, text, text, text, text, text[], text[], text[], text[]) to authenticated;

-- ── 2. Update get_onboarding_readiness ───────────────────────────────────────
-- Adds flexible to the work arrangements that require a preferred location.
-- Mirrors the save_job_preferences validation above exactly.

create or replace function public.get_onboarding_readiness()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles;
  v_cv public.cvs;
  v_prefs public.job_preferences;
  v_subscription public.subscriptions;
  v_cv_storage_object_exists boolean := false;
  v_plan_eligible boolean := false;
  v_preferences_complete boolean := false;
  v_has_active_task boolean := false;
  v_has_target_role boolean := false;
  v_has_location boolean := false;
  v_next_step text;
begin
  if v_user_id is null then
    return jsonb_build_object('authenticated', false, 'next_step', 'login');
  end if;

  select * into v_profile from public.profiles where id = v_user_id;
  select * into v_cv from public.cvs where user_id = v_user_id and is_active = true;
  select * into v_prefs from public.job_preferences where user_id = v_user_id;
  select * into v_subscription from public.subscriptions where user_id = v_user_id;

  if v_cv.storage_path is not null then
    select exists(
      select 1 from storage.objects
      where bucket_id = 'cvs' and name = v_cv.storage_path
    ) into v_cv_storage_object_exists;
  end if;

  if v_subscription.status = 'active'
     and (v_subscription.current_period_end is null or v_subscription.current_period_end > now())
  then
    v_plan_eligible := true;
  end if;

  if v_prefs.id is not null then
    -- Use coalesce(array_length(...), 0) so empty arrays evaluate to 0 > 0 = false,
    -- not null (PostgreSQL array_length('{}', 1) returns null, not 0).
    select exists(
      select 1 from public.job_preference_target_roles where job_preference_id = v_prefs.id
    ) or coalesce(array_length(v_prefs.custom_target_roles, 1), 0) > 0
    into v_has_target_role;

    select exists(
      select 1 from public.job_preference_locations where job_preference_id = v_prefs.id
    ) or coalesce(array_length(v_prefs.custom_locations, 1), 0) > 0
    into v_has_location;
  end if;

  v_preferences_complete := v_prefs.work_arrangement is not null
    and v_prefs.job_type is not null
    and v_prefs.experience_level is not null
    and v_profile.country_of_residence is not null
    and (v_profile.university_id is not null or v_profile.custom_university is not null)
    and (v_profile.major_id is not null or v_profile.custom_major is not null)
    and v_has_target_role
    and (v_prefs.work_arrangement not in ('onsite', 'hybrid', 'flexible') or v_has_location);

  if v_cv.id is not null then
    select exists(
      select 1 from public.analysis_tasks
      where cv_id = v_cv.id and status in ('pending', 'processing')
    ) into v_has_active_task;
  end if;

  v_next_step := case
    when v_profile.id is null then 'profile_missing'
    when not v_plan_eligible then 'plan'
    when v_cv.id is null or not v_cv_storage_object_exists then 'upload_cv'
    when not v_preferences_complete then 'preferences'
    else 'dashboard'
  end;

  return jsonb_build_object(
    'authenticated', true,
    'has_profile', v_profile.id is not null,
    'has_cv', v_cv.id is not null,
    'cv_storage_object_exists', v_cv_storage_object_exists,
    'cv_id', v_cv.id,
    'has_preferences', v_prefs.id is not null,
    'preferences_complete', v_preferences_complete,
    'plan_code', v_subscription.plan_code,
    'subscription_status', v_subscription.status,
    'plan_eligible', v_plan_eligible,
    'has_active_analysis_task', v_has_active_task,
    'onboarding_complete', v_next_step = 'dashboard',
    'next_step', v_next_step
  );
end;
$$;
