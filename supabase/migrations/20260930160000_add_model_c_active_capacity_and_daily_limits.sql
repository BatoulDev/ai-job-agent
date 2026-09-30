-- Model C — Active Match Capacity + Daily New-Match Cap (founder decision,
-- 2026-09-30). Forward-only. Does not edit 20260930150000 (already applied)
-- or any other historical migration.
--
-- ═══════════════════════════════════════════════════════════════════════
-- PART A — plans.job_match_limit is redefined, plans.daily_new_match_limit
-- is added. Both stay on the existing public.plans authoritative catalog
-- (AGENTS.md §6/§20) — no new "active_match_capacity" column, per founder
-- preference to keep configuration centralized under one name where safe.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.plans
  add column daily_new_match_limit integer
    check (daily_new_match_limit is null or daily_new_match_limit >= 0);

comment on column public.plans.daily_new_match_limit is
  'Maximum number of NEW matches that may be surfaced (surfaced_at newly set) for a user on this plan within one UTC calendar day — a hard ceiling, never a target (a day with fewer strong candidates surfaces fewer, never padded). NULL means no daily gate at all, bounded only by job_match_limit (active capacity). Founder decision 2026-09-30 (Model C): Student=5, Pro=10. Free is intentionally left NULL — no new Free product decision was made this round (see docs/PRODUCT_MATCHING_RULES.md); this preserves Free''s existing observable behavior, since its job_match_limit of 1 already bounds delivery at least as tightly as any small daily number would.';

comment on column public.plans.job_match_limit is
  'Maximum ACTIVE/current opportunities that may occupy a user''s active match pool at one time (see count_active_matches_for_user()). REDEFINED 2026-09-30 (Model C, founder decision) from its original meaning ("total ever surfaced, for the current cv_analysis_id, never decrementing"). Historical matches are never deleted or hidden from history — a match simply stops being counted once it is no longer a genuinely current opportunity (rejected, its job is no longer active, or its application has already been sent). See docs/PRODUCT_MATCHING_RULES.md and count_active_matches_for_user().';

update public.plans set daily_new_match_limit = 5 where plan_code = 'student';
update public.plans set daily_new_match_limit = 10 where plan_code = 'pro';
-- free.daily_new_match_limit intentionally left NULL — see column comment.

-- ═══════════════════════════════════════════════════════════════════════
-- PART B — the one authoritative active-capacity predicate. Every caller
-- (today: only surface_new_matches_for_user()) must go through this
-- function rather than re-deriving the rule — "document the exact
-- active-capacity predicate in one authoritative place" (founder
-- instruction). STABLE (read-only within a transaction), SECURITY DEFINER
-- for the same reason get_my_matches() is: it reads across jobs/applications
-- rows the caller may not have direct RLS-visible access to construct this
-- join against, but only ever for p_user_id the caller itself controls —
-- see the one and only caller below, which always passes auth.uid().
--
-- A match occupies one active-capacity slot when ALL of:
--   1. it has actually been surfaced (surfaced_at is not null) — a scored-
--      but-never-shown match was never "occupying" anything from the
--      user's perspective (same principle the original design already
--      established for job_match_limit).
--   2. its status is 'pending_review' or 'user_approved' — 'user_rejected'
--      never consumes capacity (Part 2/11 of the founder brief).
--   3. its job's status is 'active' — expired/closed/unavailable/rejected/
--      source_error jobs never consume capacity (Part 2/10/12).
--   4. it has no application with status = 'sent' — a completed send is
--      "conceptually finished" (founder's own words, Part 13) and moves to
--      history; every other application state (pending_send/sending/
--      failed/cancelled) is treated conservatively as still active/
--      actionable, since only 'sent' was explicitly named as terminal and
--      AGENTS.md §15/"do not invent application statuses" forbids treating
--      an ambiguous state as terminal without one.
create or replace function public.count_active_matches_for_user(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.matches m
  join public.jobs j on j.id = m.job_id
  where m.user_id = p_user_id
    and m.surfaced_at is not null
    and m.status in ('pending_review', 'user_approved')
    and j.status = 'active'
    and not exists (
      select 1 from public.applications a
      where a.match_id = m.id and a.status = 'sent'
    );
$$;

comment on function public.count_active_matches_for_user(uuid) is
  'The one authoritative active-capacity predicate (Model C, 2026-09-30). Counts this user''s currently-occupying matches: surfaced, not rejected, job still active, application not yet sent. Never duplicate this logic elsewhere — call this function.';

revoke execute on function public.count_active_matches_for_user(uuid) from public;
grant execute on function public.count_active_matches_for_user(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- PART C — surface_new_matches_for_user() rewritten for Model C. Same
-- signature/grants as the original (20260928090000_add_match_surfacing_
-- and_quota.sql) — only the body changes, via create or replace.
--
-- New rule per call:
--   remaining_capacity = job_match_limit - count_active_matches_for_user()
--   remaining_daily    = daily_new_match_limit - (matches surfaced today, UTC)
--   to_surface         = least(remaining_capacity, remaining_daily)
-- then stamps surfaced_at on up to `to_surface` of the current analysis's
-- highest-scoring not-yet-surfaced pending_review matches — never more,
-- never padded with weaker candidates merely to reach either ceiling.
--
-- "Today" = the current UTC calendar day, derived directly from
-- surfaced_at (no separate mutable counter table, no reset job needed —
-- the count is naturally correct the instant UTC midnight passes).
--
-- Concurrency: a pg_advisory_xact_lock scoped to this user serializes
-- overlapping calls (two tabs, a retry racing a fresh call, two matching
-- runs in the same day) so two concurrent calls can never collectively
-- read the same pre-update snapshot and jointly overshoot either the
-- active-capacity or daily ceiling — mirrors the existing pattern in
-- create_payment_attempt/mark_payment_verified.
create or replace function public.surface_new_matches_for_user()
returns setof public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_analysis_id uuid;
  v_active_capacity integer;
  v_daily_limit integer;
  v_active_count integer;
  v_remaining_capacity integer;
  v_day_start timestamptz;
  v_surfaced_today integer;
  v_effective_daily_limit integer;
  v_remaining_daily integer;
  v_to_surface integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext('surface_new_matches_for_user:' || v_user_id::text)::bigint);

  select id into v_analysis_id
  from public.cv_analyses
  where user_id = v_user_id
    and review_status = 'approved'
    and is_current = true
    and recommendations_state = 'current'
  limit 1;

  select p.job_match_limit, p.daily_new_match_limit into v_active_capacity, v_daily_limit
  from public.subscriptions s
  join public.plans p on p.plan_code = s.plan_code
  where s.user_id = v_user_id;

  if v_analysis_id is not null then
    v_active_count := public.count_active_matches_for_user(v_user_id);
    v_remaining_capacity := greatest(0, coalesce(v_active_capacity, 0) - v_active_count);

    v_day_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
    select count(*) into v_surfaced_today
    from public.matches
    where user_id = v_user_id
      and surfaced_at >= v_day_start;

    v_effective_daily_limit := coalesce(v_daily_limit, 2147483647); -- null = no daily gate
    v_remaining_daily := greatest(0, v_effective_daily_limit - v_surfaced_today);

    v_to_surface := least(v_remaining_capacity, v_remaining_daily);

    if v_to_surface > 0 then
      update public.matches
      set surfaced_at = now()
      where id in (
        select id
        from public.matches
        where user_id = v_user_id
          and cv_analysis_id = v_analysis_id
          and status = 'pending_review'
          and surfaced_at is null
        order by score desc, id
        limit v_to_surface
      );
    end if;
  end if;

  return query
    select *
    from public.matches
    where user_id = v_user_id
      and surfaced_at is not null
    order by score desc, id;
end;
$$;

comment on function public.surface_new_matches_for_user() is
  'Model C (2026-09-30): surfaces up to min(remaining active capacity, remaining daily allowance) of the caller''s current-analysis highest-scoring not-yet-surfaced pending_review matches, then returns every match ever surfaced for the caller (any analysis). Active capacity and "today" are both derived live (count_active_matches_for_user(), surfaced_at >= UTC day start) — never a mutable counter, so no reset job is needed. pg_advisory_xact_lock per user prevents concurrent overshoot.';

-- ═══════════════════════════════════════════════════════════════════════
-- PART D — expire_due_jobs(): the hourly-sweep primitive (Part 9/25 of the
-- founder brief). Idempotent, set-based, never deletes, never touches a
-- status other than active->expired. jobs_set_closed_at (existing trigger,
-- 20260914120000_add_jobs_freshness_and_geography.sql) already stamps
-- closed_at automatically since 'expired' is in its terminal-status list —
-- no duplicate bookkeeping needed here.
--
-- NOT invoked by anything yet. No scheduler calls this function in this
-- migration — see n8n-workflows/job-expiry-sweep.ts (prepared, kept
-- `active: false`, not imported/activated). Production activation is a
-- separate, later, explicit step.
create or replace function public.expire_due_jobs()
returns table(job_id uuid)
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.jobs
    set status = 'expired', status_reason = 'expired_by_deadline_sweep'
    where status = 'active'
      and (
        (expires_at is not null and expires_at <= now())
        or (closing_date is not null and closing_date <= now())
      )
    returning id
  )
  select id from updated;
$$;

comment on function public.expire_due_jobs() is
  'Idempotent expiry sweep: flips active jobs whose expires_at or closing_date has passed to status=expired. Never deletes, never touches any other status. Safe to call repeatedly/hourly. Not scheduled by this migration — see n8n-workflows/job-expiry-sweep.ts (prepared, inactive).';

revoke execute on function public.expire_due_jobs() from public;
grant execute on function public.expire_due_jobs() to service_role;
