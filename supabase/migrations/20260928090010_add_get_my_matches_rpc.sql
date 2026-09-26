-- Match delivery (Phase 07), part 2: a matches+jobs read RPC.
--
-- Real gap traced during Phase 07 (AGENTS.md §17 "identify affected...
-- permissions" before implementing): "jobs_select_active" (20260809090030)
-- grants authenticated users SELECT on public.jobs only where
-- status = 'active', with no exception. A job a user already has a match
-- on can later transition to closed/expired/unavailable/source_error via
-- the Phase 03/04 ingestion pipeline's stale-close logic — at that point a
-- plain client-side `jobs` query for that job id would silently return
-- nothing, even though the user's own match on it is completely legitimate
-- and should remain visible (their Approved/Rejected history must not go
-- blank just because the listing later disappeared upstream).
--
-- get_my_matches() is SECURITY DEFINER specifically to read across that
-- RLS boundary safely: ownership is re-derived from auth.uid() inside the
-- function (never a client-supplied filter), so a user can only ever see
-- their own matches' job details, active or not — this does not widen
-- what any user can see beyond jobs they already legitimately matched on.
create or replace function public.get_my_matches(p_status text)
returns table (
  match_id uuid,
  score integer,
  score_breakdown jsonb,
  explanation text,
  missing_skills jsonb,
  match_status text,
  matching_model text,
  decided_at timestamptz,
  created_at timestamptz,
  job_id uuid,
  job_title text,
  job_company_name text,
  job_location text,
  job_work_arrangement text,
  job_employment_type text,
  job_seniority text,
  job_application_method text,
  job_application_url text,
  job_application_email text,
  job_source_type text,
  job_source_url text,
  job_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Defense in depth: re-validate against the same allowlist matches.status
  -- itself enforces, rather than trusting the caller's string unexamined.
  if p_status not in ('pending_review', 'user_approved', 'user_rejected') then
    raise exception 'Invalid status filter.';
  end if;

  return query
    select
      m.id, m.score, m.score_breakdown, m.explanation, m.missing_skills, m.status, m.matching_model, m.decided_at, m.created_at,
      j.id, j.title, j.company_name, j.location, j.work_arrangement, j.employment_type, j.seniority,
      j.application_method, j.application_url, j.application_email, j.source_type, j.source_url, j.status
    from public.matches m
    join public.jobs j on j.id = m.job_id
    where m.user_id = v_user_id
      and m.status = p_status
      and m.surfaced_at is not null
    order by m.score desc, m.id;
end;
$$;

revoke execute on function public.get_my_matches(text) from public;
grant execute on function public.get_my_matches(text) to authenticated;

comment on function public.get_my_matches(text) is
  'Returns the caller''s own matches (filtered by status, surfaced ones only) joined with their jobs, bypassing jobs_select_active''s active-only restriction safely — ownership is re-derived from auth.uid(), never a client-supplied id. Use instead of a direct jobs query so a match''s job details remain visible even after the listing itself closes/expires upstream.';
