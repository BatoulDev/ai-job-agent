-- One-time, human-approved historical backfill of source_intelligence.retryable
-- for the 42 needs_investigation rows created before the retry-eligibility
-- feature existed (all currently retryable=NULL, added by
-- 20260924140000_add_source_intelligence_retry_eligibility.sql).
--
-- Re-verified against the live local database immediately before writing
-- this migration (2026-09-24) — unchanged from the original review:
--   fetch_blocked_or_error_status, http_status=404   (7 rows)
--   fetch_blocked_or_error_status, http_status=403   (1 row)
--   fetch_blocked_or_error_status, http_status=429   (1 row)
--   fetch_network_error,           http_status=null  (1 row)
--   no_provider_fingerprint_or_job_content_detected  (29 rows, http_status=200)
--   off_scope_job_destination_only                   (3 rows, http_status=200)
-- Total 42, all needs_investigation, all retryable=NULL today. 8 further
-- source_intelligence rows exist (successful classifications) and are
-- never touched — retryable is not applicable to them and stays NULL,
-- exactly as 20260924140000 already documents.
--
-- CLASSIFICATION RULE — identical semantics to the current, live
-- workflow logic (Build Blocked Result / Build No-URL Result / Detect
-- Provider Fingerprint in n8n-workflows/source-intelligence-analyzer.ts,
-- 2026-09-24), not re-derived or approximated here:
--   RETRYABLE (true):  detection_method='fetch_network_error', OR
--                       detection_method='fetch_blocked_or_error_status'
--                       AND http_status IN (403,429,999) OR http_status>=500.
--   STRUCTURAL (false): detection_method='no_public_url_available', OR
--                       detection_method='fetch_blocked_or_error_status'
--                       AND http_status NOT IN the retryable set above
--                       (covers 404/401/other 4xx), OR
--                       detection_method IN
--                         ('no_provider_fingerprint_or_job_content_detected',
--                          'off_scope_job_destination_only').
--
-- NO GUESSING: each UPDATE below only matches an exact, known
-- detection_method (and, where relevant, a numeric http_status pattern)
-- already proven present in this data. A row whose evidence does not
-- match any of these exact patterns — including any detection_method
-- this migration does not explicitly know about — is simply never
-- touched by any of the UPDATEs and keeps retryable=NULL, precisely the
-- required "leave NULL and report" behavior. Every one of today's 42
-- rows is expected to match exactly one UPDATE below (verified pre- and
-- post-application in this session's own report); this migration does
-- not assume that in advance.
--
-- SAFETY: every UPDATE is scoped to `retryable is null` — an already-
-- populated row (from a future real analysis) is structurally excluded
-- from ever being touched again by this migration, satisfies "never
-- overwrite an already-populated value" on its own even before
-- considering that this migration only ever runs once. Only the
-- `retryable` column is written; analyzed_at, detected_provider,
-- ingestion_type, confidence, evidence, applied_at, and applied_result
-- are never referenced in a SET clause anywhere below. No row is
-- inserted or deleted. company_sources/companies are not referenced at
-- all. Nothing here can trigger promotion — promote_source_intelligence_
-- observation() is a separate, explicitly-invoked RPC this migration
-- never calls.
--
-- FUTURE OBSERVATIONS UNAFFECTED: this migration runs exactly once, at
-- apply time, against whatever rows currently satisfy `retryable is
-- null`. It is not a trigger, rule, or ongoing policy — a source_
-- intelligence row inserted after this migration already carries an
-- explicit true/false/null retryable value from the workflow itself
-- (Insert Source Intelligence Observation's own payload), so it will
-- never again match `retryable is null` for this migration to (re-)act
-- on, even if this file were somehow re-run.
--
-- Reversible with:
--   update public.source_intelligence set retryable = null
--   where id in (
--     -- capture the exact id set from this migration's own verification
--     -- query in the accompanying session report before reverting.
--   );

-- ── Retryable: a network error — no HTTP response at all ──────────────────
update public.source_intelligence
set retryable = true
where retryable is null
  and ingestion_type = 'needs_investigation'
  and evidence->>'detection_method' = 'fetch_network_error';

-- ── Retryable: HTTP 403 / 429 / 999, or any 5xx ────────────────────────────
update public.source_intelligence
set retryable = true
where retryable is null
  and ingestion_type = 'needs_investigation'
  and evidence->>'detection_method' = 'fetch_blocked_or_error_status'
  and evidence->>'http_status' is not null
  and (
    (evidence->>'http_status')::int in (403, 429, 999)
    or (evidence->>'http_status')::int >= 500
  );

-- ── Structural: no usable URL at all ───────────────────────────────────────
update public.source_intelligence
set retryable = false
where retryable is null
  and ingestion_type = 'needs_investigation'
  and evidence->>'detection_method' = 'no_public_url_available';

-- ── Structural: HTTP 404 / 401 / any other 4xx not already claimed above ──
update public.source_intelligence
set retryable = false
where retryable is null
  and ingestion_type = 'needs_investigation'
  and evidence->>'detection_method' = 'fetch_blocked_or_error_status'
  and evidence->>'http_status' is not null
  and (evidence->>'http_status')::int not in (403, 429, 999)
  and (evidence->>'http_status')::int < 500;

-- ── Structural: fetched fine, no recognizable ATS/job signal at all ───────
update public.source_intelligence
set retryable = false
where retryable is null
  and ingestion_type = 'needs_investigation'
  and evidence->>'detection_method' = 'no_provider_fingerprint_or_job_content_detected';

-- ── Structural: fetched fine, only an off-scope job destination (e.g. LinkedIn) ──
update public.source_intelligence
set retryable = false
where retryable is null
  and ingestion_type = 'needs_investigation'
  and evidence->>'detection_method' = 'off_scope_job_destination_only';
