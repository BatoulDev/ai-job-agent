-- Source Intelligence → company_sources promotion path.
--
-- Closes the previously-identified architecture gap: Source Intelligence
-- classifies a source and writes an observation into source_intelligence,
-- but nothing ever consumed that observation to update company_sources —
-- every classified source stayed ats_provider/automation_eligibility=
-- 'unknown' forever, with source_intelligence rows accumulating as
-- orphaned evidence nobody acted on (confirmed live: 50 rows exist today,
-- zero have ever changed a single company_sources row).
--
-- APPROVED PRODUCT DECISION: auto-promote ONLY a deterministic,
-- high-confidence known-ATS classification. Everything else (medium/low
-- confidence, unknown provider, needs_investigation, html, custom_parser,
-- blocked/no-URL results) stays exactly as it is today — an unresolved,
-- reviewable observation, never guessed into an approved state.
--
-- Two separate technical facts, deliberately resolved independently (see
-- promote_source_intelligence_observation()'s own body comment below):
--   1. WHICH ATS a source uses (ats_provider) — resolvable the moment
--      Source Intelligence is confident, regardless of whether Job
--      Ingestion has a working adapter for it yet. detected_provider's
--      own CHECK constraint (this table's creation migration,
--      20260916171255) is already the full "recognized provider"
--      allowlist — greenhouse/lever/workable/oracle/sap/workday/taleo/
--      smartrecruiters/icims — nothing here duplicates that list.
--   2. WHETHER this project can currently automate ingestion from it
--      (automation_eligibility) — only true for providers that ALREADY
--      have a real, working Job Ingestion adapter TODAY: greenhouse,
--      lever, workable (confirmed 2026-09-24 by reading
--      job-ingestion-pilot-orchestrator.ts's actual ats_type routing
--      branches — NOT the same list as jobs.source_type's own CHECK
--      constraint, which also allows 'ashby' with no adapter built yet).
--      A detected-but-unadapted provider (oracle/sap/workday/taleo/
--      smartrecruiters/icims) still gets automation_eligibility set to
--      'manual_only' — genuinely more informative than leaving 'unknown'
--      forever (we now know what it is) without ever claiming automation
--      readiness the system does not actually have. 'manual_only' and
--      'suitable_public_ats' are both pre-existing values already used by
--      the original CSV registry import (confirmed live: 62 and 78 rows
--      respectively) — no new enum value is invented by this migration.
--
-- review_status is NEVER touched by this function. company_sources' own
-- creation migration (20260914150000) and every reference to
-- review_status since treats it as the human-researcher TRUST signal
-- ("only verified means the registry's own process considers this source
-- confirmed") — nothing in this schema has ever set review_status to
-- 'verified' automatically, and Job Ingestion's own approval gate
-- requires review_status='verified' AND automation_eligibility=
-- 'suitable_public_ats' TOGETHER (job-ingestion-pilot-orchestrator.ts,
-- Attach Provenance & Guard) before it will fetch a single job. A
-- confident ATS detection is a technical fact; a human's confirmation
-- that this is a genuine, safe, authorized source is a separate trust
-- decision this migration does not have evidence it is safe to bypass.
-- Promotion resolves the former only — a human still supplies the
-- latter, exactly preserving Registry Sync's own
-- review_status='needs_manual_review' default on every new source.
--
-- Ownership model: service_role has SELECT+INSERT only on
-- source_intelligence (20260918160000) — deliberately no UPDATE, so nothing
-- can set applied_at/applied_result except through this one
-- SECURITY DEFINER function. service_role already has full CRUD on
-- company_sources (20260914150000); this function is SECURITY DEFINER
-- there too only for consistency with every other worker-facing RPC in
-- this schema (get_source_intelligence_candidates, resolve_registry_
-- candidate), not because it needs elevated company_sources privilege.
--
-- Purely additive: two new nullable columns, one new function, one new
-- grant/revoke pair. No existing table, column, row, or function body is
-- modified. Reversible with:
--   drop function if exists public.promote_source_intelligence_observation(text);
--   alter table public.source_intelligence drop column if exists applied_at;
--   alter table public.source_intelligence drop column if exists applied_result;

alter table public.source_intelligence
  add column if not exists applied_at timestamptz,
  add column if not exists applied_result jsonb;

comment on column public.source_intelligence.applied_at is
  'When promote_source_intelligence_observation() successfully processed this observation (whether or not it actually changed company_sources — see applied_result). Null = never attempted. Set exactly once — promotion is idempotent and a second call for the same source_id replays the stored applied_result instead of re-evaluating or re-writing anything.';
comment on column public.source_intelligence.applied_result is
  'The exact promotion outcome recorded at applied_at: {ats_provider_applied, automation_eligibility_applied, resulting_ats_provider, resulting_automation_eligibility}. *_applied is true only when that specific company_sources column was actually changed (it is guarded — a column already non-''unknown'' at promotion time, e.g. a prior human edit, is left untouched and *_applied is false for it). Null until applied_at is set. Lets a caller answer "what state resulted" without re-deriving it from company_sources, which may have changed again since.';

-- The single controlled write path from a Source Intelligence observation
-- into company_sources. Guarded, idempotent, concurrency-safe (row locks
-- via SELECT ... FOR UPDATE), never touches company_id or review_status,
-- never creates a company or company_sources row, never bypasses Registry
-- Sync's own identity model — it only ever updates two already-existing
-- free-text classification columns on an already-existing row, and only
-- when they are still 'unknown'.
create or replace function public.promote_source_intelligence_observation(
  p_source_id text
)
returns table (
  promoted boolean,
  reason text,
  source_id text,
  ats_provider_applied boolean,
  automation_eligibility_applied boolean,
  resulting_ats_provider text,
  resulting_automation_eligibility text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obs public.source_intelligence;
  v_source public.company_sources;
  v_new_ats_provider text;
  v_new_automation_eligibility text;
  v_ats_provider_applied boolean;
  v_automation_eligibility_applied boolean;
  v_result jsonb;
begin
  -- source_intelligence.source_id is UNIQUE (20260920100000) — at most one
  -- row can ever exist. Lock it so a concurrent call for the same source
  -- (e.g. an n8n retry) serializes on this row rather than racing.
  select si.* into v_obs
  from public.source_intelligence si
  where si.source_id = p_source_id
  for update;

  if not found then
    return query select false, 'no_observation_for_source'::text, p_source_id, false, false, null::text, null::text;
    return;
  end if;

  -- Idempotent replay: never re-evaluate or re-write once processed, even
  -- if company_sources has changed again since (e.g. a human took over) —
  -- a second promotion attempt for the SAME observation must be a no-op.
  if v_obs.applied_at is not null then
    return query select
      coalesce((v_obs.applied_result->>'ats_provider_applied')::boolean, false)
        or coalesce((v_obs.applied_result->>'automation_eligibility_applied')::boolean, false),
      'already_applied'::text,
      p_source_id,
      (v_obs.applied_result->>'ats_provider_applied')::boolean,
      (v_obs.applied_result->>'automation_eligibility_applied')::boolean,
      v_obs.applied_result->>'resulting_ats_provider',
      v_obs.applied_result->>'resulting_automation_eligibility';
    return;
  end if;

  -- ── The approved auto-promotion rule ────────────────────────────────
  -- ingestion_type='ats_adapter' is only ever set by Detect Provider
  -- Fingerprint when a real named signal actually matched (never paired
  -- with detected_provider='unknown') — this condition and the
  -- detected_provider<>'unknown' check are technically redundant in
  -- today's classifier, but both are asserted explicitly so the
  -- invariant is enforced by the database itself, not merely by trusting
  -- the workflow's current behavior never to change.
  if v_obs.ingestion_type is distinct from 'ats_adapter'
     or v_obs.confidence is distinct from 'high'
     or v_obs.detected_provider = 'unknown' then
    return query select false, 'not_eligible_for_auto_promotion'::text, p_source_id, false, false, null::text, null::text;
    return;
  end if;

  -- Referentially guaranteed to exist (source_intelligence.source_id is
  -- NOT NULL REFERENCES company_sources(id) ON DELETE CASCADE) — the
  -- "not found" branch here is defensive only, never expected in normal
  -- operation.
  select * into v_source
  from public.company_sources
  where id = p_source_id
  for update;

  if not found then
    raise exception 'promote_source_intelligence_observation: no company_sources row for id % (a source_intelligence row references it — integrity violation)', p_source_id
      using errcode = 'no_data_found';
  end if;

  -- ── Guarded, per-column resolution — never overwrite a value that is
  -- no longer 'unknown', whether set by a human, another process, or an
  -- earlier promotion. Each column's own current state decides
  -- independently whether it changes at all.
  v_ats_provider_applied := (v_source.ats_provider = 'unknown');
  v_automation_eligibility_applied := (v_source.automation_eligibility = 'unknown');

  v_new_ats_provider := case
    when v_ats_provider_applied then v_obs.detected_provider
    else v_source.ats_provider
  end;

  v_new_automation_eligibility := case
    when not v_automation_eligibility_applied then v_source.automation_eligibility
    -- The ONLY providers with a real, working Job Ingestion adapter
    -- today. Update this list only when a new adapter genuinely ships in
    -- job-ingestion-pilot-orchestrator.ts, never speculatively ahead of
    -- one actually existing.
    when v_obs.detected_provider in ('greenhouse', 'lever', 'workable') then 'suitable_public_ats'
    else 'manual_only'
  end;

  -- Only touch company_sources (and trip its own updated_at trigger) when
  -- something is actually changing.
  if v_ats_provider_applied or v_automation_eligibility_applied then
    update public.company_sources
    set ats_provider = v_new_ats_provider,
        automation_eligibility = v_new_automation_eligibility
    where id = p_source_id;
  end if;

  v_result := jsonb_build_object(
    'ats_provider_applied', v_ats_provider_applied,
    'automation_eligibility_applied', v_automation_eligibility_applied,
    'resulting_ats_provider', v_new_ats_provider,
    'resulting_automation_eligibility', v_new_automation_eligibility
  );

  update public.source_intelligence si
  set applied_at = now(),
      applied_result = v_result
  where si.source_id = p_source_id;

  return query select
    (v_ats_provider_applied or v_automation_eligibility_applied),
    (case when v_ats_provider_applied or v_automation_eligibility_applied then 'promoted' else 'already_resolved_no_change_needed' end)::text,
    p_source_id,
    v_ats_provider_applied, v_automation_eligibility_applied,
    v_new_ats_provider, v_new_automation_eligibility;
end;
$$;

revoke execute on function public.promote_source_intelligence_observation(text) from public;
grant  execute on function public.promote_source_intelligence_observation(text) to service_role;

comment on function public.promote_source_intelligence_observation(text) is
  'The single controlled write path from a Source Intelligence observation into company_sources. Auto-promotes ONLY ingestion_type=''ats_adapter'' AND confidence=''high'' AND detected_provider<>''unknown'' (never medium/low/unknown/needs_investigation/html/custom_parser). Resolves ats_provider for any recognized provider; sets automation_eligibility=''suitable_public_ats'' only for greenhouse/lever/workable (the providers Job Ingestion can actually ingest today), else ''manual_only''. Never touches review_status, company_id, or creates any row — Registry Sync remains the only registry entry path. Guarded per-column (never overwrites an already-non-''unknown'' value) and idempotent (a second call for an already-processed source_id replays the stored result). service_role only.';
