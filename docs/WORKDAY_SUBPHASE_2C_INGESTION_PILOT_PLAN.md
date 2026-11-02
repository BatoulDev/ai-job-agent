# Workday Sub-phase 2c — Isolated End-to-End Ingestion Pilot Plan

Status: **PROPOSED, NOT EXECUTED.** Written after Sub-phase 2b (isolated multi-job
validation, accepted) and the approved read-only live pilot (execution 318853,
accepted). This plan covers connecting that already-approved rawJobs payload
to the real local ingestion pipeline — fixture creation, DB writes, and
cleanup — and nothing beyond it. No HTTP requests, fixtures, workflow edits,
database writes, Workday enablement, commits, pushes, or deploys have been
made under this plan. Every numbered item below mirrors the user's own
numbering in the request that produced it.

## Grounding: what the codebase already proves, vs. what this plan adds

Read directly from source before writing this plan (not assumed):

- `src/lib/ingestion/providers/workday.ts` — real adapter, `mapWorkdayJob()`, maps a raw Murex job into the generic `RawProviderJob` shape. Already registered in `src/lib/ingestion/providers/index.ts` (`workday: (raw) => mapWorkdayJob(raw as WorkdayRawJob)`).
- `src/app/api/internal/ingestion/run-batch/parseIngestionBatchRequest.ts` — `"workday"` is **already** in `AUTOMATABLE_SOURCE_TYPES` (line 39), with a header comment explicitly dated to "Workday integration Phase 1" and explaining this alone cannot cause a live call.
- `src/lib/ingestion/deriveAtsFeedUrl.ts` — `WORKDAY_PATTERN` already derives the exact CXS JSON jobs endpoint from a company's `official_careers_url`, matching what the approved live pilot (execution 318853) independently confirmed by hand.
- `src/lib/ingestion/findEligibleCompanySources.ts` — `workday` already included in the eligible-source-type union.
- `src/lib/ingestion/ingestSourceBatch.ts` — `runIngestionBatch()` (the company-specific path Workday uses) **never calls `isProviderEnabled()`**. Only `runMultiCompanyIngestionBatch()` (used by RemoteOK/Jobicy/Bayt/... — feeds with no `company_sources` row) checks `providerConfig.ts`'s `enabled` flag. Workday's authorization gate is entirely `company_sources.review_status === 'verified'`, re-checked live every call (`verifySourceForIngestion`).
- `src/lib/ingestion/providerConfig.ts` — a `workday` entry already exists (`enabled: false`, `maxJobsPerRun: 50`, `kind: "company_specific"`). `clampToProviderCeiling()` still reads `maxJobsPerRun` from this entry regardless of `enabled`, so the 50-job ceiling applies to this pilot too (our 5-job sample is far under it).
- `src/lib/ingestion/rawProviderJob.ts` — fully generic validation (`validateRawProviderJob`) and mapping (`mapRawProviderJobToJobRow`) with no Workday-specific branching at all.
- `tests/db/ingestion-core-batch.test.mjs` and `tests/db/find-eligible-company-sources.test.mjs` — the established, already-reviewed pattern for a disposable `companies` + `company_sources` fixture, with `after()` cleanup and a direct (non-HTTP) call into `runIngestionBatch()`. This plan reuses that pattern exactly, substituting a Workday fixture for the existing Oracle HCM one.

**Conclusion that shapes the whole plan:** every piece of code this pilot needs already exists, is already generic/provider-agnostic, and has already been exercised by passing tests for other Tier-A providers. Sub-phase 2c adds **zero new application code** — it only adds one disposable fixture, one (or two) direct calls into `runIngestionBatch()`, and assertions. This is explicitly not a build task.

---

## 1. Connecting the verified rawJobs payload to the adapter + ingestion API

The 5 `rawJobs` objects already captured and approved from execution 318853
(`title`, `externalPath`, `locationsText`, `postedOn`, `bulletFields`,
`description`, `tenantSiteBaseUrl`) are **already in the exact
`WorkdayRawJob` shape** `providers/workday.ts`'s `mapWorkdayJob()` expects.

Proposed call path — direct function call, no HTTP hop, no dev server
required (mirrors `tests/db/ingestion-core-batch.test.mjs` exactly, not the
`route.ts` HTTP layer):

```
import { runIngestionBatch } from "../../src/lib/ingestion/ingestSourceBatch.ts";
import { mapWorkdayJob } from "../../src/lib/ingestion/providers/workday.ts";

const mapped = capturedRawJobs.map(mapWorkdayJob); // -> RawProviderJob[]
const result = await runIngestionBatch(
  adminClient,
  fixtureSourceId,
  "workday",
  mapped,
  { maxJobsPerSource: 5, dryRun: true /* then false, separately approved */, paginationIncomplete: true }
);
```

This exercises the identical code path `route.ts` would use in production
(`mapRawJobsWithAdapter` → `runIngestionBatch`), just without needing the
Next.js dev server or `INGESTION_WORKER_SECRET` running — a smaller, safer
surface for an isolated pilot. Going through the actual HTTP route is
possible as a later, separate step if the user specifically wants the full
network-layer path proven too; not proposed as part of this plan.

**No re-fetch from Murex is needed or proposed.** This phase re-uses the
already-approved, already-captured 5-job payload. (See §9 for why this drops
the external request budget to zero.)

## 2. providerConfig.ts changes

**None needed, and none proposed.** `workday.enabled` stays `false`
throughout this entire pilot. Confirmed directly from `ingestSourceBatch.ts`:
`runIngestionBatch()` has no call to `isProviderEnabled()` anywhere in its
body or in `persistValidatedJobs()` — that check only exists in
`runMultiCompanyIngestionBatch()`, which Workday never uses. The only
`providerConfig.ts` read on this path is `clampToProviderCeiling()`'s
`maxJobsPerRun` lookup, which works identically whether `enabled` is `true`
or `false`. Workday remains globally disabled for every other code path
(the real orchestrator, any future scheduled run) exactly as it is today.

## 3. Disposable, uniquely identified fixture `company_sources`

Exact precedent: `tests/db/ingestion-core-batch.test.mjs`'s
`createFixtureSource()` and `tests/db/find-eligible-company-sources.test.mjs`'s
Oracle HCM fixture. Proposed Workday fixture, same shape:

```
const suffix = randomUUID().slice(0, 8);
fixtureCompanyId = `cc-workday-fixture-${suffix}`;
fixtureSourceId  = `sr-workday-fixture-${suffix}`;

companies.insert({ id: fixtureCompanyId, display_name: `Workday Pilot Fixture ${suffix}` });

company_sources.insert({
  id: fixtureSourceId,
  company_id: fixtureCompanyId,
  company_name: `Workday Pilot Fixture ${suffix} (Murex, disposable test only)`,
  target_country: "International",          // non-blocking metadata only — see note below
  ats_provider: "Workday",
  official_careers_url: "https://murex.wd3.myworkdayjobs.com/MurexCareerPage1", // real, confirmed tenant — traceable, not fabricated
  review_status: "verified",                 // required for runIngestionBatch to proceed at all
  automation_eligibility: "suitable_public_ats",
});
```

- Both ids are random-suffixed and prefixed `fixture` — cannot collide with
  any of the 588 real registry rows (none use this prefix).
- `review_status: "verified"` is the **only** thing that authorizes the
  write — re-checked live by `verifySourceForIngestion()` on every call,
  never cached.
- `company_name` self-describes as a disposable fixture, so if anyone sees
  it transiently in a query during the pilot window it is unambiguous.
- `target_country: "International"` is stored but not read by any gating
  logic in `ingestSourceBatch.ts` or `rawProviderJob.ts` — purely
  descriptive metadata on this row, like the Oracle HCM fixture's own
  `target_country: "Lebanon"`.

## 4. Guaranteeing the existing 852 jobs stay untouched

Architectural guarantee, not just a promise:

- Every upsert and every stale-close read/update in `persistValidatedJobs()`
  is filtered through `identityScopeQuery`/`refreshScopeQuery`, which for a
  company-specific call always adds `.eq("source_id", fixtureSourceId)`.
  It is structurally impossible for this call to read, update, or close any
  row whose `source_id` is not `fixtureSourceId` — including all 852
  existing jobs, none of which can ever carry this freshly-generated id.
- Procedural guarantee on top of the architectural one: a `count(*) FROM
  jobs` baseline is taken **before** the fixture is even created, and
  re-checked after every step (dry run, real write, cleanup) in §6 below.
- `dryRun: true` is run first, as a zero-write rehearsal, before `dryRun:
  false` is even considered — and `dryRun: false` is its own separate
  approval checkpoint (§10).

## 5. Preventing stale-close given the 5-of-74 partial sample

`persistValidatedJobs()`'s own truncation rule:

```
const truncated = deduped.length > options.maxJobsPerSource || options.paginationIncomplete === true;
...
if (!truncated) { /* stale-close runs here */ }
```

This pilot passes **both** `maxJobsPerSource: 5` (matching the real sample
size exactly) **and** `paginationIncomplete: true` (matching Murex's real
`total: 74`) — either one alone already forces `truncated = true`, so the
`if (!truncated)` stale-close block is skipped entirely. `jobsClosed` is
`0` by construction. The pass/fail gate explicitly asserts
`result.truncated === true` and `result.jobsClosed === 0` rather than just
trusting the inputs — this is the same mechanism already proven correct in
Sub-phase 2b's offline test suite and in `tests/db/
ingestion-oracle-hcm-pagination-incomplete.test.mjs` /
`ingestion-gulftalent-pagination-incomplete.test.mjs` for other providers.

## 6. Exact expected database writes, cleanup, and before/after assertions

**Expected writes, in order:**

| Step | companies | company_sources | jobs |
|---|---|---|---|
| Fixture creation | +1 | +1 | 0 |
| Dry run (`dryRun:true`) | 0 | 0 | **0** |
| Real run (`dryRun:false`, separately approved) | 0 | 0 | **+5** (5 created, 0 updated, 0 closed) |
| Optional idempotency re-run (same 5 jobs again) | 0 | 0 | **0 net** (0 created, 5 updated) |
| Cleanup | −1 | −1 | **−5** (or −0 if dry-run-only was approved) |

**Before/after assertions (every one is a real query, not an assumption):**

1. Before fixture creation: `SELECT count(*) FROM jobs` → must equal **852**.
2. Before fixture creation: `SELECT count(*) FROM jobs WHERE source_id = fixtureSourceId` → must equal **0**.
3. After dry run: `count(*) FROM jobs` → still **852**; `result.outcome === "succeeded"`, `result.jobsValid === 5`, `result.jobsCreated === 0`.
4. After real run (if/when separately approved): `count(*) FROM jobs` → **857**; `count(*) FROM jobs WHERE source_id = fixtureSourceId` → **5**; `result.jobsCreated === 5`, `result.jobsUpdated === 0`, `result.jobsClosed === 0`, `result.truncated === true`, `result.outcome === "succeeded"`.
5. After an optional idempotency re-run: `count(*) FROM jobs` unchanged at **857**; `result.jobsCreated === 0`, `result.jobsUpdated === 5`.
6. After cleanup: `count(*) FROM jobs` → back to exactly **852**. This is the real proof the fixture left nothing behind — not "we issued delete statements."

**Cleanup strategy** (mirrors `tests/db/ingestion-core-batch.test.mjs`'s `after()` exactly, FK-safe ordering):

```
DELETE FROM jobs WHERE source_id = fixtureSourceId;        -- jobs FK's into company_sources
DELETE FROM company_sources WHERE id = fixtureSourceId;
DELETE FROM companies WHERE id = fixtureCompanyId;
```

Each delete's error is checked and thrown loudly on failure (never a silent
no-op), matching the existing precedent file's own cleanup discipline.

## 7. Verifying title, company, location, description, externalId, applicationUrl, dedup

Per written row (all 5), assert against the real captured values from
execution 318853:

- **title** — exact string match (e.g. `"Risk Consultant"`).
- **company_name** — equals the fixture's own `company_name`, confirming `mapRawProviderJobToJobRow`'s `context.companyName` fallback is used (Workday's adapter deliberately leaves `raw.companyName` undefined — this is the company-specific path, not the multi-company-feed path).
- **location** / **country_code** / **city** / **remote_scope** — whatever `normalizeLocation()` actually resolves for each real `locationsText` ("Hô Chi Minh", "Santiago", "Paris") — reported as observed, not assumed in advance. If any resolves to `locationConfidence: "low"`, that row's `status` will correctly be `pending_review` rather than `active` — the plan explicitly checks and reports actual status per row rather than asserting all 5 are `active`.
- **description** — non-null, non-empty, and matches the real captured text exactly (hash-compared against the payload already captured and approved in the live-pilot report).
- **external_id** — equals `bulletFields[0]` per `extractRequisitionId()` (e.g. `"JR103358"`).
- **application_url** — equals `tenantSiteBaseUrl + externalPath` (the public Murex apply page, e.g. `https://murex.wd3.myworkdayjobs.com/MurexCareerPage1/job/Santiago/Risk-Consultant_JR103358`) — explicitly asserted as **distinct** from the CXS JSON detail-fetch URL used earlier to retrieve the description, re-confirming the separation the live pilot already verified, now at the database-row level.
- **dedup_scope** (generated column) — equals `'src:' || fixtureSourceId` for every row; `source_type === 'workday'`; `source_id === fixtureSourceId`.
- **Deduplication** — proven two ways: (a) the idempotency re-run in §6 (same 5 jobs twice → second call updates, never duplicates); (b) optionally, one deliberately duplicated `externalId` inside a single call's `rawJobs` array, to exercise `persistValidatedJobs`'s own in-batch de-dup (`Array.from(new Map(validated.map(row => [row.external_id, row])))`) and confirm no Postgres "ON CONFLICT DO UPDATE... a second time" error.

## 8. Handling partial failures; guaranteeing cleanup even on failure

- Structured as a `node:test` file (not an ad hoc script), with fixture
  creation in a `test()`/`before()` block and deletion in `after()` —
  `node:test`'s `after()` runs even when an assertion inside the test throws,
  exactly like the existing precedent file.
- Because `truncated` is forced `true` by construction (§5), the
  `partial_stale_close_failed` outcome **cannot occur** in this pilot at all
  — that code path only runs when `!truncated`. This removes one entire
  failure mode by design, not by hope.
- The only other possible failure is the `jobs.upsert()` call itself
  throwing (e.g. a real DB error) — in that case at most 5 rows are
  partially written. The same `DELETE FROM jobs WHERE source_id =
  fixtureSourceId` cleanup step removes however many (0–5) actually
  committed, with no special-casing needed.
- Runs under the existing `localTestGuard.mjs` triple-check (localhost-only
  host, `LOCAL_TEST_DB_MARKER` tripwire, confirmed `ai-job-agent` schema) —
  the same guard every other DB test in this repo already runs under —
  making it structurally impossible to point this pilot at a non-local or
  non-test database.
- Backstop: `scripts/db-test-crash-recovery-sweep.mjs`'s existing
  `reportStaleFixtures()` sweep already scans for orphaned fixture rows by
  naming convention; a `fixture`-prefixed id this pilot creates is exactly
  the kind of row that sweep is built to catch if a crash ever skipped the
  `after()` cleanup.

## 9. External request budget and required workflow modifications

**Zero new external HTTP requests, zero workflow modifications.**

This phase reuses the already-approved, already-captured 5-job rawJobs
payload from execution 318853 against the **local** ingestion code
(`runIngestionBatch`) and **local** Supabase — no call leaves the machine at
all. The isolated n8n workflow `RE8C4ZYmurlTlVL6` is not touched or executed
again this phase; it already did its job in Sub-phase 2b/the live pilot.

*Explicit option, not proposed by default:* if the user instead wants
Sub-phase 2c to prove freshness with a **fresh** live re-fetch rather than
reusing the approved sample, that would add the same bounded budget as
before — 1 list `POST` + ≤5 detail `GET`s, 6 requests total, no retries —
using the workflow exactly as it already stands (no further edits needed,
since the Sub-phase-2b-approved node changes are still in place). This is
called out as a question for the user to decide, not assumed.

## 10. Approval checkpoints before every live execution and database write

| Checkpoint | What's being approved |
|---|---|
| A | The exact fixture insert payload (companies + company_sources rows) shown in §3, before it is created |
| B | Running `dryRun: true` (zero DB writes expected) and reviewing its result |
| C | **Separately**, running `dryRun: false` (the actual 5-row write) — never bundled with B |
| D (optional) | The idempotency re-run / in-batch-duplicate test, if the user wants that extra proof |
| Final | Reviewing the full before/after report, then running cleanup and the final `count(*) === 852` verification |

Cleanup itself (the `DELETE`s in §6) is proposed as pre-authorized and
automatic (via `after()`) once any write has happened — leaving a disposable
test fixture behind is a larger risk than deleting it — but the exact rows
deleted are still reported afterward for visibility, and nothing beyond
checkpoints A–D ever touches the database.

---

## Risks

- **Fixture id collision** — mitigated by a random UUID suffix plus a
  `fixture`-only prefix never used by any of the 588 real registry rows.
- **Cleanup fails partway** (e.g. jobs deleted, company_sources delete
  fails) — mitigated by strict FK-safe delete ordering, throw-on-error
  (never silently swallowed), and the independent crash-recovery sweep as a
  second safety net.
- **Unexpected location classification** — one or more of the 3 real
  locations (Hô Chi Minh, Santiago, Paris) could resolve to
  `locationConfidence: "low"` and land as `pending_review` rather than
  `active`. Not a bug if it happens — `normalizeLocation()` is shared,
  already-tested, provider-agnostic logic — but the plan reports actual
  per-row status rather than assuming all 5 land `active`.
- **Real employer content briefly in the local DB** — the 5 real Murex job
  descriptions (already captured and approved in the live-pilot report) would
  briefly exist as rows in the local dev database between the real-write
  checkpoint and cleanup. Same exposure profile as any other already-approved
  local pilot in this project's history; named here for completeness, not
  because it's a new risk this plan introduces.
- **Scope-leak risk is already independently covered** — `source_id`-scoped
  upsert/stale-close correctness for this exact code path is already proven
  by the existing, already-passing `tests/db/ingestion-core-batch.test.mjs`
  and `tests/db/jobs-ingestion-identity.test.mjs` for other providers.
  Workday runs through the identical generic path with zero
  provider-specific branching in `ingestSourceBatch.ts` — this isn't a new
  risk being asserted for the first time.

## Rollback procedure

1. **Primary**: the `after()` cleanup block (§6) — `jobs` → `company_sources`
   → `companies`, scoped by the exact fixture ids, run automatically whether
   the pilot's assertions passed or failed.
2. **Verification, not assumption**: a final `SELECT count(*) FROM jobs`
   must equal exactly **852** — the real proof cleanup succeeded.
3. **If cleanup itself fails**: re-run
   `DELETE FROM jobs WHERE source_id LIKE 'sr-workday-fixture-%'`, then the
   matching `company_sources`/`companies` deletes by the same `LIKE`
   pattern — safe, since no real registry row ever uses this prefix — or
   invoke the existing `scripts/db-test-crash-recovery-sweep.mjs` sweep,
   which is already built to find and remove orphaned fixtures by this
   exact naming convention.
4. No migration, schema change, or commit is ever part of this rollback —
   purely `DELETE` statements against the local Supabase instance.

---

**Stopping here, as requested. Nothing above has been executed — no HTTP
requests, no fixtures created, no workflow edits, no database writes, no
Workday enablement, no commit. Waiting for approval before any checkpoint.**
