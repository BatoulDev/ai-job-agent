# LinkedIn `external_id` convention

**The rule:** every LinkedIn job's `external_id` is the bare LinkedIn numeric job id, exactly `String(raw.id)` — see `src/lib/ingestion/providers/linkedin.ts`'s `externalId` field. This is the only convention the real adapter has ever produced, and it must stay the only one any code or script ever writes into `jobs.external_id` for `source_type = 'linkedin'`.

## The 2026-10-17 incident (fixed 2026-10-25)

An ad hoc pilot run at `07:49:21` wrote 5 real LinkedIn jobs using a one-off, hand-typed `external_id` convention — `phase1-real-pilot-2026-10-17074910-<real LinkedIn id>` — instead of the adapter's bare-id shape. A second, later run that same day (`15:18:54`) used the real adapter and correctly re-ingested the same 5 jobs as `phase1-real-pilot-...` and bare-id rows both passed `jobs_dedup_scope_external_id_key` (`dedup_scope`, `external_id`) as distinct, legitimate values — creating 5 true duplicate rows for 5 real jobs.

This was never a defect in `providers/linkedin.ts` or in the dedup mechanism — a repo-wide search (`src/`, `scripts/`, `tests/`, `docs/`) found zero references to `phase1-real-pilot` anywhere in checked-in code. It was typed directly in an interactive session, never a reusable script, so normal ingestion could never reproduce it. The 5 duplicate rows were independently verified (same real LinkedIn job id, company, title, and `application_url` on each pair) and deleted by exact id on 2026-10-25 — see the Lebanon Coverage Audit follow-up investigation for the full trace.

## The rule going forward

Any future ad hoc pilot, validation, or test script that needs to write LinkedIn-shaped `jobs` rows (or any provider's rows) must do exactly one of:

1. **Reuse the real adapter's own `external_id` shape**, so a real production run can never mistake the row for a different, "new" job — or
2. **Use this project's own established isolated-fixture convention**: a `randomUUID()`-suffixed, clearly test-only `external_id`/`source_id`/`refresh_scope` that can never collide with real data, written and **cleaned up in the same script or test** (tracked ids, verified zero leftover afterward) — see `tests/db/helpers.mjs`'s `deleteFakeJobs` and any `tests/db/*.test.mjs` file for the canonical pattern already used throughout this project's test suite.

Never a third option: a value that looks like it could be real ingested data (so it's never flagged for cleanup) but isn't produced by any real adapter (so a later real run doesn't recognize it as the same job). That hybrid is exactly what created this incident.
