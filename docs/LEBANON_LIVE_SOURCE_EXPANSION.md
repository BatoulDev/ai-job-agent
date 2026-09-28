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

**Recommended for the founder's decision, not implemented here**:
whether to treat "no remote signal, from a provider whose postings are
known to be overwhelmingly onsite roles" as a deliberate, documented
`onsite` default specifically for Bayt/GulfTalent/Indeed — a real
product/business decision, not a code-correctness question, and
explicitly out of scope for this phase to decide unilaterally.

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
- **Work-arrangement inference** (§5) — the single most impactful
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

## Next recommended phase

Once the founder decides the work-arrangement question (§5), a focused
phase to (a) bind the two remaining n8n credentials, (b) extend
GulfTalent/Indeed to Qatar and Kuwait, and (c) re-run the matching
handoff proof against the (hopefully much larger) eligible set.
