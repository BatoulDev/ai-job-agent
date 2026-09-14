-- Fixes a design inconsistency found during review of
-- 20260914110000_create_claim_automation_task.sql: fail_stale_automation_tasks
-- was stamping completed_at on permanent failure, reusing the same column a
-- future successful-completion path would also stamp. analysis_tasks avoids
-- this exact ambiguity with a dedicated failed_at column
-- (20260802090030_create_analysis_tasks.sql) — automation_tasks should too,
-- since "the task reached a terminal state" and "the task succeeded" are
-- different facts a future matching/cover-letter/send/notification worker
-- must be able to tell apart from the row alone. No consumer reads
-- automation_tasks today (confirmed: zero application code queries this
-- table), so this is a pre-emptive correctness fix, not a live bug fix —
-- but shipping the wrong contract now would only get more expensive to fix
-- once a worker exists to depend on it.
alter table public.automation_tasks
  add column failed_at timestamptz;

comment on column public.automation_tasks.failed_at is
  'Set exactly once, by fail_stale_automation_tasks, when a task is permanently failed (lease expired with no attempts remaining). Distinct from completed_at, which is reserved for a genuine successful completion. Mirrors analysis_tasks.failed_at.';

create or replace function public.fail_stale_automation_tasks(
  p_lease_minutes integer default 10
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_lease interval;
begin
  v_lease := (p_lease_minutes || ' minutes')::interval;

  update public.automation_tasks
  set
    status     = 'failed',
    failed_at  = now(),
    last_error =
      'Permanently failed: max_attempts (' || max_attempts::text
      || ') exhausted after lease expiry. Last locked by '
      || coalesce(locked_by, 'unknown')
      || ' at ' || locked_at::text || '.'
      || case when last_error is not null
           then ' Previous error: ' || left(last_error, 300)
           else ''
         end
  where
    status        = 'processing'
    and locked_at < now() - v_lease
    and attempt_count >= max_attempts;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.fail_stale_automation_tasks(integer) from public;
grant  execute on function public.fail_stale_automation_tasks(integer) to service_role;

comment on function public.fail_stale_automation_tasks(integer) is
  'Permanently fails automation_tasks stuck in processing past their lease with no '
  'remaining attempts. Call before each claim_automation_task batch. Returns rows failed. '
  'Mirrors fail_stale_analysis_tasks (20260811090010). Stamps failed_at, never completed_at.';
