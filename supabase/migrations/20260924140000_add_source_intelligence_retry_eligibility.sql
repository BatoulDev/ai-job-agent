-- Source Intelligence re-analysis / retry-eligibility model.
--
-- Fixes the second HIGH-priority architecture gap: today ANY existing
-- source_intelligence row (confirmed live: including all 42 current
-- needs_investigation rows) permanently excludes that source from
-- get_source_intelligence_candidates() forever, via the table's own
-- UNIQUE(source_id) index (20260920100000) and the selector's NOT EXISTS
-- check. That is correct for a genuinely-resolved case (a stable
-- classification, or a structural finding that will not change on
-- re-fetch) but wrong for a transient fetch failure (429/5xx/timeout/
-- network error) that may well have recovered by the next scheduled run.
--
-- EVIDENCE-DRIVEN DESIGN (not invented categories): queried the live 42
-- needs_investigation rows before writing this migration. Every one of
-- them is already deterministically classifiable from the EXISTING
-- evidence fields (evidence.detection_method + evidence.http_status) —
-- no row needed a guess:
--   fetch_blocked_or_error_status, http_status=404  (7 rows) — structural
--   fetch_blocked_or_error_status, http_status=403  (1 row)  — retryable
--   fetch_blocked_or_error_status, http_status=429  (1 row)  — retryable
--   fetch_network_error, http_status=null           (1 row)  — retryable
--   no_provider_fingerprint_or_job_content_detected (29 rows) — structural
--     (http_status=200 — the page fetched FINE, the classifier simply
--     found no recognizable signal; re-fetching the identical page will
--     not produce new information)
--   off_scope_job_destination_only (3 rows)          — structural
--     (http_status=200 — a real, stable finding: this company's careers
--     page only points to an off-scope platform like LinkedIn)
-- Total: 3 retryable, 39 structural, 0 with insufficient evidence to
-- decide. See this session's chat report for the full breakdown.
--
-- DELIBERATELY NOT BACKFILLED: per this repo's own established precedent
-- (20260920100000's header — "pending an explicitly separate, human-
-- approved cleanup decision, never executed by this migration or any
-- other code in this change") this migration does NOT retroactively set
-- `retryable` on any of the 42 existing rows, even though all 42 are
-- confidently classifiable. They keep retryable=NULL, which the new
-- selector treats as non-retryable (the strictly safer default for
-- historical data this migration did not itself produce) — identical to
-- today's behavior for them. A human-approved backfill using the exact
-- same classification proposed in this session's report remains a
-- separate, later, explicit action.
--
-- THREE CATEGORIES, encoded as ONE new nullable boolean column
-- (source_intelligence.retryable), set explicitly by the workflow code
-- that already knows exactly why it produced a given result — never
-- inferred later by parsing evidence text:
--   A. TRANSIENT/RETRYABLE   -> retryable = true  (only ever paired with
--      ingestion_type='needs_investigation')
--   B. STRUCTURAL            -> retryable = false (also only ever needs_
--      investigation — a successfully-fetched-but-inconclusive page, an
--      off-scope destination, a 404, or no URL at all)
--   C. SUCCESSFUL CLASSIFICATION -> retryable stays NULL (not applicable
--      — ingestion_type is ats_adapter/html/custom_parser, governed
--      purely by ingestion_type in the selector, never retried)
-- retryable is therefore only ever meaningful when ingestion_type=
-- 'needs_investigation'; NULL/false both mean "do not auto-retry".
--
-- BACKOFF POLICY: a single, conservative, fixed 3-day window for every
-- retryable outcome (429/5xx/timeout/network alike) — NOT a per-status
-- backoff matrix. This project's own schedule is intended to be daily at
-- most (Daily Schedule Trigger); a shorter backoff would be meaningless
-- (nothing runs before tomorrow regardless), and a same-day retry risks
-- re-hitting the exact ongoing outage that caused the original failure.
-- 3 days balances "don't abandon a real recovery for weeks" against "give
-- a transient condition real time to actually clear" without building
-- exponential-backoff/attempt-count machinery this project's current
-- scale (593 sources, ~50 analyzed, at most one execution/day) does not
-- yet need — a natural, additive upgrade path if it ever does.
--
-- HISTORY MODEL: the original design (20260916171255) intended source_
-- intelligence as append-only history, but 20260920100000 added
-- UNIQUE(source_id) — a real, permanent conflict with "re-analysis" that
-- this migration now resolves properly rather than working around. That
-- index is DROPPED and replaced with UNIQUE(source_id, day) — at most one
-- observation per source PER CALENDAR DAY (UTC), not one ever. This still
-- closes the exact race the original index was built for (two concurrent
-- executions — e.g. a manual trigger overlapping the scheduled one, the
-- documented 2026-09-20 incident's own root cause — both analyzing the
-- same source at once): the loser's insert fails the constraint and is
-- handled exactly like any other insert failure already is (Evaluate
-- Insert Attempt's existing insertPerformed=false path, no workflow
-- change needed). A LEGITIMATE retry is always >= 3 days later, so it
-- never collides with this constraint. Residual, accepted risk: two
-- executions landing on opposite sides of a UTC-midnight boundary within
-- the same practical retry window could both insert — judged acceptable
-- for a scheduled-intelligence, not real-time, workflow; revisit only if
-- execution frequency ever increases materially.
--
-- LATEST-OBSERVATION CONTRACT (the answer to "how do we pick the current
-- truth for a source with several rows"): ORDER BY analyzed_at DESC,
-- created_at DESC, id DESC LIMIT 1 (or, set-wise, DISTINCT ON (source_id)
-- with that same ORDER BY). analyzed_at alone is a client-set JS
-- timestamp and is not guaranteed collision-free under true concurrency;
-- created_at (DB-assigned at INSERT) is a real secondary key; id (random
-- uuid) is a final, purely mechanical tiebreaker to guarantee a single
-- deterministic row even in a genuine timestamp tie — never used to imply
-- recency itself. This exact ordering is now used identically by both
-- get_source_intelligence_candidates() and promote_source_intelligence_
-- observation() — one canonical definition, not two independent ones.
--
-- PROMOTION RPC UPDATE: promote_source_intelligence_observation() assumed
-- exactly one source_intelligence row per source_id (true before this
-- migration). It is updated here to operate on the LATEST row via the
-- same canonical ordering, SELECT ... FOR UPDATE still serializing
-- concurrent calls for the same source. Every existing guarantee
-- (guarded per-column update, idempotent replay via applied_at, never
-- touches review_status/company_id, service_role has no direct UPDATE on
-- source_intelligence) is unchanged — only which row it reads changed.
-- An older, non-latest row's own applied_at is left exactly as it was
-- when IT was current — never retroactively touched — preserving history
-- exactly as required.

alter table public.source_intelligence
  add column if not exists retryable boolean;

comment on column public.source_intelligence.retryable is
  'Only meaningful when ingestion_type=''needs_investigation''. true = a transient/retryable fetch outcome (network error, HTTP 403/429/999, or 5xx) that should become an eligible re-analysis candidate again after the backoff window. false = a structural outcome (404, no URL, or a successfully-fetched-but-genuinely-inconclusive page) that will not change on a bare re-fetch and is not auto-retried. NULL for every successful classification (ats_adapter/html/custom_parser, where retryability is not applicable) and for historical pre-2026-09-24 needs_investigation rows, deliberately left unclassified rather than silently backfilled — see this migration''s own header for the full evidence-based categorization and the proposed (not executed) backfill.';

-- Replaces the absolute UNIQUE(source_id) — see this migration's header
-- for why "once ever" is now wrong and "once per day" is the correct,
-- still-safe replacement.
drop index if exists public.source_intelligence_source_id_key;

create unique index source_intelligence_source_id_analyzed_day_key
  on public.source_intelligence (source_id, (date_trunc('day', analyzed_at at time zone 'utc')));

comment on index public.source_intelligence_source_id_analyzed_day_key is
  'At most one observation per source per UTC calendar day — the real remaining protection against two concurrent executions (a manual trigger overlapping the schedule, the exact 2026-09-20 incident) both analyzing the same source at once. Deliberately NOT a stricter per-source-ever constraint: re-analysis after the retry backoff (always >= 3 days later, see get_source_intelligence_candidates()) must be able to insert a second row. Replaces source_intelligence_source_id_key (dropped above).';

-- ── get_source_intelligence_candidates(): explicit eligibility model ──────
-- Return shape changed (setof company_sources -> a composite company_
-- sources row plus selection context) to give dry_run real visibility
-- into WHY each source was selected, per this session's own requirement —
-- Postgres disallows CREATE OR REPLACE across a return-type change, so
-- this function is dropped and recreated rather than replaced in place.
drop function if exists public.get_source_intelligence_candidates(integer);

create function public.get_source_intelligence_candidates(
  p_limit integer default 10
)
returns table (
  source public.company_sources,
  selection_reason text,
  previous_ingestion_type text,
  previous_confidence text,
  previous_analyzed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (si.source_id)
      si.source_id, si.ingestion_type, si.confidence, si.retryable, si.analyzed_at
    from public.source_intelligence si
    order by si.source_id, si.analyzed_at desc, si.created_at desc, si.id desc
  )
  select
    cs,
    case when latest.source_id is null then 'never_analyzed' else 'retry_after_backoff' end,
    latest.ingestion_type,
    latest.confidence,
    latest.analyzed_at
  from public.company_sources cs
  left join latest on latest.source_id = cs.id
  where (cs.ats_provider = 'unknown' or cs.automation_eligibility = 'unknown')
    and (
      -- A: never analyzed at all.
      latest.source_id is null
      -- B: latest observation is a retryable needs_investigation result
      -- whose 3-day backoff has elapsed. A latest observation that is
      -- retryable=false (structural) or any successful ingestion_type
      -- (ats_adapter/html/custom_parser) never satisfies this and stays
      -- excluded — matches "successful classification is not
      -- unnecessarily re-selected" and "structural does not retry every
      -- day" exactly.
      or (
        latest.ingestion_type = 'needs_investigation'
        and latest.retryable = true
        and latest.analyzed_at <= now() - interval '3 days'
      )
    )
  order by cs.id asc
  limit p_limit;
$$;

revoke execute on function public.get_source_intelligence_candidates(integer) from public;
grant  execute on function public.get_source_intelligence_candidates(integer) to service_role;

comment on function public.get_source_intelligence_candidates(integer) is
  'Returns up to p_limit company_sources rows (as a nested `source` composite, plus selection_reason/previous_* context for dry-run visibility) with (ats_provider=''unknown'' OR automation_eligibility=''unknown'') AND EITHER never analyzed OR the latest observation is a retryable needs_investigation result whose 3-day backoff has elapsed. "Latest" uses the canonical ordering (analyzed_at desc, created_at desc, id desc) shared with promote_source_intelligence_observation(). A source with any successful classification, or a structural (retryable=false/NULL) needs_investigation result, or one already promoted out of ''unknown'' on both columns, is excluded. Ordered by id ascending, service_role only.';

-- ── promote_source_intelligence_observation(): operate on the LATEST
-- observation now that more than one can exist per source. Signature and
-- every other guarantee (guarded per-column update, idempotent replay,
-- never touches review_status/company_id) are unchanged — only the
-- initial row lookup changed from "the" row to "the latest" row, via the
-- same canonical ordering used above.
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
  select si.* into v_obs
  from public.source_intelligence si
  where si.source_id = p_source_id
  order by si.analyzed_at desc, si.created_at desc, si.id desc
  limit 1
  for update;

  if not found then
    return query select false, 'no_observation_for_source'::text, p_source_id, false, false, null::text, null::text;
    return;
  end if;

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

  if v_obs.ingestion_type is distinct from 'ats_adapter'
     or v_obs.confidence is distinct from 'high'
     or v_obs.detected_provider = 'unknown' then
    return query select false, 'not_eligible_for_auto_promotion'::text, p_source_id, false, false, null::text, null::text;
    return;
  end if;

  select * into v_source
  from public.company_sources
  where id = p_source_id
  for update;

  if not found then
    raise exception 'promote_source_intelligence_observation: no company_sources row for id % (a source_intelligence row references it — integrity violation)', p_source_id
      using errcode = 'no_data_found';
  end if;

  v_ats_provider_applied := (v_source.ats_provider = 'unknown');
  v_automation_eligibility_applied := (v_source.automation_eligibility = 'unknown');

  v_new_ats_provider := case
    when v_ats_provider_applied then v_obs.detected_provider
    else v_source.ats_provider
  end;

  v_new_automation_eligibility := case
    when not v_automation_eligibility_applied then v_source.automation_eligibility
    when v_obs.detected_provider in ('greenhouse', 'lever', 'workable') then 'suitable_public_ats'
    else 'manual_only'
  end;

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
  where si.id = v_obs.id;

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
  'The single controlled write path from a Source Intelligence observation into company_sources. Now operates on the LATEST observation for source_id (canonical ordering: analyzed_at desc, created_at desc, id desc), since more than one row per source is possible after this migration. Auto-promotes ONLY ingestion_type=''ats_adapter'' AND confidence=''high'' AND detected_provider<>''unknown''. Resolves ats_provider for any recognized provider; sets automation_eligibility=''suitable_public_ats'' only for greenhouse/lever/workable (the providers Job Ingestion can actually ingest today), else ''manual_only''. Never touches review_status, company_id, or an older (non-latest) observation''s own applied_at — history is preserved exactly. Guarded per-column and idempotent. service_role only.';

-- Reversible with:
--   drop function if exists public.promote_source_intelligence_observation(text);
--   drop function if exists public.get_source_intelligence_candidates(integer);
--   create function public.get_source_intelligence_candidates(p_limit integer default 10) returns setof public.company_sources ... -- (restore prior body from 20260919090000)
--   create function public.promote_source_intelligence_observation(p_source_id text) ... -- (restore prior body from 20260924130000)
--   drop index if exists public.source_intelligence_source_id_analyzed_day_key;
--   create unique index source_intelligence_source_id_key on public.source_intelligence (source_id);
--   alter table public.source_intelligence drop column if exists retryable;
