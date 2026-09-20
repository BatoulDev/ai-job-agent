-- Registry Sync P0, migration 3 of 4 — minimum staging table, per the
-- approved final design (Section 8/14).
--
-- A candidate that cannot be safely resolved (ambiguous company identity,
-- missing/invalid country, no resolvable source URL, a possible second
-- source for a company already on file in that market) must never guess —
-- it lands here instead of public.companies/public.company_sources. Every
-- write into this table, and every promotion out of it, happens only
-- through resolve_registry_candidate() (added in the next migration) —
-- this table has no trigger or function of its own that writes to any
-- other table, and nothing here ever auto-promotes itself.
--
-- Same default-deny access pattern as company_sources/source_intelligence:
-- RLS enabled, zero policies, service_role-only grant. Nothing here is
-- more or less sensitive than what company_sources already stores.

create table public.registry_sync_staging (
  id uuid primary key default gen_random_uuid(),

  discovery_source text not null check (discovery_source in ('manual', 'csv', 'apify')),
  discovery_run_id uuid,
  -- Exactly what the adapter received, preserved verbatim — essential for a
  -- human reviewer to see the real candidate, and to allow re-normalizing
  -- later if the normalization rules themselves improve.
  raw_payload jsonb not null default '{}'::jsonb,
  constraint registry_sync_staging_raw_payload_is_object check (jsonb_typeof(raw_payload) = 'object'),

  company_name text,
  normalized_name text,
  country_code text references public.countries (code),
  normalized_source_key text,
  -- Best-guess existing company this candidate might belong to, when one
  -- exists (e.g. the single already-resolved company for a
  -- possible_second_source_same_market candidate). Null when no candidate
  -- match exists at all (a brand-new, ambiguous, or country-less
  -- candidate).
  candidate_company_id text references public.companies (id),

  staging_reason text not null,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'resolved', 'rejected')),

  resolved_company_id text references public.companies (id),
  resolved_source_id text references public.company_sources (id),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.registry_sync_staging is
  'Candidates Registry Sync could not safely resolve to a canonical companies/company_sources row (ambiguous company identity, missing/invalid country, no resolvable source URL, or a possible second source for a company already on file in that market). Never auto-promoted — a human reviewer supplies the missing/corrected signal and the SAME resolve_registry_candidate() RPC used by every other path performs the actual canonical write; this table never writes to companies/company_sources directly, itself or via any trigger.';
comment on column public.registry_sync_staging.staging_reason is
  'Why this candidate could not be safely resolved: ambiguous_company_multiple_matches | missing_country | invalid_country | no_resolvable_url | possible_second_source_same_market. Free text (not enum-checked) deliberately — resolve_registry_candidate() is the only writer and its own reasons are the authoritative list; a check constraint here would just have to be kept in lockstep with that function''s logic for no real safety benefit at this stage.';
comment on column public.registry_sync_staging.candidate_company_id is
  'Best-guess existing company for this candidate, when resolve_registry_candidate() already found one (e.g. a possible-second-source case). Null when no confident company match exists at all.';
comment on column public.registry_sync_staging.status is
  'pending_review -> resolved (promoted to canonical, resolved_company_id/resolved_source_id set) or rejected (a human determined this is not a real company/source — kept for audit, never deleted).';

create index registry_sync_staging_status_idx
  on public.registry_sync_staging (status);

-- Supports resolve_registry_candidate()'s own duplicate-staging-row guard:
-- a repeated rediscovery of the same still-unresolved candidate updates the
-- existing pending row instead of piling up a new one on every run.
create index registry_sync_staging_pending_lookup_idx
  on public.registry_sync_staging (staging_reason, country_code, normalized_source_key)
  where status = 'pending_review';

alter table public.registry_sync_staging enable row level security;
-- Deliberately no policies: service-role only, matching company_sources'
-- own existing access model (20260914150000). No authenticated/anon grant.
grant select, insert, update, delete on public.registry_sync_staging to service_role;

create trigger set_registry_sync_staging_updated_at
  before update on public.registry_sync_staging
  for each row
  execute function public.set_updated_at();
