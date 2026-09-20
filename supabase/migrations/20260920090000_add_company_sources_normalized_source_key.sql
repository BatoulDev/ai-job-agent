-- Registry Sync P0, migration 1 of 4 — conservative source-URL normalization
-- + a company/country-scoped source identity key, per the approved final
-- design (Registry Sync Final Database Design, 2026-09-20, Section 5/6/8/14).
--
-- Corrects a proposal from the earlier read-only readiness audit, which
-- suggested UNIQUE(company_id, normalized_url). Simulated read-only against
-- the live 588 company_sources rows before writing any SQL: that key
-- collides on 10 real existing company/country pairs (Netways x4,
-- PwC x4, Talabat x3, People365 x3, Newtecx x3, Al Tamimi x2, Hilton x2,
-- Tabby x2, Apparel Group x2, Foodics x2) — every one of them a legitimate
-- multinational company reusing one group-wide careers URL across several
-- of this registry's markets. UNIQUE(company_id, country_code,
-- normalized_source_key) — this migration's actual key — was simulated
-- against the same 588 rows and produced ZERO collisions.
--
-- Deliberately conservative normalization (approved design Section 5):
-- lowercase scheme+host, strip a leading "www.", strip default ports,
-- collapse repeated slashes, strip one trailing slash, drop the fragment,
-- map known "we don't actually know" sentinel strings ("unknown",
-- "not_verified", "none found", ...) to NULL. Query strings, path case,
-- percent-encoding, locale/regional path segments (e.g. /en_sa, /m1/en),
-- and ATS tenant identifiers are left completely untouched — confirmed
-- load-bearing in this exact data (Accor's Qatar careers URL encodes the
-- market in a query string; EY/KPMG/Deloitte's per-country pages are
-- distinguished only by their locale path segment). No network access, no
-- redirect-following — pure, deterministic, IMMUTABLE string manipulation
-- only, matching what a generated column requires.

create or replace function public.normalize_source_url(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_raw text;
  v_scheme text;
  v_rest text;
  v_host text;
  v_port text;
  v_path text;
  v_query text;
  v_fragment_idx int;
  v_slash_idx int;
  v_query_idx int;
  v_colon_idx int;
begin
  if p_url is null then
    return null;
  end if;

  v_raw := btrim(p_url);
  if v_raw = '' then
    return null;
  end if;

  -- Known "we don't actually know" sentinel strings already used throughout
  -- the hand-curated registry (docs/job-source-discovery/*.csv) — never a
  -- real URL, and must never become a false identity claim.
  if lower(v_raw) in (
    'unknown', 'not_verified', 'not verified', 'none found',
    'not found', 'not_found', 'n/a', 'na', 'not_applicable'
  ) then
    return null;
  end if;
  if lower(v_raw) like 'not\_applicable%' escape '\' or lower(v_raw) like 'not applicable%' then
    return null;
  end if;

  -- Only ever normalizes a real http(s) URL. Anything else (descriptive
  -- prose, a bare domain with no scheme) is left fully unresolved rather
  -- than guessed at — this is exactly what routes a candidate to staging
  -- (registry_sync_staging, added in a later migration in this set), never
  -- a silently-coerced fake identity.
  if v_raw !~* '^https?://' then
    return null;
  end if;

  v_scheme := lower(substring(v_raw from '^(https?)://'));
  v_rest := substring(v_raw from '^https?://(.*)$');

  -- Fragment: dropped, never server-meaningful.
  v_fragment_idx := position('#' in v_rest);
  if v_fragment_idx > 0 then
    v_rest := left(v_rest, v_fragment_idx - 1);
  end if;

  -- Split host[:port] from /path[?query].
  v_slash_idx := position('/' in v_rest);
  if v_slash_idx > 0 then
    v_host := left(v_rest, v_slash_idx - 1);
    v_path := substring(v_rest from v_slash_idx);
  else
    v_host := v_rest;
    v_path := '';
  end if;

  -- Query string: left completely untouched (see this migration's header —
  -- confirmed identity-bearing in this exact data).
  v_query_idx := position('?' in v_path);
  if v_query_idx > 0 then
    v_query := substring(v_path from v_query_idx);
    v_path := left(v_path, v_query_idx - 1);
  else
    v_query := '';
  end if;

  -- Host: lowercase, strip a default port, strip a leading "www.".
  v_colon_idx := position(':' in v_host);
  if v_colon_idx > 0 then
    v_port := substring(v_host from v_colon_idx + 1);
    v_host := left(v_host, v_colon_idx - 1);
  else
    v_port := '';
  end if;
  v_host := lower(v_host);
  if left(v_host, 4) = 'www.' then
    v_host := substring(v_host from 5);
  end if;
  if v_port in ('80', '443') then
    v_port := '';
  end if;

  if v_host = '' then
    -- Malformed (e.g. "https:///careers") — not a real URL, do not guess.
    return null;
  end if;

  -- Path: collapse repeated slashes, strip exactly one trailing slash
  -- (never the bare root "/"). Case, percent-encoding, and every path
  -- segment (including locale/regional segments) are left untouched.
  if v_path = '' then
    v_path := '/';
  end if;
  v_path := regexp_replace(v_path, '/{2,}', '/', 'g');
  if length(v_path) > 1 and right(v_path, 1) = '/' then
    v_path := left(v_path, length(v_path) - 1);
  end if;

  return v_scheme || '://' || v_host
    || (case when v_port <> '' then ':' || v_port else '' end)
    || v_path || v_query;
end;
$$;

comment on function public.normalize_source_url(text) is
  'Deliberately conservative source-URL normalizer for Registry Sync identity (approved design Section 5): lowercase scheme/host, strip www./default-port/trailing-slash/fragment, collapse repeated slashes, map known sentinel strings ("unknown", "not_verified", ...) to NULL. Query strings, path case, percent-encoding, locale/regional path segments, and ATS tenant identifiers are deliberately left untouched — confirmed load-bearing in the live registry (e.g. Accor Qatar''s careers URL encodes market in its query string). Returns NULL for anything that is not a resolvable http(s) URL, rather than guessing.';

-- ── Pre-flight collision check ──────────────────────────────────────────
-- Run BEFORE any schema change, against the raw existing columns, using the
-- function above directly (mirrors the existing-data collision-check
-- pattern already established in this codebase by
-- 20260915170000_add_jobs_source_specific_dedup_key.sql). If this ever
-- fires, the migration must stop here — no column is added, no index is
-- created, and no canonical row is touched.
do $$
declare
  v_collision_count int;
begin
  select count(*) into v_collision_count
  from (
    select company_id, country_code,
      coalesce(
        public.normalize_source_url(official_careers_url),
        public.normalize_source_url(official_website_url)
      ) as key
    from public.company_sources
  ) s
  where s.key is not null
  group by company_id, country_code, key
  having count(*) > 1;

  if v_collision_count > 0 then
    raise exception
      'company_sources_identity_key: % existing row group(s) would collide under (company_id, country_code, normalized_source_key) — investigate before migrating. Expected ZERO per the approved design''s own read-only simulation.',
      v_collision_count;
  end if;
end $$;

-- ── Generated column + unique index ─────────────────────────────────────
alter table public.company_sources
  add column normalized_source_key text generated always as (
    coalesce(
      public.normalize_source_url(official_careers_url),
      public.normalize_source_url(official_website_url)
    )
  ) stored;

comment on column public.company_sources.normalized_source_key is
  'Generated: normalize_source_url(official_careers_url), falling back to normalize_source_url(official_website_url). NULL when neither yields a resolvable URL (e.g. both are sentinel strings) — a row with a NULL key has no source-URL identity claim and is excluded from the unique index below, matching standard SQL NULL semantics already relied on elsewhere in this schema (jobs_dedup_scope_external_id_key).';

-- Deliberately NOT partial. A partial index (`where normalized_source_key
-- is not null`) was the first version of this migration and was reverted
-- after direct reproduction against this exact local database: Postgres
-- refuses to use a partial index as an ON CONFLICT inference target unless
-- the ON CONFLICT clause's own predicate repeats the identical WHERE
-- exactly — plain `on conflict (company_id, country_code,
-- normalized_source_key) do nothing` (the natural, idiomatic idempotent
-- upsert this RPC needs, added in a later migration in this set) failed
-- outright with Postgres error 42P10, exactly the same failure this
-- codebase's own 20260914140000_widen_jobs_dedup_index_for_upsert.sql
-- already found and fixed once for jobs_source_external_id_key. That
-- migration's own reasoning applies unchanged here: a FULL (non-partial)
-- unique index already never treats two NULL normalized_source_key rows as
-- colliding (standard SQL NULL semantics), so dropping the partial
-- predicate is behavior-preserving for every existing row while unblocking
-- resolve_registry_candidate()'s upsert. Company-scoped AND
-- country-scoped: proven necessary, not assumed — see this migration's
-- header for the exact 10 real rows a company-scoped-only key would have
-- collided on.
create unique index company_sources_identity_key
  on public.company_sources (company_id, country_code, normalized_source_key);

comment on index public.company_sources_identity_key is
  'Registry Sync''s DB-enforced source identity guarantee (approved design Section 6/14) + ON CONFLICT upsert target for resolve_registry_candidate(): company_id + country_code + normalized_source_key. Deliberately NOT company_id+normalized_source_key alone (see this migration''s header) and NOT company_id+country_code alone (would incorrectly forbid one company legitimately running two distinct career sources in the same market — a case this registry''s own creation comment already anticipated, even though no current row exercises it). Deliberately NOT partial — see the comment above this index for the ON CONFLICT-compatibility reason, mirroring jobs_dedup_scope_external_id_key''s identical fix. Verified against all 588 existing rows before creation: zero collisions.';
