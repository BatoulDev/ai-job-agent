-- Implements the backend paths for Request Changes options 1, 3, and 5:
-- "Incorrect CV information" (cv_correction), "Change AI recommendations"
-- (recommendation_feedback), and "Something else" (user_request).
--
-- Three coordinated changes:
--
-- 1. Widens analysis_tasks.trigger to allow the three new feedback-triggered
--    values. Keeps the existing three values unchanged.
--
-- 2. Creates analysis_feedback: stores the user's correction or request so
--    the n8n worker can include it in the AI prompt. RLS: users read only
--    their own rows; service_role reads all (for n8n).
--
-- 3. Creates submit_analysis_feedback(): a narrow SECURITY DEFINER RPC that
--    validates ownership of the source analysis, creates (or deduplicates)
--    the analysis task, and inserts the feedback row — all in one atomic
--    transaction. Granted to authenticated.

-- ── 1. Widen analysis_tasks.trigger ──────────────────────────────────────────

alter table public.analysis_tasks
  drop constraint analysis_tasks_trigger_check;

alter table public.analysis_tasks
  add constraint analysis_tasks_trigger_check
  check (trigger in (
    'onboarding_completed',
    'cv_replaced',
    'preferences_updated',
    'cv_correction',
    'recommendation_feedback',
    'user_request'
  ));

-- ── 2. analysis_feedback ─────────────────────────────────────────────────────

create table public.analysis_feedback (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users (id) on delete cascade,
  cv_id              uuid        not null references public.cvs (id) on delete cascade,
  -- The analysis the user was looking at when they clicked "Request Changes".
  -- Nullable: set null if that analysis is later deleted.
  source_analysis_id uuid        references public.cv_analyses (id) on delete set null,
  -- Linked to the task that will use this feedback. Set at insert time by
  -- submit_analysis_feedback so the n8n worker can join by analysis_task_id.
  analysis_task_id   uuid        references public.analysis_tasks (id) on delete set null,
  feedback_type      text        not null
    check (feedback_type in ('cv_correction', 'recommendation_feedback', 'user_request')),
  -- Optional context field for cv_correction ("Work experience", "Skills", …).
  affected_section   text        check (char_length(affected_section) <= 200),
  feedback_text      text        not null
    check (char_length(feedback_text) >= 10 and char_length(feedback_text) <= 2000),
  created_at         timestamptz not null default now()
);

comment on table public.analysis_feedback is
  'Correction and request feedback from the user''s "Request Changes" dialog '
  '(options cv_correction, recommendation_feedback, user_request). Linked to '
  'the re-analysis task via analysis_task_id. The n8n worker reads this row '
  'and includes the feedback text in the AI prompt.';

alter table public.analysis_feedback enable row level security;

create policy "analysis_feedback_select_own"
  on public.analysis_feedback
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Authenticated users cannot insert directly — they use submit_analysis_feedback().
-- Service_role can read/write (n8n worker reads; submit_analysis_feedback writes
-- as SECURITY DEFINER which runs as the function owner, not the authenticated user).
grant select on public.analysis_feedback to authenticated;
grant select, insert, update on public.analysis_feedback to service_role;

create index analysis_feedback_task_idx  on public.analysis_feedback (analysis_task_id);
create index analysis_feedback_user_idx  on public.analysis_feedback (user_id);

-- ── 3. submit_analysis_feedback() ────────────────────────────────────────────
-- Called by POST /api/cv-analysis/submit-feedback via the Supabase RPC path.
-- Validates that p_analysis_id belongs to the authenticated user, derives the
-- cv_id from it, creates (or deduplicates) the analysis task, and inserts
-- the feedback row in a single atomic transaction.
--
-- SECURITY DEFINER: required to call the service_role-only create_analysis_task.
-- Uses auth.uid() — cannot impersonate another user.
-- Granted to authenticated only.

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

  -- Create (or deduplicate) the analysis task. If an active task already exists
  -- for this cv_id (e.g. concurrent request or preferences change in flight),
  -- create_analysis_task returns that existing task rather than raising.
  v_task := public.create_analysis_task(v_user_id, v_cv_id, p_feedback_type);

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
  'creating a duplicate.';
