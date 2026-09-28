-- Phase 21: widen jobs.source_type to allow the new Indeed multi-company
-- feed adapter (via Apify curious_coder/indeed-scraper), live-verified
-- this phase against real UAE job data. Purely additive: widens an
-- existing check constraint, no column added, no row touched, no
-- existing value removed — same pattern as
-- 20260930090000_add_oracle_hcm_and_workday_source_types.sql.
--
-- Multi-company feed (Tier C), same shape as bayt/gulftalent/remoteok/
-- jobicy/arbeitnow: source_id is always null, dedup_scope is
-- 'type:indeed' — no dedup_scope schema change needed.
alter table public.jobs drop constraint jobs_source_type_check;
alter table public.jobs add constraint jobs_source_type_check check (source_type in (
  'admin_manual', 'career_page', 'greenhouse', 'lever', 'workable', 'ashby', 'oracle_hcm', 'workday', 'linkedin',
  'remoteok', 'jobicy', 'arbeitnow', 'jsearch', 'adzuna', 'bayt', 'gulftalent', 'indeed'
));

comment on column public.jobs.source_type is
  'ATS/provider category. Company-specific (greenhouse/lever/workable/ashby/oracle_hcm/workday/career_page/admin_manual/linkedin) always carries a source_id pointing at the specific company_sources row. Multi-company feeds (remoteok/jobicy/arbeitnow/jsearch/adzuna/bayt/gulftalent/indeed, Phase 13/21) never do — source_id is always null for these, and each job carries its own company_name from the provider''s own response instead of a company_sources lookup. See jobs.dedup_scope for how both cases dedupe correctly.';
