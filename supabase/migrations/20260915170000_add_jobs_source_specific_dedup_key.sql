-- P0 fix, found during the job-ingestion pilot's post-implementation review:
-- jobs_source_external_id_key (20260809090030, widened by 20260914140000) is
-- UNIQUE (source_type, external_id). source_type is an ATS/provider CATEGORY
-- ('greenhouse' | 'lever' | 'workable' | 'admin_manual' | 'career_page' |
-- 'linkedin') — NOT company- or source-specific. Two different companies on
-- the same ATS (e.g. two different Greenhouse-hosted employers) are only
-- ever kept apart by this key if their external_id values happen never to
-- collide; nothing in the schema guarantees that.
--
-- Reproduced directly against the real local database
-- (tests/db/jobs-ingestion-identity.test.mjs, "P0 CONFIRMED" test): an
-- upsert shaped exactly like the pilot workflow's own Upsert Jobs node
-- (on_conflict=source_type,external_id + Prefer: resolution=merge-duplicates)
-- silently splices a second company's data into an unrelated company's
-- existing job row — same id, now pointing at the wrong source_id and
-- company_name — with no error at all. Confirmed P0 identity bug.
--
-- jobs.source_id (20260914150000) already points at the specific
-- company_sources row a job was ingested from and was already documented
-- there as "distinct from jobs.source_type/external_id (the per-source
-- dedup key, unrelated to company identity)" — the schema already
-- recognized source_id as a finer-grained identity dimension the dedup key
-- never incorporated. This migration closes that gap.
--
-- Design constraint: PostgREST's on_conflict=... (and Supabase-js
-- .upsert({ onConflict })) can only target a FULL (non-partial) unique
-- index — a partial index cannot be used as an ON CONFLICT inference target
-- unless the query's own ON CONFLICT clause carries an identical predicate,
-- which PostgREST never emits (this is exactly what 20260914140000 already
-- discovered and fixed for the original index). So this cannot be "add a
-- partial unique index scoped to source_id IS NOT NULL" — that would be
-- unusable by the very upsert it needs to protect.
--
-- Instead: a single generated, stored column collapses BOTH identity cases
-- into one full index, using distinct literal prefixes so a company_sources
-- id (e.g. 'sr-sa-alpaca') can never collide with a source_type enum value:
--   - source_id IS NOT NULL (every registry-provenance ingestion, including
--     every write this pilot performs): scope = 'src:' || source_id — keyed
--     to the SPECIFIC company_sources row, so two different sources sharing
--     an ATS and an external_id can never collide.
--   - source_id IS NULL (admin_manual / career_page / linkedin rows with no
--     company_sources row to point at — unchanged from today): scope =
--     'type:' || source_type — identical behavior to the current index,
--     preserving tests/db/jobs-and-admin.test.mjs's
--     "duplicate (source_type, external_id) is rejected" and
--     "manually entered jobs (no external_id) never collide" unmodified.
-- external_id IS NULL rows are unaffected either way: standard SQL unique-
-- index semantics never treat two NULLs as equal, exactly as already relied
-- on by 20260914140000 for source_type/external_id.
--
-- Purely additive: no row is deleted, updated, or reassigned a new id. Every
-- existing job (including this pilot's 20 real rows) keeps its own id,
-- source_id, external_id, and full history untouched — only the column list
-- backing its dedup identity changes, and jobs_dedup_scope_external_id_key
-- is proven non-colliding against every existing row before being created
-- (below), not assumed.
do $$
begin
  if exists (
    select 1
    from public.jobs
    group by (case when source_id is not null then 'src:' || source_id else 'type:' || source_type end), external_id
    having count(*) > 1 and external_id is not null
  ) then
    raise exception 'jobs_dedup_scope_external_id_key: existing rows would collide under the new (source_id, external_id) identity — investigate before migrating.';
  end if;
end $$;

alter table public.jobs
  add column dedup_scope text generated always as (
    case when source_id is not null then 'src:' || source_id else 'type:' || source_type end
  ) stored;

comment on column public.jobs.dedup_scope is
  'Generated dedup-identity scope: ''src:''||source_id when a specific company_sources row is known (the correct, source-specific identity for any registry-provenance ingestion), else ''type:''||source_type (unchanged legacy behavior for admin_manual/career_page/linkedin rows with no source_id). Never set directly. See jobs_dedup_scope_external_id_key.';

drop index public.jobs_source_external_id_key;

create unique index jobs_dedup_scope_external_id_key
  on public.jobs (dedup_scope, external_id);

comment on index public.jobs_dedup_scope_external_id_key is
  'Source-specific idempotent-upsert identity + ON CONFLICT target: INSERT ... ON CONFLICT (dedup_scope, external_id) DO UPDATE .... Replaces jobs_source_external_id_key (source_type, external_id), which could not tell apart two different company_sources sharing an ATS and an external_id — see this migration''s header for the confirmed collision this fixes. Full (non-partial) index: required for PostgREST on_conflict= compatibility, and already relies on standard SQL NULL semantics (two NULL external_id or dedup_scope-irrelevant rows are never treated as equal) exactly as jobs_source_external_id_key did.';
