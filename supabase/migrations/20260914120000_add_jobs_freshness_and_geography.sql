-- jobs freshness/lifecycle/geography extension — P0 remediation per
-- docs/job-ingestion-database-readiness-audit.md Section 8/17 item 2.
-- Purely additive: new nullable columns, a widened status check, a
-- status-transition trigger, and two evidence-based indexes. There are
-- currently zero jobs rows (no ingestion has ever run — confirmed by this
-- branch's own re-verification), so every change here is a no-op on
-- existing data beyond the trivial backfill below.
--
-- Deliberately NOT included in this migration (see the audit's own "Open
-- Product Decisions", Section 19, and this branch's canonical-company
-- conflict review): a company/source_id foreign key. Two of the five
-- cross-market canonical_company_id conflicts found in the CSV registry
-- (Amazon, Accenture) cannot be resolved from repository evidence alone —
-- neither has an existing bare canonical id to converge on, unlike the
-- EY/KPMG/Deloitte/PwC one-id-per-multinational-brand convention the
-- registry already establishes elsewhere. Building company_sources now and
-- importing all 588 CSV rows would either guess those two identities or
-- ship a table with known-bad dedup on day one. Deferred until a human
-- resolves those two conflicts; jobs.source_id can be added in a later,
-- equally additive migration once that table exists.
--
-- Also deliberately NOT included: a content-hash/cross-source dedup key
-- (audit Section 19 item 3 — content-hash vs. admin-reviewed-merge is an
-- unmade product decision, not a technical gap) and a match-score
-- threshold (item 5, needed only once a matching worker exists).

alter table public.jobs
  add column first_seen_at timestamptz,
  add column last_seen_at timestamptz,
  add column last_checked_at timestamptz,
  add column last_successful_check_at timestamptz,
  add column closing_date timestamptz,
  add column status_reason text,
  add column closed_at timestamptz,
  add column source_last_modified_at timestamptz,
  add column country_code text references public.countries (code),
  add column city text,
  add column remote_scope text,
  add column relocation_required boolean;

comment on column public.jobs.first_seen_at is
  'When an ingestion run first discovered this job. Set once, never updated after insert.';
comment on column public.jobs.last_seen_at is
  'Most recent ingestion run that found this job still listed at its source. Distinct from last_checked_at: a failed check advances last_checked_at but never this column.';
comment on column public.jobs.last_checked_at is
  'Most recent ingestion run that attempted to verify this job, regardless of outcome.';
comment on column public.jobs.last_successful_check_at is
  'Most recent ingestion run whose verification of this job succeeded. A gap between this and last_checked_at reflects repeated recent check failures without asserting the job is gone — status must not flip to source_error on a single miss (see jobs_status_check); a sustained-failure sweep, not the ingestion run itself, owns that decision.';
comment on column public.jobs.closing_date is
  'Source-stated application deadline, when known. Distinct from expires_at (system-computed) and closed_at (when status actually transitioned).';
comment on column public.jobs.status_reason is
  'Free-text explanation for the current status (e.g. why an admin rejected a row, or why a sweep marked it source_error). Never shown to end users verbatim without review.';
comment on column public.jobs.closed_at is
  'When status actually transitioned into a terminal state (closed/expired/rejected/unavailable). Maintained by the jobs_set_closed_at trigger below, never client-set directly — null again if status transitions back out of a terminal state.';
comment on column public.jobs.country_code is
  'ISO 3166-1 alpha-2, references countries(code). Nullable: existing free-text location rows are not backfilled by guessing a country.';
comment on column public.jobs.remote_scope is
  'Geographic eligibility for a remote job. Nullable/unconstrained by design: the CSV company/source registry (docs/job-source-discovery) uses a richer, still-evolving vocabulary than any fixed enum this migration could safely commit to today. A future migration can add a check constraint once the matching worker''s actual query needs are known, the same way jobs_status_check has already been widened in place elsewhere in this codebase.';
comment on column public.jobs.relocation_required is
  'True when the role requires physical relocation to work onsite/hybrid. Null = unknown/not yet classified.';

-- Widen the status model: pending_review/unavailable/rejected/source_error
-- join the original active/closed/expired, per the audit's own recommended
-- vocabulary (Section 8). Same drop-and-recreate pattern already used
-- elsewhere in this codebase for widening a check constraint in place
-- (e.g. 20260804090000_extend_job_preferences_experience_level.sql) — every
-- existing row's status (there are none today) remains valid under the
-- wider constraint, so no data migration is needed.
alter table public.jobs drop constraint jobs_status_check;
alter table public.jobs add constraint jobs_status_check check (status in (
  'pending_review', 'active', 'closed', 'expired', 'unavailable', 'rejected', 'source_error'
));

-- Trivial, safe backfill: any pre-existing row is treated as "first/last
-- seen and successfully checked at the moment it was created", which is
-- the correct value for a row that was entered directly rather than
-- actually ingested from an external source.
update public.jobs
set
  first_seen_at = discovered_at,
  last_seen_at = discovered_at,
  last_checked_at = discovered_at,
  last_successful_check_at = discovered_at
where first_seen_at is null;

-- closed_at is a derived, system-maintained timestamp — never trust a
-- client- or admin-supplied value for "when did this actually close".
-- Fires on INSERT too (not just UPDATE): a job can be entered directly in
-- a terminal status (e.g. an admin backfilling a job that already closed),
-- and closed_at must stay consistent with status from the very first row,
-- not only from the first transition. old.status reads as NULL on INSERT
-- (standard Postgres row-trigger behavior for the absent OLD row) — `x =
-- any(array)` and `not (...)` both propagate NULL rather than returning
-- false, so this is wrapped in coalesce(..., false) to make INSERT
-- unambiguously take the "was not terminal before" branch, exactly as a
-- fresh row should.
-- Mirrors set_updated_at's security invoker + empty search_path pattern
-- (20260714153048_create_updated_at_function.sql).
create or replace function public.set_jobs_closed_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_terminal_statuses text[] := array['closed', 'expired', 'rejected', 'unavailable'];
  v_was_terminal boolean := coalesce(old.status = any (v_terminal_statuses), false);
  v_is_terminal boolean := coalesce(new.status = any (v_terminal_statuses), false);
begin
  if v_is_terminal and not v_was_terminal then
    new.closed_at := now();
  elsif v_was_terminal and not v_is_terminal then
    new.closed_at := null;
  end if;
  return new;
end;
$$;

create trigger jobs_set_closed_at
  before insert or update on public.jobs
  for each row
  execute function public.set_jobs_closed_at();

comment on function public.set_jobs_closed_at() is
  'Stamps jobs.closed_at when status transitions into closed/expired/rejected/unavailable, and clears it when status transitions back out. Never client-trusted directly.';

-- Evidence-based indexes (audit Section 8, "Index and uniqueness gap
-- analysis") for the two query shapes a future matching/expiry-sweep
-- worker structurally needs and that the existing
-- jobs_source_external_id_key does not cover: active-job lookup filtered
-- by geography/work-arrangement, and a status-driven expiry sweep reading
-- closing_date.
create index jobs_active_geography_idx
  on public.jobs (country_code, work_arrangement, seniority)
  where status = 'active';

create index jobs_closing_date_idx
  on public.jobs (closing_date)
  where status = 'active' and closing_date is not null;
