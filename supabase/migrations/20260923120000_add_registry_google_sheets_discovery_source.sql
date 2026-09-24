-- Registry Sync — add google_sheets as a valid discovery_source.
--
-- Registry Sync's n8n workflow is replacing its impractical CSV-text-paste
-- input mode with a native Google Sheets read. This migration only widens
-- the accepted discovery_source vocabulary from ('manual', 'csv', 'apify')
-- to ('manual', 'csv', 'apify', 'google_sheets') everywhere it is checked:
-- the two provenance-column CHECK constraints (companies, company_sources),
-- the registry_sync_staging.discovery_source CHECK, and the same inline
-- validation inside resolve_registry_candidate().
--
-- Purely additive:
--   - csv is NOT removed from any accepted-values list. Historical
--     companies/company_sources rows created by the original CSV import
--     (scripts/import-company-registry.mjs) legitimately carry
--     discovery_source = 'csv' and must remain valid forever — this
--     migration does not touch a single existing row.
--   - No identity, dedup, staging, company-resolution, source-resolution,
--     review_status, or automation_eligibility logic is changed. The
--     resolve_registry_candidate() function body below is byte-identical
--     to the prior migration except for this one allow-list line and its
--     own doc comment.

alter table public.companies
  drop constraint companies_discovery_source_check;

alter table public.companies
  add constraint companies_discovery_source_check
  check (discovery_source is null or discovery_source in ('manual', 'csv', 'apify', 'google_sheets'));

comment on column public.companies.discovery_source is
  'First-discovery channel for this company row. Write-once: set on create, never changed by a later rediscovery through a different channel (see discovery_channels for that). One of manual/csv/apify/google_sheets — ai_agent and any future channel are deliberately not included yet (approved design Section 2; google_sheets added when Registry Sync replaced its CSV-paste input mode with a native Google Sheets read).';

alter table public.company_sources
  drop constraint company_sources_discovery_source_check;

alter table public.company_sources
  add constraint company_sources_discovery_source_check
  check (discovery_source is null or discovery_source in ('manual', 'csv', 'apify', 'google_sheets'));

comment on column public.company_sources.discovery_source is
  'First-discovery channel for this source row. Write-once — see companies.discovery_source for the identical convention, including the google_sheets addition.';

alter table public.registry_sync_staging
  drop constraint registry_sync_staging_discovery_source_check;

alter table public.registry_sync_staging
  add constraint registry_sync_staging_discovery_source_check
  check (discovery_source in ('manual', 'csv', 'apify', 'google_sheets'));

-- resolve_registry_candidate(): identical function body to the prior
-- migration (20260920090030) except the p_discovery_source allow-list on
-- the line below and its own doc comment. No resolution/staging/identity
-- logic changes.
create or replace function public.resolve_registry_candidate(
  p_discovery_source text,
  p_company_name text,
  p_country_code text default null,
  p_official_website_url text default null,
  p_official_careers_url text default null,
  p_company_id_hint text default null,
  p_ats_provider_hint text default null,
  p_discovery_run_id uuid default null,
  p_raw_payload jsonb default '{}'::jsonb
)
returns table (
  outcome text,
  out_company_id text,
  out_source_id text,
  out_staging_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized_name text;
  v_company_id text;
  v_company_created boolean := false;
  v_company_row public.companies;
  v_company_channels text[];
  v_matches text[];
  v_match_count int;
  v_base_slug text;
  v_slug text;
  v_suffix int;
  v_staging_reason text;
  v_staging_country_code text;
  v_staging_id uuid;
  v_normalized_key text;
  v_existing_source public.company_sources;
  v_source_channels text[];
  v_source_id text;
  v_base_source_slug text;
  v_inserted_id text;
begin
  -- ── Input contract validation — true adapter/programming errors only.
  -- Data-quality problems with the CANDIDATE itself (missing/invalid
  -- country, no usable URL, ambiguous company) are never a hard failure —
  -- they route to staging below, per the approved design's own staging
  -- reason list (Section 8/9).
  if p_discovery_source is null or p_discovery_source not in ('manual', 'csv', 'apify', 'google_sheets') then
    raise exception 'resolve_registry_candidate: p_discovery_source must be one of manual/csv/apify/google_sheets, got %', p_discovery_source
      using errcode = 'invalid_parameter_value';
  end if;

  if p_company_name is null or btrim(p_company_name) = '' then
    raise exception 'resolve_registry_candidate: p_company_name is required'
      using errcode = 'not_null_violation';
  end if;

  v_normalized_name := public.normalize_company_name(p_company_name);
  if v_normalized_name is null then
    raise exception 'resolve_registry_candidate: p_company_name has no normalizable characters'
      using errcode = 'invalid_parameter_value';
  end if;

  -- ── Company resolution ────────────────────────────────────────────────
  -- Trusted hint path: an adapter (typically CSV re-import) that already
  -- knows a real canonical id skips name resolution entirely — the exact
  -- trusted path scripts/import-company-registry.mjs already relies on
  -- today. A hint that does not resolve is NOT treated as a hard error
  -- (a stale/incorrect hint should not break an otherwise-valid candidate)
  -- — it is silently ignored and normal name-based resolution runs
  -- instead.
  if p_company_id_hint is not null then
    select * into v_company_row from public.companies where id = p_company_id_hint;
    if found then
      v_company_id := v_company_row.id;
    end if;
  end if;

  if v_company_id is null then
    -- Serialize concurrent attempts to resolve/create "the same" normalized
    -- name for the remainder of this transaction — see this migration's
    -- header for why a hard unique index is not safe here.
    perform pg_advisory_xact_lock(hashtext(v_normalized_name));

    select array_agg(id order by id) into v_matches
    from public.companies
    where public.normalize_company_name(display_name) = v_normalized_name;

    v_match_count := coalesce(array_length(v_matches, 1), 0);

    if v_match_count = 1 then
      v_company_id := v_matches[1];
    elsif v_match_count = 0 then
      -- New company. Deterministic slug from the normalized name, reusing
      -- this registry's own existing cc-<slug> convention (readable in
      -- git, consistent with every human-assigned id already in this
      -- table) — collision-checked against an id already in use for a
      -- DIFFERENT name (two different names slugifying to the same
      -- string is rare but not impossible) rather than assumed unique.
      v_base_slug := 'cc-' || regexp_replace(regexp_replace(v_normalized_name, '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g');
      v_slug := v_base_slug;
      v_suffix := 1;
      loop
        select * into v_company_row from public.companies where id = v_slug;
        exit when not found;
        v_suffix := v_suffix + 1;
        v_slug := v_base_slug || '-' || v_suffix;
      end loop;

      insert into public.companies (
        id, display_name, discovery_source, discovery_channels,
        discovery_run_id, first_discovered_at, last_seen_at
      )
      values (
        v_slug, p_company_name, p_discovery_source, array[p_discovery_source]::text[],
        p_discovery_run_id, now(), now()
      )
      returning id into v_company_id;
      v_company_created := true;
    else
      -- More than one existing company already shares this normalized name
      -- (only reachable once a name has already legitimately split, e.g. a
      -- third "Amazon" candidate) — cannot pick between two already-
      -- distinct companies without a stronger signal than name. Stage,
      -- never guess.
      v_staging_reason := 'ambiguous_company_multiple_matches';
    end if;
  end if;

  -- Rediscovery provenance for an EXISTING company (hint match or single
  -- name match) — a brand-new company already got this at INSERT time
  -- above, and an ambiguous (staged) resolution has no company row to
  -- update at all.
  if v_company_id is not null and not v_company_created then
    select discovery_channels into v_company_channels from public.companies where id = v_company_id;
    if v_company_channels is null or not (p_discovery_source = any(v_company_channels)) then
      v_company_channels := coalesce(v_company_channels, '{}'::text[]) || p_discovery_source;
    end if;
    update public.companies
    set last_seen_at = now(),
        discovery_channels = v_company_channels,
        discovery_run_id = coalesce(p_discovery_run_id, discovery_run_id)
        -- display_name and every other field: never touched here — a
        -- rediscovery reporting a different display name than what's on
        -- file must never silently overwrite it (approved design
        -- Section 10).
    where id = v_company_id;
  end if;

  -- ── Source-layer staging preconditions ──────────────────────────────
  -- Country: required for a canonical source row (company_sources_
  -- identity_key includes it), but its absence/invalidity is a candidate
  -- data-quality issue, not a caller programming error — stage, don't
  -- raise.
  if v_staging_reason is null then
    if p_country_code is null then
      v_staging_reason := 'missing_country';
    elsif not exists (select 1 from public.countries where code = p_country_code) then
      v_staging_reason := 'invalid_country';
    end if;
  end if;

  if v_staging_reason is null then
    v_normalized_key := coalesce(
      public.normalize_source_url(p_official_careers_url),
      public.normalize_source_url(p_official_website_url)
    );
    if v_normalized_key is null then
      v_staging_reason := 'no_resolvable_url';
    end if;
  end if;

  -- ── Staging path ─────────────────────────────────────────────────────
  if v_staging_reason is not null then
    -- registry_sync_staging.country_code carries the same FK to
    -- public.countries as company_sources.country_code — correctly so, it
    -- must never silently accept a typo'd code either. An invalid_country
    -- candidate's actual (bad) value is preserved verbatim in raw_payload
    -- for the reviewer; the FK-constrained column itself stores NULL for
    -- exactly this one reason, never the invalid code that caused it.
    -- Found by direct reproduction: inserting p_country_code='ZZ' here
    -- raised registry_sync_staging_country_code_fkey and rolled back the
    -- entire call (including a same-transaction company creation) before
    -- this fix — the correct failure mode structurally, but the wrong one
    -- for a candidate-quality issue that must stage, not raise.
    v_staging_country_code := case when v_staging_reason = 'invalid_country' then null else p_country_code end;

    -- Avoid uncontrolled duplicate staging rows: a repeated rediscovery of
    -- the same still-unresolved candidate updates the existing pending row
    -- instead of piling up a new one every run.
    select id into v_staging_id
    from public.registry_sync_staging
    where status = 'pending_review'
      and staging_reason = v_staging_reason
      and normalized_name is not distinct from v_normalized_name
      and country_code is not distinct from v_staging_country_code
      and normalized_source_key is not distinct from v_normalized_key
    limit 1;

    if v_staging_id is not null then
      update public.registry_sync_staging
      set raw_payload = p_raw_payload,
          discovery_run_id = coalesce(p_discovery_run_id, discovery_run_id),
          candidate_company_id = v_company_id,
          updated_at = now()
      where id = v_staging_id;
    else
      insert into public.registry_sync_staging (
        discovery_source, discovery_run_id, raw_payload, company_name, normalized_name,
        country_code, normalized_source_key, candidate_company_id, staging_reason
      )
      values (
        p_discovery_source, p_discovery_run_id, p_raw_payload, p_company_name, v_normalized_name,
        v_staging_country_code, v_normalized_key, v_company_id, v_staging_reason
      )
      returning id into v_staging_id;
    end if;

    return query select 'staged'::text, null::text, null::text, v_staging_id;
    return;
  end if;

  -- ── Source resolution ────────────────────────────────────────────────
  select * into v_existing_source
  from public.company_sources
  where company_id = v_company_id
    and country_code = p_country_code
    and normalized_source_key = v_normalized_key;

  if found then
    -- Rediscovery of an already-canonical source. review_status,
    -- automation_eligibility, and every display/metadata field are
    -- deliberately NEVER touched here — see this migration's header and
    -- the approved design's own Section 10/11 human-review protection.
    v_source_channels := v_existing_source.discovery_channels;
    if v_source_channels is null or not (p_discovery_source = any(v_source_channels)) then
      v_source_channels := coalesce(v_source_channels, '{}'::text[]) || p_discovery_source;
    end if;

    update public.company_sources
    set last_seen_at = now(),
        discovery_channels = v_source_channels,
        discovery_run_id = coalesce(p_discovery_run_id, discovery_run_id)
    where id = v_existing_source.id;

    return query select 'resolved_existing'::text, v_company_id, v_existing_source.id, null::uuid;
    return;
  end if;

  -- Same company + same country already has a DIFFERENT source on file —
  -- new information (a genuine second source, or a URL variant the
  -- normalizer did not catch), never auto-created as a second canonical
  -- row without review.
  if exists (
    select 1 from public.company_sources
    where company_id = v_company_id and country_code = p_country_code
  ) then
    v_staging_reason := 'possible_second_source_same_market';

    select id into v_staging_id
    from public.registry_sync_staging
    where status = 'pending_review'
      and staging_reason = v_staging_reason
      and normalized_name is not distinct from v_normalized_name
      and country_code is not distinct from p_country_code
      and normalized_source_key is not distinct from v_normalized_key
    limit 1;

    if v_staging_id is not null then
      update public.registry_sync_staging
      set raw_payload = p_raw_payload,
          discovery_run_id = coalesce(p_discovery_run_id, discovery_run_id),
          candidate_company_id = v_company_id,
          updated_at = now()
      where id = v_staging_id;
    else
      insert into public.registry_sync_staging (
        discovery_source, discovery_run_id, raw_payload, company_name, normalized_name,
        country_code, normalized_source_key, candidate_company_id, staging_reason
      )
      values (
        p_discovery_source, p_discovery_run_id, p_raw_payload, p_company_name, v_normalized_name,
        p_country_code, v_normalized_key, v_company_id, v_staging_reason
      )
      returning id into v_staging_id;
    end if;

    return query select 'staged'::text, null::text, null::text, v_staging_id;
    return;
  end if;

  -- ── Create new source ────────────────────────────────────────────────
  -- Deterministic id, mirroring the existing CSV's own source_record_id
  -- shape (sr-<country>-<slug>) for the same git-diffable-human-readable-id
  -- continuity reasoning as the company-id branch above. Collision-checked
  -- the same way.
  v_base_source_slug := 'sr-' || lower(p_country_code) || '-'
    || regexp_replace(regexp_replace(v_normalized_name, '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g');
  v_source_id := v_base_source_slug;
  v_suffix := 1;
  loop
    select * into v_existing_source from public.company_sources where id = v_source_id;
    exit when not found;
    v_suffix := v_suffix + 1;
    v_source_id := v_base_source_slug || '-' || v_suffix;
  end loop;

  insert into public.company_sources (
    id, company_id, company_name, target_country, country_code,
    official_website_url, official_careers_url, ats_provider, automation_eligibility,
    review_status, discovery_source, discovery_channels, discovery_run_id,
    first_discovered_at, last_seen_at
  )
  values (
    v_source_id, v_company_id, p_company_name,
    (select name from public.countries where code = p_country_code),
    p_country_code, p_official_website_url, p_official_careers_url,
    -- Matches this table's own pre-existing convention exactly: unclassified
    -- is the literal string 'unknown' (397/588 existing rows), never SQL
    -- NULL — confirmed load-bearing by direct testing: get_source_
    -- intelligence_candidates() filters on `ats_provider = 'unknown'`, a
    -- literal-string equality that NULL can never satisfy, so a NULL here
    -- would silently make every Registry-Sync-created source invisible to
    -- Source Intelligence's own candidate selection.
    coalesce(p_ats_provider_hint, 'unknown'),
    'unknown',
    -- Hard-coded, never a parameter this function accepts — Registry Sync
    -- structurally cannot create a pre-approved source (approved design
    -- Section 1/10, Phase 7 human-review protection).
    'needs_manual_review',
    p_discovery_source, array[p_discovery_source]::text[], p_discovery_run_id,
    now(), now()
  )
  on conflict (company_id, country_code, normalized_source_key) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is null then
    -- Lost a race against a concurrent caller creating the identical
    -- source — fetch what they created rather than erroring.
    select id into v_inserted_id
    from public.company_sources
    where company_id = v_company_id and country_code = p_country_code and normalized_source_key = v_normalized_key;
  end if;

  return query select 'created_new'::text, v_company_id, v_inserted_id, null::uuid;
end;
$$;

comment on function public.resolve_registry_candidate(text, text, text, text, text, text, text, uuid, jsonb) is
  'The single atomic database entry point for Registry Sync (manual/csv/apify/google_sheets alike, approved design Section 1/9). Never accepts review_status or automation_eligibility as a parameter — structurally cannot set either (Phase 7 human-review protection). Company and source resolution happen in one transaction: a source-write failure rolls back a just-created company. Ambiguous/incomplete candidates (staging_reason: ambiguous_company_multiple_matches | missing_country | invalid_country | no_resolvable_url | possible_second_source_same_market) are written to registry_sync_staging and never guessed into companies/company_sources. Idempotent: identical input, called any number of times or concurrently, resolves to the same company_id/source_id.';
