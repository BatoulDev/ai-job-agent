-- matches: a scored pairing of a user's CONFIRMED CV analysis against a
-- job. Foundation only — no matching algorithm/worker is built here (see
-- AI_JOB_AGENT_SYSTEM_AUDIT.md Section 17, #6-7). cv_analysis_id
-- references the exact analysis row used, never just user_id, so a later
-- CV replacement can never silently reinterpret an existing match's basis.
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete restrict,
  -- cascade (not restrict): tied to the account-deletion sweep. cvs ->
  -- cv_analyses already cascades from auth.users; matches must cascade the
  -- same way or a user's account deletion would fail with a foreign-key
  -- violation the moment cv_analyses tried to cascade-delete a row a
  -- restricted match still referenced.
  cv_analysis_id uuid not null references public.cv_analyses (id) on delete cascade,

  hard_filter_passed boolean not null default true,
  score integer not null check (score >= 0 and score <= 100),
  score_breakdown jsonb not null default '{}'::jsonb check (jsonb_typeof(score_breakdown) = 'object'),
  explanation text,
  missing_skills jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_skills) = 'array'),
  status text not null default 'pending_review' check (status in ('pending_review', 'user_approved', 'user_rejected')),
  matching_model text,
  matching_version text not null default 'v1',
  decided_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.matches is
  'One row per (user, job, confirmed cv_analysis) scoring attempt. cv_analysis_id must reference an approved analysis (enforced by enforce_match_uses_approved_analysis) — matching must never be built from unconfirmed AI output.';

-- Idempotent reruns: re-scoring the same (user, job, confirmed-analysis-
-- version) combination updates/reuses this row rather than duplicating it.
-- A newly confirmed analysis (a new cv_analysis_id) is free to produce a
-- fresh match for the same job.
create unique index matches_user_job_analysis_key
  on public.matches (user_id, job_id, cv_analysis_id);

create index matches_job_id_idx on public.matches (job_id);

alter table public.matches enable row level security;

create trigger set_matches_updated_at
  before update on public.matches
  for each row
  execute function public.set_updated_at();

-- Defense in depth at the database layer (AGENTS.md §20): a match can only
-- ever point at an analysis the user has actually confirmed. Cheap check —
-- cv_analyses rows are not high-volume — and closes off any future insert
-- path (worker bug, manual admin insert) from ever building a match on
-- unreviewed AI output.
create or replace function public.enforce_match_uses_approved_analysis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review_status text;
begin
  select review_status into v_review_status
  from public.cv_analyses
  where id = new.cv_analysis_id;

  if v_review_status is distinct from 'approved' then
    raise exception 'matches.cv_analysis_id must reference an approved cv_analyses row.';
  end if;

  return new;
end;
$$;

create trigger enforce_match_uses_approved_analysis_trigger
  before insert or update on public.matches
  for each row
  execute function public.enforce_match_uses_approved_analysis();

-- Users read only their own matches. No insert/update/delete policy for
-- authenticated: creation is a future matching worker's job (service_role);
-- approve/reject go through approve_match/reject_match (20260809090100),
-- never a raw client UPDATE, so status/decided_at can't be forged.
create policy "matches_select_own"
  on public.matches
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.matches to authenticated;
grant select, insert, update, delete on public.matches to service_role;
