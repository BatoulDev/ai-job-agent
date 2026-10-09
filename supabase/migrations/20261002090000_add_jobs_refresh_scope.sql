-- P0 fix: a real paid-pilot run proved that for a multi-company provider
-- queried through multiple independently-complete market partitions (e.g.
-- GulfTalent Saudi Arabia, then a separate GulfTalent AE/Dubai call), the
-- second call's stale-close sweep wrongly treated the first call's jobs as
-- gone, because both calls shared one stale-close universe keyed only by
-- source_type (source_id is null for every multi-company feed row — see
-- 20260915170000's dedup_scope). dedup_scope/source_type answers "is this
-- the same job/provider" (identity) — it was also being reused to answer
-- "did this run see the complete universe this job belongs to" (refresh
-- scope), and those are different questions once one provider is split
-- across multiple market-specific queries.
--
-- This column is the refresh-scope half, kept fully separate from identity:
-- dedup_scope/jobs_dedup_scope_external_id_key (upsert ON CONFLICT target)
-- is completely unchanged by this migration, so idempotent-upsert behavior
-- for every provider is untouched. refresh_scope is consulted only by
-- ingestSourceBatch.ts's existing-rows and active-rows-for-stale-close
-- queries, as an ADDITIONAL filter alongside source_type/source_id.
--
-- Null = this provider currently has exactly one undivided refresh
-- partition per source_type (unchanged legacy behavior for
-- RemoteOK/Jobicy/Arbeitnow/Bayt/Indeed, and for every company-specific
-- source_id-scoped row, which never needs this column at all). Only
-- GulfTalent's two seeds set it today, to e.g. 'country:SA' or
-- 'country:AE:location:Dubai' — deterministic strings built from each
-- seed's own already-present country/location request fields, not from
-- job content, an execution id, or a timestamp.
--
-- Purely additive: no existing row is deleted, updated, or reassigned an
-- id; every one of the 139 real local pilot rows keeps every field
-- untouched and starts with refresh_scope = null.
alter table public.jobs
  add column refresh_scope text;

comment on column public.jobs.refresh_scope is
  'Optional explicit refresh/stale-close partition, orthogonal to dedup_scope (identity, unchanged by this column). Null = this source_type currently has one undivided refresh partition (unchanged legacy stale-close behavior). Set by ingestSourceBatch.ts only for a multi-company feed whose source_type spans multiple independently-complete ingestion query partitions (e.g. GulfTalent SA vs AE/Dubai), so one partition''s complete refresh can never stale-close jobs belonging to a different partition that happens to share the same source_type. Never used for dedup/ON CONFLICT — see jobs_dedup_scope_external_id_key for that, which this column does not participate in.';
