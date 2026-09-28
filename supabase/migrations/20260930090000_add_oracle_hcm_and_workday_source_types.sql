-- Phase 16: widen jobs.source_type to allow two new company-specific Tier-A
-- ATS adapters researched and live-verified in Phase 15
-- (docs/LEBANON_GULF_SOURCE_RESEARCH.md §3): Oracle Cloud Recruiting
-- (confirmed live this phase via a real, unauthenticated 200 JSON response
-- against a real registry tenant, AUBMC) and Workday (confirmed real API
-- pattern, pending one live POST verification before going live). Purely
-- additive: widens an existing check constraint, no column added, no row
-- touched, no existing value removed — same pattern as
-- 20260929090000_add_multi_company_feed_source_types.sql.
--
-- Both are company-specific (Tier A), same shape as
-- greenhouse/lever/workable/ashby: source_id always points at the specific
-- company_sources row, dedup_scope stays 'src:'||source_id — no dedup_scope
-- schema change needed.
alter table public.jobs drop constraint jobs_source_type_check;
alter table public.jobs add constraint jobs_source_type_check check (source_type in (
  'admin_manual', 'career_page', 'greenhouse', 'lever', 'workable', 'ashby', 'oracle_hcm', 'workday', 'linkedin',
  'remoteok', 'jobicy', 'arbeitnow', 'jsearch', 'adzuna', 'bayt', 'gulftalent'
));

comment on column public.jobs.source_type is
  'ATS/provider category. Company-specific (greenhouse/lever/workable/ashby/oracle_hcm/workday/career_page/admin_manual/linkedin) always carries a source_id pointing at the specific company_sources row. Multi-company feeds (remoteok/jobicy/arbeitnow/jsearch/adzuna/bayt/gulftalent, Phase 13) never do — source_id is always null for these, and each job carries its own company_name from the provider''s own response instead of a company_sources lookup. See jobs.dedup_scope for how both cases dedupe correctly.';
