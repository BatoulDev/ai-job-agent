-- Founder decision (2026-09-30): raise the Student and Pro job-match
-- allowances. Forward-only value update — the original seed migration
-- (20260802090000_create_plans.sql) is never edited, per AGENTS.md §15/§34
-- ("do not edit an already-applied migration").
--
-- public.plans.job_match_limit is, and remains, the single authoritative
-- source for this number (AGENTS.md §6/§20 "use database constraints...
-- never trust a client-supplied plan or limit"). Every consumer —
-- surface_new_matches_for_user() (20260928090000_add_match_surfacing_and_
-- quota.sql), get_public_plan_catalog() (20260914100000_add_public_plan_
-- catalog_and_price_publishing.sql), and src/lib/plans/getPublicPlanCatalog.ts
-- — already reads this column dynamically; none of them are touched by this
-- migration, and none needed to be, because the value was never duplicated
-- into matching logic. Updating this one row is the entire change required
-- to raise the limit for every user going forward.
--
-- Student: 25 -> 45. Pro: 45 -> 95. Free is unchanged (not part of this
-- founder decision).
update public.plans
set job_match_limit = 45
where plan_code = 'student';

update public.plans
set job_match_limit = 95
where plan_code = 'pro';
