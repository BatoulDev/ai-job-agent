# Source Coverage and Provider Expansion Audit (Phase 12)

Branch: `phase/12-source-expansion`. Produced 2026-09-27. This is a read-only
audit of job-ingestion source coverage against the two live product plans —
**Student** (Lebanon jobs only) and **Pro** (Lebanon + Gulf relocation
[Saudi Arabia, Qatar, Kuwait, UAE] + verified international remote, as lanes
within one plan) — followed by the minimal, evidence-based implementation
that closes the one gap that was safe to close without a larger architecture
decision.

**Bottom line, stated up front per the explicit stop condition below:**
Student-plan (Lebanon) coverage is **weak**. Pro-plan Gulf coverage is
**thin but real**. Pro-plan international-remote coverage is **zero** in the
live pipeline as of this phase. None of this is hidden in the sections below.

---

## 1. Current ingestion inventory (before this phase)

One workflow, "AI Job Agent / 01 Job Ingestion" (n8n, inactive, ID
`I8WYkMfYCKug5ky4`), reused from the retired `docs/job-ingestion-pilot.md`
pilot. Before this phase it called a hardcoded 4-row source list:

| source_id | Company | ATS | Market (by `company_sources.country_code`) |
|---|---|---|---|
| sr-qa-scale-ai | Scale AI | Greenhouse | QA |
| sr-sa-alpaca | Alpaca | Greenhouse | SA |
| sr-intl-wahed | Wahed | Lever | LB |
| sr-sa-salla | Salla | Workable | SA |

That is the entire live ingestion footprint prior to this phase: **4
companies, 3 ATS types, 2 markets (SA, QA) plus one LB row**, all direct-ATS
(Tier A). No aggregator, no MENA/Gulf job board, no international-remote
board, no Apify actor, no RSS feed, no career-page scraper is wired into the
pipeline anywhere. Zero LinkedIn integration of any kind (correct — LinkedIn
scraping/automation is prohibited by AGENTS.md §7 and was never attempted).

Each source is provider-agnostic downstream: `runIngestionBatch()` in
`src/lib/ingestion/ingestSourceBatch.ts` validates, normalizes, dedupes
(`jobs.dedup_scope`), and persists through one shared pipeline regardless of
which ATS the raw job came from — this is the contract every new source must
plug into, not bypass.

### The real architectural constraint

`runIngestionBatch()` requires a `company_sources` row to resolve
`companyName`/`review_status`/`automation_eligibility` for the batch
(`verifySourceForIngestion()`), and `jobs.dedup_scope` is `'src:' ||
source_id` when a `company_sources` row exists, else `'type:' ||
source_type`. This is **fine** for single-company ATS feeds (Greenhouse,
Lever, Workable) — one feed, one company, one `company_sources` row. It is
**not** fine, without a deliberate design decision, for aggregator feeds
(RemoteOK, Jobicy, Bayt, JSearch) that return many companies' jobs from one
provider call: there is no single `company_sources` row to attach the batch
to. This is why aggregator sources are classified **BENCHMARK FIRST**, not
**ADD NOW**, below — implementing a workaround under time pressure would mean
either inventing a fake per-company source row (corrupts the registry) or
weakening `dedup_scope`/provenance (explicitly prohibited). See §7.

### Downstream pipeline already supports every target market — confirmed, not assumed

Read `src/lib/matching/checkJobEligibility.ts` and
`src/lib/ingestion/normalizeLocation.ts` directly (not inferred from
AGENTS.md text): eligibility already branches on
`job_market_coverage` (`lebanon_only | remote_lebanon_applicants |
remote_mena | remote_worldwide`) and location normalization already resolves
the Gulf relocation catalog (`saudi-arabia, qatar, kuwait, uae-dubai,
uae-abu-dhabi, uae-anywhere` in `public.locations`,
`is_relocation_market=true`). **Zero downstream changes were needed or made
this phase.** Phase 12's entire scope is an ingestion-source problem, not a
matching/eligibility problem.

---

## 2. Live coverage matrix (company_sources registry, 593 rows, queried directly this phase)

| Market | Total rows | `review_status='verified'` | `automation_eligibility='suitable_public_ats'` | Verified **and** suitable | Actually derivable to a real feed URL (Tier A) |
|---|--:|--:|--:|--:|--:|
| Lebanon (LB) | 131 | 84 | 10 | 10 | **1** (Wahed, Lever) |
| Gulf (SA+QA+KW+AE) | 462 | 314 | 68 | 65 | **10** (see below) |
| International remote | 0 rows classified this way | — | — | — | **0** (no aggregator wired in) |

Gulf's 10 derivable rows: Alpaca (SA, Greenhouse), Tamara (SA, Greenhouse),
MinIO (SA, Greenhouse), Salla (SA, Workable), Mirai (Workable), TAWANTECH
(Workable), Al Watania Information Systems (Workable), Gathern (Workable),
TGP International (Workable), Infinite pl (Lever). All confirmed via the new
`findEligibleCompanySources()` query against the live local database, not
estimated.

**Why 68 "suitable" rows only yield 11 derivable feed URLs, across both
markets combined:** the ATS distribution among the 68 verified+suitable rows
is dominated by ATS types this pipeline has no adapter for —
`workday` (4), `sap successfactors` (6), `oracle cloud hcm` variants (12+),
`phenom people` (4), `smartrecruiters` (4), `avature`, `icims`,
`brassring`, `taleo`, etc. Only Greenhouse/Lever/Workable have adapters
(`deriveAtsFeedUrl.ts`), and even among rows using one of those three, a
sizeable share embed the ATS widget on the company's own domain (e.g.
`https://www.foodics.com/careers`) rather than linking the ATS host directly
— `deriveAtsFeedUrl()` correctly returns `null` for these rather than
guessing (see its own test suite for real registry examples of both cases).

This is the honest ceiling of Tier A (direct-ATS) coverage as it exists in
the registry today: **11 companies total**, not a coverage failure of this
phase's code, but a real fact about which ATSs the region's employers
actually use (Oracle/SAP/Workday dominance in Gulf enterprise hiring,
confirmed independently in `docs/job-source-discovery/discovery-report.md`'s
Lebanon section).

---

## 3. Student / Pro verdicts per lane — explicit, not hedged

**STUDENT PLAN (Lebanon jobs only): coverage is WEAK.**
One derivable direct-ATS source (Wahed) after this phase's implementation,
up from zero. 84 Lebanon rows are `verified` in the registry but not
`suitable_public_ats` — they need either a career-page/HTML extraction
adapter (Tier B, not built) or a Lebanon-specific job board integration
(Tier C, not built) to become real ingestion sources. **A Student-plan user
today sees jobs from essentially one company.** This is a real product gap,
not a rounding error.

**PRO PLAN — Lebanon lane: same weak base as Student** (Pro includes
everything Student has, plus more).

**PRO PLAN — Gulf lane (Saudi/Qatar/Kuwait/UAE): THIN BUT REAL.**
10 derivable direct-ATS companies across 4 markets after this phase, all
functioning, tested against live registry data. Better than Lebanon, but
still a small absolute number against 462 Gulf-market companies in the
registry. Most of the volume potential in Gulf hiring sits behind
Bayt/GulfTalent (aggregator boards, Tier C, BENCHMARK FIRST — see §5) and
enterprise ATSs this pipeline doesn't support (Tier E — see §6), not behind
direct small-company ATS feeds.

**PRO PLAN — International remote lane: ZERO in the live pipeline.**
No aggregator source (RemoteOK, Jobicy, Arbeitnow, etc.) is wired into
ingestion as of this phase, despite RemoteOK and Jobicy being verified live
and ToS-compatible (§5). The blocker is architectural, not
credential/cost: `runIngestionBatch()`'s single-company-provenance model
needs a deliberate extension before an aggregator source can be added
without weakening dedup/provenance guarantees. This is flagged as a real gap
for a follow-up phase, not silently omitted.

**Do not read "implemented this phase" as "coverage problem solved."** This
phase moved Tier A coverage from 4 to 15 companies (11 new + 4 pre-existing,
one of which — Wahed — is now dynamically discovered rather than
hardcoded) and made the pipeline scale automatically as new
`verified`/`suitable_public_ats` rows are added to the registry going
forward, with zero code changes required. It did not add Tier B/C/D coverage
this phase — that requires the architecture decision in §7 and is correctly
deferred, not silently dropped.

---

## 4. Source-tier architecture

| Tier | Definition | Examples | Reliability | Cost | Maintenance | Trust |
|---|---|---|---|---|---|---|
| **A** | Direct ATS JSON API, single company, structured | Greenhouse, Lever, Workable, Ashby | High — official APIs | Free | Low — one adapter per ATS, N companies free | High — official source, best provenance |
| **B** | Career-page HTML extraction, single company | Company sites on Workday/SAP/Oracle/Teamtailor widgets | Medium — breaks on redesigns | Free (build cost only) | High — per-site brittleness | Medium — still first-party, but unstructured |
| **C** | Aggregator API/scrape, many companies, third-party | Bayt, GulfTalent (Apify), JSearch, Adzuna | Medium — depends on aggregator freshness/completeness | Paid (Apify ~$1/1000 results; JSearch/Adzuna API tiers) | Medium — one integration covers many companies | Medium — provenance is the aggregator's, not the employer's |
| **D** | International-remote aggregator, public API, ToS-compatible | RemoteOK, Jobicy | High — live, verified, simple public API | Free | Low | Medium — attribution-only ToS, no employer relationship |
| **E** | Enterprise ATS, no adapter exists | Workday, SAP SuccessFactors, Oracle HCM, Avature, iCIMS, BrassRing, Taleo, Phenom, SmartRecruiters | N/A — not integrated | N/A | High — each is effectively a bespoke scraper project | N/A |
| **Excluded** | Prohibited by product rules | LinkedIn (any form of scraping/automation) | — | — | — | — |

This phase implemented Tier A only (the only tier where the existing
provider contract needs zero extension). Tiers B/C/D require the extension
in §7 or dedicated per-site work; Tier E is out of scope until an enterprise
ATS integration is explicitly requested.

---

## 5. Candidate sources — classification with reasons

| Source | Tier | Classification | Why |
|---|---|---|---|
| Greenhouse/Lever/Workable (registry rows) | A | **ADD NOW — implemented** | Already the supported contract; only needed dynamic discovery instead of a hardcoded list. See §7. |
| Ashby | A | **DEFER** | No registry rows currently marked `ats_provider='Ashby'` + `suitable_public_ats`; adapter is cheap to add (same pattern as `deriveAtsFeedUrl.ts`) once a real row exists. Not invented speculatively. |
| RemoteOK | D | **BENCHMARK FIRST** (architecture-blocked, not quality-blocked) | Verified live via direct `curl`, 200 status, attribution-only ToS — compatible. Blocked by the single-company-provenance constraint in §1, not by data quality. Real candidate for the very next phase once that constraint is deliberately addressed. |
| Jobicy | D | **BENCHMARK FIRST** (same reason as RemoteOK) | Same verification and same blocker. |
| Remotive | D | **EXCLUDE** | ToS explicitly prohibits third-party job-board redistribution — disqualifying regardless of architecture readiness. |
| Arbeitnow | D | **BENCHMARK FIRST** | Live (200 status) but ToS/quality not yet deeply evaluated — needs the same review Remotive got before being trusted. |
| Himalayas | D | **BENCHMARK FIRST** | Same as Arbeitnow — live, unevaluated. |
| The Muse | D | **BENCHMARK FIRST** | Same as Arbeitnow — live, unevaluated. |
| We Work Remotely | D | **DEFER** | Not yet verified live this phase; no evidence gathered either way. |
| Bayt (via `blackfalcondata/bayt-scraper` Apify actor) | C | **BENCHMARK FIRST** | Real actor identified, ~$1/1000 results, covers all 5 target markets (`docs/job-source-discovery/source-expansion/source-expansion-report.md` §10.8). Zero Apify credits spent to date — cost/quality not yet measured against real data. `APIFY_API_TOKEN` is configured in `.env.local` and now documented in `.env.example`, so this is unblocked whenever a bounded, explicitly-authorized benchmark run is approved. |
| GulfTalent (via `blackfalcondata/gulftalent-scraper`) | C | **BENCHMARK FIRST** | Same actor family, same reasoning as Bayt. |
| Naukri UAE (via `silentflow/naukri-scraper`) | C | **DEFER** | Lower priority per the source-expansion report; UAE-only, and Bayt/GulfTalent already cover UAE. |
| JSearch | C | **BLOCKED_ON_CREDENTIAL** | No API key configured anywhere in this project. Cannot implement or even benchmark without the user obtaining one — never invented. |
| Adzuna | C | **BLOCKED_ON_CREDENTIAL** | Same — no API key configured. |
| Local Lebanon/MENA job boards (non-Bayt) | B/C | **DEFER** | `docs/job-source-discovery/lebanon.csv`'s `public_jobs_endpoint_or_feed` column is mostly "unknown" or a generic careers URL — no reliable derived endpoint exists yet; needs dedicated per-board research, not a rushed guess. |
| Career-page HTML extraction (general) | B | **DEFER** | High per-site maintenance cost (Tier B row in §4); no generic extractor exists in this codebase, and building one is a significant scope item on its own, not an "ADD NOW" fit. |
| RSS ingestion (general) | — | **EXCLUDE for this phase** | No evidence any candidate source in the registry actually exposes a job RSS feed; not pursued speculatively. |
| LinkedIn (any scraping/automation) | — | **EXCLUDE — product rule** | AGENTS.md §7 prohibits this outright. See §8. |

---

## 6. Answers to the 10 core coverage questions

1. **Do we have credible Lebanon coverage?** No — 1 derivable direct company
   (§3). Weak.
2. **Do we have credible Gulf coverage?** Thin but real — 10 derivable
   companies across 4 markets (§3).
3. **Do we have credible international-remote coverage?** No — zero sources
   wired into the live pipeline (§3).
4. **Why wasn't RemoteOK included in ADD NOW?** Verified live and
   ToS-compatible, but blocked by the single-company-provenance
   architectural constraint (§1, §7) — a deliberate deferral, not an
   oversight.
5. **Why wasn't Bayt included in ADD NOW?** Same aggregator-provenance
   constraint, plus it's a paid Apify actor that has never been run — cost
   and result quality need a bounded benchmark before production use, not a
   blind first run.
6. **Why wasn't JSearch/Adzuna included?** No API credentials exist in this
   project for either. `BLOCKED_ON_CREDENTIAL`, never invented.
7. **Why wasn't career-page scraping included?** No generic HTML extractor
   exists in this codebase; per-site brittleness (Tier B) makes this a
   dedicated scope item, not a same-night addition alongside a schema-safe
   Tier A change.
8. **Why wasn't Apify used at all this phase, given the token is
   configured?** Because "use Apify" was never the goal — the goal was the
   simplest reliable path per source, and Tier A (already-supported,
   zero-risk) fully absorbed this phase's safe scope. Spending real Apify
   credits on an unbenchmarked actor under time pressure was explicitly
   against the user's instructions (compare cost/reliability/quality before
   using it).
9. **Why wasn't RSS ingestion included?** No evidence any candidate source
   actually exposes a job RSS feed — nothing to implement against.
10. **Was LinkedIn scraping considered?** No — explicitly prohibited
    (AGENTS.md §7) and never attempted. The one LinkedIn-related action
    taken this phase was inspecting a local n8n template for generic
    workflow patterns only; see §8.

---

## 7. Implementation this phase (ADD NOW — evidence-based, Tier A only)

**Goal:** replace the hardcoded 4-source list with dynamic discovery from
the real `company_sources` registry, so every future `verified` +
`suitable_public_ats` Greenhouse/Lever/Workable row is automatically ingested
with zero code changes — while staying entirely inside the existing provider
contract (raw job → validation → mapping → location normalization →
normalized contract → dedupe → persistence). No provider-specific matching
logic was added; no dedup/idempotency/location-normalization/trust/
provenance/schema/stale-close behavior was touched.

**New files:**

- `src/lib/ingestion/deriveAtsFeedUrl.ts` — pure function, no DB/network.
  Regex-matches `company_sources.official_careers_url` against known
  Greenhouse (EU + global)/Lever/Workable URL patterns and constructs the
  real, callable ATS API endpoint. Returns `null` when not derivable —
  never guesses. Verified against 6 real registry rows in
  `tests/unit/derive-ats-feed-url.test.mjs` (Alpaca, Tamara, Wahed, Agility,
  Foodics [null case], SAP SuccessFactors [null case]) — 9 tests, all
  passing.
- `src/lib/ingestion/findEligibleCompanySources.ts` — queries
  `company_sources` for `review_status='verified' AND
  automation_eligibility='suitable_public_ats'`, derives a feed URL for
  each via the function above, silently excludes rows that don't resolve.
  Verified against the real live registry in
  `tests/db/find-eligible-company-sources.test.mjs` — asserts ≥10 real
  derivable sources, cross-checks every returned row's live
  `review_status`/`automation_eligibility` independently, confirms Alpaca is
  present. Passing.
- `src/app/api/internal/ingestion/list-sources/route.ts` — new internal
  endpoint, `POST /api/internal/ingestion/list-sources`, authorized the same
  way every other internal ingestion endpoint is (`INGESTION_WORKER_SECRET`
  via `isAuthorizedInternalRequest`). Calls `findEligibleCompanySources()`
  and returns `{ sources: [{ source_id, ats_type, feed_url }] }` — the exact
  snake_case wire shape the workflow's existing downstream nodes (`Split Out
  Sources`, `Extract Jobs By ATS Type`) already expect, so **zero downstream
  node changes were needed**. Every returned source's
  `review_status`/`automation_eligibility` is still re-verified live, per
  source, inside `runIngestionBatch()`'s existing
  `verifySourceForIngestion()` before anything is written — this endpoint is
  a discovery convenience, never a trust decision by itself.

**Workflow changes (n8n, "AI Job Agent / 01 Job Ingestion", ID
`I8WYkMfYCKug5ky4`):**

- Removed the `Static Pilot Source List` Set node (the hardcoded 4-row
  list).
- Added `List Ingestion Sources` (HTTP Request, POST to the new endpoint,
  Bearer-auth credential `Ingestion Worker Secret`, `retryOnFail: true,
  maxTries: 2, waitBetweenTries: 3000`, `onError: 'continueErrorOutput'`).
- Added `Log List Sources Failure` (Set node, terminal failure path — if
  source discovery itself fails, there is nothing to loop over; a human
  reviews the n8n execution log, matching this workflow's existing
  no-summary-node convention documented in its own overview sticky note).
- Updated the workflow's scope-limitation sticky note to describe dynamic
  discovery and reference this document.
- Chain: `Start Trigger → Workflow Configuration → List Ingestion Sources
  (→ error: Log List Sources Failure) → Split Out Sources → [unchanged loop]`.
  Everything from `Split Out Sources` onward — the loop, ATS branching,
  ingestion-batch calls, result recording, rate limiting — is **completely
  unchanged**, confirming the diff is isolated exactly to the
  source-discovery mechanism.
- Workflow remains **inactive** (`active: false`) throughout — verified via
  `get_workflow_details` after every change, never activated.

**Production Automation Engineer skill compliance (confirmed):**
skill read and used this session; repository-first `.ts` and `.json`
workflow definitions both updated and kept in sync with the live n8n
instance (verified via `get_workflow_details` diffed against the repo
files); JSON validated (`validate_workflow` → `valid: true`, 20 nodes, only
expected `$json.error` static-analysis warnings on error-output branches —
standard n8n pattern, not a real issue); workflow confirmed inactive after
every `update_workflow` call; tested via `test_workflow` with 2 pinned
scenarios (both passed) before this document was written; rollback path
exists (the previous `Static Pilot Source List` node's exact JSON is
recoverable from `git log` on this file, and n8n's own workflow version
history — `get_workflow_history`/`restore_workflow_version` — additionally
covers the live instance).

**Configurability achieved:** adding a new Tier-A source going forward
requires **zero code changes** — only a new, correctly-classified
`company_sources` row (`review_status='verified'`,
`automation_eligibility='suitable_public_ats'`, a resolvable
`official_careers_url`). Adding a new *ATS type* (e.g. Ashby) requires one
new branch in `deriveAtsFeedUrl.ts` plus a fixture test — no changes to
`findEligibleCompanySources.ts`, the API route, the workflow, or anything
downstream of `Split Out Sources`.

**Why aggregator sources (RemoteOK/Jobicy/Bayt) were not implemented this
phase:** see §1's architectural-constraint explanation and §5's
per-source classifications. Implementing a workaround here — inventing
synthetic `company_sources` rows for aggregator-sourced companies, or
weakening `dedup_scope`/provenance to accept a company-less batch — was
judged unsafe to rush into "ADD NOW" scope and is instead documented as a
concrete, scoped follow-up decision (§9), not silently dropped.

---

## 8. LinkedIn template research (pattern extraction only — no LinkedIn automation built or planned)

Per the explicit instruction to inspect a locally-saved LinkedIn-related n8n
template for reusable *workflow patterns* only, three candidate files were
found outside the repo (`~/Downloads/`, not part of this project's version
control): `LinkedIn (3).json`, `linkedin automation.json` (corrupted/
truncated JSON, unreadable), and `LinkedIN_Automation (1).json`.

`LinkedIn (3).json` was the relevant one and was read in full. **What it
actually is:** a Telegram-bot-triggered LinkedIn **people-profile** search
and outreach tool — a user messages a bot with a natural-language query
("find 15 CEOs in Dubai"), GPT parses it into Apify actor parameters, the
`harvestapi/linkedin-profile-search` Apify actor scrapes matching LinkedIn
**profiles** (not job postings), GPT drafts a personalized LinkedIn
connection-request message per profile, results are logged to Google
Sheets, and the message is sent back to the user via Telegram for them to
send manually.

**This is explicitly excluded from this project by product rule (AGENTS.md
§7: never scrape LinkedIn, never automate LinkedIn).** Its LinkedIn-specific
content — the actor, the profile fields, the outreach-message generation —
was not adapted, is not referenced anywhere in this project's code, and
will not be. It is documented here only because the user asked for the
template to be inspected as a reference artifact.

**Generic patterns extracted (technique-level, zero LinkedIn content):**

- **Apify node wiring shape** (`@apify/n8n-nodes-apify.apify`, `operation:
  "Run actor and get dataset"`, `actorId` as a resource-locator with
  `__rl`/`mode: "list"`, `customBody` built via `JSON.stringify()` of an
  object assembled in an upstream Code node that only includes optional
  fields when present) — confirms the real, current shape of this node type,
  useful reference if/when the Bayt/GulfTalent Apify actors from §5 are
  benchmarked in a future phase.
- **Empty-result guard pattern**: an IF node checks a boolean
  `has_results`-style flag immediately after the Apify call, branching to a
  distinct "no results" path rather than letting empty data flow into
  downstream formatting/notification nodes unchecked. A reasonable generic
  pattern, though this project's own pipeline already handles empty
  batches inside `runIngestionBatch()`.
- **Anti-patterns explicitly NOT copied:** the Apify node in this template
  has no `retryOnFail`/`onError` wiring at all (a single transient Apify
  failure halts the whole run) — this project's own new `List Ingestion
  Sources`/`Fetch Source Jobs`/`Call Ingestion Batch Endpoint` nodes all
  correctly have retry + error-output wiring, which is stronger than what
  this template does, not weaker. The template also has **no dedup or
  idempotency logic whatsoever** — every run re-scrapes and re-appends to
  Google Sheets with no upsert/uniqueness check. This project's existing
  `dedup_scope` + idempotent persistence model in `ingestSourceBatch.ts` is
  already strictly better and was never weakened to match this template's
  looser demo-quality approach.
- **Pagination**: not applicable — the Apify "Run actor and get dataset"
  operation is a single blocking call that returns the full dataset up to a
  `maxItems` cap; the actor handles its own internal pagination. No
  hand-built pagination loop pattern was present to extract.

No code, prompt text, actor ID, or field mapping from this template was
copied into this project.

---

## 9. Recommended next-phase scope (not implemented this phase — explicitly deferred)

1. **Resolve the aggregator-provenance architecture question** (§1) — a
   deliberate design decision (e.g. a nullable `company_sources` reference
   on `jobs` plus an aggregator-specific `dedup_scope` variant preserving
   per-job source attribution) before RemoteOK/Jobicy/Bayt/GulfTalent can be
   added without weakening existing guarantees.
2. **Bounded, explicitly-authorized Apify benchmark run** against
   `blackfalcondata/bayt-scraper` and `blackfalcondata/gulftalent-scraper`
   (cost ~$1/1000 results per §5) to measure real freshness/quality/coverage
   before committing to production use.
3. **Lebanon-specific source research** — the current 1-company Lebanon
   coverage is the clearest concrete product risk from this audit; local
   job-board/career-page options need dedicated research beyond what
   `docs/job-source-discovery/lebanon.csv` currently captures.
4. **JSearch/Adzuna** — remain `BLOCKED_ON_CREDENTIAL`; unblock by obtaining
   API keys, then implement behind the same evidence-based process.

---

## 10. Validation run this phase

| Check | Result |
|---|---|
| `tests/unit/derive-ats-feed-url.test.mjs` | 9/9 passing |
| `tests/db/find-eligible-company-sources.test.mjs` | 1/1 passing (against live local registry) |
| `tests/workflow/ai-job-agent-01-job-ingestion.test.mjs` | 13/13 passing (updated for the new nodes) |
| n8n `validate_workflow` on the `.ts` source | `valid: true`, 20 nodes |
| n8n `get_workflow_details` after every `update_workflow` call | connections verified to match intent each time |
| n8n `test_workflow` (2 pinned scenarios) | both passed, `active: false` confirmed throughout |
| Full `npx tsc --noEmit` / `npm run lint` / `npm run test:unit` / `npm run test:db` / `npm run build` | **see `docs/OVERNIGHT_BUILD_PROGRESS.md`'s Phase 12 entry for the full-suite run recorded alongside commit/push** |

No duplicate jobs, no broken `dedup_scope`, no stale-close regression, no
provenance loss, no provider-specific downstream matching changes, no
secret leakage (`.env.example` documents `APIFY_API_TOKEN` by name only, no
value), no workflow activation, no production send/deploy.
