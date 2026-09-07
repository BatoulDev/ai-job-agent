# UAE (Dubai + Abu Dhabi) Registry Expansion — Final Pilot Report

**Date:** 2026-09-07
**Status: DISCOVERY, ENRICHMENT, CLASSIFICATION, AND STAGING COMPLETE. `uae.csv` and `master-company-registry.csv` are unmodified — this pilot stops before final registry promotion, per the task's explicit instruction.**
**Verdict: READY_FOR_HUMAN_REVIEW**

---

## 1. Existing UAE baseline (before this pilot)

- `uae.csv`: **39 records** — **27 verified, 12 needs_manual_review**.
- Target-city split: **Dubai 23 · Abu Dhabi 12 · Sharjah 2 · Country-wide 1 · "Dubai; Sharjah" 1**.
- `master-company-registry.csv`: 288 records across all markets.
- Industry concentration: heavy in Aviation (4), Banking (4), Telecom (2), Higher Education (2), Consulting (2); **thin-to-zero** in civil/electrical/mechanical engineering, architecture, interior design, graphic design, marketing, HR/recruitment, accounting (beyond Big 4), construction contracting, K-12 schools, hospitals (only 1: Cleveland Clinic Abu Dhabi), manufacturing (only 1: EGA), and NGOs/international organizations (0). This pilot's entire design targeted these specific gaps.
- ATS diversity already present: Oracle Cloud HCM (5), Phenom People (4), SmartRecruiters, Avature, Lever, WhiteCarrot, Talentera, SAP SuccessFactors, Jobs2Web.

## 2. Sources researched and access status

25 UAE-tagged sources now in `source-expansion/source-catalog.csv` (18 pre-existing + **7 added this pass**):

| New source | Access status |
|---|---|
| TECOM/Dubai Internet City unified Community Directory (covers DIC, DMC, D3, DKP, DSP) | Structure confirmed accessible; company names load client-side (JS-rendered), not extracted this pass |
| Dubai Design District (d3) Community + Retail Directory | URL confirmed via search; not yet directly fetched |
| Dubai Healthcare City (DHCC) Community Directory | Structure confirmed accessible; facility names load dynamically, not extracted this pass |
| KHDA — Dubai Private School Ratings/Directory | Confirmed via search + reputable mirrors (~202 private schools); official site not yet directly fetched |
| ADEK — Abu Dhabi Private Schools Directory | Confirmed via search + mirror (219 private schools across Abu Dhabi/Al Ain/Al Dhafra); official site not yet directly fetched |
| Dubai Health Authority (DHA) — Medical Registry / Find-a-Facility | Confirmed via search (42 hospitals, 971 clinics per DHA's own published figures); official portal not yet directly fetched |
| arab.org — NGO Directory of Dubai/Abu Dhabi | Confirmed via search; explicitly flagged discovery-only, never sufficient for verification alone |

None of these 7 were used to extract company names into any candidate file this pass — they are catalogued for a future pass, consistent with the DMCC precedent (a high-volume directory explicitly excluded from data extraction on terms-of-service grounds).

## 3. Apify discovery: batches, results, cost

- **Actor:** `compass/crawler-google-places` (Google Maps Scraper).
- **Plan:** 10 runs / 30 search terms / 15 gap-sector categories × 2 cities (`pilot-plan.md`, `cost-estimate.md`).
- **Approval:** user approved a **$2.50 hard cost cap** (revised down mid-session from the originally-proposed $8.00, after the user reported an Apify account balance of $2.67).
- **Executed:** **6 of 10 batches**, prioritized by gap-sector value with both cities covered at each priority tier before moving to the next (Finance & Built Environment → Retail/Hospitality/Healthcare → Engineering & Design, each for Dubai then Abu Dhabi).
- **Result:** **480 raw records, $2.4014 actual spend** (under the $2.50 cap, $0.0986 margin remaining — insufficient for a 7th batch, so execution stopped there as instructed).
- **Live actor-schema corrections made at execution time** (not known when the plan was written): `scrapeSocialMediaProfiles` now requires a per-platform object, not a boolean; `website: "all"` is no longer valid, replaced by `"allPlaces"`. Both are shape-only corrections with identical data-minimization intent; documented in `execution-checkpoint.md`.
- **Not executed (checkpointed, ready to resume without new research):** `run-dubai-g2`, `run-abudhabi-g2` (Creative & Professional Services: graphic design, marketing, HR recruitment), `run-dubai-g5`, `run-abudhabi-g5` (Manufacturing, Tech & Social Sector: manufacturing, software, NGOs). Exact resume command in `execution-checkpoint.md`.
- No failures, retries, or errors occurred across the 6 executed batches.

## 4. Candidate funnel

| Stage | Count |
|---|---|
| Raw Apify records | 480 |
| Unique after within-pilot dedup | 467 |
| Already present / possible duplicate of existing registry | 1 |
| New verified (promote-now) | **10** |
| Needs manual review (real leads, unresolved) | 392 |
| No official source found | 2 |
| Rejected (irrelevant small retail/generic, 47; dropped micro-business/individual, 15) | 62 |
| **Total** | **467 = 1 + 10 + 392 + 2 + 62** ✓ |

(392 needs_manual_review breaks down as: 108 no-website + 263 eligible-but-not-selected-for-enrichment + 21 enriched-but-unresolved.)

## 5. Sector distribution (of the 10 promoted)

Architecture (1) · Interior Design (1) · Engineering Consultancy (1) · Consulting/Professional Services — audit/tax (1) · HR and Recruitment (1) · Healthcare (5). Healthcare-heavy by design (the Abu Dhabi healthcare cluster produced the most confirmable careers pages of any cluster this pass) — a real finding, not a selection artifact; see the reconciliation report §4 for why.

## 6. Dubai / Abu Dhabi / Both

- **Dubai only:** 1 (Killa Design)
- **Abu Dhabi only:** 8
- **Dubai + Abu Dhabi (one canonical row, not duplicated):** 1 (Design Infinity)

This 9:2 Abu Dhabi skew among the *promoted* set is real (see reconciliation report §4 for the honest explanation — it is not a Dubai-coverage gap in the underlying sample, which was perfectly city-balanced at every earlier funnel stage).

## 7. Careers/ATS distribution (of the 10 promoted)

- **Confirmed public ATS:** 1 (NMC Specialty Hospital Abu Dhabi — Oracle Cloud HCM)
- **Confirmed dedicated careers page, ATS vendor not itemized:** 9

## 8. Number proposed for promotion

**10 companies**, staged in `reconciliation/uae-promotion-staging.csv` (34-column schema, byte-identical header to `uae.csv`) with a full traceability manifest in `reconciliation/uae-promotion-staging-manifest.csv`.

## 9. Final proposed company list

| canonical_company_id | Company | City | Industry | Website | Careers/ATS | Review status | Automation eligibility |
|---|---|---|---|---|---|---|---|
| cc-killa-design | Killa Design | Dubai | Architecture | killadesign.com | /careers/ | verified | suitable_public_html_subject_to_review |
| cc-design-infinity | Design Infinity | Dubai; Abu Dhabi | Interior Design/Fit-out | design-infinity.com | /careers/ | verified | suitable_public_html_subject_to_review |
| cc-capital-engineering-consultancy | Capital Engineering Consultancy | Abu Dhabi | Engineering Consultancy | capitalengg.com | /careers | verified | suitable_public_html_subject_to_review |
| cc-ama-global-audit-tax-advisory | AMA Global Audit Tax Advisory | Abu Dhabi | Consulting/Professional Services | amaaudit.com | /careers/ | verified | suitable_public_html_subject_to_review |
| cc-sundus | Sundus Recruitment and Outsourcing Services | Abu Dhabi | HR and Recruitment | sundusglobal.com | /sundus-job-search | verified | suitable_public_html_subject_to_review |
| cc-nmc-specialty-hospital-abu-dhabi | NMC Specialty Hospital Abu Dhabi | Abu Dhabi | Healthcare | nmc.ae | **Oracle Cloud HCM** | verified | **suitable_public_ats** |
| cc-medeor-hospital | Medeor 24x7 Hospital | Abu Dhabi | Healthcare | medeor.ae | /careers/ | verified | suitable_public_html_subject_to_review |
| cc-healthpoint | Healthpoint | Abu Dhabi | Healthcare | healthpoint.ae | /careers/ | verified | suitable_public_html_subject_to_review |
| cc-harley-street-medical-centre | Harley Street Medical Centre | Abu Dhabi | Healthcare | hsmc.ae | /careers/ | verified | suitable_public_html_subject_to_review |
| cc-global-care-hospital | Global Care Hospital | Abu Dhabi | Healthcare | gch.ae | /careers/ | verified | suitable_public_html_subject_to_review |

Evidence summary for every row: direct WebFetch of the company's own official domain (never a search snippet, aggregator, or LinkedIn), 2026-09-07 — full detail in `enrichment/enriched-company-candidates.csv` and `reconciliation/uae-promotion-staging-manifest.csv`.

## 10. Manual-review candidates (highlights, full list in `enrichment/manual-review-queue.csv`, 392 rows)

- **21 directly-enriched-but-unresolved** (the most actionable subset): real, confirmed-legitimate companies with either (a) no discoverable hiring channel beyond a general contact form (13 — e.g. MF Architect, Falcon Interior Decoration, Aamer Group, Al Moosa Clinics), or (b) a technical access block this pass (8 — TLS certificate errors, HTTP 403s, or empty JS-rendered pages), most notably the **entire SEHA government hospital network** (Corniche Hospital, Zayed Military Hospital, Sheikh Khalifa Medical City) blocked at the parent `seha.ae` domain, and **Brands For Less** (a well-known large regional retail chain) blocked with a 403 — both flagged as high-value targets for a follow-up pass via a different access method.
- **263 eligible_employer, not yet enriched** — real leads that lost the per-cell ranking cutoff (capped at 6 per sector-cluster × city), not rejected on merit.
- **108 eligible_employer_no_website** — plausible real employers where Google Maps returned no website field.

## 11. Files created or modified

**Created (28 files, all under `docs/job-source-discovery/pilots/apify-uae/`, currently untracked):**
- `pilot-plan.md`, `cost-estimate.md`, `proposed-queries.csv`, `proposed-apify-input.json`, `run-one-batch.js`, `execution-checkpoint.md`, `normalize.js`, `normalized-companies.csv`, `classify-and-select.js`, `pilot-report.md` (this file)
- `raw/` — 6 raw Apify run outputs (`run-dubai-g1.json`, `run-dubai-g3.json`, `run-dubai-g4.json`, `run-abudhabi-g1.json`, `run-abudhabi-g3.json`, `run-abudhabi-g4.json`)
- `enrichment/` — `all-classified-candidates.csv`, `selected-for-enrichment.csv`, `rejected-candidates.csv`, `duplicate-and-alias-review.csv`, `manual-review-queue.csv`, `enriched-company-candidates.csv`, `careers-source-summary.csv`, `build-enrichment-outputs.js`
- `reconciliation/` — `uae-promotion-dry-run.csv`, `uae-promotion-staging.csv`, `uae-promotion-staging-manifest.csv`, `uae-promotion-reconciliation-report.md`, `build-staging.js`

**Modified (1 file, purely additive):**
- `docs/job-source-discovery/source-expansion/source-catalog.csv` — 7 new UAE source rows appended, zero existing rows changed.

**Not modified:** `uae.csv`, `master-company-registry.csv`, `lebanon.csv`, `saudi-arabia.csv`, `qatar.csv`, `kuwait.csv`, `international-remote.csv`, `discovery-report.md`, `candidate-reconciliation.csv`, `AGENTS.md`.

## 12. Validation results

All checks in `reconciliation/uae-promotion-reconciliation-report.md` §5 passed: schema match, field-count integrity, canonical/source-record-ID uniqueness and no collision with the existing 39+288-row registry, zero domain collisions, valid enums, non-empty evidence on every verified row, zero personal LinkedIn URLs, explicit `target_city` on every staged row, and an exhaustive 467-row dry-run accounting (10 + 392 + 2 + 62 + 1 = 467).

Re-running `normalize.js` → `classify-and-select.js` → `enrichment/build-enrichment-outputs.js` → `reconciliation/build-staging.js` in sequence against the same 6 raw JSON files reproduces byte-identical output (all four scripts are pure functions of the raw/`selected-for-enrichment.csv` inputs plus the hand-compiled `findings` array, no randomness or timestamps beyond the fixed `2026-09-07` date).

## 13. Git diff summary

- 1 tracked file modified: `source-expansion/source-catalog.csv` (+7 rows, purely additive).
- 28 new untracked files under `pilots/apify-uae/`.
- `AGENTS.md`'s pre-existing modification (present before this session started, per the initial `git status`) was never touched or staged by this work.
- Nothing staged, committed, or pushed.

## 14. Confirmation

`uae.csv`, `master-company-registry.csv`, all other market-country CSVs, and `AGENTS.md` were **not modified** by this pilot. No git staging, commit, push, or branch switch occurred. No job-ingestion automation, n8n workflow, database, or application code was touched. No LinkedIn scraping or login occurred. No personal data (reviews, images, leads, contacts, social profiles) was collected — every Apify run had all enrichment/personal-data toggles explicitly disabled, confirmed in each raw JSON's saved `input` object.

## 15. Exact resume point

Everything in this pass reached a terminal, documented state — nothing is mid-flight. The next actions available, in priority order:
1. **Human review of the 10 `promote_now` rows** in `reconciliation/uae-promotion-staging.csv` — the only action needed to actually add them to `uae.csv` (a separate, explicit approval, consistent with the Lebanon precedent).
2. **Resume the 4 unexecuted Apify batches** (`run-dubai-g2`, `run-abudhabi-g2`, `run-dubai-g5`, `run-abudhabi-g5`) if additional Apify budget is approved — exact command in `execution-checkpoint.md`, no new research needed.
3. **Re-fetch the 8 technically-blocked enrichment candidates** (especially the SEHA network and Brands For Less) via a different method (e.g. a manual browser check) in a future pass.
4. **Enrich more of the 263 eligible_employer backlog** beyond this pass's per-cell cap of 6, if deeper coverage of the same 6 executed sector-clusters is wanted before spending more Apify budget on the remaining 2 clusters.

## 16. Final verdict

**READY_FOR_HUMAN_REVIEW** — 10 companies are fully verified, staged, and validated for promotion into `uae.csv` pending explicit human approval. The pilot correctly stopped short of registry promotion, git staging, commit, or push, per the task's explicit stop point.
