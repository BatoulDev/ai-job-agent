-- Adds the write-capable CV-analysis review/confirmation flow that
-- cv_analyses has never had (AI_JOB_AGENT_SYSTEM_AUDIT.md, blocker #3):
-- update_cv_analysis_review() lets a user save edits to their own
-- unapproved analysis; confirm_cv_analysis() is the approval transaction
-- DATABASE_PLAN.md's Phase 4A addendum documented but never implemented,
-- followed here precisely.
--
-- review_status widened to add 'superseded': cv_analyses_one_approved_per_
-- user is a plain partial unique index on (user_id) where
-- review_status = 'approved' — at most ONE row can ever hold that literal
-- value per user, ever. When a newer analysis is approved (or an existing
-- approved analysis's CV is replaced), the OLD row's review_status must
-- move off 'approved' or the unique index breaks. The permanent historical
-- fact "this was approved, and when" is preserved by approved_at (never
-- cleared), not by keeping the literal string 'approved' forever.
alter table public.cv_analyses
  drop constraint cv_analyses_review_status_check;

alter table public.cv_analyses
  add constraint cv_analyses_review_status_check
  check (review_status in ('pending_review', 'approved', 'changes_requested', 'superseded'));

comment on column public.cv_analyses.review_status is
  'pending_review: initial AI output, unreviewed. changes_requested: user saved edits via update_cv_analysis_review, not yet confirmed. approved: confirmed via confirm_cv_analysis — at most one row per user (cv_analyses_one_approved_per_user). superseded: was approved, but a newer analysis (same or replaced CV) has since taken over the single approved/current slot; approved_at remains set as the permanent historical record of when it was approved.';

-- mark_cv_analyses_superseded_on_cv_change (20260805090030) already
-- demotes is_current/recommendations_state when a CV is replaced, but left
-- review_status untouched — which, before the widening above, was correct
-- (there was no safe value to move it to). Now that 'superseded' exists,
-- also demote review_status here so cv_analyses_one_approved_per_user
-- stays valid the moment a CV is replaced, not only once a new analysis is
-- later confirmed.
create or replace function public.mark_cv_analyses_superseded_on_cv_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active = false and old.is_active = true then
    update public.cv_analyses
    set is_current = false,
        recommendations_state = 'superseded',
        superseded_at = now(),
        review_status = case when review_status = 'approved' then 'superseded' else review_status end
    where cv_id = new.id and is_current = true;
  end if;
  return new;
end;
$$;

-- Lets the owning user save review edits to an analysis that has finished
-- processing and has not yet been confirmed. Never touches AI-generated
-- columns (cv_facts/ai_career_profile) — only user_edits, review_status,
-- and reviewed_at.
create or replace function public.update_cv_analysis_review(
  p_analysis_id uuid,
  p_user_edits jsonb
)
returns public.cv_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.cv_analyses;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_user_edits is not null and jsonb_typeof(p_user_edits) <> 'object' then
    raise exception 'user_edits must be a JSON object.';
  end if;

  select * into v_row
  from public.cv_analyses
  where id = p_analysis_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Analysis not found.';
  end if;

  if v_row.status <> 'completed' then
    raise exception 'This analysis is not ready for review yet.';
  end if;

  if v_row.review_status = 'approved' then
    raise exception 'This analysis has already been confirmed and can no longer be edited.';
  end if;

  update public.cv_analyses
  set user_edits = p_user_edits,
      review_status = 'changes_requested',
      reviewed_at = now()
  where id = p_analysis_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.update_cv_analysis_review(uuid, jsonb) from public;
grant execute on function public.update_cv_analysis_review(uuid, jsonb) to authenticated;

-- The approval transaction, following DATABASE_PLAN.md's Phase 4A addendum
-- (Approval transaction, documented but not implemented) step for step.
create or replace function public.confirm_cv_analysis(p_analysis_id uuid)
returns public.cv_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.cv_analyses;
  v_cv_is_active boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- 1: lock the target row.
  select * into v_row
  from public.cv_analyses
  where id = p_analysis_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Analysis not found.';
  end if;

  -- Idempotent no-op: already the confirmed, current record.
  if v_row.review_status = 'approved' and v_row.is_current and v_row.recommendations_state = 'current' then
    return v_row;
  end if;

  -- 5: reject an incomplete, failed, or already-superseded result.
  if v_row.status <> 'completed' then
    raise exception 'This analysis is not ready to confirm.';
  end if;

  if v_row.recommendations_state = 'superseded' then
    raise exception 'This analysis has been superseded by a newer CV and can no longer be confirmed.';
  end if;

  -- 3: the CV this analysis is based on must still be the user's active CV.
  select is_active into v_cv_is_active from public.cvs where id = v_row.cv_id;
  if v_cv_is_active is distinct from true then
    raise exception 'This analysis'' CV is no longer your active CV.';
  end if;

  -- 6: supersede whatever currently holds the single approved/current slot
  -- for this user (a prior successful analysis of the same CV, or a row
  -- the CV-change trigger hasn't caught because the CV itself didn't
  -- change) — required atomically here, not left to the caller, so
  -- cv_analyses_one_approved_per_user / _one_current_per_user can never be
  -- violated by this transaction.
  update public.cv_analyses
  set is_current = false,
      review_status = case when review_status = 'approved' then 'superseded' else review_status end
  where user_id = v_user_id
    and id <> p_analysis_id
    and (is_current = true or review_status = 'approved');

  -- 7-8: approve the target row.
  update public.cv_analyses
  set review_status = 'approved',
      is_current = true,
      recommendations_state = 'current',
      approved_at = now(),
      reviewed_at = now()
  where id = p_analysis_id
  returning * into v_row;

  insert into public.audit_events (user_id, actor_type, event_type, entity_type, entity_id)
  values (v_user_id, 'user', 'cv_analysis_confirmed', 'cv_analysis', p_analysis_id);

  return v_row;
end;
$$;

revoke execute on function public.confirm_cv_analysis(uuid) from public;
grant execute on function public.confirm_cv_analysis(uuid) to authenticated;
