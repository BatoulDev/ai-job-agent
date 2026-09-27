-- Matching embeddings storage (Phase 05). Purely additive: nullable columns
-- on jobs and cv_analyses, no new extension, no data migration needed (zero
-- rows in either table have an embedding yet).
--
-- Deliberately plain `real[]` arrays, not the pgvector extension. At this
-- product's real scale (starting from 4 ingestion sources — dozens to low
-- hundreds of active jobs, not millions), the shortlist step already bounds
-- its candidate set (see src/lib/matching/shortlist.ts) to a size small
-- enough for in-process cosine-similarity ranking — no ANN index is needed
-- yet, and pgvector would be an unused dependency today (AGENTS.md §24).
-- ponytail: real[] + JS cosine similarity, upgrade to the pgvector extension
-- + an ANN index if the active jobs table ever exceeds ~10k rows or
-- shortlist latency becomes a measured problem, not a guessed one.
--
-- embedding_content_hash lets the (future) embedding worker skip
-- regenerating an embedding whose source text hasn't changed since it was
-- last computed — "refresh only when relevant content changes," not on
-- every run.

alter table public.jobs
  add column embedding real[],
  add column embedding_content_hash text,
  add column embedding_generated_at timestamptz;

comment on column public.jobs.embedding is
  'Semantic embedding of this job''s title/description/location, for the matching shortlist (src/lib/matching/shortlist.ts). Null until a future embedding worker computes it. Never used for deterministic eligibility (AGENTS.md §11) — checkJobEligibility() always runs first.';
comment on column public.jobs.embedding_content_hash is
  'Hash of the exact text last embedded (see src/lib/matching/embeddingText.ts). Recompute the embedding only when this no longer matches the job''s current content — never on every ingestion run.';

alter table public.cv_analyses
  add column profile_embedding real[],
  add column profile_embedding_content_hash text,
  add column profile_embedding_generated_at timestamptz;

comment on column public.cv_analyses.profile_embedding is
  'Semantic embedding of the approved AI Career Profile + preferences (src/lib/matching/embeddingText.ts). Only ever computed for a row that is_cv_analysis_matching_eligible() — never for a pending/changes_requested/stale analysis.';
comment on column public.cv_analyses.profile_embedding_content_hash is
  'Hash of the exact text last embedded. Recompute only when this no longer matches (e.g. profile re-approved after a re-analysis, or preferences changed).';
