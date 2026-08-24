-- Phase 1 of application-level rate limiting (see docs/PRODUCTION_READINESS.md,
-- "Rate limiting and abuse prevention"). Adds authoritative, bypass-resistant
-- protection for the two highest-cost, most directly abusable write paths:
--
--   A. create_analysis_task() — version/state-aware scheduling, NOT a
--      blanket time cooldown. See "AI-task scheduling design" below.
--   B. replace_cv() — at most 5 successful CV replacements per rolling hour
--      per user. Enforced with auth.uid(), inside the same SECURITY DEFINER
--      function that already performs the write, so it cannot be bypassed by
--      calling supabase.rpc('replace_cv', ...) directly (that IS the only
--      write path for cvs already; there is no separate app-layer gate to
--      route around).
--
-- ── Second correction (this revision): feedback linkage + a real quota ───────
--
-- Two risks found in review after the first correction above:
--
--   1. Feedback linkage across a deferred follow-up. analysis_feedback rows
--      point at a specific analysis_task_id, but a deferred follow-up task
--      (see "processing" below) gets a BRAND NEW id — so feedback submitted
--      while the original task was processing would stay attached to a task
--      that will never run again, and the n8n worker's "Load Task Feedback"
--      step (n8n-workflows/cv-analysis-worker.ts / .json — read, not
--      modified) — `analysis_feedback?analysis_task_id=eq.{taskId}&limit=1`,
--      with no `order=` clause — would never see it for the follow-up
--      either, since it filters by the follow-up's own (different) id.
--      Fixed entirely in Postgres, no n8n change: analysis_feedback gets a
--      new `superseded_at` column, and the invariant "at most one feedback
--      row is ever live (non-null analysis_task_id, superseded_at null) for
--      a given task at a time" is maintained by submit_analysis_feedback
--      (superseding — detaching, not deleting — any earlier live row for
--      the same task before inserting the new one, making the newest
--      feedback authoritative) and carried forward by
--      enqueue_followup_analysis_task (re-pointing that one live row, if
--      any, from the old terminal task to the new follow-up). Because at
--      most one row can ever match a given live analysis_task_id, the
--      worker's existing unordered "limit=1" read is deterministic without
--      needing an ORDER BY — no n8n change required. Full submission history
--      is preserved; rows are detached, never deleted.
--
--   2. Sequential abuse: the version/state-aware design below prevents
--      SIMULTANEOUS duplicate tasks, but nothing bounded how many
--      SEQUENTIAL feedback-driven tasks a user could create — completing
--      one and immediately requesting another, indefinitely. Added: a
--      5-per-rolling-hour quota shared across the three feedback-category
--      triggers (cv_correction, recommendation_feedback, user_request —
--      see "Feedback-category quota" below for why these three share one
--      bucket), charged only when a genuinely new request is *accepted*
--      (a fresh task, or the first flag on a processing task — never on a
--      dedup/collapse, and never on a rejected/failed call), and never
--      applied to cv_replaced or preferences_updated, which must always be
--      able to schedule the latest state (replace_cv has its own
--      independent 5-per-hour quota already; save_job_preferences only
--      calls through when something genuinely changed).
--
-- ── AI-task scheduling design (revision — see history below) ─────────────────
--
-- An earlier revision of this migration enforced a single blanket 10-minute
-- per-user cooldown before create_analysis_task could insert a genuinely new
-- row, shared across every trigger (onboarding_completed, cv_replaced,
-- preferences_updated, cv_correction, recommendation_feedback, user_request).
-- That design had a real lifecycle bug: replace_cv()'s own internal
-- create_analysis_task('cv_replaced') call could itself be blocked by that
-- cooldown whenever some OTHER trigger had recently created a task — and the
-- fix at the time (catching and swallowing that specific PT429 inside
-- replace_cv) meant a successful CV replacement could silently end up with
-- NO analysis task at all, relying on some later, unspecified user action to
-- eventually trigger one. That is not acceptable: every successful
-- replacement must end up with a pending, processing, completed, or
-- automatically-deferred analysis — never silently orphaned. The blanket
-- cooldown also had a second problem even ignoring replace_cv: it blocked
-- legitimate, genuinely different triggers from each other for the full 10
-- minutes (e.g. preferences_updated blocking a real feedback submission
-- moments later), which contradicts normal product use (a user may change
-- preferences, replace their CV, and submit feedback in any order, in quick
-- succession, and each is a genuine request that deserves its own analysis).
--
-- This revision replaces the blanket cooldown entirely with version/latest-
-- state-aware scheduling, keyed per (user, cv_id) rather than per user:
--
--   1. Dedup first (unchanged in spirit, extended): if an ACTIVE task
--      (pending or processing) already exists for this cv_id, no new task is
--      ever inserted — regardless of which trigger asked. This alone bounds
--      in-flight AI cost per cv_id to at most two rows (see #2), no matter
--      how many times or how rapidly it is called, by any combination of
--      triggers.
--        - If the existing active task is still PENDING (worker has not
--          claimed it yet): the worker reads the current CV and current
--          job_preferences LIVE at claim time — confirmed from
--          n8n-workflows/cv-analysis-worker.ts, which fetches both by id at
--          execution time rather than from any frozen snapshot — so a
--          pending task already *will* reflect the newest state once it
--          runs. Nothing needs to be re-created; only the `trigger` column
--          is refreshed in place to record the most recent reason, and the
--          existing row is returned. No quota, no new row: this is the
--          "return the existing task, no charge" case.
--        - If the existing active task is PROCESSING (the worker has
--          already claimed it and may be mid-flight): its output cannot be
--          safely redirected mid-run, and a second insert for the same
--          cv_id must never be allowed to reach 'pending' while this one is
--          'processing' — claim_analysis_task() (n8n-workflows, not
--          modified here) has no cv_id-aware exclusion, so two claimable
--          rows for the same cv_id could both be claimed concurrently,
--          which would then collide with the one-active-task-per-cv_id
--          unique index and break the worker's batch claim. Instead, this
--          row is flagged (needs_followup, followup_trigger) so that the
--          moment it leaves 'processing' (completed or failed), exactly one
--          follow-up task is queued automatically for the latest state —
--          see enqueue_followup_analysis_task() below. Repeated calls while
--          processing just re-flag the same row; at most one follow-up is
--          ever created regardless of call volume during that window.
--   2. If no active task exists for this cv_id at all, a genuinely new one
--      is created — with NO time-based cooldown. Abuse protection instead
--      comes from the structural bound in #1 (at most one processing + one
--      queued follow-up per cv_id at any moment, so the rate at which
--      *new* tasks can be created for one cv_id is capped by how fast the
--      worker can actually complete them, not by an arbitrary duration that
--      would otherwise have to choose between blocking legitimate rapid
--      state changes or being too generous to matter) plus each caller's
--      own independent bound: replace_cv's 5-per-hour quota (a brand new
--      cv_id can only be minted that often to begin with), save_job_
--      preferences' own change-detection (a task is only ever requested
--      when something genuinely changed), and onboarding/complete's
--      readiness gate (fires once, guarded by !hasActiveAnalysisTask).
--
-- Net effect: replace_cv() now calls create_analysis_task() unconditionally
-- again (no more catching/swallowing PT429) — dedup for a brand-new cv_id
-- never finds an existing active row, so a fresh task is always created,
-- bounded only by replace_cv's own 5-per-hour quota. Every successful
-- replacement therefore always ends up with a real task lifecycle.
--
-- ── replace_cv() CV-replacement quota (unchanged from the prior revision) ──
--
-- Both limits use an additive table (rate_limit_events) rather than reusing
-- existing timestamp columns, because a plain "check the latest timestamp"
-- read is not race-safe on its own: two concurrent requests can both read
-- "no recent event" before either commits. Correctness comes from
-- pg_advisory_xact_lock, keyed per (action, user), taken at the top of each
-- function before its check-then-act sequence — this serializes only that
-- one user's calls to that one action, never blocks other users, and
-- releases automatically at transaction end (commit or rollback).
--
-- Everything in this migration is additive and purely restrictive (it can
-- only reject a request that today would always be accepted, or defer work
-- that would otherwise be silently lost) — no existing table, column,
-- policy, or grant is narrowed or removed. Rollback is a follow-up migration
-- that:
--   1. drops the analysis_tasks.needs_followup / followup_trigger columns
--      and the analysis_tasks_enqueue_followup trigger + its function;
--   2. drops the analysis_feedback.superseded_at column;
--   3. drops charge_feedback_task_quota();
--   4. drops rate_limit_events;
--   5. drops the 4-argument create_analysis_task and re-creates the
--      original 3-argument CREATE OR REPLACE body verbatim from
--      20260802090030_create_analysis_tasks.sql;
--   6. re-applies the immediately-prior CREATE OR REPLACE bodies of
--      replace_cv (20260812100010_supersede_analysis_tasks_on_cv_replace.sql),
--      submit_analysis_feedback (20260818100000_add_analysis_feedback.sql),
--      and update_profile_name_and_retry_analysis
--      (20260819120000_update_profile_name_rpc.sql) verbatim.
-- All pure schema/function changes — the rollback needs no data migration,
-- though any analysis_feedback rows detached (superseded_at set,
-- analysis_task_id nulled) while this revision was live stay detached
-- (never deleted — this is intentional history, not something to restore).

-- ── 1. rate_limit_events ──────────────────────────────────────────────────────
-- One row per successful rate-limited occurrence: cv_replace (replace_cv's
-- 5-per-hour quota) or feedback_task_create (the shared feedback-category
-- AI-task quota — see charge_feedback_task_quota() below). Fully opaque to
-- end users, mirroring automation_tasks' convention exactly: RLS enabled
-- with zero policies for `authenticated`, and no GRANT to `authenticated` at
-- all — a doubly-enforced default-deny. Only replace_cv and
-- charge_feedback_task_quota (both SECURITY DEFINER, run as their owner)
-- and service_role (test fixtures / operational inspection) can ever read or
-- write this table.
create table public.rate_limit_events (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  action     text        not null check (action in ('cv_replace', 'feedback_task_create')),
  created_at timestamptz not null default now()
);

comment on table public.rate_limit_events is
  'Append-only log of rate-limited actions (cv_replace, feedback_task_create), one row per successful occurrence. Read/written only by replace_cv() / charge_feedback_task_quota() (SECURITY DEFINER, run as their owner) and by service_role. Never exposed to authenticated — no policy, no grant.';

create index rate_limit_events_user_action_created_idx
  on public.rate_limit_events (user_id, action, created_at desc);

alter table public.rate_limit_events enable row level security;

revoke all on public.rate_limit_events from public, authenticated;
grant select, insert, update, delete on public.rate_limit_events to service_role;

-- ── 2. analysis_tasks: columns for the deferred-follow-up mechanism ──────────
alter table public.analysis_tasks
  add column needs_followup boolean not null default false,
  add column followup_trigger text
    check (followup_trigger is null or followup_trigger in (
      'onboarding_completed', 'cv_replaced', 'preferences_updated',
      'cv_correction', 'recommendation_feedback', 'user_request'
    ));

comment on column public.analysis_tasks.needs_followup is
  'Set true when create_analysis_task() is asked to (re-)schedule this cv_id while this row is still "processing" — i.e. the underlying state changed again after the worker already claimed this task. enqueue_followup_analysis_task() reads this the moment the row leaves "processing" and queues exactly one follow-up task for the latest state.';
comment on column public.analysis_tasks.followup_trigger is
  'The most recent trigger reason requested while this row was "processing" — used as the trigger for the automatically-queued follow-up task. Null unless needs_followup is true.';

-- ── 3a. charge_feedback_task_quota(): the shared feedback-category quota ─────
-- At most 5 successful feedback-category AI-task acceptances per rolling
-- hour per user — cv_correction, recommendation_feedback, and user_request
-- share ONE bucket (not three separate quotas): all three represent the
-- same thing from an abuse/cost standpoint — a user explicitly asking for a
-- fresh AI re-analysis, whether phrased as CV-correction feedback,
-- recommendation feedback, a generic request, or a profile-name-triggered
-- retry (update_profile_name_and_retry_analysis also uses 'user_request').
-- Splitting them into separate quotas would let a user get 15 free
-- re-analyses/hour just by rotating which feedback_type they submit, with
-- no product reason to allow that. Called only from create_analysis_task,
-- only when a genuinely new request is being *accepted* (see there) — never
-- for cv_replaced or preferences_updated, which must always be able to
-- schedule the latest state. This is the single source of truth for the
-- limit/window — change the numbers below only, nowhere else.
create or replace function public.charge_feedback_task_quota(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.rate_limit_events
    where user_id = p_user_id
      and action = 'feedback_task_create'
      and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise sqlstate 'PT429'
      using message = 'You''ve requested too many new analyses recently. Please wait a bit and try again.',
            detail   = 'RATE_LIMITED_FEEDBACK_TASK_CREATE',
            hint     = 'Retry after the 1-hour rolling window has elapsed.';
  end if;

  insert into public.rate_limit_events (user_id, action) values (p_user_id, 'feedback_task_create');
end;
$$;

revoke execute on function public.charge_feedback_task_quota(uuid) from public;

-- ── 3b. create_analysis_task(): version/state-aware scheduling ───────────────
-- p_charge_feedback_quota (new, default true): every existing caller keeps
-- working unchanged (submit_analysis_feedback, update_profile_name_and_
-- retry_analysis, enqueue_preferences_analysis_task, and the onboarding-
-- complete admin-client call all omit it and get the default). Only
-- enqueue_followup_analysis_task's own internal call passes `false`
-- explicitly — an automatic follow-up is *fulfilling* a request whose
-- quota was already charged at acceptance time (see the "processing"
-- branch below), not a new request of its own; charging it again would
-- both double-count a single user action and — worse — could make the
-- worker's own "mark task completed" call fail with a rate-limit error it
-- has no way to handle, since that call reaches this function only
-- indirectly via this trigger.
-- Adding a 4th parameter changes this function's argument-type signature,
-- so CREATE OR REPLACE below would otherwise create a new overload
-- alongside the original 3-argument version from
-- 20260802090030_create_analysis_tasks.sql rather than replacing it —
-- every existing 3-argument call site (all seven callers, plus this
-- migration's own earlier revision of this same function) would then keep
-- resolving to that OLD, unfixed overload. Drop it explicitly first so
-- only the corrected version can ever be called. Safe: plpgsql function
-- bodies resolve calls to other functions by name at EXECUTION time, not
-- at CREATE time, so no existing function definition is broken by this.
drop function if exists public.create_analysis_task(uuid, uuid, text);

create or replace function public.create_analysis_task(
  p_user_id uuid,
  p_cv_id uuid,
  p_trigger text,
  p_charge_feedback_quota boolean default true
)
returns public.analysis_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.analysis_tasks;
begin
  -- Serializes every create_analysis_task call for this user (regardless of
  -- which of the seven callers invoked it) so the dedup/collapse/insert
  -- sequence below is atomic under concurrency. Released automatically at
  -- transaction end.
  perform pg_advisory_xact_lock(hashtext('create_analysis_task:' || p_user_id::text)::bigint);

  select * into v_row
  from public.analysis_tasks
  where cv_id = p_cv_id and status in ('pending', 'processing')
  limit 1;

  if found then
    if v_row.status = 'pending' then
      -- Collapse in place: refresh the recorded reason only. The worker
      -- reads CV and preferences live at claim time, so this row already
      -- represents the latest state once it runs. No new row, no charge —
      -- this is a deduplicated request, never quota-charged.
      if v_row.trigger is distinct from p_trigger then
        update public.analysis_tasks
        set trigger = p_trigger
        where id = v_row.id
        returning * into v_row;
      end if;
      return v_row;
    end if;

    -- v_row.status = 'processing': flag for an automatic follow-up instead
    -- of inserting now (see enqueue_followup_analysis_task below for why
    -- inserting a second claimable row here would be unsafe). Idempotent:
    -- repeated calls while processing just update the same flag/reason —
    -- charged (if applicable) only the first time this row is flagged
    -- (`not v_row.needs_followup`), never on a repeat flag: a second
    -- feedback submission while the first is still awaiting its follow-up
    -- is a collapse onto the same accepted request, not a new one.
    if p_charge_feedback_quota
       and not v_row.needs_followup
       and p_trigger in ('cv_correction', 'recommendation_feedback', 'user_request')
    then
      perform public.charge_feedback_task_quota(p_user_id);
    end if;

    update public.analysis_tasks
    set needs_followup = true,
        followup_trigger = p_trigger
    where id = v_row.id
    returning * into v_row;

    return v_row;
  end if;

  -- No active task for this cv_id: create a genuinely new one. No
  -- time-based cooldown for cv_replaced/preferences_updated/
  -- onboarding_completed — see the design note at the top of this file.
  -- Feedback-category triggers are bounded by the shared quota above,
  -- charged here (accepted request) only when eligible.
  if p_charge_feedback_quota and p_trigger in ('cv_correction', 'recommendation_feedback', 'user_request') then
    perform public.charge_feedback_task_quota(p_user_id);
  end if;

  insert into public.analysis_tasks (user_id, cv_id, trigger, idempotency_key)
  values (p_user_id, p_cv_id, p_trigger, p_cv_id::text || ':' || gen_random_uuid()::text)
  on conflict (cv_id) where status in ('pending', 'processing') do nothing
  returning * into v_row;

  if v_row.id is null then
    -- Lost a race against a concurrent caller: fetch what they created.
    -- Kept as a defensive fallback; the advisory lock above already
    -- prevents this for same-user races, but a cv_id is not guaranteed to
    -- be exclusive to one user in every future caller, so this branch stays.
    select * into v_row
    from public.analysis_tasks
    where cv_id = p_cv_id and status in ('pending', 'processing')
    limit 1;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.create_analysis_task(uuid, uuid, text, boolean) from public;
grant execute on function public.create_analysis_task(uuid, uuid, text, boolean) to service_role;

-- ── 4. enqueue_followup_analysis_task(): the deferred-follow-up trigger ─────
-- Fires whenever a row transitions out of "processing" (to "completed" or
-- "failed" — the latter covers both a normal worker failure report and
-- fail_stale_analysis_tasks' bulk lease-expiry update; both are plain
-- UPDATEs on this table regardless of caller, so this fires either way with
-- no n8n changes required). If the row was flagged needs_followup and its
-- cv_id is still the user's active CV and it was never superseded, queues
-- exactly one new task for the latest state via the same create_analysis_task
-- entry point used everywhere else (so the new task is itself still subject
-- to this same scheduling logic, not a special case) — with
-- p_charge_feedback_quota = false, since the quota was already charged at
-- acceptance time (see create_analysis_task's "processing" branch); this
-- call must never fail on a quota check, or the worker's own "mark task
-- completed/failed" call (which reaches this trigger indirectly) would
-- itself start failing.
--
-- Also re-points any still-live feedback (analysis_feedback.analysis_task_id
-- = old.id, superseded_at is null) onto the new follow-up task, so feedback
-- submitted while old was processing is actually read by the follow-up
-- rather than staying attached to a task that will never run again. At most
-- one row can ever be live for a given task (see submit_analysis_feedback's
-- own supersession step), so this UPDATE affects at most one row.
create or replace function public.enqueue_followup_analysis_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_followup public.analysis_tasks;
begin
  if old.needs_followup
     and old.superseded_at is null
     and exists (
       select 1 from public.cvs
       where id = old.cv_id and user_id = old.user_id and is_active = true
     )
  then
    select * into v_followup
    from public.create_analysis_task(
      old.user_id,
      old.cv_id,
      coalesce(old.followup_trigger, old.trigger),
      false
    );

    if v_followup.id is distinct from old.id then
      update public.analysis_feedback
      set analysis_task_id = v_followup.id
      where analysis_task_id = old.id
        and superseded_at is null;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.enqueue_followup_analysis_task() from public;

comment on function public.enqueue_followup_analysis_task() is
  'AFTER UPDATE trigger on analysis_tasks: when a needs_followup row leaves "processing", automatically queues exactly one follow-up task for the latest state via create_analysis_task(). Guards against queuing for a CV that was replaced or a task that was superseded in the meantime.';

create trigger analysis_tasks_enqueue_followup
  after update on public.analysis_tasks
  for each row
  when (old.status = 'processing' and new.status in ('completed', 'failed'))
  execute function public.enqueue_followup_analysis_task();

-- ── 5. replace_cv(): CV-replacement rolling-window limit ─────────────────────
-- Identical to 20260812100010_supersede_analysis_tasks_on_cv_replace.sql
-- (PDF guard, ownership guard, row locking, versioning, cv_replaced task
-- creation, cross-version task supersession) with one addition: a rolling-
-- hour quota check immediately after authentication, before any row is read
-- or written. A rejected call raises before the function body reaches any
-- INSERT/UPDATE, so it can never consume quota or leave a partial write.
--
-- The create_analysis_task() call below is now unconditional again (no
-- try/catch around it) — with the blanket cooldown removed, dedup for a
-- brand-new cv_id never finds an existing active row, so this always
-- succeeds in creating (or, extremely rarely under a same-cv_id race,
-- deduplicating onto) a real task. Every successful replacement therefore
-- always ends up with a task lifecycle, bounded only by the 5-per-hour quota
-- checked above.
create or replace function public.replace_cv(
  p_storage_path    text,
  p_file_name       text,
  p_file_size_bytes integer,
  p_mime_type       text
)
returns public.cvs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id      uuid := auth.uid();
  v_old          public.cvs;
  v_new          public.cvs;
  v_had_active   boolean;
  v_recent_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Serializes every replace_cv call for this user so the count-then-insert
  -- rate-limit check below is atomic under concurrency, independent of (in
  -- addition to) the pre-existing "select ... for update" row lock further
  -- down. Released automatically at transaction end.
  perform pg_advisory_xact_lock(hashtext('replace_cv:' || v_user_id::text)::bigint);

  -- Rate limit: at most 5 successful replacements per rolling hour per
  -- user. This is the single source of truth for the limit/window — change
  -- the numbers below only, nowhere else. Counts EVERY successful
  -- replace_cv call (including a user's very first CV upload, which also
  -- goes through this same RPC) — the policy is about bounding calls to
  -- this write path, not just re-replacements.
  select count(*) into v_recent_count
  from public.rate_limit_events
  where user_id = v_user_id
    and action = 'cv_replace'
    and created_at > now() - interval '1 hour';

  if v_recent_count >= 5 then
    raise sqlstate 'PT429'
      using message = 'You''ve reached the CV upload limit. Please try again in a bit.',
            detail   = 'RATE_LIMITED_CV_REPLACE',
            hint     = 'Retry after the 1-hour rolling window has elapsed.';
  end if;

  -- Server-side MIME-type guard. DOCX/DOC can be re-enabled here once a
  -- verified plain-text extractor is confirmed in the n8n environment.
  if p_mime_type <> 'application/pdf' then
    raise exception 'Only PDF uploads are supported. Received: %', p_mime_type
      using errcode = 'check_violation';
  end if;

  if p_storage_path is null or p_storage_path not like (v_user_id::text || '/%') then
    raise exception 'storage_path must be scoped to the authenticated user''s own folder.';
  end if;

  select * into v_old
  from public.cvs
  where user_id = v_user_id and is_active = true
  for update;

  v_had_active := found;

  if v_had_active then
    update public.cvs
    set is_active = false, superseded_at = now()
    where id = v_old.id;
  end if;

  insert into public.cvs (
    user_id, storage_path, file_name, file_size_bytes, mime_type, status, version, is_active
  )
  values (
    v_user_id, p_storage_path, p_file_name, p_file_size_bytes, p_mime_type,
    'uploaded', coalesce(v_old.version, 0) + 1, true
  )
  returning * into v_new;

  -- Records this successful replacement for the rolling-window count above.
  -- Inserted only once the cvs row itself has been written successfully.
  insert into public.rate_limit_events (user_id, action) values (v_user_id, 'cv_replace');

  -- Only a true replacement (an existing active CV superseded) enqueues a
  -- task here. First-time uploads keep relying on /api/onboarding/complete,
  -- unchanged, to enqueue 'onboarding_completed' once preferences are done
  -- too — not at CV-upload time. Unconditional again: see the design note
  -- at the top of this file for why this can no longer be silently skipped.
  if v_had_active then
    perform public.create_analysis_task(v_user_id, v_new.id, 'cv_replaced');
  end if;

  -- Supersede any still-unfinished analysis tasks left behind by this
  -- user's other CV versions. Ordinarily that's just the one task tied to
  -- v_old.id, but this is scoped to user_id (not v_old.id alone) so it
  -- also cleans up any older, previously-unsupersede tasks in one pass.
  -- Never touches the row for v_new.id (the task just created above, if
  -- any) or any task whose status is already terminal (completed/failed)
  -- or already superseded.
  update public.analysis_tasks
  set superseded_at = now()
  where user_id = v_user_id
    and cv_id <> v_new.id
    and status in ('pending', 'processing')
    and superseded_at is null;

  return v_new;
end;
$$;

revoke execute on function public.replace_cv(text, text, integer, text) from public;
grant execute on function public.replace_cv(text, text, integer, text) to authenticated;

-- ── 6. analysis_feedback: superseded_at (feedback-linkage fix) ───────────────
-- See the "Second correction" design note at the top of this file. Mirrors
-- the superseded_at pattern already used on cvs and analysis_tasks. Rows are
-- never deleted — this only marks a row as no longer live (and, alongside
-- it, analysis_task_id is cleared to null) so the n8n worker's unordered
-- "limit=1" feedback read can never match more than one row for a given
-- live task.
alter table public.analysis_feedback
  add column superseded_at timestamptz;

comment on column public.analysis_feedback.superseded_at is
  'Set when a newer feedback submission for the same task supersedes this row (analysis_task_id is cleared to null at the same time), making the newest feedback authoritative and keeping at most one row live per task. Never set merely because this row was carried forward to a deferred follow-up task — see enqueue_followup_analysis_task, which re-points analysis_task_id without touching this column. The row itself is never deleted.';

-- ── 7. submit_analysis_feedback(): supersede any earlier live feedback ───────
-- Identical to 20260818100000_add_analysis_feedback.sql except for one
-- addition immediately before the INSERT: any existing live (superseded_at
-- is null) feedback row already attached to the target task is superseded
-- (detached: superseded_at = now(), analysis_task_id = null) before the new
-- row is inserted. This is what keeps at most one feedback row live per
-- task at a time — see the design note at the top of this file. Full
-- history is preserved: every submission still gets its own permanent row
-- (unchanged from before — see the existing "still inserts a new feedback
-- row" test), only the *live* pointer moves.
create or replace function public.submit_analysis_feedback(
  p_analysis_id      uuid,
  p_feedback_type    text,
  p_feedback_text    text,
  p_affected_section text default null
)
returns public.analysis_feedback
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id  uuid := auth.uid();
  v_cv_id    uuid;
  v_task     public.analysis_tasks;
  v_row      public.analysis_feedback;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_feedback_type not in ('cv_correction', 'recommendation_feedback', 'user_request') then
    raise exception 'Invalid feedback_type.';
  end if;

  if length(trim(coalesce(p_feedback_text, ''))) < 10 then
    raise exception 'Feedback must be at least 10 characters.';
  end if;

  if length(coalesce(p_feedback_text, '')) > 2000 then
    raise exception 'Feedback must not exceed 2000 characters.';
  end if;

  if p_affected_section is not null and length(p_affected_section) > 200 then
    raise exception 'Affected section must not exceed 200 characters.';
  end if;

  -- Ownership check: the analysis must belong to the caller.
  -- Deliberately combines not-found and not-owned into one exception so
  -- requesting another user's analysis ID reveals nothing about its existence.
  select cv_id into v_cv_id
  from public.cv_analyses
  where id = p_analysis_id and user_id = v_user_id;

  if not found then
    raise exception 'Analysis not found.';
  end if;

  -- The CV the analysis was generated from must still be the user's active CV.
  if not exists (
    select 1 from public.cvs
    where id = v_cv_id
      and is_active = true
      and user_id   = v_user_id
  ) then
    raise exception 'Your CV is no longer active. Upload a new CV to request changes.';
  end if;

  -- Create (or deduplicate) the analysis task. Subject to the shared
  -- feedback-category quota (see charge_feedback_task_quota) when this
  -- results in a genuinely new request being accepted; raises PT429 if
  -- exhausted, aborting this call before any feedback row is written.
  v_task := public.create_analysis_task(v_user_id, v_cv_id, p_feedback_type);

  -- Supersede any earlier live feedback for this same task — see the
  -- function comment above. Must happen before the insert below.
  update public.analysis_feedback
  set superseded_at = now(),
      analysis_task_id = null
  where analysis_task_id = v_task.id
    and superseded_at is null;

  -- Insert the feedback row linked to the created (or existing) task.
  insert into public.analysis_feedback (
    user_id, cv_id, source_analysis_id, analysis_task_id,
    feedback_type, affected_section, feedback_text
  )
  values (
    v_user_id,
    v_cv_id,
    p_analysis_id,
    v_task.id,
    p_feedback_type,
    nullif(trim(coalesce(p_affected_section, '')), ''),
    trim(p_feedback_text)
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.submit_analysis_feedback(uuid, text, text, text) from public;
grant  execute on function public.submit_analysis_feedback(uuid, text, text, text) to authenticated;

comment on function public.submit_analysis_feedback(uuid, text, text, text) is
  'Creates an analysis task + feedback row atomically for Request Changes '
  'options 1, 3, and 5 (cv_correction, recommendation_feedback, user_request). '
  'Validates caller ownership of the source analysis before proceeding. '
  'SECURITY DEFINER to call the service_role-only create_analysis_task. '
  'Idempotent at the task level: returns an existing active task rather than '
  'creating a duplicate. Subject to the shared feedback-category quota '
  '(charge_feedback_task_quota) when a genuinely new task is accepted. '
  'Supersedes any earlier live feedback row for the same task before inserting.';

-- ── 8. update_profile_name_and_retry_analysis(): degrade quota gracefully ───
-- Identical to 20260819120000_update_profile_name_rpc.sql except the
-- create_analysis_task call is now wrapped: if the shared feedback-category
-- quota (charge_feedback_task_quota, trigger 'user_request') is exhausted,
-- the name change itself still succeeds — has_active_task simply reports
-- false, exactly like the existing "no active CV" case already does. This
-- is deliberately different from replace_cv (which never catches a
-- rate-limit error from its own create_analysis_task call): renaming a
-- profile has real value independent of whether a retry-analysis is also
-- scheduled, and the user has already received several analyses this hour
-- via other actions if this quota is the one that's exhausted. Contrast
-- with CV replacement, where skipping would mean a brand-new cv_id — never
-- analyzed by anything else — goes unanalyzed indefinitely.
create or replace function public.update_profile_name_and_retry_analysis(
  p_full_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_trimmed  text;
  v_cv_id    uuid;
  v_has_active_task boolean := false;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  v_trimmed := trim(p_full_name);
  if v_trimmed = '' then
    raise exception 'Name cannot be empty.';
  end if;
  if char_length(v_trimmed) > 200 then
    raise exception 'Name must not exceed 200 characters.';
  end if;

  update public.profiles
    set full_name = v_trimmed
  where id = v_user_id;

  -- Find the user's current active CV. The unique partial index on
  -- cvs(user_id) WHERE is_active = true guarantees at most one row.
  select id into v_cv_id
  from public.cvs
  where user_id = v_user_id
    and is_active = true
  order by created_at desc
  limit 1;

  if v_cv_id is not null then
    begin
      perform public.create_analysis_task(v_user_id, v_cv_id, 'user_request');
      v_has_active_task := true;
    exception
      when sqlstate 'PT429' then
        v_has_active_task := false;
    end;
  end if;

  return jsonb_build_object(
    'ok',              true,
    'has_active_task', v_has_active_task
  );
end;
$$;

-- Grant to authenticated: callers must still have a valid session and
-- auth.uid() must resolve to a real user — anonymous callers are rejected
-- inside the function body.
revoke execute on function public.update_profile_name_and_retry_analysis(text) from public;
grant execute on function public.update_profile_name_and_retry_analysis(text) to authenticated;
