-- Closes the gap between "user saves preferences" and "AI career profile
-- is refreshed." Five coordinated changes, applied in dependency order:
--
-- 1. Widens analysis_tasks.trigger to allow 'preferences_updated'.
--
-- 2. Adds job_preferences.selection_version: a signal column that
--    save_job_preferences bumps when the join-table selections change,
--    making those changes visible to the bump_job_preferences_version
--    BEFORE trigger (which only sees direct columns on the row itself).
--
-- 3. Updates bump_job_preferences_version to also bump version when
--    selection_version changes, so mark_cv_analyses_stale_on_preferences_
--    change fires for role/location changes identically to direct-column
--    changes.
--
-- 4. Adds enqueue_preferences_analysis_task(): a narrow SECURITY DEFINER
--    helper that save_job_preferences calls to queue a preferences_updated
--    task for the authenticated user's active CV. Defined before
--    save_job_preferences (its only caller) so the reference resolves cleanly.
--
-- 5. Replaces save_job_preferences with the full updated version that:
--    (a) captures job_preferences.version before the upsert so direct-column
--        changes can be detected after the trigger fires,
--    (b) captures join-table state before deletion for IS DISTINCT FROM
--        comparison,
--    (c) increments selection_version when join-table selections changed,
--    (d) calls enqueue_preferences_analysis_task() when anything changed AND
--        this is not the initial first save (first saves are handled by
--        /api/onboarding/complete via trigger = 'onboarding_completed').
--
-- No existing rows are affected adversely. selection_version defaults to 0;
-- the change-detection logic only bumps it on real future changes.

-- ── 1. Widen analysis_tasks.trigger ──────────────────────────────────────────

alter table public.analysis_tasks
  drop constraint analysis_tasks_trigger_check;

alter table public.analysis_tasks
  add constraint analysis_tasks_trigger_check
  check (trigger in ('onboarding_completed', 'cv_replaced', 'preferences_updated'));

-- ── 2. Add selection_version to job_preferences ───────────────────────────────

alter table public.job_preferences
  add column selection_version integer not null default 0;

comment on column public.job_preferences.selection_version is
  'Monotonically increasing counter bumped by save_job_preferences when the
sorted set of reference role or location IDs actually changes. Makes join-table
changes visible to bump_job_preferences_version (which only compares direct
columns on the job_preferences row). Never set by a client directly.';

-- ── 3. Update bump_job_preferences_version ────────────────────────────────────
-- Adds selection_version to the change-detection OR clause so that a join-
-- table-only change (which increments selection_version) still bumps version
-- and triggers mark_cv_analyses_stale_on_preferences_change. All other
-- clauses are unchanged from 20260806090060.

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
    new.target_roles          is distinct from old.target_roles
    or new.location           is distinct from old.location
    or new.work_arrangement   is distinct from old.work_arrangement
    or new.job_type           is distinct from old.job_type
    or new.experience_level   is distinct from old.experience_level
    or new.additional_notes   is distinct from old.additional_notes
    or new.job_market_coverage is distinct from old.job_market_coverage
    or new.custom_target_roles is distinct from old.custom_target_roles
    or new.custom_locations   is distinct from old.custom_locations
    or new.selection_version  is distinct from old.selection_version
  ) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;

  return new;
end;
$$;

-- ── 4. enqueue_preferences_analysis_task() ───────────────────────────────────
-- Defined before save_job_preferences (its only caller in this migration)
-- for clarity. Uses auth.uid() internally — never accepts a user_id
-- parameter — so it can only act for the authenticated caller.
--
-- SECURITY DEFINER: required because save_job_preferences is SECURITY
-- INVOKER (runs as the authenticated user), which has no EXECUTE grant on
-- create_analysis_task (service_role-only). A SECURITY DEFINER function
-- owned by postgres (the migration owner) can call create_analysis_task
-- regardless of the authenticated user's grants.
--
-- Granted to authenticated: save_job_preferences (SECURITY INVOKER,
-- running as the authenticated user) needs EXECUTE on its callees. Granting
-- to authenticated is safe because:
--   • auth.uid() restricts the action to the caller's own data.
--   • No active CV → silently returns, no task.
--   • create_analysis_task's partial-unique-index (analysis_tasks_one_active_
--     per_cv) prevents more than one active task per CV regardless of how
--     often this function is called.

create or replace function public.enqueue_preferences_analysis_task()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_cv_id   uuid;
begin
  if v_user_id is null then
    return;
  end if;

  select id into v_cv_id
  from public.cvs
  where user_id = v_user_id and is_active = true;

  if not found then
    return;
  end if;

  perform public.create_analysis_task(v_user_id, v_cv_id, 'preferences_updated');
end;
$$;

revoke execute on function public.enqueue_preferences_analysis_task() from public;
grant execute on function public.enqueue_preferences_analysis_task() to authenticated;

comment on function public.enqueue_preferences_analysis_task() is
  'Called by save_job_preferences when effective preferences change after the '
  'initial first save. Enqueues a preferences_updated analysis task for the '
  'authenticated user''s active CV via create_analysis_task. SECURITY DEFINER '
  'so it can call the service_role-only create_analysis_task. Uses auth.uid() '
  '— cannot impersonate. Idempotent: returns existing task if one is active.';

-- ── 5. Replace save_job_preferences ──────────────────────────────────────────
-- Extends 20260806090100 with:
--   • v_old_version: captures job_preferences.version before the upsert so
--     direct-column changes (detected by bump_job_preferences_version) can
--     be identified after the RETURNING value arrives.
--   • v_old_role_ids / v_old_location_ids: captured before deletion for IS
--     DISTINCT FROM comparison (same as before, documented here for clarity).
--   • Task-creation gate at the end: calls enqueue_preferences_analysis_task()
--     when v_old_version IS NOT NULL (not a first save) AND at least one
--     effective preference changed (direct column OR join table).
-- All validation logic is identical to the previous version.

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
  v_old_version      integer;   -- pre-upsert version; null = first save
  v_old_role_ids     text[];
  v_old_location_ids text[];
  v_roles_changed    boolean;
  v_locs_changed     boolean;
  v_direct_changed   boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- De-duplicate and normalise incoming arrays.
  v_target_role_ids := coalesce(
    (select array_agg(distinct x) from unnest(coalesce(p_target_role_ids, array[]::text[])) as x),
    array[]::text[]
  );
  v_location_ids := coalesce(
    (select array_agg(distinct x) from unnest(coalesce(p_location_ids, array[]::text[])) as x),
    array[]::text[]
  );

  -- Server-side validation of reference IDs.
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

  -- Clean and de-duplicate custom free-text values; exclude any that
  -- duplicate a selected reference role by name (case-insensitive).
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

  if p_work_arrangement in ('onsite', 'hybrid')
     and array_length(v_location_ids, 1) is null
     and array_length(v_custom_locations, 1) is null
  then
    raise exception 'At least one preferred location is required for On-site or Hybrid work arrangement.';
  end if;

  -- Capture the pre-upsert version so we can detect direct-column changes
  -- after bump_job_preferences_version fires during the upsert below.
  -- If no row exists yet (first save), v_old_version stays null — that is
  -- the sentinel for "this is the initial onboarding save; do not enqueue
  -- a preferences_updated task" (onboarding/complete handles first-save
  -- task creation with trigger = 'onboarding_completed').
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
  -- v_row.version is now post-trigger: bump_job_preferences_version set
  -- new.version = old.version + 1 if any direct column changed, or kept
  -- it the same. RETURNING reflects the post-BEFORE-trigger state.

  -- Capture join-table state BEFORE deletion so IS DISTINCT FROM can
  -- detect whether the reference-role or -location set actually changed.
  -- array_agg returns NULL (not []) when there are no rows — intentional:
  -- NULL IS DISTINCT FROM {x} = true (empty → non-empty → changed).
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

  -- IS DISTINCT FROM is null-safe: NULL IS DISTINCT FROM NULL = false
  -- (both empty → no change), NULL IS DISTINCT FROM {x} = true (changed).
  v_roles_changed := v_old_role_ids is distinct from (
    select array_agg(x order by x) from unnest(v_target_role_ids) as x
  );
  v_locs_changed := v_old_location_ids is distinct from (
    select array_agg(x order by x) from unnest(v_location_ids) as x
  );

  -- Increment selection_version when join-table content changed so that
  -- bump_job_preferences_version bumps version (and consequently
  -- mark_cv_analyses_stale_on_preferences_change marks the analysis stale).
  if v_roles_changed or v_locs_changed then
    update public.job_preferences
    set selection_version = selection_version + 1
    where id = v_row.id;
  end if;

  -- v_row.version (from UPSERT RETURNING) reflects only the direct-column
  -- trigger bump — before the selection_version UPDATE above. This is the
  -- correct value to compare against v_old_version to isolate direct-column
  -- changes from join-table changes (which are captured by v_roles_changed /
  -- v_locs_changed).
  v_direct_changed := (v_old_version is not null) and (v_row.version > v_old_version);

  -- Enqueue a preferences_updated analysis task when:
  --   (a) v_old_version is not null — not a first save (first saves use
  --       onboarding_completed via /api/onboarding/complete); AND
  --   (b) at least one effective preference actually changed.
  -- Deduplication is safe: if a pending/processing task already exists for
  -- this CV (e.g. an in-flight cv_replaced task), create_analysis_task
  -- returns the existing task and no duplicate is created.
  if v_old_version is not null and (v_direct_changed or v_roles_changed or v_locs_changed) then
    perform public.enqueue_preferences_analysis_task();
  end if;

  select * into v_row from public.job_preferences where id = v_row.id;
  return v_row;
end;
$$;

revoke execute on function public.save_job_preferences(text, text, text, text, text, text[], text[], text[], text[]) from public;
grant execute on function public.save_job_preferences(text, text, text, text, text, text[], text[], text[], text[]) to authenticated;
