-- analysis_tasks: internal tracking rows for one CV-analysis operation
-- each. Foundation only — no worker, AI call, or n8n workflow consumes
-- this table yet (Phase 4). This migration exists so the queue/claim
-- design can be reviewed and tested now, before automation is built.
--
-- The task id is an internal tracking id, not a plan id, and is never
-- shown to the user as a meaningful identifier.
create table public.analysis_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cv_id uuid not null references public.cvs (id) on delete cascade,
  trigger text not null check (trigger in ('onboarding_completed')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  last_error text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.analysis_tasks is
  'One row per CV-analysis attempt. A future worker (Phase 4) will claim pending rows with available_at <= now() using "for update skip locked" so two workers can never process the same task. Not wired to any worker yet.';

-- The core concurrency guarantee this phase must provide: a given CV can
-- never have more than one active (pending or processing) task at once,
-- even under concurrent onboarding-completion requests. A partial unique
-- index enforces this at the database layer, not just in application code.
create unique index analysis_tasks_one_active_per_cv
  on public.analysis_tasks (cv_id)
  where status in ('pending', 'processing');

create index analysis_tasks_claimable_idx
  on public.analysis_tasks (available_at)
  where status = 'pending';

alter table public.analysis_tasks enable row level security;

create trigger set_analysis_tasks_updated_at
  before update on public.analysis_tasks
  for each row
  execute function public.set_updated_at();

-- Users may read the status of their own tasks (e.g. a future "analyzing
-- your CV..." dashboard indicator). No insert/update/delete policy exists
-- for the authenticated role — a user can never create a task, mark one
-- completed, or touch attempt/processing fields.
create policy "analysis_tasks_select_own"
  on public.analysis_tasks
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.analysis_tasks to authenticated;

-- Trusted server-only creation path (future callers: the onboarding-
-- completion Route Handler, running with the service-role client — never
-- the browser). Safe to call repeatedly: if an active task already exists
-- for this cv_id, it is returned instead of raising, so a page refresh or
-- duplicate onboarding-completion call can never create a second one.
create or replace function public.create_analysis_task(
  p_user_id uuid,
  p_cv_id uuid,
  p_trigger text
)
returns public.analysis_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.analysis_tasks;
begin
  select * into v_row
  from public.analysis_tasks
  where cv_id = p_cv_id and status in ('pending', 'processing')
  limit 1;

  if found then
    return v_row;
  end if;

  insert into public.analysis_tasks (user_id, cv_id, trigger, idempotency_key)
  values (p_user_id, p_cv_id, p_trigger, p_cv_id::text || ':' || gen_random_uuid()::text)
  on conflict (cv_id) where status in ('pending', 'processing') do nothing
  returning * into v_row;

  if v_row.id is null then
    -- Lost a race against a concurrent caller: fetch what they created.
    select * into v_row
    from public.analysis_tasks
    where cv_id = p_cv_id and status in ('pending', 'processing')
    limit 1;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.create_analysis_task(uuid, uuid, text) from public;
grant execute on function public.create_analysis_task(uuid, uuid, text) to service_role;
