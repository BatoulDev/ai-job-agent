-- Source Intelligence Layer, storage step 1: an append-only observation log
-- for source classification results (detected ATS/provider, recommended
-- ingestion method, confidence, evidence). This table is purely a leaf/log:
-- it has no trigger, function, or constraint that writes to any other table,
-- and it never causes ingestion or source activation on its own. Promoting a
-- source into an actually-approved, ingestible state remains a separate,
-- explicit write to company_sources.review_status/automation_eligibility —
-- unchanged by this migration.
--
-- Modeled directly on this schema's own existing append-only event-log
-- convention (public.audit_events, public.rate_limit_events): uuid primary
-- key, a jsonb payload column constrained to a JSON object via
-- jsonb_typeof(...) = 'object', created_at only (no updated_at, no update
-- trigger — a re-classification is a new row, not an edit to an old one).
--
-- Purely additive: creates one new table, no existing table (company_sources,
-- jobs, or any other) is touched by this migration.

create table public.source_intelligence (
  id                uuid primary key default gen_random_uuid(),
  source_id         text not null references public.company_sources(id) on delete cascade,
  run_id            uuid not null,
  detected_provider text not null,
  ingestion_type    text not null,
  confidence        text not null,
  evidence          jsonb not null default '{}'::jsonb,
  analyzed_at       timestamp with time zone not null default now(),
  created_at        timestamp with time zone not null default now(),

  constraint source_intelligence_detected_provider_check check (
    detected_provider = any (array[
      'greenhouse', 'lever', 'workable', 'oracle', 'sap', 'workday',
      'taleo', 'smartrecruiters', 'icims', 'unknown'
    ])
  ),
  constraint source_intelligence_ingestion_type_check check (
    ingestion_type = any (array[
      'ats_adapter', 'api', 'html', 'custom_parser', 'manual', 'needs_investigation'
    ])
  ),
  constraint source_intelligence_confidence_check check (
    confidence = any (array['high', 'medium', 'low'])
  ),
  constraint source_intelligence_evidence_check check (
    jsonb_typeof(evidence) = 'object'
  )
);

comment on table public.source_intelligence is
  'Append-only observation log: one row per source-classification attempt. Never updated in place (no updated_at, no update trigger) — a re-probe inserts a new row, so history is the table itself. Does not activate sources or trigger ingestion; company_sources.review_status/automation_eligibility remain the sole, separately-written approval gate.';
comment on column public.source_intelligence.run_id is
  'Correlation id for one Source Intelligence workflow execution — not a foreign key, since no workflow-run table exists in this schema (matches the lightweight-correlation-id convention already used elsewhere in this project).';
comment on column public.source_intelligence.evidence is
  'Free-form evidence object: matched_signal, probed_endpoint, http_status, detection_method. Constrained to a JSON object (not array/scalar) by source_intelligence_evidence_check.';

create index source_intelligence_source_id_analyzed_idx
  on public.source_intelligence (source_id, analyzed_at desc);

create index source_intelligence_run_id_idx
  on public.source_intelligence (run_id);

alter table public.source_intelligence enable row level security;
-- Deliberately no policies: service-role only (bypasses RLS), matching
-- company_sources' own existing access model. No authenticated/public grant.
