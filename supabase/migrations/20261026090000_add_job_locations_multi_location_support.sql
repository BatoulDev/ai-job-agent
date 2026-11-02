-- Phase 2 multi-location job support (Workday Sub-phase 2c follow-on,
-- approved product direction: "one canonical job, multiple independently
-- verified eligible locations — never duplicate rows per location, never
-- mislabel a Paris+Beirut job as Beirut-only"). Additive only: no existing
-- jobs column, constraint, or dedup key is touched. See the Phase 2
-- architecture review conversation for the full design history —
-- summarized inline below at each corrected decision point.
--
-- NOT applied by this migration file's mere existence — Checkpoint 1a is
-- drafting this file for review only. Applying it (even to the local
-- guarded test database) is a separate, explicitly approved Checkpoint 1b.

-- ── job_locations ───────────────────────────────────────────────────────
--
-- A job's PRIMARY location continues to live on jobs.location/country_code/
-- city exactly as today (unchanged, never removed) — this table is an
-- additive satellite of ADDITIONAL verified-eligible locations plus a
-- mirrored primary row, used only by the matching/eligibility read path
-- (never by anything that only needs the job's single headline location,
-- e.g. a job card — those keep reading jobs.location/city directly).
--
-- A row only ever exists here for a location that independently resolved
-- at medium/high confidence (never low) — see upsert_job_with_locations
-- below, which is the only writer. This is what makes "no new fail-open
-- eligibility path" true by construction rather than by a separate check.
create table public.job_locations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  country_code text not null references public.countries (code),
  city text,
  is_primary boolean not null default false,
  location_confidence text not null check (location_confidence in ('high', 'medium')),
  created_at timestamptz not null default now()
);

comment on table public.job_locations is
  'Additive, per-job set of independently-verified eligible locations (Phase 2 multi-location support). Every row is medium/high confidence by construction — a location that could not be resolved cleanly is never inserted here, it simply has no row. The job''s own jobs.location/country_code/city stay the authoritative single "headline" location for display, unchanged by this table''s existence. Written only by upsert_job_with_locations(); never written directly by application code or any client role.';

comment on column public.job_locations.is_primary is
  'True for the one row mirroring the job''s own jobs.location/country_code/city at the time it was last written (enforced to be at most one per job by job_locations_one_primary_per_job below). Never a second source of truth — upsert_job_with_locations() always derives both the jobs row and this row from the same input, in the same transaction, so they cannot drift.';

-- NULL-safe uniqueness: two Lebanese offices for the same job (e.g. Beirut
-- and Tripoli — same country_code, different city) are two distinct rows;
-- two rows for the same job+country with city IS NULL are correctly
-- treated as duplicates, which a plain multi-column unique index would not
-- do (SQL NULL <> NULL). Supersedes an earlier draft's (job_id,
-- country_code) primary key, which could not have represented two cities
-- in the same country for one job.
create unique index job_locations_job_country_city_key
  on public.job_locations (job_id, country_code, coalesce(city, ''));

-- At most one primary row per job — enforced, not just intended by
-- convention. upsert_job_with_locations() deletes the old primary row
-- (scoped to is_primary = true only, never touching additional rows)
-- before inserting the new one in the same transaction; this index is the
-- defense-in-depth backstop if that logic ever has a bug.
create unique index job_locations_one_primary_per_job
  on public.job_locations (job_id) where is_primary;

create index job_locations_job_id_idx on public.job_locations (job_id);

alter table public.job_locations enable row level security;

-- Same visibility rule as jobs_select_active (20260809090030): ordinary
-- users may read a job's structured locations only when the parent job
-- itself is active. No separate "admin sees everything" policy is added
-- here because job_locations carries no information beyond what the
-- already-existing jobs_select_admin policy already exposes via the
-- parent row.
create policy "job_locations_select_active_job"
  on public.job_locations
  for select
  to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and j.status = 'active'));

create policy "job_locations_select_admin"
  on public.job_locations
  for select
  to authenticated
  using (public.is_admin());

-- Direct table writes are never granted to `authenticated` at all — the
-- only write path is the security definer RPC below. This policy exists
-- only so an admin tool could, in principle, correct a row by hand
-- through the same trusted-role model jobs_admin_* already uses;
-- application code must never rely on it as the ingestion path.
create policy "job_locations_admin_write"
  on public.job_locations
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.job_locations to authenticated;

-- Deliberately SELECT-only for service_role — a SECURITY DEFINER function
-- runs with the privileges of its OWNER, not its caller, so
-- upsert_job_with_locations() below needs no INSERT/UPDATE/DELETE grant
-- on this table to do its own writes. Granting those directly to
-- service_role would open a second, ungoverned write path that bypasses
-- the RPC's allowlist validation, source re-verification, and scoped-
-- delete logic entirely. NOTE, stated plainly rather than overclaimed:
-- this narrows the SQL-level grant surface on THIS table within this
-- repository's own migrations — it is one layer of defense, not a
-- guarantee that service_role can never write here through some other
-- route (e.g. a broader schema-wide default-privilege grant configured
-- at the Supabase project level, outside any file in this repository).
-- That broader grant surface has not been audited as part of this change
-- and would need its own separate review before this guarantee could be
-- claimed as complete.
grant select on public.job_locations to service_role;

-- ── upsert_job_with_locations ───────────────────────────────────────────
--
-- The single, atomic, service_role-only entry point that writes one job
-- row AND its job_locations rows together — replacing the two-separate-
-- Supabase-requests design flagged as non-atomic during review. Mirrors
-- this codebase's existing atomic-multi-table-write convention
-- (resolve_registry_candidate, 20260920090030) rather than introducing a
-- new one.
--
-- Deliberately does NOT accept a free-form `status` column (unlike a
-- plain upsert would need to) — status is computed inside this function
-- from the primary location's own confidence plus whether any location
-- in p_locations independently resolved, never trusted from the caller.
-- This closes off (structurally, not just by validation) the possibility
-- of some future caller setting a job to 'rejected'/'source_error'/etc.
-- through the ingestion path, which must never be an ingestion-time
-- decision — same "cannot set, not just must not set" philosophy
-- resolve_registry_candidate already uses for review_status/
-- automation_eligibility.
--
-- p_job: an explicit allowlist of job columns (see v_allowed_job_keys
-- below) — never a wildcard INSERT ... SELECT * FROM jsonb_each(p_job).
-- An unexpected top-level key in p_job is a hard error, not silently
-- ignored, so a caller bug surfaces immediately rather than silently
-- writing fewer columns than intended.
--
-- p_locations: a jsonb array of {country_code, city, is_primary,
-- location_confidence} — already computed by deriveJobLocationRows() in
-- TypeScript (pure, offline, already reviewed); this function only
-- persists it, never re-derives location logic from raw text. Every
-- element is still independently validated and normalized on entry
-- (presence, JSON type, and — for location_confidence — allowed value)
-- before any of it is used, rather than trusting the TypeScript caller's
-- own correctness alone — the same defense-in-depth posture already
-- applied to source_id's review_status above.
--
-- p_replace_locations: false means "this run did not confirm the current
-- additional-location state" (e.g. the provider's additionalLocations
-- field was absent from the response, never merely empty) — in that case
-- ADDITIONAL rows (is_primary = false) for this job are left completely
-- untouched, no matter what p_locations contains for them. The PRIMARY
-- row is always refreshed regardless of this flag, exactly mirroring how
-- jobs.location/country_code/city are already unconditionally rewritten
-- every ingestion run today.
create or replace function public.upsert_job_with_locations(
  p_job jsonb,
  p_locations jsonb,
  p_replace_locations boolean
)
returns table (
  out_job_id uuid,
  out_created boolean,
  out_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed_job_keys text[] := array[
    'title', 'company_name', 'description', 'location', 'work_arrangement',
    'employment_type', 'seniority', 'application_method', 'application_url',
    'application_email', 'source_type', 'external_id', 'source_url', 'source_id',
    'country_code', 'city', 'remote_scope', 'published_at', 'source_last_modified_at',
    'closing_date', 'refresh_scope', 'first_seen_at', 'last_seen_at', 'last_checked_at',
    'last_successful_check_at'
  ];
  v_key text;
  v_source_id text;
  v_review_status text;
  v_job_id uuid;
  v_job_created boolean := false;
  v_primary_confidence text;
  v_has_any_qualifying_location boolean;
  v_computed_status text;
  v_loc jsonb;
  v_dedup_scope text;
  v_normalized_locations jsonb := '[]'::jsonb;
  v_is_primary boolean;
  v_location_confidence text;
begin
  -- ── Contract validation: programming errors only, never a data-quality
  -- outcome (those are rejected upstream by validateRawProviderJob before
  -- this function is ever called — see persistValidatedJobs).
  if p_job is null or jsonb_typeof(p_job) <> 'object' then
    raise exception 'upsert_job_with_locations: p_job must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;
  if p_locations is null or jsonb_typeof(p_locations) <> 'array' then
    raise exception 'upsert_job_with_locations: p_locations must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  -- Explicit per-element validation and normalization — every field read
  -- from an untrusted jsonb array element is checked for presence, type,
  -- and (for location_confidence) allowed value before it is ever used
  -- to compute status or written anywhere. Nothing downstream reads
  -- p_locations directly again after this loop; it always reads
  -- v_normalized_locations instead, so every later use already has a
  -- guaranteed-explicit, guaranteed-typed is_primary (never relying on
  -- plpgsql's "NULL is falsy" implicit behavior) and a guaranteed-valid
  -- location_confidence (never silently deferring to the table's own
  -- CHECK constraint to catch a bad value downstream).
  for v_loc in select * from jsonb_array_elements(p_locations) loop
    if jsonb_typeof(v_loc) <> 'object' then
      raise exception 'upsert_job_with_locations: every p_locations element must be a JSON object' using errcode = 'invalid_parameter_value';
    end if;

    if (v_loc ->> 'country_code') is null or btrim(v_loc ->> 'country_code') = '' then
      raise exception 'upsert_job_with_locations: p_locations element is missing a non-empty country_code' using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(v_loc -> 'country_code') <> 'string' then
      raise exception 'upsert_job_with_locations: p_locations.country_code must be a JSON string' using errcode = 'invalid_parameter_value';
    end if;

    if v_loc ? 'city' and v_loc -> 'city' is not null and jsonb_typeof(v_loc -> 'city') <> 'string' then
      raise exception 'upsert_job_with_locations: p_locations.city, when present, must be a JSON string or null' using errcode = 'invalid_parameter_value';
    end if;

    -- Explicit handling, not implicit: a missing key, a JSON null, or
    -- anything other than a real JSON boolean for is_primary is treated
    -- as "not primary" — stated here as a deliberate normalization step,
    -- never left for a later NULL-is-falsy comparison to decide quietly.
    if v_loc ? 'is_primary' and v_loc -> 'is_primary' is not null and jsonb_typeof(v_loc -> 'is_primary') <> 'boolean' then
      raise exception 'upsert_job_with_locations: p_locations.is_primary, when present, must be a JSON boolean' using errcode = 'invalid_parameter_value';
    end if;
    v_is_primary := coalesce((v_loc ->> 'is_primary')::boolean, false);

    v_location_confidence := v_loc ->> 'location_confidence';
    if v_location_confidence is null or v_location_confidence not in ('high', 'medium') then
      raise exception 'upsert_job_with_locations: p_locations.location_confidence must be exactly "high" or "medium", got %', v_location_confidence
        using errcode = 'invalid_parameter_value';
    end if;

    v_normalized_locations := v_normalized_locations || jsonb_build_array(jsonb_build_object(
      'country_code', v_loc ->> 'country_code',
      'city', v_loc ->> 'city',
      'is_primary', v_is_primary,
      'location_confidence', v_location_confidence
    ));
  end loop;

  -- Explicit allowlist enforcement — an unexpected key is a hard failure,
  -- not a silently-dropped one. status/id/created_at/updated_at/
  -- dedup_scope/closed_at/status_reason are deliberately NEVER in
  -- v_allowed_job_keys: status is computed below, id/created_at/
  -- updated_at/dedup_scope are database-managed, closed_at is trigger-
  -- managed (set_jobs_closed_at), and status_reason is explicitly cleared
  -- below (same as the existing TypeScript upsert already did).
  for v_key in select jsonb_object_keys(p_job) loop
    if not (v_key = any (v_allowed_job_keys)) then
      raise exception 'upsert_job_with_locations: p_job contains a disallowed key "%"', v_key
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  if (p_job ->> 'title') is null or btrim(p_job ->> 'title') = '' then
    raise exception 'upsert_job_with_locations: p_job.title is required' using errcode = 'not_null_violation';
  end if;
  if (p_job ->> 'company_name') is null or btrim(p_job ->> 'company_name') = '' then
    raise exception 'upsert_job_with_locations: p_job.company_name is required' using errcode = 'not_null_violation';
  end if;
  if (p_job ->> 'external_id') is null or btrim(p_job ->> 'external_id') = '' then
    raise exception 'upsert_job_with_locations: p_job.external_id is required' using errcode = 'not_null_violation';
  end if;

  -- ── Live source-identity re-verification — never trusts the caller's
  -- claim alone, same "never trust a cached approval" principle
  -- verifySourceForIngestion() already enforces one layer up in
  -- TypeScript. Re-checked here too, inside the elevated-privilege
  -- function, as defense-in-depth against any OTHER future service_role
  -- caller that might invoke this RPC with a stale or forged source_id.
  v_source_id := p_job ->> 'source_id';
  if v_source_id is not null then
    select review_status into v_review_status from public.company_sources where id = v_source_id;
    if not found then
      raise exception 'upsert_job_with_locations: source_id "%" does not exist', v_source_id using errcode = 'invalid_parameter_value';
    end if;
    if v_review_status <> 'verified' then
      raise exception 'upsert_job_with_locations: source_id "%" is not verified (review_status=%)', v_source_id, v_review_status
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- ── Compute status internally — never accepted from the caller.
  -- Primary confidence comes from the one p_locations element the
  -- TypeScript caller marked is_primary=true (if it resolved at all);
  -- "qualifying" additional locations are every OTHER medium/high-
  -- confidence element. A job is pending_review only when BOTH the
  -- primary is absent/unresolved AND no additional location qualifies —
  -- the corrected rule from the architecture review: a confirmed
  -- high-confidence additional location (e.g. Beirut) must be able to
  -- move a job from pending_review to active even when its primary
  -- (e.g. a garbled text) could not resolve on its own, and the reverse
  -- must also hold if that additional location is later confirmed absent.
  -- Reads v_normalized_locations (validated/normalized above), never
  -- p_locations directly — is_primary here is always a real boolean, not
  -- a comparison against a possibly-NULL raw value.
  select (elem ->> 'location_confidence')
    into v_primary_confidence
    from jsonb_array_elements(v_normalized_locations) as elem
    where (elem ->> 'is_primary')::boolean = true
    limit 1;

  select exists (
    select 1 from jsonb_array_elements(v_normalized_locations) as elem
    where (elem ->> 'is_primary')::boolean = false
  ) into v_has_any_qualifying_location;

  v_computed_status := case
    when v_primary_confidence in ('high', 'medium') then 'active'
    when v_has_any_qualifying_location then 'active'
    else 'pending_review'
  end;

  -- ── Upsert the jobs row. Deliberately selects the existing row first
  -- (not just relying on the upsert's own conflict detection) so
  -- out_created is reported correctly without a second round trip.
  v_dedup_scope := case when v_source_id is not null then 'src:' || v_source_id else 'type:' || (p_job ->> 'source_type') end;

  select id into v_job_id from public.jobs where dedup_scope = v_dedup_scope and external_id = (p_job ->> 'external_id');
  v_job_created := (v_job_id is null);

  insert into public.jobs (
    title, company_name, description, location, work_arrangement, employment_type,
    seniority, application_method, application_url, application_email, source_type,
    external_id, source_url, source_id, country_code, city, remote_scope,
    published_at, source_last_modified_at, closing_date, refresh_scope,
    first_seen_at, last_seen_at, last_checked_at, last_successful_check_at,
    status, status_reason
  ) values (
    p_job ->> 'title', p_job ->> 'company_name', p_job ->> 'description', p_job ->> 'location',
    p_job ->> 'work_arrangement', p_job ->> 'employment_type', p_job ->> 'seniority',
    p_job ->> 'application_method', p_job ->> 'application_url', p_job ->> 'application_email',
    p_job ->> 'source_type', p_job ->> 'external_id', p_job ->> 'source_url', v_source_id,
    p_job ->> 'country_code', p_job ->> 'city', p_job ->> 'remote_scope',
    (p_job ->> 'published_at')::timestamptz, (p_job ->> 'source_last_modified_at')::timestamptz,
    (p_job ->> 'closing_date')::timestamptz, p_job ->> 'refresh_scope',
    coalesce((p_job ->> 'first_seen_at')::timestamptz, now()), (p_job ->> 'last_seen_at')::timestamptz,
    (p_job ->> 'last_checked_at')::timestamptz, (p_job ->> 'last_successful_check_at')::timestamptz,
    v_computed_status, null
  )
  on conflict (dedup_scope, external_id) do update set
    title = excluded.title, company_name = excluded.company_name, description = excluded.description,
    location = excluded.location, work_arrangement = excluded.work_arrangement,
    employment_type = excluded.employment_type, seniority = excluded.seniority,
    application_method = excluded.application_method, application_url = excluded.application_url,
    application_email = excluded.application_email, source_url = excluded.source_url,
    country_code = excluded.country_code, city = excluded.city, remote_scope = excluded.remote_scope,
    published_at = excluded.published_at, source_last_modified_at = excluded.source_last_modified_at,
    closing_date = excluded.closing_date, refresh_scope = excluded.refresh_scope,
    last_seen_at = excluded.last_seen_at, last_checked_at = excluded.last_checked_at,
    last_successful_check_at = excluded.last_successful_check_at,
    status = excluded.status, status_reason = null
  returning id into v_job_id;

  -- ── job_locations: primary and additional rows are independently
  -- scoped deletes — never one combined "delete everything for this
  -- job" statement, which would wrongly wipe preserved additional rows
  -- when only the primary needed refreshing this run.
  delete from public.job_locations where job_id = v_job_id and is_primary = true;

  if p_replace_locations then
    delete from public.job_locations where job_id = v_job_id and is_primary = false;
  end if;

  -- Reads v_normalized_locations — every element here already has an
  -- explicit, real boolean is_primary (never a raw NULL comparison) and
  -- an already-validated location_confidence.
  for v_loc in select * from jsonb_array_elements(v_normalized_locations) loop
    if (v_loc ->> 'is_primary')::boolean = true or p_replace_locations then
      insert into public.job_locations (job_id, country_code, city, is_primary, location_confidence)
      values (v_job_id, v_loc ->> 'country_code', v_loc ->> 'city', (v_loc ->> 'is_primary')::boolean, v_loc ->> 'location_confidence')
      -- Expression-based conflict target requires its own delimiting
      -- parens around the expression — (coalesce(city, '')), not a bare
      -- coalesce(city, '') — to correctly match
      -- job_locations_job_country_city_key's definition above.
      on conflict (job_id, country_code, (coalesce(city, ''))) do update set
        is_primary = excluded.is_primary, location_confidence = excluded.location_confidence;
    end if;
  end loop;

  return query select v_job_id, v_job_created, v_computed_status;
end;
$$;

comment on function public.upsert_job_with_locations is
  'The single atomic entry point for Phase 2 multi-location ingestion writes (jobs row + job_locations rows together, one transaction, one call per job — never a batch-wide multi-row statement, so one job failing can never roll back a different job already committed in the same run). Validates p_job against an explicit column allowlist (never a wildcard column mapping), re-verifies source_id review_status internally even though the caller already checked it, and computes status itself rather than accepting it as a parameter. additional-location rows (is_primary=false) are only ever replaced when p_replace_locations is true — meaning the caller explicitly confirmed the provider response''s current additionalLocations state this run, never merely inferred it from an absent field. service_role only — see the revoke/grant pair below.';

revoke execute on function public.upsert_job_with_locations(jsonb, jsonb, boolean) from public;
grant execute on function public.upsert_job_with_locations(jsonb, jsonb, boolean) to service_role;

-- ── Backfill for the existing jobs (Checkpoint 1b will run this; drafted
-- here so the file is complete and reviewable as one unit) ─────────────
--
-- Mirrors deriveEligibilityLocation()'s own live confidence rule exactly
-- (src/lib/ingestion/jobEligibilityLocation.ts) rather than a separate,
-- possibly-divergent assumption: a job with country_code already set is
-- "high" confidence UNLESS it is simultaneously remote with no stated
-- remote_scope, which that function already treats as "medium". Jobs
-- with country_code null (already pending_review/unresolved, including
-- intentionally-unlocated admin_manual rows) correctly backfill zero
-- rows — no special-casing needed, this is the existing "falls back to
-- unchanged scalar-only behavior" case.
insert into public.job_locations (job_id, country_code, city, is_primary, location_confidence)
select
  id,
  country_code,
  city,
  true,
  case when work_arrangement = 'remote' and remote_scope is null then 'medium' else 'high' end
from public.jobs
where country_code is not null;
