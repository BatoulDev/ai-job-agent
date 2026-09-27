-- Match delivery + quota (Phase 07). Purely additive: one nullable column,
-- one new SECURITY DEFINER function. No existing table/policy/trigger is
-- changed.
--
-- Product rule (AGENTS.md §6/§7, docs/OVERNIGHT_BUILD_PROGRESS.md Phase 06):
-- "Curated match quota applies only to matches actually surfaced/delivered.
-- Do not consume quota for internal candidates, rescoring, duplicates, or
-- platform failures." Phase 06's LLM rerank already creates a `matches` row
-- the moment a candidate is scored — that is NOT the same moment as
-- "delivered to the user," so quota cannot be counted from `matches.created_at`
-- or from row count alone. `surfaced_at` marks the one event that actually
-- counts: the first time a specific match was actually shown to its user.
--
-- Quota window: scoped to the user's CURRENT approved cv_analysis_id, not a
-- calendar month. A fresh CV re-analysis produces a fresh batch of curated
-- matches, which is a defensible, simple interpretation — free-plan users
-- have no billing period at all in this schema (subscriptions.current_period_start
-- stays null for the free plan, see handle_new_user_subscription), so a
-- calendar-month reset cannot be expressed for them without a separate
-- scheduled job this migration does not build. Documented limitation, not
-- an oversight: a true monthly reset for free-tier users is a natural
-- follow-up once a scheduled-job mechanism exists for this project.

alter table public.matches
  add column surfaced_at timestamptz;

comment on column public.matches.surfaced_at is
  'When this match was first actually shown to its user. Null until then. The ONLY thing curated-match quota counts against (AGENTS.md §6/§7) — a scored-but-not-yet-shown match never consumes quota. Set only by surface_new_matches_for_user(), never client-writable.';

create index matches_surfaced_at_idx on public.matches (user_id, cv_analysis_id, surfaced_at);

-- Idempotent, quota-aware surfacing: on every call, returns every match this
-- user has already seen for their current analysis, and additionally
-- surfaces (marks surfaced_at, then includes) as many new pending_review
-- matches as their plan's job_match_limit still allows for this analysis.
-- Never surfaces more than the limit; re-calling never re-surfaces or
-- exceeds it. SECURITY DEFINER so it can read/update matches rows without
-- granting authenticated a direct UPDATE policy on the table (matches has
-- none by design — see 20260809090040_create_matches.sql).
create or replace function public.surface_new_matches_for_user()
returns setof public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_analysis_id uuid;
  v_limit integer;
  v_already_surfaced integer;
  v_remaining integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select id into v_analysis_id
  from public.cv_analyses
  where user_id = v_user_id
    and review_status = 'approved'
    and is_current = true
    and recommendations_state = 'current'
  limit 1;

  if v_analysis_id is null then
    return; -- no currently matching-eligible profile: nothing to surface
  end if;

  select p.job_match_limit into v_limit
  from public.subscriptions s
  join public.plans p on p.plan_code = s.plan_code
  where s.user_id = v_user_id;

  select count(*) into v_already_surfaced
  from public.matches
  where user_id = v_user_id
    and cv_analysis_id = v_analysis_id
    and surfaced_at is not null;

  v_remaining := greatest(0, coalesce(v_limit, 0) - v_already_surfaced);

  if v_remaining > 0 then
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
      limit v_remaining
    );
  end if;

  return query
    select *
    from public.matches
    where user_id = v_user_id
      and cv_analysis_id = v_analysis_id
      and surfaced_at is not null
    order by score desc, id;
end;
$$;

revoke execute on function public.surface_new_matches_for_user() from public;
grant execute on function public.surface_new_matches_for_user() to authenticated;

comment on function public.surface_new_matches_for_user() is
  'Idempotent, quota-aware match delivery. Surfaces up to job_match_limit pending_review matches (highest score first) for the caller''s current approved analysis, then returns every match ever surfaced for it. Never exceeds the plan limit across repeated calls.';
