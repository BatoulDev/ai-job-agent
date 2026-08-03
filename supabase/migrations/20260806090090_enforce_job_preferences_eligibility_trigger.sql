-- Authoritative, database-level enforcement of the country/plan geo rules
-- (AGENTS.md "Plan eligibility and job-market coverage" / "Authorization
-- and plan enforcement"): a manipulated client request cannot save an
-- unsupported work arrangement or Pro-only coverage, no matter which
-- write path is used (the save_job_preferences RPC in 20260806090100, or
-- any direct client upsert still permitted by job_preferences' existing
-- RLS policies).
--
-- security invoker, matching this repo's stated preference: it only reads
-- profiles/subscriptions rows the calling user is already allowed to read
-- under their own "select own" RLS policies (new.user_id is always
-- auth.uid() here, since job_preferences RLS already restricts insert/
-- update to a user's own row) — no elevated privilege needed. When called
-- via a service_role connection, service_role bypasses RLS entirely at
-- the role level regardless of the function's security mode, so this
-- still works for any future trusted server-side write path.
create or replace function public.enforce_job_preferences_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_country text;
  v_plan_code text;
begin
  select country_of_residence into v_country
  from public.profiles
  where id = new.user_id;

  select plan_code into v_plan_code
  from public.subscriptions
  where user_id = new.user_id;

  -- Known non-Lebanon residence: only Remote is currently supported, and
  -- job-market coverage (a Lebanon-Pro-only concept) never applies.
  if v_country is not null and v_country <> 'LB' then
    if new.work_arrangement is not null and new.work_arrangement <> 'remote' then
      raise exception 'Unsupported work arrangement for users residing outside Lebanon: only Remote is currently supported.';
    end if;

    if new.job_market_coverage is not null then
      raise exception 'Job-market coverage options are only available to Lebanon-based users.';
    end if;
  end if;

  -- A Student user (or anyone not on Pro) must never receive Pro-only
  -- geographic coverage, and coverage never applies outside Lebanon or
  -- outside remote/flexible arrangements, regardless of residence.
  if new.job_market_coverage is not null then
    if v_plan_code is distinct from 'pro' then
      raise exception 'Job-market coverage requires the Pro plan.';
    end if;

    if v_country is distinct from 'LB' then
      raise exception 'Job-market coverage is only available to users residing in Lebanon.';
    end if;

    if new.work_arrangement not in ('remote', 'flexible') then
      raise exception 'Job-market coverage only applies to Remote or Flexible work arrangements.';
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_job_preferences_eligibility_trigger
  before insert or update on public.job_preferences
  for each row
  execute function public.enforce_job_preferences_eligibility();
