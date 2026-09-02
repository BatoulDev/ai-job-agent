-- Automation-1 audit fix (Phase 6 of the 8-item fix order): submit_analysis_
-- feedback() never touched the source analysis's recommendations_state.
-- Confirmed during the audit: submitting recommendation_feedback (or
-- cv_correction, or user_request) against a currently approved+current
-- analysis left it review_status='approved', is_current=true,
-- recommendations_state='current' for the entire window until the
-- follow-up task completed and a fresh analysis was separately confirmed —
-- i.e. it stayed fully matching-eligible even though the user had just
-- flagged it as needing a correction.
--
-- Decision (documented per the task's own instruction to state the exact
-- decision rather than invent a fragile implementation): all three
-- feedback types demote the source analysis identically, using the exact
-- same mechanism already used for preference-triggered staleness —
-- recommendations_state -> 'stale'. This was chosen over inventing a new
-- state because:
--   - It reuses the existing, already-tested current/stale/superseded
--     model instead of adding a fourth state.
--   - Phase 1/2's freshness gates (confirm_cv_analysis,
--     is_cv_analysis_matching_eligible) already treat 'stale' as
--     ineligible — no further gate changes are needed for this to take
--     effect.
--   - review_status stays 'approved' and approved_at is never cleared —
--     the permanent historical record of "this was approved, and when" is
--     preserved exactly as the existing review_status comment documents.
--   - is_current is left untouched (same reasoning as the preferences-
--     change trigger: a stale record is still "the" record until a
--     refreshed one is approved) — only recommendations_state changes.
--   - The row is never deleted; feedback rows are never deleted either
--     (submit_analysis_feedback already only detaches/supersedes, never
--     deletes — unchanged by this migration).
-- Only applied when the source analysis is currently recommendations_state
-- = 'current' (idempotent: a second feedback submission, or feedback
-- against an already-stale/superseded row, is a no-op on this specific
-- effect, matching the existing collapse-in-place task semantics).
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
  v_recs_state text;
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
  select cv_id, recommendations_state into v_cv_id, v_recs_state
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
  -- exhausted, aborting this call before any feedback row is written or
  -- the source analysis is touched.
  v_task := public.create_analysis_task(v_user_id, v_cv_id, p_feedback_type);

  -- Demote the source analysis (new): a genuinely accepted correction or
  -- request means the currently-approved profile is known to need a
  -- refresh — it must stop being matching-eligible until the refreshed,
  -- re-reviewed analysis is approved. Only touches a row that was
  -- 'current'; never regresses an already-'superseded' row, and is a safe
  -- no-op on repeat submissions against the same analysis.
  if v_recs_state = 'current' then
    update public.cv_analyses
    set recommendations_state = 'stale'
    where id = p_analysis_id;
  end if;

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
  'Demotes the source analysis to recommendations_state=''stale'' when a '
  'genuinely new request is accepted and the row was current — making it '
  'matching-ineligible until the refreshed analysis is approved, without '
  'clearing review_status/approved_at/is_current or deleting any history. '
  'SECURITY DEFINER to call the service_role-only create_analysis_task. '
  'Idempotent at the task level: returns an existing active task rather than '
  'creating a duplicate. Subject to the shared feedback-category quota '
  '(charge_feedback_task_quota) when a genuinely new task is accepted. '
  'Supersedes any earlier live feedback row for the same task before inserting.';
