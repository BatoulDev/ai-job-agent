# Lebanon + Gulf Ingestion Validation (Phase 17)

Branch: `phase/17-ingestion-adversarial-hardening`, forked from `phase/16-
lebanon-gulf-source-expansion` @ `7848208`. Goal: prove the Phase 16
Lebanon/Gulf expansion (Oracle Cloud Recruiting, career-page limit raise)
works under real and worst-case conditions — real bounded executions
against local/dev, workflow inactive throughout, no real external
application/email sent.

---

## 1. Real bounded executions

Two real, manual, bounded n8n executions against workflow `I8WYkMfYCKug5ky4`
("AI Job Agent / 01 Job Ingestion"), `dryRun:false`, `maxJobsPerSource:5`,
`active:false` throughout (confirmed via `get_workflow_details` before and
after):

| Execution | Duration | Status |
|---|---|---|
| 133016 | 6m02s | success |
| 133108 (idempotency re-run) | 5m42s | success |

### Per-source results (execution 133016)

**Tier A — company-specific ATS (14 sources, including 2 real Oracle Cloud Recruiting sources):**

| source | ats | outcome | fetched | valid | rejected | created | updated |
|---|---|---|---|---|---|---|---|
| sr-sa-mirai | workable | succeeded | 3 | 3 | 0 | 0 | 3 |
| **sr-ae-nmc-specialty-hospital-abu-dhabi** | **oracle_hcm** | **succeeded** | 25 | 22 | 3 | **5** | 0 |
| sr-sa-tamara | greenhouse | fetch_failed (known DNS issue) | — | — | — | — | — |
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
| **sr-lb-aubmc** | **oracle_hcm** | **succeeded** | 5 | 5 | 0 | **5** | 0 |

**Both real Oracle Cloud Recruiting sources succeeded end-to-end** — not
just AUBMC (the one manually verified in Phase 16), but also
`sr-ae-nmc-specialty-hospital-abu-dhabi`, a second real registry row that
`findEligibleCompanySources()` picked up automatically because its
`official_careers_url` already happened to be a real Oracle tenant URL.
This confirms the adapter generalizes, not just against the one
hand-verified tenant. 10 real jobs created (5 Lebanon + 5 UAE), 0 rejected
for AUBMC, 3/25 honestly rejected for NMC (real data-quality gaps in that
tenant's own listings, not a mapping bug).

`sr-sa-tamara` still fails identically to Phases 14/16 with
`getaddrinfo ENOTFOUND boards-api.eu.greenhouse.io` — the same
pre-existing, unresolved, environmental DNS issue, unrelated to this
phase's changes.

**Tier D — multi-company feeds (3 providers):**

| provider | outcome | fetched | valid | rejected | created | updated |
|---|---|---|---|---|---|---|
| remoteok | succeeded | 100 | 99 | 1 | 0 | 5 |
| jobicy | succeeded | 40 | 40 | 0 | **5** | 0 |
| arbeitnow | succeeded | 15 | 15 | 0 | **5** | 0 |

Jobicy and Arbeitnow created 5 new jobs each this run (real, live feeds —
new real postings appeared since Phase 14/16's runs; this is expected,
correct behavior for continuously-updated public feeds, not a bug).

**Tier B — career-page extraction (50 real candidates, up from 20 in Phase
14 — Phase 16's `DEFAULT_LIMIT` raise confirmed working):**

40/50 succeeded with an honest `no_valid_jobs` (0 jobs found — still zero
real yield, consistent with Phase 13/14's finding that the recorded
`official_careers_url` is almost always a landing page, not a job-detail
page). 10/50 failed on real, unrelated website errors:

- 7× real HTTP 404 (page moved/removed)
- 1× real HTTP 403 (Cloudflare bot-check interstitial)
- 1× real HTTP 307 (JS-required redirect)
- 1× real 20-second timeout

**Honest finding: raising `DEFAULT_LIMIT` alone did not produce a single
new real job** — confirms Phase 16's own analysis that the real fix is the
landing-page-vs-detail-page mismatch, not candidate-pool size. The
link-discovery helper built in Phase 16
(`findCareerPageJobDetailLinks.ts`) remains the correct next step, still
not wired into the fetch loop.

---

## 2. Idempotency (execution 133108, identical bounded re-run)

**Every single source across Tier A and Tier D shows `jobsCreated:0`,
`jobsUpdated:N` on the second run** — including both new Oracle sources
(`sr-lb-aubmc`: 0 created/5 updated; `sr-ae-nmc-specialty-hospital-abu-dhabi`:
0 created/5 updated). Direct DB re-query confirms:

- Total `jobs` rows: **93 before, 93 after** — zero growth.
- Duplicate `(dedup_scope, external_id)` pairs: **0, both times.**
- No incorrect stale-close: no previously-active job's `status` changed
  between runs.

Idempotency is proven for the new Oracle Cloud Recruiting source type on
real data, not just the 7 providers Phase 14 already proved.

---

## 3. Database persistence (final state, both runs)

```
TOTAL jobs rows: 93
by source_type: { admin_manual: 1, arbeitnow: 10, ashby: 5, greenhouse: 16,
                   jobicy: 10, lever: 8, oracle_hcm: 10, remoteok: 5, workable: 28 }
by country_code: { (null): 43, QA: 4, IN: 2, CA: 1, US: 6, AE: 7, SA: 25, LB: 5 }
by work_arrangement: { (null): 51, remote: 39, hybrid: 2, onsite: 1 }
```

Provenance, dedup, and schema correctness confirmed exactly as in Phase 14
(`source_type`, `source_id`, `external_id`, `dedup_scope`, `company_name`,
`application_url`/`application_email`, `status`) — unchanged mechanics,
now exercised against Oracle's real data too.

---

## 4. Apply URL audit (Step 17D)

- **0 of 93 rows** have neither `application_url` nor `application_email`
  — every stored job has a usable path to apply.
- Direct spot-check of 2 real, newly-created Oracle apply URLs — both
  return a real live **HTTP 200**:
  - `https://fa-exxn-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2/job/50` (AUBMC, Medical Laboratory Technologist)
  - `https://eiby.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/12436` (NMC Specialty Hospital, Registered Nurse)
- No apply URL was invented anywhere in this pipeline — every one is
  either the provider's own returned field or, for Oracle, deterministically
  constructed from a real, live-confirmed URL pattern
  (`{host}/hcmUI/CandidateExperience/en/sites/{site}/job/{id}`).

---

## 5. Location / work-arrangement null behavior (Step 17C, honest findings)

**43/93 rows (46%) have `country_code: null`, 51/93 (55%) have
`work_arrangement: null`.** These are never guessed — confirmed via direct
inspection: `normalizeLocation()` correctly returns `null` rather than
inventing a value whenever the source's own raw text doesn't resolve
cleanly (verified this phase with real Arabic-script location strings,
§6). For Oracle specifically: **all 10 real Oracle-sourced jobs have
`work_arrangement: null`**, because the real `WorkplaceTypeCode` field
Oracle's API returns is empty/null for every job observed at both tenants
(AUBMC, NMC) — a real data-completeness gap in what these two employers'
Oracle configuration exposes, not a mapping defect. AUBMC's jobs also have
`city: null` — correct, since AUBMC's own `PrimaryLocation` field is
literally just `"Lebanon"` with no city.

**Consequence, confirmed directly (§7): every real Lebanon job ingested
this phase is currently ineligible for matching**, failing
`checkJobEligibility()`'s `work_arrangement_unknown` gate — correctly, not
a bug. This is the single most important honest finding of this phase for
Lebanon coverage specifically (see §9).

---

## 6. Worst-case / adversarial testing (Step 17C)

Most of the worst-case list (empty provider response, one job, malformed
job, provider-side duplicate, cross-provider collision, stale-close,
timeout/429/500, retry/backoff, oversized payload) was already covered by
the existing 630+ unit and 542 DB tests from Phases 03/13/14 — re-run
clean this phase (§8), not duplicated.

**One genuine, new gap found and closed this phase**: no test previously
exercised non-English (Arabic-script) location text — realistic for real
Lebanon/Gulf job postings. Added 3 real tests
(`tests/unit/normalize-location.test.mjs`), verified against the real
function:

- Pure Arabic-script text (`"بيروت، لبنان"`, `"الرياض"`) → fails closed:
  `countryCode: null`, `city: null`, `locationConfidence: "low"` — never a
  crash, never a guess.
- Mixed English + Arabic parenthetical (`"Dubai, UAE (دبي)"`) → resolves
  correctly via the English portion (`AE`/`Dubai`, `high` confidence) — the
  Arabic text present doesn't break a real match.

New Oracle/Workday adapter edge cases already covered by Phase 16's own
test suite (missing `candidateSiteUrl` → null apply URL, missing
`bulletFields` → falls back to `externalPath`, empty raw object → all-null
shape that validation then correctly rejects) — re-confirmed working this
phase, not re-tested redundantly.

---

## 7. Matching handoff (Step 17F)

Matching was not modified. Three real scenarios tested directly against
`checkJobEligibility()` and `shortlistJobsForUser()` (unchanged) using real
DB rows:

**A. The real, newly-ingested Lebanon job (Oracle, AUBMC) — honestly ineligible:**
```
job: { countryCode: "LB", workArrangement: null, remoteScope: null }
checkJobEligibility (Free/Student): { eligible: false, reason: "work_arrangement_unknown" }
```
Correct, deterministic, and consistent with §5's finding — not a bug.

**B. Full chain proof with a real Gulf job that has complete data (Qatar, onsite, The Utopia Studio):**
```
Student plan:                          in shortlist? false (expected)
Pro plan, Qatar relocation selected:   in shortlist? true  (expected)
Pro plan, relocation NOT enabled:      in shortlist? false (expected)
```
Proves the full real chain — stored job → hard eligibility → matching
shortlist — still works correctly end-to-end for a real Gulf job, and
correctly respects the Pro relocation gate (not just "any Pro sees it").

**C. Remote-scope nuance (real Saudi-scoped remote job + a synthetic worldwide-scoped one, to isolate the variable):**
```
Student, real country:SA-scoped remote job:     ineligible (remote_scope_excludes_lebanon)
Pro (remote_worldwide coverage), worldwide job: eligible
Student, the SAME worldwide-scoped job:         eligible
```

**Finding to carry into Phase 18, not fixed here** (out of this phase's
scope — no entitlement-rule change was made): `checkJobEligibility()`'s
existing, unmodified `remoteScopeIncludesLebanon()` logic makes a
`worldwide` or `region:mena`-scoped remote job eligible for **every**
plan, including Free/Student — not gated to Pro. This means a Student user
technically can see some international-remote jobs today (the
Lebanon-inclusive ones), which is a real behavior worth Phase 18
explicitly reconciling against the stated product rule ("Student: Lebanon
only"). Flagged here with evidence, not silently corrected — Phase 17's
mandate was ingestion hardening, not entitlement changes.

---

## 8. Full regression (Step 17G)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run test:unit` | **633/633** (3 new Arabic-location tests) |
| `npm run test:workflow` | **360/360** (unchanged — no workflow file touched this phase) |
| `npm run test:db` | **542/542**, zero fixture leakage |
| `npm run build` | succeeds |
| `npm run test:e2e` | **6/6** |

**No real bugs were found or fixed this phase.** Every finding in §5-§7 is
a real, honest data-completeness or business-logic observation, correctly
handled by existing (Phase 03/16) fail-closed code — not a defect
requiring a regression test + fix, per AGENTS.md §10's own definition of a
bug.

---

## 9. Weak lanes — stated plainly, not hidden

- **Lebanon**: 5 real jobs ingested this phase (AUBMC), but **100% of them
  are currently ineligible for matching** due to Oracle's own API not
  populating work-arrangement data for this tenant. Lebanon's *effective*
  matchable job count from this phase's ingestion is **zero**, despite
  real ingestion succeeding. This is the clearest concrete gap remaining
  for the Student-plan lane.
- **Career-page extraction (Tier B)**: still 0 real jobs found across 50
  real candidates (up from 20) — the landing-page/detail-page mismatch
  identified in Phase 13/14/16 remains unresolved; the built link-discovery
  helper is not yet wired in.
- **Bayt, GulfTalent, Workday, JSearch**: still not live (§10) — the
  components Phase 15's research identified as the largest real levers for
  Lebanon/Gulf coverage remain unimplemented pending founder action or
  further engineering (Workday's per-job detail fetch).
- **Kuwait**: still has the thinnest native coverage of the 5 target
  markets (unchanged this phase — no Kuwait-specific source was added).

---

## 10. Credentials / blockers still missing (unchanged from Phase 16, re-confirmed)

See `docs/OVERNIGHT_CREDENTIALS_REQUIRED.md` for full detail. Summary:

- **Apify Bayt + GulfTalent bounded benchmark run** — the single highest-
  leverage remaining founder action for Lebanon/Gulf coverage; not run
  this phase (real money, needs explicit sign-off).
- **`JSEARCH_API_KEY`** — free tier sufficient, covers Saudi/Qatar/UAE only.
- **Workday per-job detail fetch** — an engineering follow-up, not a
  credential gap.
- **Career-page link-following wiring** — built (Phase 16), not connected
  to the fetch loop.

---

## Production-readiness blockers (explicit, not softened)

1. Lebanon's real ingested jobs are not yet reaching any user (§5/§9) —
   the Student-plan lane is not meaningfully improved by this phase's real
   ingestion numbers alone.
2. Bayt/GulfTalent — the components most likely to change that — remain
   unauthorized for a live run.
3. The Phase 18 entitlement-rule question (§7) should be resolved before
   any claim that Student/Pro market access matches the stated product
   rule exactly.
4. Everything else already documented in `docs/PRODUCTION_READINESS.md`
   (rate limiting, GDPR/account deletion, file-content upload validation)
   is unchanged and still applies.

**This phase does not claim production readiness.** It proves the Phase 16
expansion is mechanically sound (real execution, real persistence, real
idempotency, real apply URLs) while being explicit that Lebanon's
practical, user-facing improvement from this phase is currently zero.
