-- jobs: admin/trusted-worker-ingested listings from safe public sources
-- only (company career pages, Greenhouse/Lever/Workable/Ashby, public
-- application emails, or a LinkedIn link — never scraped or auto-applied
-- through, per AGENTS.md §7). Foundation only: no ingestion worker or
-- admin UI is built by this migration.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company_name text not null,
  description text not null,
  location text,
  work_arrangement text check (work_arrangement in ('remote', 'onsite', 'hybrid', 'flexible')),
  employment_type text check (employment_type in ('full-time', 'part-time', 'internship', 'contract')),
  seniority text check (seniority in ('internship', 'entry-level', 'junior', 'mid-level', 'senior')),

  -- How a user (or, later, an approved automation) may actually apply.
  -- external_link: the user clicks through and applies themselves —
  -- required, structurally, for every LinkedIn listing (see the check
  -- below). email: an automated sender may eventually compose and send an
  -- application to application_email, but only after explicit user
  -- approval (enforced on applications, not here).
  application_method text not null check (application_method in ('external_link', 'email')),
  application_url text,
  application_email text,

  source_type text not null check (source_type in (
    'admin_manual', 'career_page', 'greenhouse', 'lever', 'workable', 'ashby', 'linkedin'
  )),
  -- Stable identifier from the source, when one exists. Null for
  -- admin_manual entries, which have no external system to key off —
  -- deduplication for those is an admin/editorial responsibility, not a
  -- database-enforced one (see the partial unique index below).
  external_id text,
  source_url text,

  status text not null default 'active' check (status in ('active', 'closed', 'expired')),
  published_at timestamptz,
  discovered_at timestamptz not null default now(),
  expires_at timestamptz,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint jobs_application_method_target check (
    (application_method = 'external_link' and application_url is not null)
    or (application_method = 'email' and application_email is not null)
  ),
  -- Product rule (AGENTS.md §7): LinkedIn jobs provide a link and prepared
  -- materials only — never automated email sending.
  constraint jobs_linkedin_never_email check (
    not (source_type = 'linkedin' and application_method = 'email')
  ),
  constraint jobs_application_url_format check (
    application_url is null or application_url ~ '^https?://'
  ),
  constraint jobs_application_email_format check (
    application_email is null or application_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  )
);

comment on table public.jobs is
  'Admin/trusted-source job listings. LinkedIn rows are structurally forbidden from application_method=email (jobs_linkedin_never_email) — they may only ever carry a link.';
comment on column public.jobs.external_id is
  'Stable id from source_type''s own system (e.g. a Greenhouse job id). Null for admin_manual — see jobs_source_external_id_key for how dedup handles that.';

-- Dedup key: a given source's external id maps to at most one job row.
-- Partial (external_id is not null) so admin-entered jobs, which have no
-- external id, are never forced to collide with each other.
create unique index jobs_source_external_id_key
  on public.jobs (source_type, external_id)
  where external_id is not null;

alter table public.jobs enable row level security;

create trigger set_jobs_updated_at
  before update on public.jobs
  for each row
  execute function public.set_updated_at();

-- Ordinary users may read only active jobs — never draft/closed/expired
-- rows, and never another status an admin tool might use internally later.
create policy "jobs_select_active"
  on public.jobs
  for select
  to authenticated
  using (status = 'active');

-- Admin-only writes, enforced at the RLS layer (not just the application),
-- using the trusted role model from 20260809090020.
create policy "jobs_admin_insert"
  on public.jobs
  for insert
  to authenticated
  with check (public.is_admin());

create policy "jobs_admin_update"
  on public.jobs
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "jobs_admin_delete"
  on public.jobs
  for delete
  to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.jobs to authenticated;
grant select, insert, update, delete on public.jobs to service_role;
