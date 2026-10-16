-- LinkedIn data-slayer enrichment: bounded retry/idempotency tracking.
-- Purely additive — two nullable/defaulted columns, no existing column
-- changed, no data migrated. See src/lib/ingestion/linkedinEnrichment.ts
-- for the resolution logic that reads/writes these and
-- src/lib/ingestion/applyLinkedInEnrichmentBatch.ts for the persistence
-- layer that applies it.
--
-- Why not a single "enriched_at" timestamp (the originally proposed
-- design): manual validation proved a single successful data-slayer call
-- can return an empty/unresolved work_arrangement even when the real
-- LinkedIn posting visibly shows a value (2 of 3 real "UNKNOWN" results
-- in one pilot batch were confirmed false negatives on manual review).
-- Treating "we already tried once" as "never try again" would make that
-- false negative permanent. linkedin_enrichment_attempts + work_arrangement
-- together are sufficient to encode every case this feature needs:
--   - work_arrangement IS NOT NULL -> resolved (structured or classifier),
--     never re-queried regardless of attempts.
--   - work_arrangement IS NULL AND attempts < 2 -> eligible for one more
--     bounded paid retry.
--   - work_arrangement IS NULL AND attempts >= 2 -> stop automatic paid
--     retries; stays unknown (checkJobEligibility.ts already treats an
--     unknown work_arrangement safely — never a rejection by itself).
-- A provider/network failure must never increment attempts (see
-- classifyAttemptOutcome in linkedinEnrichment.ts) — only a
-- structurally-valid response (successful or a genuine empty result)
-- counts as a real attempt, so a job is never falsely marked as "tried"
-- when the actor call itself simply failed.
alter table public.jobs
  add column linkedin_enrichment_attempts smallint not null default 0,
  add column linkedin_enrichment_last_attempt_at timestamptz;

-- Hard backstop matching the application's own queue-eligibility rule
-- (attempts < 2) — defense in depth, not just an application-layer check.
alter table public.jobs
  add constraint jobs_linkedin_enrichment_attempts_range
  check (linkedin_enrichment_attempts >= 0 and linkedin_enrichment_attempts <= 2);

comment on column public.jobs.linkedin_enrichment_attempts is
  'Count of completed (non-network-failure) data-slayer enrichment attempts for this job. Capped at 2 by the application''s queue-eligibility rule and this column''s own check constraint. 0 = never attempted. Never incremented on an actor/network failure or an identity-mismatched/malformed response — only on a structurally-valid, correctly-identified response, whether its work arrangement resolved or came back empty.';
comment on column public.jobs.linkedin_enrichment_last_attempt_at is
  'Timestamp of the most recent counted enrichment attempt (see linkedin_enrichment_attempts). Null when never attempted. Observability only — not read by the queue-eligibility rule itself, which depends only on work_arrangement and linkedin_enrichment_attempts.';
