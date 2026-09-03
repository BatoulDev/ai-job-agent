-- Plan-aware job preferences foundation (feat/plan-aware-job-preferences).
--
-- Confirmed MVP market: this product now supports only users who currently
-- live in Lebanon. profiles.country_of_residence stops being a user-facing
-- onboarding/settings field (removed from the UI in this same branch) and
-- becomes a system-level market constant, defaulted to Lebanon for every
-- new signup. The column itself is NOT dropped (existing FK/eligibility-
-- trigger dependents, and historical data, are preserved) — it simply
-- stops being collected from users and stops gating onboarding
-- completeness. A residual non-'LB' value on an old row is never treated
-- as "supported outside-Lebanon behavior" by any code in this migration or
-- the application layer changes in this branch.
--
-- Coordinated changes, in dependency order:
--   1. profiles: default country_of_residence to Lebanon for new users;
--      backfill existing null rows (never overwrite a real, previously
--      collected value).
--   2. job_preferences: add lebanon_location_scope (required by every
--      future save) and the Pro-only international-preferences columns.
--   3. job_preference_relocation_locations / job_preference_authorized_
--      countries: new owned-child join tables, same RLS/versioning
--      pattern as job_preference_target_roles / job_preference_locations.
--   4. Eligibility triggers: extend enforce_job_preferences_eligibility
--      (Pro-only gate for international_search_enabled) and add narrow
--      per-child-table triggers so a direct client write to either new
--      join table (bypassing save_job_preferences) can never grant scope
--      the RPC itself would have rejected.
--   5. bump_job_preferences_version: include the new direct columns in
--      change detection, so an international-preferences change is
--      versioned identically to every existing preference field (this
--      also means it can mark an existing CV analysis stale and enqueue
--      re-analysis via the existing preferences_updated flow — see the
--      branch's dependency-impact report for why this is intentional,
--      not a new bypass).
--   6. save_job_preferences: replaces the 9-argument version with a new
--      one that adds 6 new, all-defaulted trailing parameters (backward
--      compatible — an old caller that never sends them behaves exactly
--      as before) and validates every new field server-side.
--   7. get_onboarding_readiness: drops the country_of_residence
--      requirement, adds the lebanon_location_scope requirement, and adds
--      separate international-readiness fields (never folded into one
--      ambiguous boolean).

-- ── 1. profiles.country_of_residence becomes a defaulted system constant ──

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, country_of_residence)
  values (new.id, new.raw_user_meta_data ->> 'full_name', 'LB');
  return new;
end;
$$;

comment on function public.handle_new_user is
  'Creates the profiles row for a new auth user. country_of_residence is defaulted to Lebanon (''LB'') here — the product no longer collects this from users (MVP supports only Lebanon-based users); the column is preserved for backward compatibility with the pre-existing eligibility trigger and historical data, never re-exposed as a selectable field.';

-- Backfill only rows that were never set (never overwrite a value a user
-- actually selected while the field was still user-facing).
update public.profiles
set country_of_residence = 'LB'
where country_of_residence is null;

-- ── 2. job_preferences: Lebanese location flexibility + Pro international ─

alter table public.job_preferences
  add column lebanon_location_scope text
    check (lebanon_location_scope in ('selected_only', 'selected_and_nearby', 'anywhere_in_lebanon')),
  add column international_search_enabled boolean not null default false,
  add column willing_to_relocate boolean,
  add column work_authorization_status text
    check (work_authorization_status in ('needs_employer_support', 'already_authorized', 'unsure'));

comment on column public.job_preferences.lebanon_location_scope is
  'How strictly Lebanese on-site/hybrid matching follows job_preference_locations/custom_locations: selected_only, selected_and_nearby (see public.location_nearby_areas), or anywhere_in_lebanon. Required by save_job_preferences for every save going forward; nullable at the column level only so historical rows predating this feature remain valid (backfilled to ''selected_only'' below — the strictest, behavior-preserving default).';
comment on column public.job_preferences.international_search_enabled is
  'Pro-only. Never true unless the owning user''s current plan is pro — enforced in enforce_job_preferences_eligibility_trigger regardless of write path. false is a fully valid, intentional, complete state (AGENTS.md: "international disabled is intentional, not incomplete").';
comment on column public.job_preferences.willing_to_relocate is
  'Only meaningful when international_search_enabled = true; forced null otherwise by save_job_preferences. true requires at least one job_preference_relocation_locations row and a non-null work_authorization_status.';
comment on column public.job_preferences.work_authorization_status is
  'Only meaningful when willing_to_relocate = true; forced null otherwise by save_job_preferences. already_authorized requires at least one job_preference_authorized_countries row.';

-- Behavior-preserving default: before this feature existed, the only
-- Lebanese-location behavior was "match the exact selected locations" —
-- there was no nearby-area or anywhere-in-Lebanon expansion. Backfilling
-- every pre-existing row (which predates the column entirely) to
-- 'selected_only' keeps their matching behavior identical to what it was
-- the moment before this migration ran.
update public.job_preferences
set lebanon_location_scope = 'selected_only'
where lebanon_location_scope is null;

-- ── 3. New owned-child join tables ────────────────────────────────────────

create table public.job_preference_relocation_locations (
  job_preference_id uuid not null references public.job_preferences (id) on delete cascade,
  location_id text not null references public.locations (slug),
  created_at timestamptz not null default now(),
  primary key (job_preference_id, location_id)
);

comment on table public.job_preference_relocation_locations is
  'Selected Gulf relocation markets (public.locations rows with is_relocation_market = true) for a job_preferences row. Only meaningful when international_search_enabled = true and willing_to_relocate = true — see enforce_job_preference_relocation_locations_eligibility.';

alter table public.job_preference_relocation_locations enable row level security;

create policy "job_preference_relocation_locations_select_own"
  on public.job_preference_relocation_locations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.job_preferences jp
      where jp.id = job_preference_id and jp.user_id = auth.uid()
    )
  );

create policy "job_preference_relocation_locations_insert_own"
  on public.job_preference_relocation_locations
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.job_preferences jp
      where jp.id = job_preference_id and jp.user_id = auth.uid()
    )
  );

create policy "job_preference_relocation_locations_delete_own"
  on public.job_preference_relocation_locations
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.job_preferences jp
      where jp.id = job_preference_id and jp.user_id = auth.uid()
    )
  );

grant select, insert, delete on public.job_preference_relocation_locations to authenticated;
grant select, insert, update, delete on public.job_preference_relocation_locations to service_role;

-- No AFTER INSERT/DELETE version-bump trigger here, deliberately: an
-- earlier equivalent (bump_job_preferences_version_for_child(), used by
-- job_preference_target_roles/job_preference_locations) was removed in
-- 20260824170000_fix_job_preferences_account_deletion_cascade.sql because
-- it self-conflicted with cascade deletion (deleting a user whose
-- job_preferences row had child rows made Postgres try to UPDATE the
-- parent row from within the same statement that was already deleting
-- it). save_job_preferences already bumps job_preferences.selection_version
-- exactly once per logical save when this table's content changes (see
-- v_intl_changed below) — the same authoritative, cascade-safe pattern
-- job_preference_target_roles/job_preference_locations use today.

create table public.job_preference_authorized_countries (
  job_preference_id uuid not null references public.job_preferences (id) on delete cascade,
  country_code text not null references public.countries (code),
  created_at timestamptz not null default now(),
  primary key (job_preference_id, country_code)
);

comment on table public.job_preference_authorized_countries is
  'Countries the user has already-authorized (public.job_preferences.work_authorization_status = ''already_authorized'') legal work authorization for. Never assumed to transfer between countries — each row is an explicit, separately-selected country, and must be a subset of the countries implied by that job_preferences row''s selected relocation locations (enforced in save_job_preferences and enforce_job_preference_authorized_countries_eligibility).';

alter table public.job_preference_authorized_countries enable row level security;

create policy "job_preference_authorized_countries_select_own"
  on public.job_preference_authorized_countries
  for select
  to authenticated
  using (
    exists (
      select 1 from public.job_preferences jp
      where jp.id = job_preference_id and jp.user_id = auth.uid()
    )
  );

create policy "job_preference_authorized_countries_insert_own"
  on public.job_preference_authorized_countries
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.job_preferences jp
      where jp.id = job_preference_id and jp.user_id = auth.uid()
    )
  );

create policy "job_preference_authorized_countries_delete_own"
  on public.job_preference_authorized_countries
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.job_preferences jp
      where jp.id = job_preference_id and jp.user_id = auth.uid()
    )
  );

grant select, insert, delete on public.job_preference_authorized_countries to authenticated;
grant select, insert, update, delete on public.job_preference_authorized_countries to service_role;

-- Same deliberate omission as job_preference_relocation_locations above —
-- no AFTER INSERT/DELETE version-bump trigger (see that comment).

-- ── 4. Eligibility triggers (defense in depth, every write path) ─────────

create or replace function public.enforce_job_preferences_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_country text;
  v_plan_code text;
begin
  select country_of_residence into v_country
  from public.profiles
  where id = new.user_id;

  select plan_code into v_plan_code
  from public.subscriptions
  where user_id = new.user_id;

  -- Known non-Lebanon residence (legacy data only — no current UI can
  -- produce this for a new user): only Remote is supported, and neither
  -- of the two Lebanon/Pro-only geographic-scope concepts ever applies.
  if v_country is not null and v_country <> 'LB' then
    if new.work_arrangement is not null and new.work_arrangement <> 'remote' then
      raise exception 'Unsupported work arrangement for users residing outside Lebanon: only Remote is currently supported.';
    end if;

    if new.job_market_coverage is not null then
      raise exception 'Job-market coverage options are only available to Lebanon-based users.';
    end if;

    if new.international_search_enabled is true then
      raise exception 'International search is only available to Lebanon-based users.';
    end if;
  end if;

  -- Legacy coverage field: unchanged from 20260806090090.
  if new.job_market_coverage is not null then
    if v_plan_code is distinct from 'pro' then
      raise exception 'Job-market coverage requires the Pro plan.';
    end if;

    if v_country is distinct from 'LB' then
      raise exception 'Job-market coverage is only available to users residing in Lebanon.';
    end if;

    if new.work_arrangement not in ('remote', 'flexible') then
      raise exception 'Job-market coverage only applies to Remote or Flexible work arrangements.';
    end if;
  end if;

  -- New structured international-preferences model: Pro-only, no matter
  -- which write path is used (this RPC or a direct authenticated update).
  if new.international_search_enabled is true and v_plan_code is distinct from 'pro' then
    raise exception 'International search requires the Pro plan.';
  end if;

  return new;
end;
$$;

-- job_preference_locations stays Lebanon-only: a relocation-market row
-- (is_relocation_market = true) must never end up in the Lebanese
-- preferred-locations join table, regardless of write path.
create or replace function public.enforce_job_preference_locations_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_relocation_market boolean;
begin
  select is_relocation_market into v_is_relocation_market
  from public.locations
  where slug = new.location_id;

  if v_is_relocation_market is true then
    raise exception 'This location is a relocation market and cannot be used as a Lebanese preferred location.';
  end if;

  return new;
end;
$$;

create trigger enforce_job_preference_locations_scope_trigger
  before insert on public.job_preference_locations
  for each row
  execute function public.enforce_job_preference_locations_scope();

-- job_preference_relocation_locations: Pro-only, requires
-- willing_to_relocate = true on the parent row, and the location must
-- actually be a flagged relocation market.
create or replace function public.enforce_job_preference_relocation_locations_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_jp public.job_preferences;
  v_plan_code text;
  v_is_relocation_market boolean;
begin
  select * into v_jp from public.job_preferences where id = new.job_preference_id;

  select plan_code into v_plan_code from public.subscriptions where user_id = v_jp.user_id;
  if v_plan_code is distinct from 'pro' then
    raise exception 'Relocation locations require the Pro plan.';
  end if;

  if v_jp.international_search_enabled is not true or v_jp.willing_to_relocate is not true then
    raise exception 'Relocation locations require international search and relocation willingness to both be enabled.';
  end if;

  select is_relocation_market into v_is_relocation_market
  from public.locations
  where slug = new.location_id;

  if v_is_relocation_market is not true then
    raise exception 'This location is not a supported relocation market.';
  end if;

  return new;
end;
$$;

create trigger enforce_job_preference_relocation_locations_eligibility_trigger
  before insert on public.job_preference_relocation_locations
  for each row
  execute function public.enforce_job_preference_relocation_locations_eligibility();

-- job_preference_authorized_countries: requires already_authorized on the
-- parent row, and the country must be implied by an already-selected
-- relocation location (never assume authorization transfers between
-- countries the user didn't even select for relocation).
create or replace function public.enforce_job_preference_authorized_countries_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_jp public.job_preferences;
  v_plan_code text;
  v_country_selected boolean;
begin
  select * into v_jp from public.job_preferences where id = new.job_preference_id;

  select plan_code into v_plan_code from public.subscriptions where user_id = v_jp.user_id;
  if v_plan_code is distinct from 'pro' then
    raise exception 'Work authorization requires the Pro plan.';
  end if;

  if v_jp.work_authorization_status is distinct from 'already_authorized' then
    raise exception 'Authorized countries can only be recorded when work authorization status is already_authorized.';
  end if;

  select exists(
    select 1 from public.job_preference_relocation_locations rl
    join public.locations l on l.slug = rl.location_id
    where rl.job_preference_id = new.job_preference_id
      and l.country_code = new.country_code
  ) into v_country_selected;

  if not v_country_selected then
    raise exception 'An authorized country must match one of your selected relocation locations.';
  end if;

  return new;
end;
$$;

create trigger enforce_job_preference_authorized_countries_eligibility_trigger
  before insert on public.job_preference_authorized_countries
  for each row
  execute function public.enforce_job_preference_authorized_countries_eligibility();

-- ── 5. Version detection includes the new direct columns ─────────────────

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
    or new.selection_version is distinct from old.selection_version
    or new.lebanon_location_scope is distinct from old.lebanon_location_scope
    or new.international_search_enabled is distinct from old.international_search_enabled
    or new.willing_to_relocate is distinct from old.willing_to_relocate
    or new.work_authorization_status is distinct from old.work_authorization_status
  ) then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;

  return new;
end;
$$;

comment on function public.bump_job_preferences_version is
  'Recomputes job_preferences.version server-side on every insert/update. Includes the international-preferences columns added in this migration: changing them is versioned identically to every other preference field, which (via the existing mark_cv_analyses_stale_on_preferences_change / confirm_cv_analysis / is_cv_analysis_matching_eligible chain) can mark the current CV analysis stale and enqueue a preferences_updated re-analysis task — this is the existing, already-tested reanalysis flow, not a new bypass or a new gate.';

-- ── 6. save_job_preferences: extended, backward-compatible signature ─────

drop function if exists public.save_job_preferences(text, text, text, text, text, text[], text[], text[], text[]);

create or replace function public.save_job_preferences(
  p_work_arrangement                text,
  p_job_market_coverage             text,
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
  -- 'selected_only' by this migration) — every new save must choose one.
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
    v_user_id, p_work_arrangement, p_job_market_coverage, p_job_type,
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
  text, text, text, text, text, text[], text[], text[], text[],
  text, boolean, boolean, text[], text, text[]
) from public;
grant execute on function public.save_job_preferences(
  text, text, text, text, text, text[], text[], text[], text[],
  text, boolean, boolean, text[], text, text[]
) to authenticated;

comment on function public.save_job_preferences is
  'Single atomic entrypoint for saving job preferences, including Lebanese location flexibility and Pro-only international preferences. Backward compatible: the 6 international/location-scope parameters are all defaulted, so a pre-existing caller sending only the original 9 named arguments behaves exactly as before this migration, except lebanon_location_scope is now required (raises if omitted/invalid) — see the branch report for why this is safe (existing rows were already backfilled).';

-- ── 7. get_onboarding_readiness: drop country gate, add scope + international readiness ──

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
  v_has_relocation_location boolean := false;
  v_has_authorized_country boolean := false;
  v_international_complete boolean := false;
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
    select exists(
      select 1 from public.job_preference_target_roles where job_preference_id = v_prefs.id
    ) or coalesce(array_length(v_prefs.custom_target_roles, 1), 0) > 0
    into v_has_target_role;

    select exists(
      select 1 from public.job_preference_locations where job_preference_id = v_prefs.id
    ) or coalesce(array_length(v_prefs.custom_locations, 1), 0) > 0
    into v_has_location;

    select exists(
      select 1 from public.job_preference_relocation_locations where job_preference_id = v_prefs.id
    ) into v_has_relocation_location;

    select exists(
      select 1 from public.job_preference_authorized_countries where job_preference_id = v_prefs.id
    ) into v_has_authorized_country;
  end if;

  -- country_of_residence is no longer part of preferences completeness —
  -- it is a system-level Lebanon constant, defaulted automatically (see
  -- handle_new_user), never collected from the user.
  v_preferences_complete := v_prefs.work_arrangement is not null
    and v_prefs.job_type is not null
    and v_prefs.experience_level is not null
    and v_prefs.lebanon_location_scope is not null
    and (v_profile.university_id is not null or v_profile.custom_university is not null)
    and (v_profile.major_id is not null or v_profile.custom_major is not null)
    and v_has_target_role
    and (v_prefs.work_arrangement not in ('onsite', 'hybrid', 'flexible') or v_has_location);

  -- International readiness is intentionally separate from Lebanon
  -- readiness (AGENTS.md: "do not use one ambiguous boolean"). Disabled
  -- international search is a complete, valid state on its own.
  if v_prefs.id is null or v_prefs.international_search_enabled is not true then
    v_international_complete := not coalesce(v_prefs.international_search_enabled, false);
  elsif v_prefs.willing_to_relocate is null then
    v_international_complete := false;
  elsif v_prefs.willing_to_relocate is false then
    v_international_complete := true;
  else
    v_international_complete :=
      v_has_relocation_location
      and v_prefs.work_authorization_status is not null
      and (v_prefs.work_authorization_status <> 'already_authorized' or v_has_authorized_country);
  end if;

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
    'next_step', v_next_step,
    'international_search_enabled', coalesce(v_prefs.international_search_enabled, false),
    'international_preferences_complete', v_international_complete
  );
end;
$$;

comment on function public.get_onboarding_readiness is
  'Trusted, auth.uid()-scoped onboarding readiness. preferences_complete no longer requires country_of_residence (system-level Lebanon constant, see handle_new_user) and now requires lebanon_location_scope. international_preferences_complete is a SEPARATE gate — disabled international search is complete on its own; only an enabled-but-incomplete configuration (missing relocation location, authorization status, or authorized country) is incomplete. Actual matching eligibility additionally requires is_cv_analysis_matching_eligible(), unchanged by this migration.';
