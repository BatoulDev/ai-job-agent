-- Fixes the broken "state-driven" source selection used by the Source
-- Intelligence Analyzer n8n workflow's Load Candidate Sources node.
--
-- Root cause (confirmed by direct, read-only reproduction against this
-- project's own local database, not just code inspection): the workflow
-- selected candidates via a PostgREST embedded-resource anti-join —
--   select=...,source_intelligence!left(source_id)
--   &source_intelligence.source_id=is.null
-- PostgREST's embedded-filter semantics for a !left embed only prune the
-- NESTED embedded array in the JSON response; they do not exclude the
-- parent company_sources row from the top-level result set. Verified live:
-- a source with two existing source_intelligence rows was still returned,
-- with its embedded source_intelligence field showing [] instead of being
-- excluded. Every run therefore reselected the exact same top-N
-- company_sources rows (ordered by id, LIMIT maxSourcesPerRun) regardless
-- of how many source_intelligence rows already existed for them, producing
-- duplicate source_intelligence rows for the same source_id across
-- separate executions.
--
-- Fix: replace the embedded-filter pattern with a real SQL NOT EXISTS,
-- executed as an actual Postgres query inside this function rather than
-- translated through PostgREST's REST-level filter semantics. The n8n
-- workflow's Load Candidate Sources node now calls this via
-- POST /rest/v1/rpc/get_source_intelligence_candidates instead of a raw
-- GET against company_sources with an embedded filter.
--
-- Read-only (STABLE, no writes). Mirrors the existing repo convention for
-- worker-facing selection functions (claim_automation_task, 20260914110000):
-- SECURITY DEFINER, search_path pinned empty, revoked from public, granted
-- to service_role only. SECURITY DEFINER is not strictly required for
-- privilege reasons here — service_role already has direct SELECT on
-- company_sources (20260914150000) and bypasses RLS regardless — it's kept
-- only for consistency with every other worker-facing RPC in this schema.
create or replace function public.get_source_intelligence_candidates(
  p_limit integer default 10
)
returns setof public.company_sources
language sql
stable
security definer
set search_path = ''
as $$
  select cs.*
  from public.company_sources cs
  where (cs.ats_provider = 'unknown' or cs.automation_eligibility = 'unknown')
    and not exists (
      select 1
      from public.source_intelligence si
      where si.source_id = cs.id
    )
  order by cs.id asc
  limit p_limit;
$$;

revoke execute on function public.get_source_intelligence_candidates(integer) from public;
grant  execute on function public.get_source_intelligence_candidates(integer) to service_role;

comment on function public.get_source_intelligence_candidates(integer) is
  'Returns up to p_limit company_sources rows with (ats_provider=''unknown'' OR automation_eligibility=''unknown'') AND no existing source_intelligence row for that source_id, ordered by id ascending. Real SQL NOT EXISTS — replaces a PostgREST embedded-filter anti-join pattern (source_intelligence!left(source_id)&source_intelligence.source_id=is.null) confirmed NOT to exclude already-analyzed sources, since embedded-resource filters only prune the nested embed and never the parent row. service_role only.';
