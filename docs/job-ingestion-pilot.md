# Job Ingestion — Pilot Orchestrator

Status: **pilot, inactive**. Built on branch `feat/job-ingestion-automation`. Not activated, no schedule, no production writes performed by this phase.

## 1. Source-classification summary

The 588-row company registry (`docs/job-source-discovery/*.csv`, imported into `public.company_sources`) already carries researcher-assigned classification columns. Distribution at the time this pilot was built:

| `automation_eligibility` | count |
|---|---|
| suitable_public_html_subject_to_review | 358 |
| unknown | 90 |
| suitable_public_ats | 78 |
| manual_only | 62 |

| `review_status` | count |
|---|---|
| verified | 398 |
| needs_manual_review | 180 |
| no_official_source_found | 10 |

Cross-referencing `automation_eligibility = suitable_public_ats` AND `review_status = verified` AND a known ATS provider with a documented public JSON API (Greenhouse, Lever, Workday, SmartRecruiters, Workable) yielded 25 candidates with a populated `public_jobs_endpoint_or_feed`. Each candidate endpoint was live-verified with a plain `curl` GET against its public API before selection — no browser automation was needed or used, since Greenhouse/Lever/Workable all publish stable, undocumented-auth-free JSON endpoints for their job boards.

Note: SmartRecruiters and Workday candidates were live-verified too (Etihad Airways/SmartRecruiters, DataRobot/Workday) but were **not** selected for the pilot — `public.jobs.source_type` has a fixed check constraint of `admin_manual, career_page, greenhouse, lever, workable, ashby, linkedin`, and widening it wasn't independently justified for a 4-source pilot (see "Database safety" in the implementation report).

## 2. Selected pilot sources

| Company | `company_sources.id` | Country | ATS | Verified public endpoint |
|---|---|---|---|---|
| Scale AI | `sr-qa-scale-ai` | Qatar (target market) | Greenhouse | `https://boards-api.greenhouse.io/v1/boards/scaleai/jobs?content=true` |
| Alpaca | `sr-sa-alpaca` | Saudi Arabia | Greenhouse | `https://boards-api.greenhouse.io/v1/boards/alpaca/jobs?content=true` |
| Wahed | `sr-intl-wahed` | Lebanon (target market) | Lever | `https://api.lever.co/v0/postings/wahed.com?mode=json` |
| Salla | `sr-sa-salla` | Saudi Arabia | Workable | `https://apply.workable.com/api/v1/widget/accounts/salla?details=true` |

Why these four: two Greenhouse boards (to prove one adapter type handles independent source failures correctly), one Lever board, one Workable board — covering 3 of the 3 ATS adapters this pilot implements, all `review_status = verified`, all live-returning real job postings at verification time (67–227 jobs each). Kitopi (originally a Lever candidate) was dropped after its public Lever board returned HTTP 404 at verification time — a real, current-state check caught a stale registry entry rather than trusting the CSV blindly.

Remaining assumption: registry `country_code`/`target_country` describe the market this source was researched *for*, not necessarily where the company's own jobs are physically located (confirmed directly — Scale AI's live postings are in San Francisco/New York, not Qatar). `jobs.country_code`/`jobs.city` are therefore left `NULL` for all four sources rather than inferring geography from the registry (see §6 below).

## 3. Ingestion architecture

```
Start Pilot Run (Manual Trigger)
  → Workflow Configuration (mode, supabaseBaseUrl, maxJobsPerSource, rateLimitDelaySeconds)
  → Load Approved Pilot Sources (static adapter config: 4 × {source_id, ats_type, feed_url})
  → Fetch Source Provenance (live GET company_sources — re-verifies review_status/automation_eligibility every run)
  → Attach Provenance & Guard
  → Process Sources (loop, 1 source at a time)
      → Is Source Approved?
          false → Build Review-Required Result
          true  → Route By ATS Type (greenhouse | lever | workable | unsupported)
                     → Fetch <ATS> Jobs (timeout 15s, native retry disabled)
                     → Evaluate <ATS> Fetch Attempt (classifies error/statusCode → success | retryable_* | permanent_*)
                     → Should Retry <ATS>? 
                         true  → Compute Backoff <ATS> → Backoff Wait <ATS> → loops back to Fetch <ATS> Jobs
                         false → Classify & Normalize <ATS> (validate, strip HTML, map fields)
      → Should Write To DB? (succeeded && jobsValid>0 && mode==='local_pilot')
          true  → Prepare Bounded Write Set (flags `truncated` when jobsValid > maxJobsPerSource)
                   → Select Existing Jobs For Source → Compute Diff Plan
                   → Upsert Jobs (idempotent, on_conflict=dedup_scope,external_id — see §5a)
                   → Merge Upsert Result → Should Close Stale Jobs? → Close Stale Jobs For Source
          false → (dry_run, or no valid jobs, or fetch failed)
      → Finalize Source Result (single convergence point for every branch above)
      → Rate Limit Delay → loop to next source
  → Build Execution Summary (onDone: aggregates every source's result)
```

41 nodes total (29 base + 12 retry-loop nodes: `Evaluate <ATS> Fetch Attempt` / `Should Retry <ATS>?` / `Compute Backoff <ATS>` / `Backoff Wait <ATS>`, one set per adapter). The `company_sources.review_status`/`automation_eligibility` gate is re-checked live from the database on every run — the hardcoded 4-source list in the workflow is never trusted as authorization by itself.

## 4. Workflow input/output contract

**Input** (edit the "Workflow Configuration" node before running):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `mode` | string | `dry_run` | `dry_run` or `local_pilot` |
| `supabaseBaseUrl` | string | `http://host.docker.internal:55321` | Local Supabase REST base URL |
| `environment` | string | `local` | Informational label |
| `maxJobsPerSource` | number | `5` | Bounded cap on jobs written per source in `local_pilot` |
| `rateLimitDelaySeconds` | number | `2` | Pause between sources |

**Output**: the final "Build Execution Summary" node produces:

```jsonc
{
  "mode": "dry_run",
  "sourcesAttempted": 4, "sourcesSucceeded": 4, "sourcesFailed": 0,
  "jobsFetched": 0, "jobsValid": 0, "jobsRejected": 0,
  "jobsCreated": 0, "jobsUpdated": 0, "jobsUnchanged": 0, "jobsClosed": 0,
  "retries": 0, "totalDurationMs": 0,
  "perSource": [ /* one entry per source: source_id, ats_type, outcome, succeeded, counts, error */ ],
  "finishedAt": "..."
}
```

## 5. Normalization rules

Common mapping for all three adapters — see the exact per-adapter code in `n8n-workflows/job-ingestion-pilot-orchestrator.json` (`Classify & Normalize Greenhouse/Lever/Workable` nodes):

- `source_type` / `external_id`: the ATS's own stable id (Greenhouse numeric id, Lever posting UUID, Workable shortcode). Never a content hash.
- `title`, `description` (HTML stripped to plain text), `application_url`: required — a job missing any of these, or whose `application_url` isn't `http(s)://`, is **rejected**, not inserted with a placeholder.
- `company_name`: **always** the live `company_sources.company_name` value, never invented or hardcoded from the pilot's static source list.
- `work_arrangement`: only set when the source itself is structurally explicit (Lever `categories.workplaceType`, Workable `telecommuting: true`, or Greenhouse's own "Remote" text in its `location.name` field). Otherwise `NULL`.
- `employment_type`: mapped only when the source's own field (Lever `categories.commitment`, Workable `employment_type`) matches one of the four values the schema allows (`full-time`/`part-time`/`contract`/`internship`); Greenhouse's list endpoint has no such field, so it's always `NULL` there.
- `location`: the raw source string, unparsed.
- `country_code` / `city`: **always `NULL`** in this pilot — see the "documented limitation" note in the workflow's file header. No adapter's list endpoint gives structured, reliable per-job geography without guessing from free text.
- `seniority`: always `NULL` — no adapter provides it, and guessing from title keywords was deliberately not implemented (avoids inventing data).
- `published_at`: Greenhouse `first_published`, Lever `createdAt`, Workable `published_on`.
- `source_last_modified_at`: only Greenhouse provides `updated_at`; `NULL` for Lever/Workable.

## 5a. Dedup identity: `dedup_scope`, not `source_type`

**`source_type` is an ATS/provider *category*** (`greenhouse`/`lever`/`workable`/`admin_manual`/`career_page`/`linkedin`) — it is **not** company- or source-specific. Two different companies hosted on the same ATS (e.g. two different Greenhouse-hosted employers) share the same `source_type`. The original dedup key, `UNIQUE (source_type, external_id)`, therefore could not tell apart two genuinely different companies' jobs if their external ids ever collided — confirmed as a real P0 identity bug during the post-implementation review (`tests/db/jobs-ingestion-identity.test.mjs`, the "FIXED"/"FIX VERIFIED" tests): an upsert shaped exactly like this workflow's own `Upsert Jobs` node silently spliced one company's data into an unrelated company's existing row, with no error.

Fixed by `supabase/migrations/20260915170000_add_jobs_source_specific_dedup_key.sql`, additive and non-destructive (no row was deleted, updated, or reassigned a new id):

- `jobs.dedup_scope` — a generated, stored column: `'src:' || source_id` when a specific `company_sources` row is known (every write this pilot performs), else `'type:' || source_type` (unchanged legacy behavior for `admin_manual`/`career_page`/`linkedin` rows that have no `source_id`).
- The dedup/idempotent-upsert unique index and `ON CONFLICT` target is now `(dedup_scope, external_id)` — `jobs_dedup_scope_external_id_key` — replacing `jobs_source_external_id_key (source_type, external_id)`.
- `Upsert Jobs`'s URL is `on_conflict=dedup_scope,external_id`. Nothing else in the workflow needed to change: `Select Existing Jobs For Source` and `Close Stale Jobs For Source` were already scoped by `source_id`, not `source_type` — only the final upsert's conflict target was using the wrong (too-broad) identity.
- Never insert into `dedup_scope` directly — it is computed by Postgres from `source_id`/`source_type` on every insert/update.

## 6. Lifecycle behavior

- `first_seen_at` is set once (on first insert) and preserved on every subsequent upsert — computed by reading the existing row (if any) via `Select Existing Jobs For Source` before the upsert, never re-stamped.
- `last_seen_at` / `last_checked_at` / `last_successful_check_at` are refreshed to "now" on every successful upsert.
- **Stale-close is scoped to a successful, complete fetch only.** `Compute Diff Plan` computes `staleExternalIds` (previously-active jobs for that `source_id` absent from the *current successful* fetch) directly from the same query used for the created/updated/unchanged diff — a fetch that failed, timed out, or was rate-limited never reaches this node, so a retryable or permanent fetch failure can never mark a source's existing jobs unavailable. This is the concrete mechanism behind "a temporary source outage must not close all jobs" (verified in `tests/db/job-ingestion-pilot.test.mjs`).
- **Stale-close is also blocked on truncation.** `Prepare Bounded Write Set` sets `truncated: true` whenever a source's `jobsValid` exceeds `maxJobsPerSource` (i.e. the bounded pilot only wrote a partial page of the source's real result set). `Should Close Stale Jobs?` requires `writeSucceeded === true AND staleExternalIds.length > 0 AND truncated === false` (AND-combined, all three mandatory) — so a bounded/truncated `local_pilot` run can never close jobs that are still genuinely active but simply outside the written page. Verified in both `tests/workflow` (structural IF-condition check) and `tests/db` (diff-plan behavior with `truncated: true`).
- Closing sets `status = 'unavailable'` with a `status_reason`, never deletes rows.

## 7. Rate limits

- Per-source pacing: a `Wait` node pauses `rateLimitDelaySeconds` (default 2s) between each of the 4 sources — sequential, single execution, no parallel fan-out to these public APIs.
- HTTP 429 responses are detected explicitly (via `neverError: true` + reading `statusCode`) and classified `retryable_rate_limited` **without** any further call to that source within the same run — this respects provider rate-limit guidance rather than hammering it. Picking the source back up is a future scheduled-run concern.

## 8. Retry behavior — bounded exponential backoff with jitter

n8n's Code node sandbox has no network access (confirmed via `get_node_types`), so the retry loop is a real graph loop per adapter: `Fetch <ATS> Jobs` → `Evaluate <ATS> Fetch Attempt` → `Should Retry <ATS>?` → (true) `Compute Backoff <ATS>` → `Backoff Wait <ATS>` → back to `Fetch <ATS> Jobs`. The HTTP Request node's native retry is explicitly disabled (`retryOnFail: false`) in favor of this loop.

- **Retryable**: connection/timeout errors (`retryable_network_error`), HTTP 429 (`retryable_rate_limited`), and HTTP 500/502/503/504 (`retryable_server_error`).
- **Never retried**: any other 4xx (`permanent_client_error`) and any other 5xx not in the retryable set (`permanent_server_error`).
- **Bounded attempts**: `MAX_ATTEMPTS = 4` (1 initial + 3 retries). Exhausting retries yields an `*_retries_exhausted` outcome and the source is finalized as failed — no infinite loop.
- **Backoff formula**: `exp = min(MAX_DELAY_MS, BASE_DELAY_MS * 2^(attempt-1))` with `BASE_DELAY_MS = 500`, `MAX_DELAY_MS = 8000`; `jitter = random() * exp`; `nextDelayMs = min(MAX_DELAY_MS, round((exp + jitter) / 2))`.
- **`Retry-After` respected**: a valid HTTP 429 `Retry-After` header (seconds or HTTP-date) overrides the computed delay, still capped at `MAX_DELAY_MS`.
- **Observability**: `retries` (attempts used, `attempt - 1`) and the final `outcome`/`error` are threaded through `Classify & Normalize <ATS>` → `Finalize Source Result` → `Build Execution Summary`, so every run's summary reports exactly how many retries each source needed and how it ultimately resolved.

Because the SDK's code validator rejects top-level function/arrow-function declarations (only `import`/`const = call(...)`/`export default` are allowed outside a node's own `jsCode` string), the classification logic is duplicated inline once per adapter's `Evaluate <ATS> Fetch Attempt` node rather than extracted to a shared helper — see the top-of-file comment in `n8n-workflows/job-ingestion-pilot-orchestrator.ts`.

**Ceiling**: jitter is pseudo-random per attempt (not seeded), so exact delay values are non-deterministic in a live run — tests stub `Math.random` to verify the formula deterministically. **Upgrade path**: none needed for this pilot's scope; a recurring scheduled worker would additionally need cross-run backoff state (not just within-run), which is out of scope here.

## 9. Dry-run instructions

1. Open the workflow in n8n (`http://localhost:5678/workflow/35sOxBCRRazBX3T1`), confirm it is **inactive**.
2. Confirm the "Supabase Service Role" credential is attached to the 4 HTTP nodes that need it (see "Required credentials" below — already bound as of this pilot's remediation pass).
3. Open "Workflow Configuration" and confirm `mode` is `dry_run` (the default).
4. Click the Manual Trigger ("Start Pilot Run") to execute.
5. Inspect "Build Execution Summary" — `jobsCreated`/`jobsUpdated`/`jobsUnchanged`/`jobsClosed` must all read `0`; `jobsFetched`/`jobsValid`/`jobsRejected` should reflect real fetched data.
6. Confirm no rows exist in `public.jobs` (`select count(*) from jobs;` should be unchanged before/after).

## 10. Controlled local-pilot instructions

1. Complete steps 1–2 above.
2. Set `mode` to `local_pilot` and confirm `maxJobsPerSource` is a small number (default 5 — 4 sources × 5 jobs = at most 20 rows written).
3. Run the Manual Trigger.
4. Inspect "Build Execution Summary" for `jobsCreated`/`jobsUpdated` and each `perSource` entry's `outcome`.
5. Re-run immediately afterward — `jobsCreated` should now read `0` and `jobsUnchanged` should match the prior `jobsCreated` count (idempotent retry, no duplicates).
6. To roll back: `delete from public.jobs where source_id in ('sr-qa-scale-ai','sr-sa-alpaca','sr-intl-wahed','sr-sa-salla');` (local dev database only).

## 11. Required credential names and environment variables

| Credential | Type | Used by |
|---|---|---|
| `Supabase Service Role` | n8n `supabaseApi` credential (already exists in this n8n instance, id `e6yCCcAVvt33iwAs`) | Fetch Source Provenance, Select Existing Jobs For Source, Upsert Jobs, Close Stale Jobs For Source |

No new credential needs to be created — the same one the CV Analysis Worker already uses. No environment variables are read directly by the workflow; `supabaseBaseUrl` is a plain field on the "Workflow Configuration" node (matching the CV Analysis Worker's own pattern).

## 12. Failure recovery

- **One source fails, others continue**: every fetch/upsert/close-stale HTTP node uses `onError: continueRegularOutput` — a thrown network error becomes a data value (`{error: "..."}`), not a halted execution. Verified structurally in `tests/workflow/job-ingestion-pilot-orchestrator.test.mjs`.
- **DB write fails** (Supabase unreachable mid-run): `Merge Upsert Result` detects the error and reports `outcome: "db_write_failed"` for that source without crashing the run; `jobsCreated/Updated/Unchanged` are correctly `0` for that source.
- **Stuck/partial runs**: this is a manual, single-shot pilot (no scheduled recurrence, no `automation_tasks` claiming) — there is no "stuck processing" state to recover from. Re-running the Manual Trigger is always safe (idempotent upsert).

## 13. How to add another source adapter

1. Verify the new source's public API directly (`curl`), confirm no auth/ToS/anti-bot bypass is involved.
2. Add `{ source_id, ats_type, feed_url }` to `Load Approved Pilot Sources`'s static list — the `source_id` **must** already exist in `company_sources` with `review_status='verified'` and `automation_eligibility='suitable_public_ats'` (re-checked live every run regardless).
3. Add a new case to `Route By ATS Type` and a paired `Fetch <ATS> Jobs` + `Classify & Normalize <ATS>` node, following the existing three as a template (status-code classification, HTML-strip, reject-if-missing-required-field, wire into the shared `dbWriteChain`).
4. If the new ATS's `source_type` isn't already in `public.jobs`'s check constraint, that is the "independently confirmed blocker" required before a schema migration — do not widen the constraint speculatively.
5. Add fixture-based tests mirroring the existing `Classify & Normalize <ATS>` test block in `tests/workflow/job-ingestion-pilot-orchestrator.test.mjs`.

## 14. How to import this workflow into another n8n environment

1. In the target n8n: **Settings → Credentials**, create a `Supabase` credential named exactly `Supabase Service Role` (service-role key, target project URL).
2. Import `n8n-workflows/job-ingestion-pilot-orchestrator.json` via the n8n UI (hamburger menu → Import from File) or `create_workflow_from_code` with the companion `.ts` file.
3. Attach the credential to the 4 HTTP nodes that need it (Fetch Source Provenance, Select Existing Jobs For Source, Upsert Jobs, Close Stale Jobs For Source).
4. Edit "Workflow Configuration"'s `supabaseBaseUrl` to the target environment's Supabase REST URL.
5. Leave `active: false` and run a `dry_run` first, in every environment, before ever considering `local_pilot`.

## 15. Future activation checklist

Do **not** activate this workflow or add a Schedule Trigger until, at minimum:

- [ ] A human has reviewed a `local_pilot` run's actual written rows for quality.
- [ ] Country/city resolution is decided (currently `NULL` by design — see §6).
- [ ] A real recurring-execution concurrency story is designed (this pilot's splitInBatches loop is single-execution only; a Schedule Trigger would need overlapping-execution handling, matching the CV Analysis Worker's own documented model).
- [ ] Cost/volume estimated for the target real source count (this pilot is 4 sources; the registry has 588).
- [ ] Monitoring/alerting exists for `sourcesFailed`, `jobsRejected` spikes, and `db_write_failed` outcomes.
- [ ] Rate limits are reconfirmed against each real target ATS's actual published limits (this pilot's 2s/source pacing is a conservative placeholder for 4 sources, not a researched per-provider limit).

## 16. Rollback / safe-disable instructions

- The workflow is created **inactive** and has no Schedule Trigger — there is nothing to "disable" by default.
- If it was ever manually activated: open it in n8n and toggle Active → Inactive.
- Any `local_pilot` test rows can be removed with: `delete from public.jobs where source_id in ('sr-qa-scale-ai','sr-sa-alpaca','sr-intl-wahed','sr-sa-salla');` — safe only in a local/dev database, never production, and never as a substitute for understanding why a row exists.

## 17. Browser autosave safety (MCP-driven workflow updates)

The n8n editor UI autosaves from its in-memory state. If a browser tab has this workflow (`35sOxBCRRazBX3T1`) open in the editor while an MCP tool call updates the workflow, the browser tab's next autosave can silently overwrite the MCP change with stale in-memory content — the MCP update appears to succeed but is invisibly reverted moments later.

Before any MCP-driven read or update of this workflow:

1. Confirm no browser tab is open on the workflow's editor URL (`http://localhost:5678/workflow/35sOxBCRRazBX3T1`).
2. If one is open, navigate it away (e.g. to the n8n Overview page) or close it — without saving or modifying the workflow from the browser first.
3. Do not reopen the editor tab on this workflow while an MCP update is in flight.
4. Only re-open the editor tab for human review after MCP-driven changes are complete.
