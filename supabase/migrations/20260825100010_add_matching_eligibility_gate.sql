-- Automation-1 audit fix (Phase 2 of the 8-item fix order): no canonical
-- "matching-eligible profile" function existed anywhere. The only DB-level
-- gate a future matches worker had was enforce_match_uses_approved_analysis,
-- which checked only review_status = 'approved' — the same gap Phase 1
-- closed for confirm_cv_analysis was still open for match creation: a
-- stale-but-approved analysis (recommendations_state='stale', or based on
-- an outdated preferences_version) could still back a new matches row.
--
-- This migration adds one canonical, reusable function —
-- is_cv_analysis_matching_eligible() — and wires it into the matches
-- insert/update trigger. Automation 2 must call this same function (or the
-- trigger it backs) rather than re-deriving the eligibility criteria
-- itself, so the criteria can never drift between the dashboard, the
-- approval RPC, and the matching worker again.

-- ── 1. Canonical eligibility function ────────────────────────────────────────
-- Returns true only when p_analysis_id is: completed, approved, is_current,
-- recommendations_state = 'current', based on the user's still-active CV,
-- and its preferences_version equals the user's live job_preferences.version.
-- SECURITY DEFINER so it can be called by authenticated users (e.g. the
-- dashboard) without granting them direct read access to cv_analyses rows
-- they don't own — but it still enforces ownership itself: when called by
-- an authenticated session (auth.uid() is not null), the analysis must
-- belong to that caller, or the function returns false rather than leaking
-- whether the id exists. When called internally (e.g. from a SECURITY
-- DEFINER trigger executing as service_role, where auth.uid() is null),
-- the ownership check is skipped — the trigger below separately verifies
-- new.user_id matches the analysis owner.
create or replace function public.is_cv_analysis_matching_eligible(p_analysis_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.cv_analyses;
  v_cv_active boolean;
  v_latest_version integer;
begin
  select * into v_row from public.cv_analyses where id = p_analysis_id;
  if not found then
    return false;
  end if;

  if auth.uid() is not null and auth.uid() <> v_row.user_id then
    return false;
  end if;

  if v_row.status <> 'completed' then
    return false;
  end if;
  if v_row.review_status <> 'approved' then
    return false;
  end if;
  if v_row.is_current is distinct from true then
    return false;
  end if;
  if v_row.recommendations_state <> 'current' then
    return false;
  end if;

  select is_active into v_cv_active from public.cvs where id = v_row.cv_id;
  if v_cv_active is distinct from true then
    return false;
  end if;

  select version into v_latest_version from public.job_preferences where user_id = v_row.user_id;
  if v_row.preferences_version is null
     or v_latest_version is null
     or v_row.preferences_version <> v_latest_version then
    return false;
  end if;

  return true;
end;
$$;

revoke execute on function public.is_cv_analysis_matching_eligible(uuid) from public;
grant execute on function public.is_cv_analysis_matching_eligible(uuid) to authenticated, service_role;

comment on function public.is_cv_analysis_matching_eligible(uuid) is
  'Canonical matching-eligibility gate (business rule 14): true only when the '
  'analysis is completed, approved, is_current, recommendations_state=current, '
  'based on the still-active CV, and its preferences_version equals the live '
  'job_preferences.version. Automation 2 and the dashboard must both call this '
  'function (or rely on the matches-insert trigger that uses it) instead of '
  're-deriving the criteria, so they cannot drift apart again.';

-- ── 2. Strengthen the matches trigger to use the canonical gate ─────────────
create or replace function public.enforce_match_uses_approved_analysis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_analysis_user_id uuid;
begin
  select user_id into v_analysis_user_id
  from public.cv_analyses
  where id = new.cv_analysis_id;

  if v_analysis_user_id is null or v_analysis_user_id <> new.user_id then
    raise exception 'matches.user_id must match the owner of matches.cv_analysis_id.';
  end if;

  if not public.is_cv_analysis_matching_eligible(new.cv_analysis_id) then
    raise exception 'matches.cv_analysis_id must reference a completed, approved, current analysis based on the active CV and the latest preferences version.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_match_uses_approved_analysis is
  'Defense in depth (AGENTS.md §20): a match can only ever point at an '
  'analysis that is completed, approved, current, based on the active CV, '
  'and based on the latest preferences version — via '
  'is_cv_analysis_matching_eligible(), never a locally re-derived condition. '
  'Also verifies matches.user_id actually owns matches.cv_analysis_id.';
