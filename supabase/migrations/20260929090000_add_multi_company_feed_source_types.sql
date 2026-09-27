-- Phase 13: widen jobs.source_type to allow multi-company feed providers
-- (RemoteOK, Jobicy, Arbeitnow — implemented and live this phase) and the
-- MENA/Gulf aggregators researched in Phase 12 (JSearch, Adzuna, Bayt,
-- GulfTalent — adapter contracts exist, enabled:false in
-- src/lib/ingestion/providerConfig.ts, BLOCKED_ON_CREDENTIAL/AUTHORIZATION;
-- see docs/PROVIDER_EXPANSION_IMPLEMENTATION.md). Purely additive: widens
-- an existing check constraint, no column added, no row touched, no
-- existing value removed.
--
-- These rows always carry source_id = null (no single company_sources row
-- for a many-companies-per-call feed — see
-- src/lib/ingestion/ingestSourceBatch.ts's runMultiCompanyIngestionBatch),
-- so jobs.dedup_scope (20260915170000) already falls back to
-- 'type:'||source_type for them with zero further schema change needed —
-- exactly the same fallback admin_manual/career_page/linkedin already use.
alter table public.jobs drop constraint jobs_source_type_check;
alter table public.jobs add constraint jobs_source_type_check check (source_type in (
  'admin_manual', 'career_page', 'greenhouse', 'lever', 'workable', 'ashby', 'linkedin',
  'remoteok', 'jobicy', 'arbeitnow', 'jsearch', 'adzuna', 'bayt', 'gulftalent'
));

comment on column public.jobs.source_type is
  'ATS/provider category. Company-specific (greenhouse/lever/workable/ashby/career_page/admin_manual/linkedin) always carries a source_id pointing at the specific company_sources row. Multi-company feeds (remoteok/jobicy/arbeitnow/jsearch/adzuna/bayt/gulftalent, Phase 13) never do — source_id is always null for these, and each job carries its own company_name from the provider''s own response instead of a company_sources lookup. See jobs.dedup_scope for how both cases dedupe correctly.';
