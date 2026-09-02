-- Automation-1 audit fix (Phase 1 of the 8-item fix order): confirm_cv_analysis()
-- never checked that the analysis being approved still reflects the user's
-- CURRENT recommendations state or their LATEST job_preferences.version. It
-- only rejected recommendations_state = 'superseded' — a 'stale' analysis
-- (preferences changed after the analysis was generated/approved) passed
-- every guard and could be approved, or re-approved, unchanged.
--
-- Reproduced live during the audit: an approved analysis whose preferences
-- changed flipped to recommendations_state='stale' but stayed
-- review_status='approved'/is_current=true, and confirm_cv_analysis's own
-- idempotent-no-op check (which already required recommendations_state=
-- 'current') simply fell through to the normal approve path instead of
-- rejecting — silently re-approving a stale row and resetting
-- recommendations_state back to 'current' with no new analysis.
--
-- Fix: explicitly reject any analysis whose recommendations_state is not
-- 'current', and require preferences_version to be set and equal to the
-- caller's live job_preferences.version. Ownership, completed-status,
-- active-CV, atomic supersession, and the one-approved/one-current
-- invariants are all preserved unchanged from
-- 20260809090100_add_cv_analyses_review_confirm.sql.
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
  v_latest_prefs_version integer;
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

  -- Idempotent no-op: already the confirmed, current record. Narrow by
  -- design — recommendations_state must already be 'current', so a stale
  -- row (even one that was previously approved) never qualifies and falls
  -- through to the rejection checks below instead of being silently
  -- re-approved.
  if v_row.review_status = 'approved' and v_row.is_current and v_row.recommendations_state = 'current' then
    return v_row;
  end if;

  -- 5: reject an incomplete or failed result.
  if v_row.status <> 'completed' then
    raise exception 'This analysis is not ready to confirm.';
  end if;

  -- Reject a result superseded by a newer CV (specific message).
  if v_row.recommendations_state = 'superseded' then
    raise exception 'This analysis has been superseded by a newer CV and can no longer be confirmed.';
  end if;

  -- Reject any other non-current state (i.e. 'stale' — preferences changed
  -- since this analysis was generated). Catches both a fresh completed
  -- analysis that never became current-and-fresh and a previously-approved
  -- analysis that has since gone stale.
  if v_row.recommendations_state <> 'current' then
    raise exception 'This analysis no longer reflects your current preferences and cannot be confirmed. Wait for the refreshed analysis and approve that instead.';
  end if;

  -- 3: the CV this analysis is based on must still be the user's active CV.
  select is_active into v_cv_is_active from public.cvs where id = v_row.cv_id;
  if v_cv_is_active is distinct from true then
    raise exception 'This analysis'' CV is no longer your active CV.';
  end if;

  -- Freshness gate (new): the analysis must carry a known preferences
  -- version, and it must equal the caller's live job_preferences.version.
  -- A null preferences_version (e.g. an older analysis predating this
  -- column, or one whose preference merge failed) cannot be proven fresh
  -- and is rejected rather than assumed valid.
  select version into v_latest_prefs_version
  from public.job_preferences
  where user_id = v_user_id;

  if v_row.preferences_version is null
     or v_latest_prefs_version is null
     or v_row.preferences_version <> v_latest_prefs_version then
    raise exception 'This analysis does not reflect your latest preferences and cannot be confirmed. Wait for the refreshed analysis and approve that instead.';
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

comment on function public.confirm_cv_analysis(uuid) is
  'Approval transaction for a completed cv_analyses row. Requires: ownership, '
  'status=completed, recommendations_state=current (rejects stale/superseded), '
  'the analysis'' CV still active, and preferences_version equal to the '
  'caller''s live job_preferences.version. Atomically supersedes any prior '
  'approved/current row for the user. Idempotent only when the target row is '
  'already approved+current+fresh.';
