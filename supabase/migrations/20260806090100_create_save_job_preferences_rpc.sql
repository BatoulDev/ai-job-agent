-- save_job_preferences: single atomic entrypoint for the onboarding
-- preferences save flow, now that a save spans job_preferences plus two
-- join tables (job_preference_target_roles, job_preference_locations).
-- Wrapping all of it in one function body gives the multi-table write a
-- real transaction (AGENTS.md §18 — "use transactions for multi-step
-- writes that must succeed or fail together"), so a partial write (e.g.
-- job_preferences saved but roles only half-replaced) can't happen.
--
-- security invoker: runs as the calling user, so it relies on (and never
-- bypasses) the existing RLS policies on job_preferences and the two join
-- tables — a user can still only ever touch their own rows. The
-- job_preferences insert/update below also fires
-- enforce_job_preferences_eligibility_trigger exactly as a direct client
-- write would, so the country/plan geo rules are enforced here too.
--
-- Re-validates everything untrusted at the boundary (AGENTS.md §2/§6):
-- role/location ids must exist and be active, custom entries are
-- trimmed and case-insensitively deduplicated (and, for roles, deduped
-- against the selected reference roles too), and the combined role count
-- must be between 1 and 5.
create or replace function public.save_job_preferences(
  p_work_arrangement text,
  p_job_market_coverage text,
  p_job_type text,
  p_experience_level text,
  p_additional_notes text,
  p_custom_target_roles text[],
  p_custom_locations text[],
  p_target_role_ids text[],
  p_location_ids text[]
)
returns public.job_preferences
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_target_role_ids text[];
  v_location_ids text[];
  v_custom_roles text[];
  v_custom_locations text[];
  v_role_count integer;
  v_row public.job_preferences;
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

  -- Trim, drop blanks, dedupe case-insensitively, and exclude anything
  -- that duplicates an already-selected reference role's name.
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

  insert into public.job_preferences (
    user_id, work_arrangement, job_market_coverage, job_type, experience_level,
    additional_notes, custom_target_roles, custom_locations
  )
  values (
    v_user_id, p_work_arrangement, p_job_market_coverage, p_job_type, p_experience_level,
    nullif(trim(coalesce(p_additional_notes, '')), ''), v_custom_roles, v_custom_locations
  )
  on conflict (user_id) do update set
    work_arrangement = excluded.work_arrangement,
    job_market_coverage = excluded.job_market_coverage,
    job_type = excluded.job_type,
    experience_level = excluded.experience_level,
    additional_notes = excluded.additional_notes,
    custom_target_roles = excluded.custom_target_roles,
    custom_locations = excluded.custom_locations
  returning * into v_row;

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

  select * into v_row from public.job_preferences where id = v_row.id;
  return v_row;
end;
$$;

revoke execute on function public.save_job_preferences(text, text, text, text, text, text[], text[], text[], text[]) from public;
grant execute on function public.save_job_preferences(text, text, text, text, text, text[], text[], text[], text[]) to authenticated;
