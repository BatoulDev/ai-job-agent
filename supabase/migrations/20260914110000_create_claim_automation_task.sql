-- Implements the atomic worker-claim contract for automation_tasks, mirroring
-- claim_analysis_task/fail_stale_analysis_tasks (20260811090010) exactly in
-- structure. automation_tasks (20260809090090) already has every column
-- this needs (locked_by/locked_at, next_attempt_at, attempt_count/
-- max_attempts, idempotency_key) — no schema change required, this
-- migration only adds the two functions the table's own creation comment
-- said would come later ("Set by a future claim function").
--
-- Column-name differences from analysis_tasks are deliberate, not
-- accidental: automation_tasks uses next_attempt_at (not available_at) and
-- tracks the claiming worker via locked_by/locked_at (analysis_tasks has
-- neither — it only ever has one caller, the CV-analysis worker, so it
-- never needed to distinguish which worker instance holds a lease).
-- locked_at is the lease-expiry clock here, in place of analysis_tasks'
-- started_at.
--
--   claim_automation_task(p_worker_id, p_batch_size)
--     Atomically claims up to p_batch_size tasks using FOR UPDATE SKIP
--     LOCKED. Also reclaims processing tasks whose lease has expired
--     (locked_at older than LEASE_MINUTES) and that still have remaining
--     attempts. Returns the claimed rows.
--
--   fail_stale_automation_tasks(p_lease_minutes)
--     Permanently fails processing tasks that are past their lease AND
--     have exhausted max_attempts. Called once per worker execution before
--     claim_automation_task, same ordering as the analysis_tasks pattern.
--     Returns the count of rows permanently failed.
--
-- Both are SECURITY DEFINER, granted to service_role only — no future
-- ingestion/matching/cover-letter/send/notification worker call site needs
-- any grant beyond this; authenticated has no execute grant, matching
-- automation_tasks' own zero-authenticated-access design (20260809090090).

-- ── claim_automation_task ─────────────────────────────────────────────────
create or replace function public.claim_automation_task(
  p_worker_id text,
  p_batch_size integer default 5
)
returns setof public.automation_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Must match p_lease_minutes passed to fail_stale_automation_tasks in the
  -- same worker execution (same convention as claim_analysis_task).
  v_lease interval := '10 minutes';
begin
  return query
  with claimable as (
    select id
    from public.automation_tasks
    where
      (
        status = 'pending'
        and next_attempt_at <= now()
      )
      or
      (
        status        = 'processing'
        and locked_at < now() - v_lease
        and attempt_count < max_attempts
      )
    order by next_attempt_at
    limit p_batch_size
    for update skip locked  -- atomic: each concurrent claim sees disjoint rows
  ),
  claimed as (
    update public.automation_tasks t
    set
      status        = 'processing',
      started_at    = coalesce(t.started_at, now()),
      locked_by     = p_worker_id,
      locked_at     = now(),
      attempt_count = t.attempt_count + 1,
      last_error    = case
                        when t.status = 'processing'
                        then 'Reclaimed after lease expiry (was attempt '
                          || t.attempt_count::text
                          || ', previously locked by '
                          || coalesce(t.locked_by, 'unknown')
                          || ').'
                          || case when t.last_error is not null
                               then ' Previous error: ' || left(t.last_error, 300)
                               else ''
                             end
                        else t.last_error
                      end
    from claimable
    where t.id = claimable.id
    returning t.*
  )
  select * from claimed;
end;
$$;

revoke execute on function public.claim_automation_task(text, integer) from public;
grant  execute on function public.claim_automation_task(text, integer) to service_role;

comment on function public.claim_automation_task(text, integer) is
  'Atomically claims up to p_batch_size automation_tasks using FOR UPDATE SKIP LOCKED, '
  'including lease-expired reclaim. Returns claimed rows. service_role only. '
  'Mirrors claim_analysis_task (20260811090010) for the generic outbox.';

-- ── fail_stale_automation_tasks ───────────────────────────────────────────
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
    status       = 'failed',
    completed_at = now(),
    last_error   =
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
  'Mirrors fail_stale_analysis_tasks (20260811090010).';
