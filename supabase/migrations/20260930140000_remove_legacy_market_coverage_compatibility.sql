-- Legacy market-coverage cleanup — final, destructive phase.
--
-- Unblocked from the previous task's stop condition
-- (20260930130000_normalize_legacy_market_coverage_values.sql,
-- docs/LEBANON_GULF_PLAN_CONSISTENCY_AUDIT.md §9): this project has no
-- production database and no real production users — the only reason
-- that migration kept read compatibility (an unverified historical
-- onboarding UI picker that could have written any of the four raw
-- values to a real production row) does not apply. Confirmed this
-- session: local/dev job_preferences has zero rows holding any retired
-- value.
--
-- The active product model has exactly two valid job_market_coverage
-- states going forward: null, or 'remote_worldwide' — the sole canonical
-- Pro remote-market tier (Lebanon + Gulf + worldwide remote; see
-- docs/PRODUCT_MATCHING_RULES.md "Market coverage"). 'remote_mena',
-- 'lebanon_only', and 'remote_lebanon_applicants' are removed from the
-- CHECK constraint entirely — not merely blocked from new writes
-- (20260930120000/20260930130000 already did that) — making them
-- structurally impossible column values, not just unused ones.
--
-- Order of operations (each step depends on the previous succeeding):
--   1. Defensively normalize any row this database still holds for a
--      retired value (belt-and-suspenders — 20260930130000 already did
--      this, and this session confirmed zero such rows remain, but a
--      migration that tightens a CHECK constraint should never assume a
--      prior migration's effect rather than re-proving it).
--   2. Verify zero rows remain — hard-fails the migration otherwise,
--      before the constraint is ever tightened.
--   3. Replace job_preferences_job_market_coverage_check to allow only
--      null or 'remote_worldwide'.
--   4. Simplify enforce_job_preferences_eligibility: remove the explicit
--      "reject remote_mena/lebanon_only/remote_lebanon_applicants" branch
--      (20260930130000) — it's now fully redundant, since the CHECK
--      constraint itself rejects any of those values as a matter of
--      column type, not application logic. The remaining checks (plan/
--      country/work_arrangement validation for a non-null coverage,
--      international_search_enabled Pro-gating) stay: a CHECK constraint
--      cannot reference other tables (subscriptions.plan_code,
--      profiles.country_of_residence), so those remain the trigger's job.

-- ── 1. Defensive normalization (idempotent no-op if already clean) ───────

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

-- ── 2. Verify: hard-fail before the constraint is tightened ──────────────

do $$
declare
  v_remaining integer;
begin
  select count(*) into v_remaining
  from public.job_preferences
  where job_market_coverage in ('remote_mena', 'lebanon_only', 'remote_lebanon_applicants');

  if v_remaining > 0 then
    raise exception 'job_market_coverage cleanup aborted: % row(s) still hold a retired value after normalization — refusing to tighten the CHECK constraint', v_remaining;
  end if;
end;
$$;

-- ── 3. Tighten the CHECK constraint: only null or remote_worldwide ───────

alter table public.job_preferences
  drop constraint job_preferences_job_market_coverage_check;

alter table public.job_preferences
  add constraint job_preferences_job_market_coverage_check
  check (job_market_coverage in ('remote_worldwide'));

comment on column public.job_preferences.job_market_coverage is
  'The sole active market-coverage tier: null (no international remote coverage — the Free/Student/not-yet-opted-in state) or ''remote_worldwide'' (Pro, opted in — Lebanon + Gulf + worldwide remote; see docs/PRODUCT_MATCHING_RULES.md "Market coverage"). Server-derived only, by save_job_preferences — never a client-supplied or user-selected value. ''remote_mena''/''lebanon_only''/''remote_lebanon_applicants'' were development-era states, fully retired: removed from this CHECK constraint (20260930140000) after confirming zero rows held them in this project''s only database (no production database or users exist).';

-- ── 4. Simplify the trigger: drop the now-redundant retired-value check ──

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

  -- job_market_coverage: the CHECK constraint (job_preferences_job_market_
  -- coverage_check, tightened in this same migration) already guarantees
  -- this is null or 'remote_worldwide' — no application-level "reject a
  -- retired value" branch is needed here anymore. What a CHECK constraint
  -- cannot express — cross-table plan/country validation — stays here.
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
