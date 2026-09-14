-- Found during P0 review while investigating "idempotent retries" for a
-- future ingestion worker: jobs_source_external_id_key
-- (20260809090030_create_jobs.sql) is a PARTIAL unique index
-- (`where external_id is not null`). Postgres refuses to use a partial
-- index as an ON CONFLICT inference target unless the ON CONFLICT clause's
-- own predicate exactly matches — plain `on conflict (source_type,
-- external_id) do update ...` (the natural, idiomatic idempotent-upsert
-- pattern, and what Supabase's `.upsert()` generates) fails outright with
-- Postgres error 42P10 ("there is no unique or exclusion constraint
-- matching the ON CONFLICT specification"). Reproduced directly against
-- the partial index before writing this migration.
--
-- The partial predicate turns out to have been unnecessary for the reason
-- its own migration comment gave ("so admin-entered jobs, which have no
-- external id, are never forced to collide with each other"): standard SQL
-- unique-index semantics already never treat two NULLs as equal, with or
-- without a partial predicate — confirmed in this session, inside a rolled
-- back transaction, that a full (non-partial) unique index on (source_type,
-- external_id) still allows any number of external_id IS NULL rows to
-- coexist. Dropping the predicate is therefore behavior-preserving for
-- every existing case (jobs-and-admin.test.mjs's "manually entered jobs
-- never collide" and this branch's own
-- tests/db/jobs-ingestion-identity.test.mjs both still pass unmodified)
-- while unblocking the one thing it was silently blocking: a real
-- ingestion worker's idempotent-retry upsert.
--
-- There are currently zero jobs rows (Section 8 of the audit; independently
-- reconfirmed this session), so this drop-and-recreate is a no-op on
-- existing data — same additive-in-spirit pattern already used for
-- widening jobs_status_check, applied here to an index instead of a check
-- constraint.
drop index public.jobs_source_external_id_key;

create unique index jobs_source_external_id_key
  on public.jobs (source_type, external_id);

comment on index public.jobs_source_external_id_key is
  'Deterministic external-job identity + idempotent-upsert target for a future ingestion worker: INSERT ... ON CONFLICT (source_type, external_id) DO UPDATE .... Intentionally NOT partial (unlike its 20260809090030 original) — a plain unique index already never treats two NULL external_id rows as colliding, and only a plain index is usable as an ON CONFLICT inference target.';
