-- applications: an approved match's send attempt(s). No sendable row can
-- exist without approved_at/approved_by evidence (both NOT NULL) — that is
-- the explicit-approval gate, structurally, not merely a UI convention.
-- Foundation only — no sender is built here; nothing is sent by this
-- migration.
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  -- restrict: jobs are retired via status='closed'/'expired', not deleted;
  -- a job with real application history should never be hard-deletable.
  job_id uuid not null references public.jobs (id) on delete restrict,
  cover_letter_id uuid references public.cover_letters (id) on delete set null,

  application_method text not null check (application_method in ('external_link', 'email')),

  -- Explicit-approval evidence — separate from send-success, per the
  -- explicit requirement. Required at creation: an application row simply
  -- cannot exist without them.
  approved_at timestamptz not null,
  approved_by uuid not null references auth.users (id),

  status text not null default 'pending_send' check (status in ('pending_send', 'sending', 'sent', 'failed', 'cancelled')),
  send_attempt_count integer not null default 0 check (send_attempt_count >= 0),
  last_attempt_at timestamptz,
  last_error text,
  provider_message_id text,
  idempotency_key text not null unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.applications is
  'One row per application send attempt for an approved match. approved_at/approved_by are required at creation (the approval gate); status is the separate send lifecycle. enforce_application_method_matches_job additionally forbids email sending for any job that does not itself support it (in particular every LinkedIn listing).';

-- At most one non-terminal (pending_send/sending/sent) application per
-- match — a new row is only possible after a prior one definitively
-- failed/cancelled (retry-via-new-row), mirroring
-- analysis_tasks_one_active_per_cv exactly.
create unique index applications_one_active_per_match
  on public.applications (match_id)
  where status in ('pending_send', 'sending', 'sent');

create index applications_user_status_idx on public.applications (user_id, status);

alter table public.applications enable row level security;

create trigger set_applications_updated_at
  before update on public.applications
  for each row
  execute function public.set_updated_at();

-- Product-rule enforcement at the database layer, not just the
-- application: a job whose own application_method is not 'email' (every
-- LinkedIn listing, by construction — see jobs_linkedin_never_email) can
-- never have an application row with application_method='email'.
create or replace function public.enforce_application_method_matches_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  select * into v_job from public.jobs where id = new.job_id;

  if not found then
    raise exception 'Referenced job does not exist.';
  end if;

  if new.application_method = 'email' and v_job.application_method <> 'email' then
    raise exception 'This job does not support automated email application sending.';
  end if;

  return new;
end;
$$;

create trigger enforce_application_method_matches_job_trigger
  before insert or update on public.applications
  for each row
  execute function public.enforce_application_method_matches_job();

create policy "applications_select_own"
  on public.applications
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete for authenticated: creation happens only via
-- create_application (20260809090100), which independently re-verifies
-- match ownership/approval and derives approved_by from auth.uid() — never
-- a raw client insert. Send-attempt updates are service_role/worker-only
-- (no worker is built in this mission).
grant select on public.applications to authenticated;
grant select, insert, update, delete on public.applications to service_role;
