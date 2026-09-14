-- Additive canonical-company + company-source/provenance foundation, per
-- the human identity decision recorded in
-- docs/job-ingestion-database-readiness-audit.md Sections 21-22:
--
--   - Amazon UAE (cc-amazon-uae) and Amazon Saudi Arabia (cc-amazon-sa)
--     remain two distinct companies rows — the registry's own researcher
--     notes explicitly say "NOT a duplicate ... different target_country".
--   - Accenture Saudi Arabia (cc-accenture-sa) and Accenture Qatar
--     (cc-accenture-qatar) remain two distinct companies rows — evidence
--     is suggestive but not deterministic (differing company_type/legal
--     name/headquarters_country), and this migration does not guess.
--   - SLB (cc-slb / cc-slb-qatar / cc-slb-formerly-schlumberger), Tata
--     Consultancy Services (cc-tcs / cc-tata-consultancy-services-qatar),
--     and Apparel Group (cc-apparel-group / cc-apparel-group-sa) each
--     converge onto ONE companies row (their existing bare canonical id:
--     cc-slb / cc-tcs / cc-apparel-group), applied by the import script
--     (scripts/import-company-registry.mjs), never by editing a CSV.
--
-- This migration only adds schema. No CSV row is touched, no company is
-- imported by this migration itself (seeding is a separate, explicit,
-- idempotent, re-runnable script — see that script's own header — matching
-- the existing repository pattern of scripts/seed-local-automation-users.mjs
-- not being invoked by any migration either).
--
-- Three-layer design, deliberately kept in this order:
--   1. companies       — canonical identity. One row per real-world company
--                         this registry has decided to treat as one entity.
--   2. company_sources  — one row per original CSV source_record_id,
--                         preserved exactly (provenance), pointing at
--                         exactly one companies row.
--   3. jobs.source_id   — a future ingested job points at the specific
--                         company_sources row it came from, not directly at
--                         companies — so which SOURCE said "here is a job"
--                         is always recoverable independent of which
--                         canonical company that source was mapped to.
--
-- companies.id and company_sources.id deliberately reuse the CSV's own
-- stable text identifiers (canonical_company_id / source_record_id)
-- instead of a new uuid surrogate — these are already the "stable
-- canonical id" this whole registry is built around, already
-- human-readable and diffable in git, and reusing them means no mapping
-- table is needed between "the id research already assigned" and "the id
-- the database uses".

create table public.companies (
  id text primary key,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.companies is
  'Canonical company identity. One row per real-world company this registry has decided to treat as one entity — id reuses docs/job-source-discovery''s own canonical_company_id values. Parent-company/alias support (e.g. a nullable parent_company_id) can be added later, additively, without rewriting any row here or any jobs.source_id reference — this table intentionally does not attempt that now.';

alter table public.companies enable row level security;

create trigger set_companies_updated_at
  before update on public.companies
  for each row
  execute function public.set_updated_at();

-- Public reference data, same pattern as countries/plans/locations:
-- select-only for authenticated, full CRUD service_role only.
create policy "companies_select_authenticated"
  on public.companies
  for select
  to authenticated
  using (true);

grant select on public.companies to authenticated;
grant select, insert, update, delete on public.companies to service_role;

-- ── company_sources ─────────────────────────────────────────────────────

create table public.company_sources (
  id text primary key, -- reuses the CSV's own source_record_id (e.g. 'sr-sa-slb')
  company_id text not null references public.companies (id),
  company_name text not null,
  target_country text not null,
  country_code text references public.countries (code),
  official_website_url text,
  official_careers_url text,
  ats_provider text,
  automation_eligibility text,
  -- Exactly the four values the live CSV registry actually uses today
  -- (verified 398 / needs_manual_review 180 / no_official_source_found 10 /
  -- blocked_or_unsafe 0, per the original audit's programmatic count).
  -- Deliberately NOT collapsed into a boolean "approved" flag: a
  -- needs_manual_review row must stay visibly, queryably unresolved, never
  -- silently treated as approved by a consumer that only checks NULL vs.
  -- NOT NULL.
  review_status text not null check (review_status in (
    'verified', 'needs_manual_review', 'no_official_source_found', 'blocked_or_unsafe'
  )),
  researcher_notes text,
  last_verified_at date,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.company_sources is
  'One row per original CSV source_record_id (docs/job-source-discovery), preserved exactly. Provenance for a future jobs.source_id FK. review_status is carried through unmodified — needs_manual_review/no_official_source_found/blocked_or_unsafe rows are never treated as human-approved by their mere presence in this table.';
comment on column public.company_sources.company_id is
  'Which canonical company this source was mapped to. Protected by the company_sources_reject_remap trigger below: an existing row''s mapping can never be silently changed by a routine re-import, only by an explicit, deliberate action.';
comment on column public.company_sources.review_status is
  'Verbatim from the CSV registry''s own review_status column. needs_manual_review/no_official_source_found/blocked_or_unsafe must never be read as "approved" — only verified means the registry''s own process considers this source confirmed.';

create index company_sources_company_id_idx on public.company_sources (company_id);

alter table public.company_sources enable row level security;

create trigger set_company_sources_updated_at
  before update on public.company_sources
  for each row
  execute function public.set_updated_at();

-- Fully opaque to ordinary users by design, same pattern as
-- automation_tasks (20260809090090): RLS enabled with zero policies for
-- authenticated, no grant at all. Researcher notes and unresolved-review
-- provenance are internal ingestion machinery, not a product surface —
-- a future public company directory (if built) reads from companies
-- (already select-authenticated above), never from this table directly.
grant select, insert, update, delete on public.company_sources to service_role;

-- Database-enforced version of "never silently change an existing identity
-- mapping" / "conflicting remaps must fail or enter explicit review state"
-- (this migration's own governing requirement): a routine idempotent
-- re-import always recomputes and re-writes the SAME company_id for an
-- unchanged source_record_id, so this trigger never fires during normal
-- operation. It exists specifically to hard-stop the one dangerous case —
-- an import (or any other caller) attempting to point an EXISTING source
-- at a DIFFERENT company than before — rather than relying on import-script
-- discipline alone. A genuine, deliberate remap must delete and re-insert
-- the row explicitly, which is a visible, auditable, non-silent act.
create or replace function public.reject_company_source_remap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception
      'company_sources.company_id cannot be changed for an existing source (id=%): was %, attempted %. '
      'Remapping a source to a different canonical company is an identity decision, not a routine re-import.',
      old.id, old.company_id, new.company_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger company_sources_reject_remap
  before update on public.company_sources
  for each row
  execute function public.reject_company_source_remap();

comment on function public.reject_company_source_remap() is
  'Rejects any UPDATE that changes company_sources.company_id for an existing row. A repeated idempotent import always recomputes the same mapping and never trips this; only an actual remap attempt does.';

-- ── jobs.source_id ──────────────────────────────────────────────────────
-- Deterministic job-SOURCE identity, one layer beneath company identity:
-- a future ingested job points at exactly which company_sources row
-- produced it. Nullable and additive — there are currently zero jobs rows
-- (reconfirmed this session), and admin_manual jobs (no CSV-backed source)
-- legitimately have no company_sources row to point at, so this must stay
-- optional rather than backfilled/required.
alter table public.jobs
  add column source_id text references public.company_sources (id);

comment on column public.jobs.source_id is
  'Which company_sources row this job was ingested from, when known. Null for admin_manual jobs and any job not yet linked to a specific registry source. Distinct from jobs.source_type/external_id (the per-source dedup key, unrelated to company identity) and from jobs.company_name (free text, still the display value until a future migration decides whether to join through companies.display_name instead).';

create index jobs_source_id_idx on public.jobs (source_id);
