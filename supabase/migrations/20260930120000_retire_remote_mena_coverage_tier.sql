-- Pro market-coverage model simplification.
--
-- Product decision: Pro's effective market entitlement is one coherent
-- tier — Lebanon + Gulf + worldwide international remote — never a
-- user-facing choice between competing sub-tiers ("MENA" vs "worldwide").
-- The previous job_market_coverage wiring fix
-- (20260930110000_derive_job_market_coverage_server_side.sql) already
-- ensured save_job_preferences only ever derives 'remote_worldwide' or
-- null — it never derives 'remote_mena'. That closed the only
-- product-facing path. This migration closes the remaining one: a
-- crafted direct write (bypassing the RPC, including a service-role
-- write) could still set job_market_coverage = 'remote_mena' on a
-- Lebanon-resident Pro user with a remote/flexible work arrangement,
-- since the eligibility trigger only validated plan/country/arrangement,
-- not which specific tier value was used.
--
-- 'remote_worldwide' is not merely "wider than" remote_mena — it is a
-- strict superset. checkJobEligibility.ts's evaluateRemoteEligibility()
-- grants remote_worldwide to any job with a determinable remote scope,
-- which includes every case remote_mena would grant (GCC-scoped or
-- MENA-country remote) plus everything else. So there is no real Pro
-- entitlement remote_mena expresses that remote_worldwide doesn't already
-- cover — the two-tier distinction is unsupported complexity, not a real
-- product differentiation.
--
-- Non-destructive by design, per explicit instruction not to remove
-- 'remote_mena' from the database just because it is no longer an active
-- derivation path:
--   - The job_preferences_job_market_coverage_check CHECK constraint is
--     UNCHANGED — 'remote_mena' remains a legal column value, so any
--     pre-existing row that already holds it stays valid and readable.
--   - Only NEW writes attempting to SET job_market_coverage = 'remote_mena'
--     are rejected, via the eligibility trigger (fires for every write
--     path, including service-role — triggers are not RLS policies and
--     are not bypassed by role).
--   - checkJobEligibility.ts's remote_mena branches are UNCHANGED — a
--     legacy row that already holds this value continues to be evaluated
--     under its original, narrower (GCC/MENA-only) semantics, so no
--     existing user's access is silently widened or narrowed by this
--     migration. See tests/db/matching-rerank.test.mjs's legacy-row test
--     for the real, DB-level proof.
--   - A legacy remote_mena row self-corrects the next time its owner
--     saves preferences through the real product path (save_job_preferences
--     always derives remote_worldwide or null, never remote_mena) — the
--     same self-correction pattern the previous migration established for
--     a Pro-to-Free downgrade.

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

  -- Known non-Lebanon residence (legacy data only — no current UI can
  -- produce this for a new user): only Remote is supported, and neither
  -- of the two Lebanon/Pro-only geographic-scope concepts ever applies.
  if v_country is not null and v_country <> 'LB' then
    if new.work_arrangement is not null and new.work_arrangement <> 'remote' then
      raise exception 'Unsupported work arrangement for users residing outside Lebanon: only Remote is currently supported.';
    end if;

    if new.job_market_coverage is not null then
      raise exception 'Job-market coverage options are only available to Lebanon-based users.';
    end if;

    if new.international_search_enabled is true then
      raise exception 'International search is only available to Lebanon-based users.';
    end if;
  end if;

  -- Retired legacy tier: see this migration's header comment. Rejected
  -- for every write path (RPC, direct authenticated write, service-role)
  -- so no new competing remote_mena/remote_worldwide derivation path can
  -- ever be recreated. Pre-existing rows already holding this value are
  -- untouched — this only blocks it as a value for a NEW write.
  if new.job_market_coverage = 'remote_mena' then
    raise exception 'remote_mena is a retired legacy value and can no longer be set. Use remote_worldwide (or null) instead.';
  end if;

  -- Legacy coverage field: unchanged from 20260806090090.
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

  -- New structured international-preferences model: Pro-only, no matter
  -- which write path is used (this RPC or a direct authenticated update).
  if new.international_search_enabled is true and v_plan_code is distinct from 'pro' then
    raise exception 'International search requires the Pro plan.';
  end if;

  return new;
end;
$$;

comment on column public.job_preferences.job_market_coverage is
  'Only meaningful for a Lebanon-resident Pro user with work_arrangement in (remote, flexible) — see enforce_job_preferences_eligibility_trigger. Null otherwise. save_job_preferences only ever derives ''remote_worldwide'' or null (20260930110000) — ''lebanon_only''/''remote_lebanon_applicants''/''remote_mena'' are legacy values with no active derivation path; ''remote_mena'' specifically can no longer be written at all (20260930120000), preserved only for any pre-existing row.';
