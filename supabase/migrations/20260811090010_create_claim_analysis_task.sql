-- Implements the atomic worker-claim contract documented in DATABASE_PLAN.md
-- Phase 4B addendum ("Atomic Worker Claim" section). Two functions:
--
--   claim_analysis_task(p_batch_size)
--     Atomically claims up to p_batch_size tasks in a single transaction
--     using FOR UPDATE SKIP LOCKED. Also reclaims processing tasks whose
--     lease has expired (started_at older than LEASE_MINUTES) and that
--     still have remaining attempts. Returns the claimed rows so the caller
--     can process each one using its id, user_id, and cv_id.
--
--   fail_stale_analysis_tasks(p_lease_minutes)
--     Permanently fails processing tasks that are past their lease AND have
--     exhausted max_attempts. Called once per worker execution before
--     claim_analysis_task so stuck tasks are cleaned up before new ones are
--     claimed. Returns the count of rows permanently failed.
--
-- Both are SECURITY DEFINER, granted to service_role only. The n8n worker
-- calls them via the Supabase REST RPC endpoint with the service-role key.
-- authenticated has no execute grant — users cannot claim or fail tasks.

-- ── claim_analysis_task ───────────────────────────────────────────────────
--
-- Claim contract:
--   status = 'pending'  AND available_at <= now()  → fresh claim
--   status = 'processing' AND started_at < now() - LEASE  AND
--     attempt_count < max_attempts                 → lease-expired reclaim
--
-- Both paths are handled in one atomic CTE. attempt_count is incremented on
-- every claim (including reclaims). last_error is preserved on reclaims so
-- the previous attempt's error is still visible in the row.
--
-- Concurrent worker executions (overlapping 30s schedule firings) each see a
-- non-overlapping set of rows because SKIP LOCKED skips any row another
-- transaction is currently modifying. No two executions can claim the same
-- task.
create or replace function public.claim_analysis_task(
  p_batch_size integer default 3
)
returns setof public.analysis_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Lease constant: a task processing longer than this is considered stuck.
  -- Must match p_lease_minutes passed to fail_stale_analysis_tasks in the
  -- same worker execution.
  v_lease interval := '10 minutes';
begin
  return query
  with claimable as (
    select id
    from public.analysis_tasks
    where
      -- Fresh pending tasks that are due
      (
        status      = 'pending'
        and available_at <= now()
        and superseded_at is null
      )
      or
      -- Lease-expired processing tasks still eligible for retry
      (
        status        = 'processing'
        and started_at < now() - v_lease
        and attempt_count < max_attempts
        and superseded_at is null
      )
    order by available_at
    limit p_batch_size
    for update skip locked  -- atomic: each concurrent claim sees disjoint rows
  ),
  claimed as (
    update public.analysis_tasks t
    set
      status        = 'processing',
      started_at    = now(),
      attempt_count = t.attempt_count + 1,
      -- Annotate reclaimed rows so operators can spot lease-recovery events
      -- without needing to inspect execution logs. The previous last_error
      -- (if any) is preserved as a suffix so nothing is lost.
      last_error    = case
                        when t.status = 'processing'
                        then 'Reclaimed after lease expiry (was attempt '
                          || t.attempt_count::text
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

revoke execute on function public.claim_analysis_task(integer) from public;
grant  execute on function public.claim_analysis_task(integer) to service_role;

comment on function public.claim_analysis_task(integer) is
  'Atomically claims up to p_batch_size analysis tasks using FOR UPDATE SKIP LOCKED. '
  'Returns claimed rows. Called by the n8n CV analysis worker via service-role RPC. '
  'See DATABASE_PLAN.md Phase 4B for the full automation contract.';

-- ── fail_stale_analysis_tasks ─────────────────────────────────────────────
--
-- Permanently fails processing tasks that:
--   - have been in processing status longer than the lease window, AND
--   - have attempt_count >= max_attempts (no retries left)
--
-- These rows will never be reclaimed by claim_analysis_task (which requires
-- attempt_count < max_attempts). Without this function they would stay in
-- 'processing' indefinitely and block the per-cv unique index.
--
-- Called at the start of every worker execution, before claim_analysis_task,
-- so new task slots open up before the next claim is attempted.
--
-- Returns the count of rows permanently failed (0 is the common case).
create or replace function public.fail_stale_analysis_tasks(
  p_lease_minutes integer default 10
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count   integer;
  v_lease   interval;
begin
  v_lease := (p_lease_minutes || ' minutes')::interval;

  update public.analysis_tasks
  set
    status    = 'failed',
    failed_at = now(),
    last_error =
      'Permanently failed: max_attempts (' || max_attempts::text
      || ') exhausted after lease expiry. Last attempt started at '
      || started_at::text || '.'
      || case when last_error is not null
           then ' Previous error: ' || left(last_error, 300)
           else ''
         end
  where
    status        = 'processing'
    and started_at < now() - v_lease
    and attempt_count >= max_attempts;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.fail_stale_analysis_tasks(integer) from public;
grant  execute on function public.fail_stale_analysis_tasks(integer) to service_role;

comment on function public.fail_stale_analysis_tasks(integer) is
  'Permanently fails analysis tasks stuck in processing past their lease with '
  'no remaining attempts. Called by the n8n worker before each claim batch. '
  'Returns number of rows failed (typically 0). See claim_analysis_task for the '
  'lease constant used in the complementary reclaim path.';
