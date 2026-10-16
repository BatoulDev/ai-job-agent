# Lebanon Live Source Expansion (Phase 21)

Branch: `phase/21-live-provider-validation`, forked from `main` @ `6d9ce78`
(Phase 20's Source Recommendation Gate merged). This document is the
real, evidence-based record of live provider validation, implementation,
n8n integration, real ingestion, idempotency, and matching-handoff proof
for Bayt, GulfTalent, and Indeed — the three providers Phase 20's gate
recommended for a first bounded benchmark.

Credential used for every paid call this phase: **"AI Job Guide -
Apify"** (`httpHeaderAuth`, id `Is83Aa0IsbzXDbCP`) — a new, more
restricted token than Phase 19/20's original "Apify Api Token"
credential, manually attached by the founder partway through this phase.

---

## 1. Bayt — live benchmark

**Actor**: `blackfalcondata/bayt-scraper`. Reconfirmed pricing ($0.99/1k
results), input schema, and output schema fresh this phase before
spending anything (Task in Step 6).

Three real, bounded runs:

| Run | Query | Requested | Returned | Cost |
|---|---|---|---|---|
| 1 | `country:LB`, keyword filter `"internship OR graduate OR junior OR entry level"` | 10 | **1** | ~$0.001 |
| 2 | `country:LB`, no keyword | 10 | 10 | ~$0.01 |
| 3 | `country:LB`, no keyword | 25 | 25 | ~$0.025 |

**Real finding**: the actor's `query` field does not support boolean
`OR` syntax as free text — it degraded to 1 near-irrelevant aggregated
result. A plain, unfiltered `country:LB` query returned a healthy,
fresh, real Lebanon job stream instead (all 25 real jobs from Run 3 were
already a superset of Run 2's 10 — same top-of-list, sorted by
recency). Real total distinct sample: **25 real Lebanon jobs**.

**Real schema drift found and fixed** (`src/lib/ingestion/providers/bayt.ts`):
- `employmentType`'s real value is `"Full time"` (lowercase "t"), not
  `"Full Time"` — silently nulled every real employment type until
  fixed. Both spellings are now mapped.
- Real titles can contain raw HTML entities (e.g. `"Playground &amp;
  Host Cashier"`) — `title` now runs through the same `stripHtml()`
  already used for `description`.
- `careerLevel` real values observed: `"Unspecified"`, `"Mid career"`,
  `"Entry level"`, `"Senior executive"`, `"Management"`. Mapped only the
  unambiguous three (`entry-level`, `mid-level`, `senior`) to
  `seniority` — `"Unspecified"` and `"Management"` stay unmapped
  (AGENTS.md §30: no guessing).

**Idempotency proof**: the same real job (`"Research Intern"` at
Carnegie Middle East Center) had the exact same `jobId` hash across two
independent runs 5 minutes apart — the dedup/idempotency assumption
holds for real data.

**Data quality (25 real Lebanon jobs)**:
- 0 duplicates (25 unique `jobId`)
- 2 real internships (`"Research Intern"`, `"Communications Intern"`,
  both Carnegie Middle East Center)
- 1 `"Entry level"`, 2 `"Mid career"`, 1 `"Senior executive"`, rest
  `"Unspecified"` career level
- **Real data-quality risk**: `company` was `"Jobs for Humanity"` (a
  diversity-hiring redistribution partner) on one aggregated
  (`isAggregated:true`) posting whose actual description was clearly for
  a different real employer (Infoquest) — for aggregated Bayt postings,
  `company` can reflect the reposting service, not the real employer.
  Not fixed (no safe extraction rule exists without guessing); flagged
  here for future awareness.
- `applyUrl` present in only 3/25 (12%) — the other 88% correctly fall
  back to the listing page (`url`), same non-bug pattern already
  documented for RemoteOK.
- All 25 dated 2026-09-17 through 2026-09-28 (today) — genuinely fresh.

**Cost this phase**: ~$0.036 total. **Status: LIVE, `enabled:true`.**

---

## 2. Indeed — live benchmark (new adapter)

**Actor**: `curious_coder/indeed-scraper`, $0.10/1k results + a small
monthly platform fee. No existing adapter — built this phase from real
observed output (`src/lib/ingestion/providers/indeed.ts`), not from
documentation alone.

**Critical zero-cost finding**: `country:"lb"` was rejected outright by
the actor's own input validation — a 400 before the actor started (no
charge). The real allowed `country` enum is: ar, au, at, bh, be, br, ca,
cl, cn, co, cr, cz, dk, ec, eg, fi, fr, de, gr, hk, hu, in, id, ie, il,
it, jp, **kw, lu, my, mx, ma, nl, nz, ng, no, om**, pk, pa, pe, ph, pl,
pt, **qa**, ro, **sa**, sg, za, kr, es, se, ch, tw, th, tr, ua, **ae**,
uk, us, uy, ve, vn — **no Lebanon at all**. Indeed can only ever serve
the Gulf tier for this project.

Re-ran against `country:"ae"`, `location:"Dubai"`, 10 results — real,
successful.

**Real schema** (very different from documentation): raw fields include
`id` (not `jobId`), `companyDetails.name` (nested, not top-level
`company`), `location` (a rich nested object with `countryCode`,
`countryName`, `city`, `formatted.long`), `jobTypes` (an **array**, not
a single string — a job can list several simultaneously),
`originalApplyUrl`, `jobDescription`/`jobDescriptionHTML`, `pubDate`
(epoch ms).

**Real applyUrl provenance finding**: `originalApplyUrl` in all 10 real
samples pointed to Indeed's own domain (`ae.indeed.com/job/...`), not an
employer ATS — despite the field name implying an original/employer
link. All 10 samples had `jobSourceName:"Indeed"` (Indeed-native
postings, for which Indeed genuinely is the original source) — a
legitimate, not broken, application destination, the same category as
most Bayt jobs falling back to the listing page.

**Data quality (10 real UAE jobs)**: 8/10 had a real company name
(`companyDetails.name`), 2/10 `null` (anonymous/confidential postings) —
correctly rejected by validation (`missing_company_name`). No remote/
work-arrangement field exists anywhere in the real schema —
`providerWorkArrangement` stays `null` always, never inferred.

**Real gap found and fixed**: `MULTI_COMPANY_SOURCE_TYPES`, the
route-level allowlist in
`src/app/api/internal/ingestion/run-multi-company-batch/parseMultiCompanyIngestionBatchRequest.ts`,
did not include `"indeed"` at all — every real Indeed request would
have 400'd even with the provider enabled. Fixed. A second real gap:
`public.jobs.source_type_check` also didn't allow `'indeed'` — caught by
a real constraint violation during the real-ingestion proof (§5) and
fixed with an additive migration
(`supabase/migrations/20260930100000_add_indeed_source_type.sql`).

**Cost this phase**: ~$0.001 (10 items, well under a cent — cheapest
provider tested). **Status: LIVE, `enabled:true`, Gulf only.**

---

## 3. GulfTalent — live benchmark

**Actor**: `blackfalcondata/gulftalent-scraper`. Reconfirmed pricing
($0.70/1k + $0.005/run-start + $0.0007/record) and schema fresh.

Two real markets tested:

| Market | Query | Requested | Returned | Notes |
|---|---|---|---|---|
| Saudi Arabia | `country:SA`, no location | 10 | 10 | Worked without a location hint |
| UAE | `country:AE`, no location | 10 | **0** | Real 0-result finding |
| UAE (retry) | `country:AE`, `location:"Dubai"` | 10 | 10 | Location hint required for this market |

**Real, operational finding**: unlike Saudi Arabia, UAE returned zero
results with no `location` hint — a `location` string appears necessary
for at least some GulfTalent markets. Documented for the next phase's
Qatar/Kuwait runs.

**Real schema drift found and fixed**
(`src/lib/ingestion/providers/gulftalent.ts`):
- The seniority field is really named `seniorityId` — a bare numeric
  code (1, 2, 4, 6 observed), not the assumed `seniority` free-text
  field. No published legend for the codes exists, so `seniority` stays
  unmapped (AGENTS.md §30) — captured for future reference if GulfTalent
  ever documents the meanings.
- A real `isRemote` boolean field **does exist** (1/10 real Saudi jobs
  had `isRemote:true`) — the prior assumption that no remote signal
  exists at all was wrong. Now mapped, same conservative pattern as
  Bayt (`false`/absent → `null`, never `"onsite"`).

**Data quality (20 real Gulf jobs)**: 0 duplicates (20 unique
`jobId`) — including two real, distinct "Secretary to the CEO" postings
at the same company (RTC-1 Employment Services, Dubai) with different
`jobKey`/`applyUrl` — a genuine double-posting, not a dedup bug.
`applyUrl` present in **100%** of real jobs (20/20), including one
genuine third-party ATS link
(`career4.successfactors.com/sfcareer/jobreqcareerpvt?...`, Bechtel) —
the best apply-link provenance observed of any Apify-sourced provider
this project has tested.

**Markets corrected**: `providerConfig.ts`'s `gulftalent.markets` no
longer lists `"lebanon"` — Phase 20 already confirmed live that the
actor's real `country` input enum has no Lebanon option (AE/SA/QA/KW/
BH/OM only); Gulf-only is the accurate scope.

**Cost this phase**: ~$0.02. **Status: LIVE, `enabled:true`, Gulf only.**

---

## 4. Cross-provider comparison and duplicates

Real, direct comparison in the one market both GulfTalent and Indeed
were tested against (Dubai, UAE): **17 real jobs, 0 overlap** — every
title/company pair distinct across both providers. Combined with Bayt's
Lebanon-only sample (no geographic overlap with the Gulf-only providers
this phase), the real combined dataset (53 jobs) has **zero true
cross-provider duplicates** — the two apparent title+company collisions
found were both *within* the same provider (two distinct real postings
at the same company, not a dedup failure).

**Known architectural risk, unchanged from Phase 20**: deduplication is
scoped per `source_type` (`dedup_scope = 'type:<provider>'`), not by job
content across providers. This phase's real data happens not to exercise
that risk (no market overlap yet between Bayt and the Gulf-only
providers), but once GulfTalent/Indeed both grow their market coverage
overlap will become real. No fuzzy cross-provider dedup was implemented
this phase — not evidenced as necessary yet, and AGENTS.md's "avoid
aggressive fuzzy dedup" applies. Flagged for a future phase once real
overlapping-market data actually shows collisions.

---

## 5. Real ingestion, idempotency, and matching handoff

Run directly against the real local Supabase instance (the same one
every `test:db` suite uses), using the REAL vendor-raw payloads captured
from this phase's live benchmarks, mapped through the real adapters —
not synthetic fixtures.

### Real ingestion result

| Provider | Fetched | Valid | Rejected | Created |
|---|---|---|---|---|
| Bayt | 25 | 25 | 0 | 25 |
| GulfTalent | 20 | 20 | 0 | 20 |
| Indeed | 10 | 8 | 2 (`missing_company_name`) | 8 |
| **Total** | **55** | **53** | **2** | **53** |

### Idempotency proof

The exact same batches were re-submitted immediately after. Real result
for all three providers: `jobsCreated: 0`, `jobsUpdated` exactly equal
to the original `jobsCreated` count (25/20/8) — no duplicate rows, no
duplicate `external_id`, stable across two independent runs.

### Real DB state (53 persisted jobs)

| Provider | Rows | Unique ext_id | Lebanon | Known country | Known city | Known work_arrangement | Internship | Valid apply path | Companies |
|---|---|---|---|---|---|---|---|---|---|
| Bayt | 25 | 25 | 25 | 25/25 | 19/25 | 2/25 | 2 | 25/25 | 16 |
| GulfTalent | 20 | 20 | 0 | 20/20 | 18/20 | 1/20 | 0 | 20/20 | 12 |
| Indeed | 8 | 8 | 0 | 8/8 | 7/8 | 0/8 | 0 | 8/8 | 7 |

All 53 rows landed `status: active` (none `pending_review`) — location
confidence resolved cleanly for every real row.

### Matching handoff — the one real, significant finding this phase

Using the real, already-proven `checkJobEligibility()` +
`deriveEligibilityLocation()` bridge (`src/lib/matching/shortlist.ts`'s
own dependency) against these 53 real persisted rows:

| Plan | Eligible |
|---|---|
| Student (Lebanon) | 2/53 |
| Pro, relocation YES (Gulf + Lebanon) | 2/53 |
| Pro, relocation NO (remote-only outside Lebanon) | 2/53 |

Ineligible breakdown (identical across all three plans): **50/53
`work_arrangement_unknown`**, 1/53 `remote_scope_excludes_lebanon`.

**This is not a bug.** `checkJobEligibility()` hard-rejects any job
whose `work_arrangement` is `null`, before any plan-specific logic runs
— by design, per AGENTS.md §30 (never invent). None of the three new
adapters ever infer `"onsite"` from the mere absence of a remote signal,
because real Bayt/GulfTalent/Indeed data has no explicit onsite/hybrid
field at all — only an occasional `isRemote:true`. The 2 eligible jobs
are the 2 real Bayt Lebanon jobs with `isRemote:true` (immediately
eligible via `country_code === "LB"`); the 1 `remote_scope_excludes_lebanon`
job is GulfTalent's one real remote posting (Saudi-based, no resolvable
Lebanon-inclusive scope).

This is architecturally identical to Phase 17's honest finding for real
Oracle/AUBMC Lebanon jobs (0% initially eligible for the same reason).
**Real-world Gulf/Lebanon job-board postings are overwhelmingly implicit
office/onsite roles that never state "onsite" explicitly** — the
pipeline correctly refuses to guess rather than silently admitting
wrong data.

**RESOLVED (Phase 21 follow-up)**: the founder decision was made —
missing work-arrangement metadata alone must never reject an otherwise
eligible job. Implemented in `checkJobEligibility.ts` with an explicit
match/conflict/unknown model (never inferring onsite/hybrid/remote from
location). Full rule, rationale, and implementation pointers now live in
`docs/PRODUCT_MATCHING_RULES.md` "Work arrangement" — the durable,
central reference going forward; this section stays as the original
evidence record.

---

## 6. n8n integration

Workflow: **AI Job Agent / 01 Job Ingestion** (`I8WYkMfYCKug5ky4`).
Remains `active: false` throughout — inactive, manual-trigger-only, per
this phase's explicit requirement.

Added a new, fully isolated branch (10 new nodes, 49 → 59 total),
touching zero existing nodes' internals — provider isolation, per the
skill's requirement:

```
Workflow Configuration
  → Apify Multi-Company Source Seeds   [static seed list: Bayt-Lebanon,
       GulfTalent-SA, GulfTalent-AE, Indeed-AE — the real markets
       benchmarked this phase]
  → Split Out Apify Sources
  → Loop Apify Sources (Rate Limited)
    → Call Apify Actor                  [POST, credential-bound]
    → Aggregate Apify Jobs              [Apify returns a bare array,
                                          same auto-split as Lever]
    → Call Apify Batch Endpoint         [POST /run-multi-company-batch,
                                          separate node from the Tier D
                                          branch's own — different
                                          $('Split Out ...') ancestor]
    → Build Apify Success/Failure Result
    → Record Apify Source Result
    → Apify Rate Limit Delay → loop back
```

Not wired: Qatar/Kuwait markets (not yet benchmarked), and any node for
LinkedIn (explicitly prohibited this phase).

**Process note**: this branch was built live via the n8n MCP first, then
the repository's portable source
(`n8n-workflows/ai-job-agent-01-job-ingestion.ts` and its compiled
`.json`) was updated to match — the reverse of this project's own
documented `docs/n8n-workflow-change-process.md` order (repo source
first, then push to live). Reconciled before this phase's commit: the
repo `.ts`/`.json` now exactly mirror the live workflow (verified
node-for-node, zero content drift in the 49 pre-existing nodes).
Flagging this honestly rather than silently following the correct order
after the fact.

**One remaining manual step**: both new HTTP Request nodes ("Call Apify
Actor", "Call Apify Batch Endpoint") need their credential bound
manually in the n8n UI — "AI Job Guide - Apify" and "Ingestion Worker
Secret" respectively. Programmatic credential binding via the n8n MCP's
`setNodeCredential`/`addNode` is a confirmed, reproducible tool
limitation (fails identically for `httpHeaderAuth` and `httpBearerAuth`
on `n8n-nodes-base.httpRequest`, reported separately) — not a project or
credential issue. The real ingestion proof in §5 was run directly
against the TypeScript pipeline (the same local Supabase every DB test
already uses) to avoid blocking on this one UI click; the n8n branch
itself is structurally complete, validated (`get_workflow_details`
connections confirmed), and ready to execute the moment the credentials
are bound.

---

## 7. Cost ledger

| Provider | Runs | Items requested | Items returned | Cost |
|---|---|---|---|---|
| Bayt | 3 | 45 | 36 | ~$0.036 |
| GulfTalent | 3 | 30 | 20 | ~$0.02 |
| Indeed | 2 | 20 | 10 (1 rejected input, $0 cost) | ~$0.001 |
| LinkedIn (bebity, research — see §8 and `docs/LINKEDIN_JOB_DISCOVERY_RESEARCH.md`) | 1 (aborted) | 10 | 978 (before abort) | **$1.4671** |
| **Total** | 9 | 105 | 1,044 | **~$1.524** |

**Cost anomaly, real and reported honestly**: the LinkedIn run is the
one place cost behaved abnormally this phase — the requested `maxItems:
10` did not bound the real actor (its real run configuration shows
`maxItems: 6619`), and the run was still active when checked ~3.5
minutes in, at $1.39 and climbing. It was aborted immediately per this
phase's own "STOP if cost behaves unexpectedly" rule; final cost locked
at $1.4671 for 978 real items. Full root-cause and remediation
recommendation in `docs/LINKEDIN_JOB_DISCOVERY_RESEARCH.md`. Every
Bayt/GulfTalent/Indeed call, by contrast, matched its estimated cost
within expected bounds.

Remaining Apify credit was not directly queryable this phase
(`/v2/users/me/limits` returned a 403 — the restricted token's scope
doesn't include account-info reads). Given the LinkedIn overrun, actual
remaining credit is now materially lower than the ~$0.06 originally
budgeted implied — **recommend the founder check the real remaining
balance directly in the Apify console** before authorizing further paid
benchmarks.

---

## 8. LinkedIn bebity research

> **Policy update (2026-10-09)**: AGENTS.md §7/§35 now permits guarded
> LinkedIn job discovery/ingestion under strict conditions (see §35 for
> the full list). The two real findings below are preserved exactly as
> discovered — neither is erased or softened. Of the two, the
> **Easy-Apply finding's disqualifying weight is superseded by an
> explicit Easy-Apply product decision the same day**: a LinkedIn Easy
> Apply job is now accepted provided a valid canonical public LinkedIn
> URL exists (AGENTS.md §35 rule 7) — the user still always applies
> manually, never via automated Easy Apply. The **cost-control finding
> is not superseded** and remains the real evidence bar any future
> LinkedIn attempt must clear before spending.

See `docs/LINKEDIN_JOB_DISCOVERY_RESEARCH.md` for the full research
output, including a real cost incident (§7). Research only — never
connected to production ingestion, never persisted to the `jobs` table,
no LinkedIn account automation of any kind.

**Headline findings**: a real 15-item free sample (from the 978 items
actually produced before the run was aborted) showed **100% of real
Lebanon LinkedIn postings were LinkedIn Easy-Apply-only** — no external
employer link, which this project's application flow cannot use.
Combined with the cost-control failure, this **revises bebity's status
down from Phase 20's "TEST FIRST" to HOLD** pending a properly-bounded,
larger sample. 12 real employers discovered (MultiBank Group, MCI,
Capital Partners Holding, Sarah's Bag, Kronfol Homes, CMA CGM, Transmed,
Valutico, Bold Lighting, Le Gray, SEVEN, RidgePoint) — zero overlap with
the 53 real Bayt/GulfTalent/Indeed jobs ingested this phase.

---

## 9. Tests

- `npx tsc --noEmit`: clean
- `npm run lint`: clean
- `npm run test:unit`: 666/666 (added Indeed adapter tests, Bayt/
  GulfTalent real-finding tests, provider-config/route-allowlist
  updates for the newly-enabled providers)
- `npm run test:db`: real writes proven for Bayt/GulfTalent/Indeed once
  enabled (replacing the now-superseded Phase 19 disabled-provider guard
  tests for these three; the generic `jsearch` guard still proves the
  same fail-closed mechanism for providers that remain disabled)
- `npm run build`: see final report

---

## 10. Remaining gaps

- **LinkedIn cost-control lesson** (§7/§8) — always confirm an actor's
  real bounding parameter name via a free schema fetch before any paid
  call, not just for the well-established Bayt/GulfTalent/Indeed
  actors. Apply this to every new actor family, not only new providers.
- ~~**Work-arrangement inference** (§5)~~ — **RESOLVED**, see the founder decision note in §5 and `docs/PRODUCT_MATCHING_RULES.md`.
- **Work-arrangement inference** (§5, historical) — the single most impactful
  remaining gap: 50/53 real jobs ineligible for any plan due to
  `work_arrangement_unknown`. Needs a founder decision, not more code.
- Qatar and Kuwait not yet live-benchmarked for GulfTalent/Indeed (only
  Saudi Arabia + UAE this phase).
- n8n credential binding (§6) — one manual UI step remaining before the
  new branch can actually execute.
- Bayt's real `company` field can reflect a reposting aggregator rather
  than the true employer for `isAggregated:true` postings — no safe fix
  identified, flagged for awareness only.
- GulfTalent's `seniorityId` numeric codes remain unmapped — no
  published legend found.
- Cross-provider fuzzy dedup — not implemented, not yet evidenced as
  necessary (§4); revisit once Bayt/GulfTalent/Indeed markets actually
  overlap in production data.

## 11. LinkedIn Lebanon pilot — production adapter build (dated, post-policy-change)

Following the 2026-10-09 AGENTS.md §35 policy change (§8 above), this
phase built the actual centralized LinkedIn adapter
(`src/lib/ingestion/providers/linkedin.ts`) and ran the one bounded,
free-schema-first pilot call that policy requires before trusting any
cost bound.

**Free schema reconfirmation (no cost)**: `GET
/v2/acts/bebity~linkedin-jobs-scraper` and its latest build's input
schema, fetched live before any paid call. This is the real root-cause
finding the §8 incident was missing: **the actor's own input has no
`maxItems` field at all** — the real per-search bounding field is
`rows` (default `0` = unbounded). `maxItems`/`maxTotalChargeUsd` are
platform-level **run options** (query/body fields on the Run Actor
call itself, confirmed via `defaultRunOptions` in the actor metadata),
not actor input — sending `maxItems` inside the input JSON (as the §8
incident did) is silently ignored by the actor while the platform never
sees it as a run option either. The pricing model is also no longer the
flat-rate plan assumed earlier — it is `PAY_PER_EVENT`: a one-time
actor-start charge plus ~$0.001-0.0015 per job result on the free tier
(cheaper on paid tiers).

**Real, bounded paid run**: `rows: 10`, `locations: ["Lebanon"]`,
`companyProfile: false`, `enrichCompany: false` as input, with
`maxItems=10&maxTotalChargeUsd=0.05&timeout=150` as run options (the
real financial backstop). Completed in 10s, exactly 10 items returned,
**$0.0001** billed — no overrun, `maxTotalChargeUsd` never triggered.

**Real schema (10/10 real Lebanon jobs)**: fields are `id`, `title`,
`companyName`, `companyUrl`, `companyId`, `location`, `description`,
`descriptionHtml`, `contractType`, `experienceLevel`, `workType`,
`applyType` (`EASY_APPLY` | `EXTERNAL`), `applyUrl`, `jobUrl`,
`publishedAt`, `postedTime`, `salary`, `sector`, `jobFunction`,
`posterFullName`, `posterProfileUrl`, `scrapingInfo`.

- `workType` was an **empty string on 10/10** real rows — confirms the
  earlier free-sample finding exactly; `classifyWorkArrangementFromText`
  is wired into the adapter as a fallback (never primary) for this
  reason. 3/9 valid rows got a real high-confidence fallback
  classification (all `"remote"`, from explicit title/description
  evidence — e.g. "Remote Call Center Representative"); 6/9 stayed
  unknown (`null`), never guessed.
- `applyType` was `EASY_APPLY` on 7/10 and **EXTERNAL on 3/10** — a real,
  non-trivial external-link share, unlike the earlier 15-item free
  sample's 100% Easy-Apply finding (same actor, different query/sample).
  2 of those 3 EXTERNAL rows had an **empty `applyUrl`** despite the
  non-Easy-Apply `applyType` — a real schema quirk. `jobUrl` (always a
  real `*.linkedin.com/jobs/view/...` canonical link in every sample,
  including those two) is therefore always the application-target
  fallback, exactly as AGENTS.md §35 rule 7 anticipates.
- 1/10 rows had an empty `companyName` ("Execution Trader") — correctly
  rejected by the existing `missing_company_name` rule, the same
  pattern already proven for Bayt/Indeed.
- `contractType` was `"Full-time"` on 10/10 in this small sample — no
  part-time/contract/internship observed yet to confirm those mappings
  live.

**Pipeline metrics (real data, through the actual production
map→validate→upsert-row functions, not a simulation)**:

| | |
|---|---|
| TOTAL_RETURNED | 10 |
| VALID_JOBS | 9 |
| REJECTED_MALFORMED | 1 (`missing_company_name`) |
| DUPLICATES | 0 (10/10 unique `id`) |
| NEW_UNIQUE | 9 |

Field completeness (over the 9 valid rows, as persisted `JobUpsertRow`
shape): TITLE 100%, COMPANY 100%, LOCATION 100%, DESCRIPTION 100%,
EMPLOYMENT_TYPE 100% (all real `"Full-time"` → `full-time`),
WORK_ARRANGEMENT_DIRECT 0/9, WORK_ARRANGEMENT_FALLBACK 3/9,
WORK_ARRANGEMENT_UNKNOWN 6/9, LINKEDIN_URL (`source_url`) 100%,
POSTED_DATE 100%. `application_method` was `external_link` for all 9
(the jobUrl/applyUrl fallback chain never left a row without a target).

**Cost ledger addition**: $0.0001 for this phase's one real LinkedIn
run (10 items, 10 seconds) — on top of the §7 total, giving a project
cost-to-date of **~$1.524**.

**Status: adapter implemented and registered
(`providers/index.ts`/`providerConfig.ts`), `enabled: false`, markets
`["lebanon"]` only.** This one bounded run is a real schema/cost
confirmation, not the larger documented pilot review AGENTS.md §35 rule
10 requires before flipping `enabled: true` — that remains a founder
decision, not a default outcome of this build.

## 12. LinkedIn Lebanon final validation (30-item sample, founder review gate)

Second, larger bounded run following §11's 10-item pilot — the explicit
final-validation phase before asking the founder to review and approve
production enablement (AGENTS.md §35 rule 10). Same free-schema-first
discipline re-confirmed before spending: the actor's build was
byte-identical to §11's (same `buildId`, same pricing model), so the
10-item pilot's schema/billing findings (`rows` is the real per-search
cap; `maxItems`/`maxTotalChargeUsd` are platform run options, not actor
input) still hold without needing a second 137KB schema re-fetch.

**Real, bounded run**: `rows: 30`, `locations: ["Lebanon"]`,
`companyProfile: false`, `enrichCompany: false`, run options
`maxItems=30&maxTotalChargeUsd=0.15&timeout=180`. Completed in well
under the timeout, **exactly 30 items returned, $0.0076 billed** — no
overrun, cap never triggered.

### Geographic validation (the critical new check this phase added)

Real risk identified and tested for: towns also named "Lebanon" outside
the country (Pennsylvania, Tennessee, Ohio, New Hampshire). Probing the
shared `normalizeLocation.ts` directly found a genuine, pre-existing gap
— a spelled-out `"...United States"` suffix was already caught by the
existing multi-region ambiguity logic (two competing country matches →
null/low-confidence), but a bare `"Lebanon, Pennsylvania"` / `"Lebanon,
Tennessee"` / `"Lebanon, Ohio"` / `"Lebanon, New Hampshire"` (no
`"United States"` suffix) wrongly resolved to `countryCode: "LB"`,
medium confidence. **Fixed at the root** (not duplicated per-provider):
added the four full state names as `US` aliases in
`normalizeLocation.ts`'s `KNOWN_COUNTRIES` table — the same mechanism
that already defends the "United States" case. Deliberately did **not**
add bare 2-letter abbreviations (PA/TN/OH/NH): naive substring matching
would make `"oh"` collide with real city names like `"Doha"`, which
would wrongly tag `"Doha, Qatar"` as ambiguous. This leaves a documented,
narrow residual gap (a bare abbreviation with no full state name and no
"United States" suffix) — never observed in any real LinkedIn sample
(40 real jobs across both pilots), since LinkedIn's own location
breadcrumb consistently spells out the full region/country name. Full
regression suite re-run after the fix: all 807 unit tests still pass,
including Doha/Qatar and every other provider's existing location
fixtures — zero regressions.

Applied to all 30 real jobs: **30/30 confirmed Lebanon-country** (every
`location` string carried a real Lebanese governorate — Beirut, Mount
Lebanon, Keserwan-Jbeil — or resolved to bare `"Lebanon"`), **0
ambiguous, 0 non-Lebanon**. No false positive occurred in this sample,
but the fix is real and independently verified via the US-state test
cases above, not just "no bad data happened to appear."

### Real schema (30/30 real Lebanon jobs) — same shape as §11, more data

- `workType` empty on **40/40** real jobs across both pilots now —
  confirms this is a stable provider/query characteristic, not sampling
  noise. `classifyWorkArrangementFromText` fallback: **11/29 valid jobs**
  got a real, evidence-backed classification this run (vs. 3/9 in the
  smaller pilot) — all high or medium confidence, all with a real quoted
  evidence phrase (e.g. "Remote Work-at-Home", "hybrid approach, with
  teams in the office around four days a week"). 18/29 stayed unknown —
  never guessed.
- `applyType`: EASY_APPLY 16/30, EXTERNAL 14/30 — a healthier external-
  link share than §11's smaller sample, with real diverse employer ATS
  destinations (BairesDev, Y Combinator, L'Oréal, iCIMS, SmartRecruiters,
  Accor, BambooHR, Greenhouse ×2, a hospital's own careers page, Nexans,
  VML).
- `contractType` was **"Full-time" on 30/30** — still no real
  part-time/contract/internship/temporary sample to confirm those
  mappings live; the adapter's mapping table stays as documented
  (Temporary/Volunteer deliberately unmapped, AGENTS.md §30).
- 1/30 rows had an empty `companyName` (the same real "Execution Trader"
  posting from §11, reappearing with a stable external id) — correctly
  rejected by `missing_company_name`. The real public LinkedIn page for
  this posting displays `"CONFIDENTIAL."` as a literal company-name
  placeholder (confirmed via manual page check below) — a provider
  extraction gap on an already-ambiguous posting, not a pipeline bug.

### Manual public-page verification (12 real jobs checked, no login/cookies)

Fetched each job's public LinkedIn URL directly (plain HTTP, no browser
session, no authentication) and compared title/company/location/
employment-type/work-arrangement/description/posted-date against the
provider's extracted data. Mix covered: remote (MCI ×2), hybrid (Execution
Trader, WPP Media ×2, VML), unknown-arrangement (L'Oréal, MGallery, Saint
George Hospital, OLX Lebanon, Khatib & Alami, Nexans, Horecons),
Easy Apply and External apply types, and seven distinct Lebanon
regions/cities (Beirut, Dekwaneh, Ghazir, Nahr Ibrahim, Rmeil, plus two
bare-country postings).

**Result: 10 MATCH, 2 PARTIAL_MATCH, 0 MISMATCH, 0 UNVERIFIABLE.**

- Work-arrangement fidelity was perfect on every checked job, including
  three real hybrid/remote evidence phrases that matched the classifier's
  extracted evidence **word-for-word** against the live page.
- The 2 partial matches: (1) the "Execution Trader" page shows
  `"CONFIDENTIAL."` as a company name the provider's `companyName` field
  left empty (see above); (2) two WPP Media listings' scraped `title`
  carries extra boilerplate (`"WPP Media: <role>, Lebanon"`) that the
  real on-page title doesn't include (`"<role>"` alone) — same real role,
  cosmetically verbose title, not a wrong value, not a matching-quality
  problem.

### Pipeline metrics (real data, through the actual production functions)

| | |
|---|---|
| TOTAL_RETURNED | 30 |
| VALID_JOBS | 29 |
| REJECTED_MALFORMED | 1 (`missing_company_name`) |
| CONFIRMED_LEBANON | 30 |
| AMBIGUOUS_LOCATION | 0 |
| NON_LEBANON | 0 |
| DUPLICATES (within this run) | 0 (30/30 unique external ids) |
| Cross-run overlap with §11's 10-item pilot | 10/10 (100% — every §11 job reappeared with the identical external id) |
| NEW_UNIQUE (vs. §11) | 20 |

Field completeness (29 valid rows): TITLE/COMPANY/LOCATION/DESCRIPTION/
EMPLOYMENT_TYPE/LINKEDIN_URL/POSTED_DATE all 100%.
WORK_ARRANGEMENT_DIRECT 0/29, WORK_ARRANGEMENT_FALLBACK 11/29,
WORK_ARRANGEMENT_UNKNOWN 18/29.

### Test-DB persistence, dedup, and matching proof (new this phase)

§11 never actually proved a DB write — this phase does, without
flipping `providerConfig.ts`'s `linkedin.enabled` to `true`.
`persistValidatedJobs` (the shared idempotent-upsert/stale-close core
`runIngestionBatch`/`runMultiCompanyIngestionBatch` both call) is now
exported specifically for this: a controlled, real-shaped 5-job subset
is mapped through the real adapter, validated, and persisted directly
into the local test database (`tests/db/linkedin-pilot-persistence.test.mjs`).
Proven for real, not asserted:

- All 5 rows persist with `source_type:'linkedin'`,
  `dedup_scope:'type:linkedin'`, correct `country_code`/`city`,
  `employment_type:'full-time'`, the right `work_arrangement` per job
  (`remote`/`hybrid`/`null` — never guessed), and a non-null
  `application_url` even for the real EXTERNAL-with-empty-`applyUrl`
  case (jobUrl fallback, AGENTS.md §35 rule 7).
- Re-ingesting the identical batch is idempotent: `jobsCreated:0`,
  `jobsUpdated:5`, row count unchanged.
- A dedicated test proves dedup identity is `external_id`, never the
  URL: the same id re-ingested with a differently-decorated tracking
  URL (`?trk=...`) updates the one existing row, never inserts a second.
- `checkJobEligibility()`/`deriveEligibilityLocation()` — the same
  bridge already proven for Bayt/GulfTalent/Indeed (§5) — handles these
  real LinkedIn rows identically: a Lebanon remote job is eligible for a
  Free-plan Lebanon user; an unknown-work-arrangement Lebanon job is
  *not* falsely rejected; a known work-arrangement conflict (onsite-only
  user vs. a hybrid job) and a known employment-type conflict
  (part-time-only user vs. a full-time job) both still correctly
  reject; a Pro remote-worldwide user still sees an onsite-Lebanon job.
  Synthetic test inputs only — no real users, no real CVs, no database
  rows created for the "users" side of this check.

All fixtures created by this phase's DB tests were deleted and verified
removed by the test run itself (`tests/db/helpers.mjs`'s
`deleteFakeJobs`) — no production rows touched, no unrelated jobs
closed.

### Status

**Adapter, config, and shared-code geography fix all implemented and
tested. `linkedin.enabled` stays `false`, markets stay `["lebanon"]`
only.** Two independent live pilots (10 then 30 items, $0.0001 +
$0.0076 = $0.0077 total LinkedIn spend across both) plus a manual
12-job public-page fidelity check and a real test-DB persistence/dedup/
matching proof now exist. Production enablement remains a founder
decision per AGENTS.md §35 rule 10 — not a default outcome of this
phase.

## Next recommended phase

Once the founder decides the work-arrangement question (§5), a focused
phase to (a) bind the two remaining n8n credentials, (b) extend
GulfTalent/Indeed to Qatar and Kuwait, and (c) re-run the matching
handoff proof against the (hopefully much larger) eligible set.

Separately, once the founder reviews §11-12's LinkedIn pilot evidence
(including the 12-job manual link-by-link comparison) and explicitly
approves production enablement (AGENTS.md §35 rule 10): flip
`enabled: true` in `providerConfig.ts`, wire an n8n branch mirroring the
existing Apify Source Seeds pattern, and run a larger (still bounded)
sample before trusting volume/duplication-rate claims beyond this
30-item run.
