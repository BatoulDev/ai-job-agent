-- Checkpoint 2C corrective fix (NEW, additive migration — the previously
-- applied 20261026090000_add_job_locations_multi_location_support.sql is
-- NOT edited or replayed; it already ran against this local database and
-- its 852-job baseline). Fixes two regressions found reviewing that
-- migration's upsert_job_with_locations function, both corrected here via
-- a straight CREATE OR REPLACE of the same function — no table, column,
-- grant, or signature change. See the corrective design-review
-- conversation for the full analysis; summarized at each fix below.

-- Bug 1 — p_locations.city: comparing a jsonb value with "IS NOT NULL"
-- checks for SQL NULL, which a JSON null literal is not (a jsonb datum
-- holding JSON null is itself non-null). That let a genuinely-null city
-- (e.g. Lebanon, country-only) fall through to the type check and get
-- rejected. Fixed by checking jsonb_typeof() alone, which correctly
-- reports 'null' for a JSON null and distinguishes it from every invalid
-- type (number/bool/array/object).

-- Bug 2 — is_primary: the ORIGINAL migration's own comment claimed "a
-- missing key, a JSON null, or anything other than a real JSON boolean...
-- is treated as not primary", but the code actually raised an exception
-- for explicit JSON null (the same IS NOT NULL pitfall as bug 1) —
-- comment and code disagreed. This corrective round makes rejection of
-- explicit null the deliberately intended behavior (not an accident of
-- the jsonb-null trap): is_primary, when the key is present, must be a
-- genuine JSON boolean — null and every other type are hard errors.
-- Missing key is unaffected (still silently "not primary").

-- Bug 3 (the real regression) — a country-less Remote job (explicit scope
-- e.g. "worldwide"/"region:mena", confidence high; or no scope at all,
-- confidence medium) never produces a p_locations row at all —
-- deriveJobLocationRows() correctly never writes a job_locations row
-- without a country (that table's country_code is NOT NULL/FK — there is
-- nowhere to put "remote, no country"). But the RPC's status computation
-- only trusted p_locations, so both cases silently downgraded to
-- pending_review — a real behavior change from the pre-Phase-2
-- mapRawProviderJobToJobRow, which computed status from
-- location.locationConfidence directly (only 'low' ever meant
-- pending_review, independent of whether a country resolved).
--
-- Fixed by accepting one new, strictly-validated, NEVER-persisted p_job
-- key: primary_location_confidence — the exact same already-computed,
-- already-reviewed normalizeLocation().locationConfidence value for the
-- primary candidate, passed through rather than silently dropped. It is
-- used ONLY as a last-resort fallback, and ONLY when BOTH of the
-- following hold:
--   (a) work_arrangement = 'remote' — a high/medium confidence value
--       alone must never activate an unresolved NON-remote job (an
--       onsite/hybrid/flexible job with a garbled location stays
--       pending_review exactly as before, regardless of what this field
--       says);
--   (b) no p_locations row already qualified (primary or additional) —
--       a country-resolved primary or a confirmed additional location
--       still decides status outright, unchanged (Paris-primary +
--       Beirut-additional, every single-location provider: this fallback
--       never runs for them).
-- 'low' never activates anything through this field, same bar
-- location_confidence already enforces for stored job_locations rows.
--
-- Deliberately NOT a second source of geographic eligibility: this only
-- decides whether the job is listed at all (status). Whether a specific
-- Lebanon-based user is actually eligible for a remote job stays entirely
-- governed by remote_scope + deriveEligibilityLocation/
-- checkJobEligibility downstream — untouched by this migration. A remote
-- job activated via this fallback with remote_scope = null (the
-- ambiguous-medium case) is exactly as eligible-or-not as it already was
-- under the pre-Phase-2 code: this fix restores old status parity, it
-- does not invent new eligibility.
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
    'last_successful_check_at',
    -- The one allowlisted key deliberately never written to public.jobs —
    -- see the Bug 3 header comment above. Validated below, consulted only
    -- as a narrowly-gated status fallback.
    'primary_location_confidence'
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
  v_primary_location_confidence text;
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

    -- FIX (bug 1): jsonb_typeof() alone correctly distinguishes a real
    -- JSON null ('null') from a JSON string ('string') and every invalid
    -- type — never an "IS NOT NULL" comparison against a jsonb value,
    -- which is true even when that value holds a JSON null literal.
    -- Allows a genuinely-null city (e.g. Lebanon, country-only) through;
    -- still rejects number/bool/array/object.
    if v_loc ? 'city' and jsonb_typeof(v_loc -> 'city') not in ('null', 'string') then
      raise exception 'upsert_job_with_locations: p_locations.city, when present, must be a JSON string or null' using errcode = 'invalid_parameter_value';
    end if;

    -- FIX (bug 2): is_primary, when the key is present, must be a genuine
    -- JSON boolean — jsonb_typeof() reports 'null' for an explicit JSON
    -- null, which is deliberately NOT in the allowed set below, so it is
    -- rejected outright rather than silently defaulting (the original
    -- migration's comment claimed the latter; this corrective version
    -- makes rejection the actual, intended, documented behavior). A
    -- missing key is unaffected — v_loc ? 'is_primary' is false, so the
    -- check is skipped and the coalesce below still yields false.
    if v_loc ? 'is_primary' and jsonb_typeof(v_loc -> 'is_primary') <> 'boolean' then
      raise exception 'upsert_job_with_locations: p_locations.is_primary, when present, must be a genuine JSON boolean (null is not accepted)' using errcode = 'invalid_parameter_value';
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
  -- not a silently-dropped one.
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

  -- FIX (bug 3) validation: same explicit-allowlist posture as
  -- location_confidence above — an unrecognized value is a hard error,
  -- never silently ignored. Absent key (pre-fix caller) is valid and
  -- simply disables the fallback below (v_primary_location_confidence
  -- stays null, which never matches the 'high'/'medium' check).
  v_primary_location_confidence := p_job ->> 'primary_location_confidence';
  if v_primary_location_confidence is not null and v_primary_location_confidence not in ('high', 'medium', 'low') then
    raise exception 'upsert_job_with_locations: p_job.primary_location_confidence, when present, must be "high", "medium", or "low", got %', v_primary_location_confidence
      using errcode = 'invalid_parameter_value';
  end if;

  -- ── Live source-identity re-verification — unchanged.
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

  select (elem ->> 'location_confidence')
    into v_primary_confidence
    from jsonb_array_elements(v_normalized_locations) as elem
    where (elem ->> 'is_primary')::boolean = true
    limit 1;

  select exists (
    select 1 from jsonb_array_elements(v_normalized_locations) as elem
    where (elem ->> 'is_primary')::boolean = false
  ) into v_has_any_qualifying_location;

  -- FIX (bug 3): a country-resolved primary or a confirmed qualifying
  -- additional location still wins outright, unchanged (Paris-primary/
  -- Beirut-additional, every single-location provider — this fallback
  -- branch is never reached for them). ONLY when p_locations carried no
  -- qualifying row at all does the new fallback apply, and ONLY for a
  -- stated-remote job — a high/medium primary_location_confidence can
  -- never activate an unresolved non-remote job.
  v_computed_status := case
    when v_primary_confidence in ('high', 'medium') then 'active'
    when v_has_any_qualifying_location then 'active'
    when (p_job ->> 'work_arrangement') = 'remote' and v_primary_location_confidence in ('high', 'medium') then 'active'
    else 'pending_review'
  end;

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

  delete from public.job_locations where job_id = v_job_id and is_primary = true;

  if p_replace_locations then
    delete from public.job_locations where job_id = v_job_id and is_primary = false;
  end if;

  for v_loc in select * from jsonb_array_elements(v_normalized_locations) loop
    if (v_loc ->> 'is_primary')::boolean = true or p_replace_locations then
      insert into public.job_locations (job_id, country_code, city, is_primary, location_confidence)
      values (v_job_id, v_loc ->> 'country_code', v_loc ->> 'city', (v_loc ->> 'is_primary')::boolean, v_loc ->> 'location_confidence')
      on conflict (job_id, country_code, (coalesce(city, ''))) do update set
        is_primary = excluded.is_primary, location_confidence = excluded.location_confidence;
    end if;
  end loop;

  return query select v_job_id, v_job_created, v_computed_status;
end;
$$;

comment on function public.upsert_job_with_locations is
  'Checkpoint 2C corrective version (20261027090000, applied over the already-live 20261026090000 function — same 3-arg signature, SECURITY DEFINER, and grants). Fixes: (1) a genuinely-null p_locations.city is now accepted (jsonb-null-vs-SQL-null comparison bug); (2) p_locations.is_primary now explicitly rejects JSON null as intended (the original comment claimed graceful fallback; the code never actually did that — this version makes rejection deliberate); (3) a country-less Remote job with explicit scope (high) or ambiguous-but-non-low confidence (medium) is active again via the new primary_location_confidence fallback, gated to work_arrangement=''remote'' AND no qualifying p_locations row — never persisted, never usable to activate a non-remote job, never a geographic-eligibility signal (remote_scope/deriveEligibilityLocation remain the sole eligibility path). Everything else matches 20261026090000 unchanged.';

revoke execute on function public.upsert_job_with_locations(jsonb, jsonb, boolean) from public;
grant execute on function public.upsert_job_with_locations(jsonb, jsonb, boolean) to service_role;
