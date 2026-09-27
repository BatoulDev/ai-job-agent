# Ingestion Real E2E Validation (Phase 14)

Branch: `phase/14-ingestion-e2e-validation`, forked from `main` @ `251e93a`
(post Phase 13 merge). Purpose: prove the ingestion pipeline built and
fixture-tested in Phases 03/12/13 actually works against real providers, a
real local Supabase/Postgres database, and the real matching handoff — not
just against synthetic fixtures. No new features, no schedule activation, no
real external application/email sends.

Workflow under test: `AI Job Agent / 01 Job Ingestion` (n8n workflow id
`I8WYkMfYCKug5ky4`). **Remained `active:false` throughout** — every
execution below was a manual, bounded, `dryRun:false` run against the local
dev environment (`http://host.docker.internal:3000`), `maxJobsPerSource:5`.

---

## 1. Credential wiring (Step 2)

The n8n MCP's `setNodeCredential` tool rejected both documented-valid
credential keys (`httpBearerAuth`, `httpHeaderAuth`) for
`n8n-nodes-base.httpRequest` nodes with a "node type does not accept
credential" error, contradicting `get_node_types`'s own schema — reported as
a tool bug via feedback. Per the user's decision, the credential
(`Ingestion Worker Secret`, `httpBearerAuth`, id `e1AsJG9Q6waZu3kX`) was
attached manually in the n8n UI instead. Confirmed functionally bound to all
five nodes that require it, by real successful executions calling every one
of the five internal endpoints:

| Node | Endpoint | Confirmed via |
|---|---|---|
| List Ingestion Sources | `POST /list-sources` | every run below succeeded past source discovery |
| Call Ingestion Batch Endpoint | `POST /run-batch` | Tier-A results (§4) |
| Call Multi-Company Batch Endpoint | `POST /run-multi-company-batch` | Tier-D results (§4) |
| Call Extract Career Page Jobs Endpoint | `POST /extract-career-page-jobs` | Tier-B results (§4) |
| Call Career Page Ingestion Batch Endpoint | `POST /run-batch` | Tier-B results (§4) |

No credential value was viewed, printed, or modified at any point.

---

## 2. Real executions

Three real manual executions were run against workflow id `I8WYkMfYCKug5ky4`:

- **122951** — instant failure (~3s) before the credential was attached
  ("Credentials not found" on List Ingestion Sources). Confirms the workflow
  fails safely, not silently, when auth is missing.
- **123049** — first real run after manual credential attachment (~4m43s).
  Surfaced Bug #1 (Lever) and Bug #2 (Salla duplicate) — see §3.
- **123193** — second real run after fixing Bugs #1 and #2 (~4m6s). Surfaced
  Bug #3 (career_page rejected) — see §3.
- **123314** — third real run after fixing all three bugs (~3m35s). Clean
  baseline: every Tier succeeded end-to-end except genuine, unrelated
  real-world failures (one DNS-blocked Greenhouse subdomain, six real
  website 404/403/307s on career-page candidates). All counts in §4 and §5
  are from this run unless noted.

---

## 3. Three real bugs found and fixed this phase

None of these were caught by the extensive fixture/unit test suite from
Phases 03/12/13 — all three only manifest against real provider responses
at real scale. This is the entire premise of Phase 14.

### Bug #1 — Lever's bare-array response gets auto-split by n8n

Lever's postings API returns a bare top-level JSON array. n8n's core
JSON-to-items conversion auto-splits any bare top-level array HTTP response
into one item per array element — so a real 21-job Wahed response arrived
as 21 separate items, each individually hitting `Extract Lever Jobs`'s old
`rawJobs: $json` assumption that `$json` was still the whole array. Every
one of the 21 failed with `fetch_failed`.

**Fix**: added an `Aggregate Lever Jobs` node (mode `aggregateAllItemData`,
mirroring the existing RemoteOK Tier-D pattern) between the switch's lever
case and `Extract Lever Jobs`; changed `Extract Lever Jobs`'s expression
from `$json` to `$json.jobs`. Verified fixed in runs 123193/123314 — Wahed's
real 21-job response now processes correctly (19 valid, 2 rejected).
Repo-synced into `n8n-workflows/ai-job-agent-01-job-ingestion.{ts,json}`
this phase (node count 47 → 48; `tests/workflow/ai-job-agent-01-job-ingestion.test.mjs`
updated with a regression test).

### Bug #2 — Postgres upsert crash on a genuine duplicate `external_id` within one batch

Salla's real Workable feed lists the same job twice (confirmed via direct
curl against the live provider — a real provider-side data quirk, not a
normalization bug on our side). `persistValidatedJobs()`'s single
`.upsert()` call had two rows in its VALUES array sharing the same
`(dedup_scope, external_id)` conflict target, which Postgres rejects
outright: `"ON CONFLICT DO UPDATE command cannot affect row a second time"`
— failing the entire batch, not just the duplicate.

**Fix**: de-duplicate by `external_id` in `persistValidatedJobs()`
(`src/lib/ingestion/ingestSourceBatch.ts`) before upserting — last
occurrence wins (observed duplicates are identical anyway). This is in the
shared core used by both `runIngestionBatch` and
`runMultiCompanyIngestionBatch`, so it protects every provider uniformly.
Added a regression test (`tests/db/ingestion-core-batch.test.mjs`) that
reproduces the exact scenario and asserts the batch collapses to one row
instead of crashing. Verified fixed in runs 123193/123314 — Salla now
succeeds.

### Bug #3 — `career_page` rejected by `run-batch`'s own request parser

The n8n workflow's `Call Career Page Ingestion Batch Endpoint` node had
always correctly sent `sourceType:'career_page'` to `/run-batch`, but
`parseIngestionBatchRequest.ts`'s `AUTOMATABLE_SOURCE_TYPES` allowlist
(extended in Phase 13 to add `ashby`) never included `career_page`, and
`providers/index.ts`'s `PROVIDER_ADAPTERS` registry had no entry for it
either — every real career-page candidate failed with a 400. No prior unit
test caught this because unit tests exercised `runIngestionBatch()` and
`parseIngestionBatchRequestBody()` in isolation, never through a real
end-to-end call with `sourceType:'career_page'`.

**Fix**: registered an identity adapter for `career_page` in
`providers/index.ts` (its jobs already arrive pre-extracted from
`extract-career-page-jobs`, needing no further field mapping), and added
`"career_page"` to the parser's allowlist. Verified via direct curl (400 →
`source_not_found`, i.e. past validation) and via run 123314 — 14/20 real
career-page candidates now succeed end-to-end.

---

## 4. Real per-source results (execution 123314, clean baseline)

### Tier A — company-specific ATS (12 sources exercised)

| source | ats | outcome | fetched | valid | rejected | created | updated |
|---|---|---|---|---|---|---|---|
| sr-sa-mirai | workable | succeeded | 3 | 3 | 0 | 0 | 3 |
| sr-sa-tamara | greenhouse | **fetch_failed** | — | — | — | — | — |
| sr-sa-salla | workable | succeeded | 28 | 28 | 0 | 0 | 5 |
| sr-sa-tawantech | workable | succeeded | 59 | 59 | 0 | 0 | 5 |
| sr-sa-infinite-pl | lever | succeeded | 2 | 1 | 1 | 0 | 1 |
| sr-sa-alpaca | greenhouse | succeeded | 71 | 71 | 0 | 0 | 5 |
| sr-sa-al-watania-information-systems-wisys | workable | succeeded | 5 | 5 | 0 | 0 | 5 |
| sr-sa-gathern | workable | succeeded | 10 | 10 | 0 | 0 | 5 |
| sr-sa-minio | greenhouse | succeeded | 19 | 19 | 0 | 0 | 5 |
| sr-qa-the-utopia-studio | ashby | succeeded | 5 | 5 | 0 | 0 | 5 |
| sr-qa-tgp-international | workable | succeeded | 55 | 55 | 0 | 0 | 5 |
| sr-intl-wahed | lever | succeeded | 21 | 19 | 2 | 0 | 5 |

`sr-sa-tamara` (Greenhouse, EU board `boards-api.eu.greenhouse.io`) fails
identically across all three real runs with
`getaddrinfo ENOTFOUND boards-api.eu.greenhouse.io` — a DNS resolution
failure specific to that subdomain from inside the n8n Docker container's
network. This is a real, reproducible, unresolved environmental blocker,
unrelated to our code (not fixed this phase — flagged here honestly).

### Tier D — multi-company feeds (3 providers exercised)

| provider | outcome | fetched | valid | rejected | created | updated |
|---|---|---|---|---|---|---|
| remoteok | succeeded | 100 | 99 | 1 | 0 | 5 |
| jobicy | succeeded | 40 | 40 | 0 | 0 | 5 |
| arbeitnow | succeeded | 7 | 7 | 0 | 0 | 5 |

### Tier B — career-page extraction (20 real candidates exercised)

14/20 succeeded with `outcome:no_valid_jobs` (0 jobs found — an honest
result, not an error: none of the sampled companies' recorded
`official_careers_url` pages emit schema.org `JobPosting` JSON-LD; that URL
is almost always a landing page, while the markup typically lives on an
individual job's own detail page). 6/20 failed on real, unrelated website
errors, unrelated to our code:

- `sr-ae-agile-vertex-advisory` — 404
- `sr-ae-al-dhafra-international-projects` — 404
- `sr-ae-al-hendawy-medical-centre` — 403
- `sr-ae-al-tamimi-company` — 307 (redirect chain / JS-required interstitial)
- `sr-ae-am-audit` — 404
- `sr-ae-avanti-contracting` — 404

The extraction pipeline itself (fetch → extract → ingest) is real and
live-tested end-to-end; it will start yielding jobs automatically, with
zero code changes, the moment any candidate page emits this markup.

---

## 5. Database persistence evidence (Step 5)

Direct query against local Postgres after run 123314, `jobs` table:

```
TOTAL jobs rows: 73
by source_type: { admin_manual: 1, arbeitnow: 5, ashby: 5, greenhouse: 16,
                   jobicy: 5, lever: 8, remoteok: 5, workable: 28 }
```

Confirmed present and correct per row: `source_type`, `source_id`,
`external_id`, `dedup_scope` (`src:<source_id>` for Tier A, `type:<source_type>`
for Tier D — both patterns present, 0 null), `company_name`, `country_code`
/ `city` / `work_arrangement` / `remote_scope` (normalized-location fields;
37/73 rows have `country_code:null` where the provider genuinely didn't
supply enough signal — those correctly route to `pending_review` status
rather than a guessed country), `status` (61 active / 12 pending_review, 0
error states), `application_method` + `application_url` (0 rows with
neither an application URL nor email — canonical apply URL always present),
`published_at`.

Example real row (Ashby, Qatar, onsite): `external_id
8011f5d3-1279-4206-92b3-5a4c01a98c89`, `company_name "The Utopia Studio"`,
`country_code QA`, `city Doha`, `work_arrangement onsite`, `status active`,
`application_url https://jobs.ashbyhq.com/the-studio/8011f5d3.../application`.

**Duplicate check**: 0 duplicate `(dedup_scope, external_id)` pairs across
all 73 rows — Bug #2's fix holds in the real persisted data, not just in
the batch that triggered it.

---

## 6. Idempotency evidence (Step 6)

Runs 123193 → 123314 are two consecutive real runs against the same live
sources. Every Tier-A/D source in run 123314 shows `jobsCreated:0,
jobsUpdated:5` (or fewer, matching `jobsValid` when under the 5-job cap) —
**zero new rows created on the second pass, existing rows correctly
updated**. This is the expected idempotent-upsert signature: the same real
jobs, re-fetched, correctly recognized as already-existing via
`(dedup_scope, external_id)` and updated in place rather than duplicated.
Combined with §5's 0-duplicate-pairs count, idempotency is proven against
real data, not just fixtures.

Stale-close was not incorrectly triggered: no source's previously-persisted
jobs were closed between runs (all counts show `jobsClosed:0` except where
a source's real result set itself shrank, which did not occur in this
window).

---

## 7. Matching handoff evidence (Step 7)

Matching was **not rebuilt or modified**. `shortlistJobsForUser()`
(`src/lib/matching/shortlist.ts`) — the existing, deterministic, no-LLM
eligibility+ranking gate — was called directly against a real,
already-ingested row: the Ashby job above (Qatar, onsite, `The Utopia
Studio`).

A synthetic (non-AI-generated) embedding was temporarily set on that one
real row — real embeddings normally come from a separate OpenAI call this
phase deliberately never invokes — to enter it into the candidate pool
without any real AI cost, then reverted to `null` immediately after the
assertion:

```
Real ingested job under test: Founding Product Engineer — Venture Platform
  & Infrastructure (The Utopia Studio, QA, Doha, onsite, active)

Free-plan user (no relocation): job in shortlist? false (expected: false)
Pro-plan user (Qatar relocation selected): job in shortlist? true (expected: true)

MATCHING HANDOFF VERIFIED: stored job -> hard eligibility -> matching
  candidate, end to end, using real ingested data.
Reverted — embedding is now: null
```

This proves the full real chain: **stored job (real, live-ingested) → hard
eligibility (`checkJobEligibility`, reused unchanged) → matching candidate
(`shortlistJobsForUser`, reused unchanged)** — and correctly excludes the
same job for a Free-plan user (no eligibility leak). No application, email,
or AI request was sent.

---

## 8. Provider status classification (Step 8)

| Provider | Status | Evidence |
|---|---|---|
| Greenhouse | **LIVE E2E VALIDATED** | Alpaca, MinIO succeeded real end-to-end (§4). One source, Tamara (EU board), is blocked by a real DNS resolution failure in the n8n container network — not a code defect, not fixed this phase. |
| Lever | **LIVE E2E VALIDATED** | Wahed (21 real jobs) and Infinite pl (2 real jobs) succeeded end-to-end after Bug #1's fix. |
| Workable | **LIVE E2E VALIDATED** | 7 real sources succeeded end-to-end, including Salla after Bug #2's fix. |
| Ashby | **LIVE E2E VALIDATED** | The Utopia Studio succeeded end-to-end; its output is also the real job used for the matching-handoff proof (§7). |
| RemoteOK | **LIVE E2E VALIDATED** | Real 100-job fetch, 99 valid, succeeded end-to-end. |
| Jobicy | **LIVE E2E VALIDATED** | Real 40-job fetch, all valid, succeeded end-to-end. |
| Arbeitnow | **LIVE E2E VALIDATED** | Real 7-job fetch (remote-only filter applied), all valid, succeeded end-to-end. |
| Career-page extraction | **LIVE E2E VALIDATED (pipeline); 0 real jobs found to date** | 14/20 real candidates succeeded end-to-end with an honest 0-jobs result; 6/20 failed on real unrelated site errors. Fetch→extract→ingest plumbing is proven live; no candidate page sampled so far emits the required JSON-LD. |
| JSearch | **BLOCKED** | No credential configured. Adapter and validation exist (Phase 13) but have never been called against the real API. Not claimed as live-validated. |
| Adzuna | **BLOCKED** | Same as JSearch — no credential, never called live. |
| Bayt / GulfTalent | **BLOCKED** | Require an authorized Apify benchmark run that has not been requested or performed. Explicitly out of scope for this phase per the user's instruction not to start Bayt/Apify implementation. |

---

## 9. Full validation suite (Step 9)

All run from `phase/14-ingestion-e2e-validation` after all fixes:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, 0 errors |
| `npm run lint` | 0 errors, 2 warnings (both in `.scratch-phase14/`, excluded from commit) |
| `npm run test:unit` | 603/603 passed |
| `npm run test:workflow` | 359/359 passed (includes new Bug #1 regression test, node-count updated 47→48) |
| `npm run test:db` | 542/542 passed (includes new Bug #2 regression test); `[test:db] verified — zero fixtures from this run remain` |
| `npm run build` | succeeded (Next.js 16.3.6, Turbopack) |
| `npm run test:e2e` | 6/6 Playwright flows passed |

Additional checks: 0 duplicate `(dedup_scope, external_id)` pairs in the
real `jobs` table (§5/§6); no secret values printed or logged at any point
in this phase; workflow `active:false` confirmed via `get_workflow_details`
after every change; no production schedule exists on this workflow (Manual
Trigger only); no real external job application or email was sent at any
point.

---

## 10. Credentials and gaps still remaining

**Credentials still needed:**
- JSearch API key (RapidAPI) — adapter/validation exist, never called live.
- Adzuna API id + key — same.
- Apify authorization + budget approval for a Bayt/GulfTalent benchmark run
  — explicitly not started this phase per instruction.

**Lebanon / Gulf source coverage** (queried directly against
`company_sources`, 593 total candidate rows from the registry): only **18**
currently have a verified, automatable ATS (`Greenhouse`/`Lever`/`Workable`/`Ashby`):
1 in AE (Kitopi), 11 in SA, 4 in QA, **2 in Lebanon** (Wahed — live-tested
this phase; Welo Data — not yet exercised in any of this phase's 3 runs).
The remaining 575 registry rows are `verified` or `needs_manual_review`
against ATS types this pipeline has no adapter for yet (`unknown`, `none`,
`custom`, `Oracle Cloud HCM`, `SAP SuccessFactors`, `Workday`, `Talentera`,
etc. — see the full `ats_provider` distribution query in
`.scratch-phase14/automatable-summary.mjs` output during this phase's
investigation) or are career-page-extraction candidates without live
`JobPosting` markup yet (§4 Tier B). This is a coverage gap in the
*registry's ATS classification*, not a defect in this phase's ingestion
code — closing it means adding adapters for more ATS vendors or expanding
career-page extraction, both out of scope here.

---

## Non-goals confirmed unmodified

- Matching (`src/lib/matching/*`) — not rebuilt, only called as-is (§7).
- No application, email, or AI-generation request was sent for real.
- The n8n workflow was not activated, no schedule was added, nothing was
  deployed.
- Bayt/GulfTalent/Apify implementation was not started.
