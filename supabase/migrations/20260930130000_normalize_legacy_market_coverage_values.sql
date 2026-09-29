-- Legacy market-coverage cleanup — safe portion only.
--
-- STOP CONDITION HIT, cleanup deliberately incomplete. See
-- docs/LEBANON_GULF_PLAN_CONSISTENCY_AUDIT.md §9 and
-- docs/PRODUCT_MATCHING_RULES.md ("Market coverage") for the full report.
-- Summary: git history proves a real, once-live onboarding UI picker
-- (src/app/onboarding/preferences/page.tsx, commits b54b342..a28b586,
-- live on `main` 2026-08-03 to 2026-09-03) let a Lebanon-resident Pro
-- user with a remote/flexible work arrangement directly choose ANY of
-- the four raw job_market_coverage values — including 'lebanon_only' and
-- 'remote_lebanon_applicants', not just 'remote_mena'. That means any of
-- the three retired values below could be sitting in a real, currently-
-- unknown production row. This session's local/dev database (queried:
-- 1 row total, NULL) is not representative of production and must not
-- be treated as proof production is already clean.
--
-- Given that, this migration does the part that is safe regardless of
-- unknown production state, and stops there:
--   1. Extends enforce_job_preferences_eligibility to reject
--      'lebanon_only' and 'remote_lebanon_applicants' for any NEW write
--      too (previously only 'remote_mena' was blocked, 20260930120000).
--      Safe: these two values have no active derivation path either (see
--      checkJobEligibility.ts — both already behave identically to
--      null), so blocking new writes changes no supported product
--      behavior.
--   2. Normalizes any row THIS database currently holds for any of the
--      three retired values to its canonical target — correct and safe
--      regardless of whether that's 0 rows or many, since it's a plain,
--      idempotent, WHERE-scoped UPDATE. Ships now so that whenever this
--      migration is eventually applied to a database that does hold
--      legacy rows (including production, whenever it runs there), they
--      get normalized automatically.
--   3. Verifies zero rows remain holding a retired value immediately
--      after the update, hard-failing the migration if not.
--
-- Deliberately NOT done here (the unsafe/destructive part):
--   - The job_preferences_job_market_coverage_check CHECK constraint
--     still lists all four historical values as legal — NOT tightened.
--   - checkJobEligibility.ts's remote_mena/lebanon_only/
--     remote_lebanon_applicants branches are UNCHANGED — still present.
--   - The JobMarketCoverage TypeScript union still includes all four
--     values.
-- Destructive removal of the above should only proceed once an operator
-- with real production database access confirms — via the same
-- zero-remaining-legacy-rows query this migration runs below — that
-- production has actually been normalized. Until then, removing that
-- code would risk a real production row silently falling through to the
-- wrong branch (e.g. a lingering 'lebanon_only' row read by code that no
-- longer recognizes it) the moment new application code deploys ahead of
-- the migration that normalizes it.
--
-- Canonical mapping used (see docs/PRODUCT_MATCHING_RULES.md "Market
-- coverage" for the full reasoning):
--   'remote_mena'                -> 'remote_worldwide' (strict superset;
--                                    evaluateRemoteEligibility() already
--                                    grants remote_worldwide to every
--                                    case remote_mena would, plus more).
--   'lebanon_only'                -> null (checkJobEligibility.ts treats
--                                    it identically to null already — a
--                                    null coverage's own documented
--                                    conservative default IS the
--                                    'remote_lebanon_applicants'/
--                                    'lebanon_only' behavior).
--   'remote_lebanon_applicants'   -> null (same reasoning as above —
--                                    these two values were never
--                                    behaviorally distinct from null or
--                                    from each other in this codebase).

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

  -- Retired legacy tiers: see this file's header comment and
  -- 20260930120000 (which originally retired remote_mena alone).
  -- 'lebanon_only' and 'remote_lebanon_applicants' never had an active
  -- derivation path either (checkJobEligibility.ts treats both
  -- identically to a null coverage), so they are retired the same way:
  -- rejected for every NEW write path (RPC, direct authenticated write,
  -- service-role — this is a trigger, not an RLS policy, so it fires
  -- regardless of role), while any pre-existing row is left untouched by
  -- this check (only the value on a NEW write is rejected).
  if new.job_market_coverage in ('remote_mena', 'lebanon_only', 'remote_lebanon_applicants') then
    raise exception 'retired legacy job_market_coverage value "%" can no longer be set. Use remote_worldwide (or null) instead.', new.job_market_coverage;
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

-- ── Normalize any row this database currently holds ──────────────────────
--
-- Disable the version-bump, stale-recommendations, and (now-stricter)
-- eligibility triggers for this statement only: this is a data-
-- correctness backfill (these values should never have persisted past
-- whatever moment they were written), not a genuine user preference
-- change, so it must not bump job_preferences.version, must not mark an
-- otherwise-current CV analysis's recommendations stale, and must not be
-- blocked by the rejection rule this same migration just added above.

alter table public.job_preferences disable trigger enforce_job_preferences_eligibility_trigger;
alter table public.job_preferences disable trigger bump_job_preferences_version_trigger;
alter table public.job_preferences disable trigger mark_cv_analyses_stale_on_preferences_change_trigger;

update public.job_preferences
set job_market_coverage = case job_market_coverage
  when 'remote_mena' then 'remote_worldwide'
  when 'lebanon_only' then null
  when 'remote_lebanon_applicants' then null
end
where job_market_coverage in ('remote_mena', 'lebanon_only', 'remote_lebanon_applicants');

alter table public.job_preferences enable trigger enforce_job_preferences_eligibility_trigger;
alter table public.job_preferences enable trigger bump_job_preferences_version_trigger;
alter table public.job_preferences enable trigger mark_cv_analyses_stale_on_preferences_change_trigger;

-- ── Verify: hard-fail the migration if any retired value survived ────────

do $$
declare
  v_remaining integer;
begin
  select count(*) into v_remaining
  from public.job_preferences
  where job_market_coverage in ('remote_mena', 'lebanon_only', 'remote_lebanon_applicants');

  if v_remaining > 0 then
    raise exception 'job_market_coverage normalization failed: % row(s) still hold a retired value after the update', v_remaining;
  end if;
end;
$$;

comment on column public.job_preferences.job_market_coverage is
  'Only meaningful for a Lebanon-resident Pro user with work_arrangement in (remote, flexible) — see enforce_job_preferences_eligibility_trigger. Null otherwise. save_job_preferences only ever derives ''remote_worldwide'' or null (20260930110000). ''remote_mena'', ''lebanon_only'', and ''remote_lebanon_applicants'' are retired legacy values: none can be written anymore (20260930120000, 20260930130000) and this database has zero rows holding any of them (verified above) — but the CHECK constraint still permits them and checkJobEligibility.ts still interprets them, deliberately, because a real historical UI path (see 20260930130000''s header) could have written them to a database this migration has not yet reached (e.g. production, if applied later). Do not remove that compatibility until a zero-remaining-rows check like the one above has been run against every database this could apply to.';
