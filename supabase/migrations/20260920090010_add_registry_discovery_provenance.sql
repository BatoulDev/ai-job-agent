-- Registry Sync P0, migration 2 of 4 — minimum discovery provenance, per
-- the approved final design (Section 7/10/14).
--
-- Columns only, deliberately not a separate discovery_events table (Option
-- B, considered and rejected in the design's own Section 7 trade-off): no
-- current requirement asks for full per-observation history, only "how/when
-- first discovered" and "which channels has this been seen through /
-- when last". A discovery_events table can always be added later without
-- touching these columns; the reverse is not true.
--
-- discovery_source is write-once (first-discovery channel, never changed by
-- a later rediscovery); discovery_channels is an append-only distinct list
-- so "first entered manually, later found via CSV, later found via Apify"
-- is representable as ONE canonical row that accumulates
-- ['manual','csv','apify'] over time, never three separate rows —
-- resolve_registry_candidate() (added later in this migration set) is what
-- actually maintains this on every call; this migration only adds the
-- storage and backfills existing data.
--
-- Purely additive: nullable/defaulted columns, no existing row's identity,
-- review_status, automation_eligibility, or any other field is touched
-- beyond the explicit backfill below.

alter table public.companies
  add column discovery_source text,
  add column discovery_channels text[] not null default '{}'::text[],
  add column discovery_run_id uuid,
  add column first_discovered_at timestamptz,
  add column last_seen_at timestamptz;

alter table public.companies
  add constraint companies_discovery_source_check
  check (discovery_source is null or discovery_source in ('manual', 'csv', 'apify'));

comment on column public.companies.discovery_source is
  'First-discovery channel for this company row. Write-once: set on create, never changed by a later rediscovery through a different channel (see discovery_channels for that). One of manual/csv/apify for this phase — ai_agent and any future channel are deliberately not included yet (approved design Section 2).';
comment on column public.companies.discovery_channels is
  'Append-only distinct list of every discovery_source that has ever (re)discovered this company. Maintained by resolve_registry_candidate() — never client-writable directly. A source first entered manually, later reseen via CSV, later reseen via Apify accumulates [''manual'',''csv'',''apify''] on this ONE row; discovery_source/this array never participate in identity (see company_sources_identity_key in the prior migration) — provenance and identity are deliberately kept separate.';
comment on column public.companies.first_discovered_at is
  'When this company row was first created. Write-once, distinct from last_seen_at.';
comment on column public.companies.last_seen_at is
  'Most recent rediscovery of this company through any channel. Bumped by resolve_registry_candidate() on every resolution, whether a new row was created or an existing one was matched.';

alter table public.company_sources
  add column discovery_source text,
  add column discovery_channels text[] not null default '{}'::text[],
  add column discovery_run_id uuid,
  add column first_discovered_at timestamptz,
  add column last_seen_at timestamptz;

alter table public.company_sources
  add constraint company_sources_discovery_source_check
  check (discovery_source is null or discovery_source in ('manual', 'csv', 'apify'));

comment on column public.company_sources.discovery_source is
  'First-discovery channel for this source row. Write-once — see companies.discovery_source for the identical convention.';
comment on column public.company_sources.discovery_channels is
  'Append-only distinct list of every discovery_source that has ever (re)discovered this source. Maintained by resolve_registry_candidate() only. Never participates in company_sources_identity_key — provenance and identity are deliberately kept separate (approved design Section 2/7).';
comment on column public.company_sources.first_discovered_at is
  'When this source row was first created. Write-once.';
comment on column public.company_sources.last_seen_at is
  'Most recent rediscovery of this source through any channel. Distinct from imported_at (set once at the original CSV import, never advanced) and updated_at (bumps on ANY column change, not specifically rediscovery).';

-- Backfill: every existing row (553 companies, 588 company_sources, all
-- 2026-09-14/15 CSV import work) genuinely did come from the CSV import —
-- this is not a guess, it is what actually happened, per
-- scripts/import-company-registry.mjs and the migration history it
-- followed. Purely additive; no other column is touched.
update public.companies
set discovery_source = 'csv',
    discovery_channels = array['csv']::text[],
    first_discovered_at = created_at,
    last_seen_at = created_at
where discovery_source is null;

update public.company_sources
set discovery_source = 'csv',
    discovery_channels = array['csv']::text[],
    first_discovered_at = imported_at,
    last_seen_at = imported_at
where discovery_source is null;
