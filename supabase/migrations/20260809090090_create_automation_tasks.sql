-- automation_tasks: a single generic durable task/outbox model for the
-- future matching/cover-letter/send/notification workers, deliberately
-- distinct from analysis_tasks (which stays CV-specific and untouched).
-- One shared table with a task_type discriminator is a proportional MVP
-- foundation; splitting into per-domain tables later (mirroring
-- analysis_tasks) is a reasonable future refinement if one automation's
-- needs diverge, not a decision this migration needs to make now.
--
-- Fully opaque to ordinary users by design: RLS is enabled with zero
-- policies for authenticated (default-deny), and authenticated has no
-- grant on this table at all — user-visible status is derived from
-- matches/cover_letters/applications' own status columns instead, which do
-- have select_own policies. Purely internal worker machinery.
create table public.automation_tasks (
  id uuid primary key default gen_random_uuid(),
  task_type text not null check (task_type in (
    'job_matching', 'cover_letter_generation', 'application_send', 'notification_delivery'
  )),
  subject_type text not null check (subject_type in ('match', 'cover_letter', 'application', 'notification')),
  subject_id uuid not null,

  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  next_attempt_at timestamptz not null default now(),
  -- Set by a future claim function (for update skip locked), mirroring the
  -- documented-not-implemented analysis_tasks claim contract
  -- (DATABASE_PLAN.md, Phase 4B addendum). Not set by anything in this
  -- migration.
  locked_by text,
  locked_at timestamptz,
  -- Safe summary only — never raw CV text, API credentials, or full email
  -- bodies (AGENTS.md §30).
  last_error text,
  idempotency_key text not null unique,

  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.automation_tasks is
  'Generic outbox for future matching/cover-letter/send/notification workers. No worker claims from this table yet. See analysis_tasks for the CV-analysis-specific equivalent, which this does not replace.';

-- Mirrors analysis_tasks_one_active_per_cv exactly: at most one active
-- (pending/processing) task per (subject, task_type) at a time.
create unique index automation_tasks_one_active_per_subject
  on public.automation_tasks (subject_type, subject_id, task_type)
  where status in ('pending', 'processing');

-- Mirrors analysis_tasks_claimable_idx exactly.
create index automation_tasks_claimable_idx
  on public.automation_tasks (next_attempt_at)
  where status = 'pending';

alter table public.automation_tasks enable row level security;

create trigger set_automation_tasks_updated_at
  before update on public.automation_tasks
  for each row
  execute function public.set_updated_at();

-- Intentionally no policies at all for authenticated (see the table
-- comment) and no grant either — RLS-enabled-with-zero-policies plus no
-- grant is a doubly-enforced default-deny.
grant select, insert, update, delete on public.automation_tasks to service_role;
