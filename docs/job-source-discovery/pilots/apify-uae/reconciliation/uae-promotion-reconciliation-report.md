# UAE (Dubai + Abu Dhabi) Registry Expansion — Promotion / Reconciliation Report

**Status: READ-ONLY ANALYSIS AND STAGING. `uae.csv` and `master-company-registry.csv` have NOT been modified.** Staging artifacts (`uae-promotion-staging.csv`, `uae-promotion-staging-manifest.csv`, `uae-promotion-dry-run.csv`) are prepared in this directory for human review, mirroring the completed Lebanon precedent (`pilots/apify-lebanon/reconciliation/`).
**Analysis date:** 2026-09-07

---

## 1. Destination registry

- **Exact path:** `docs/job-source-discovery/uae.csv`
- **Baseline row count (before this pilot):** 39 data rows, 34 columns — 27 `verified`, 12 `needs_manual_review`. Target-city split: Dubai 23, Abu Dhabi 12, Sharjah 2, Country-wide 1, "Dubai; Sharjah" 1.
- **Schema:** identical 34-column schema shared by every market file and `master-company-registry.csv` (confirmed programmatically — see §5 validation).

## 2. Pipeline summary (this pilot)

1. **Deep source research**: 7 new UAE sources added to `source-expansion/source-catalog.csv` (25 UAE-tagged sources total now) — TECOM/DIC unified community directory, Dubai Design District directory, DHCC facility directory, KHDA/ADEK private-school directories, DHA licensed-facility register, arab.org NGO directory. None used as standalone verification (directory evidence alone is documented as insufficient per the task's own rule).
2. **Apify Google Maps discovery**: 10-run plan prepared (`pilot-plan.md`, `cost-estimate.md`, `proposed-queries.csv`, `proposed-apify-input.json`); user approved a **$2.50 hard cost cap** (revised down from the originally proposed $8.00 after the user reported their Apify account had only $2.67 remaining). **6 of 10 runs executed**, prioritized by gap-sector value and city balance, for **480 raw records at $2.4014 actual spend** (see `execution-checkpoint.md` for the exact run-by-run cost and the 4 unexecuted runs' ready-to-resume checkpoint).
3. **Normalization + dedup**: 480 raw records → **467 unique candidates** (13 folded as within-pilot duplicates across overlapping search terms) via domain-first, name-fallback grouping (`normalized-companies.csv`). Cross-checked against `uae.csv` (39 rows) + `master-company-registry.csv` (288 rows) by normalized domain and normalized name: **1 possible match** flagged for manual confirmation, held out of promotion (`duplicate-and-alias-review.csv`).
4. **Relevance classification**: 467 candidates classified into `eligible_employer` (311), `eligible_employer_no_website` (108), `irrelevant_small_retail_or_generic` (47), `possible_duplicate_of_existing_registry` (1) (`all-classified-candidates.csv`).
5. **Bounded selection for full enrichment**: capped at 6 candidates per (sector-cluster × city) cell, ranked by Google review count/rating, yielding **48 candidates** selected for direct WebFetch verification (`selected-for-enrichment.csv`).
6. **Manual curation before spending WebFetch budget**: 15 of the 48 were dropped as individual practitioners or micro-businesses (a single dentist, a single surgeon, single-branch courier agents, small retail/decor shops) — real judgment calls documented per-row in `rejected-candidates.csv`, not silently discarded.
7. **Direct enrichment**: the remaining **33 candidates** were each WebFetched against their own official domain (never a search snippet or aggregator) — `enriched-company-candidates.csv`. Result: **10 `new_verified`** (confirmed official site + dedicated careers page/ATS), **21 `needs_manual_review`** (confirmed real company but no hiring channel found, or a technical block — TLS errors, HTTP 403s, empty JS-rendered pages), **2 `no_official_source_found`** (dead/redirected domain; social-media-only presence).
8. **Promotion staging**: the 10 `new_verified` companies staged in `uae-promotion-staging.csv` + `uae-promotion-staging-manifest.csv`, using the exact `uae.csv` 34-column schema.

## 3. Full candidate funnel (467 → 10)

| Stage | Count | Cumulative disposition |
|---|---|---|
| Raw Apify records (6 of 10 planned batches) | 480 | — |
| After within-pilot dedup | 467 | starting point |
| `irrelevant_small_retail_or_generic` (auto-classified by category) | 47 | excluded |
| `possible_duplicate_of_existing_registry` | 1 | held for manual confirmation, not promoted |
| `eligible_employer_no_website` | 108 | held in manual-review queue (no verifiable official source) |
| `eligible_employer`, not selected for this pass's bounded enrichment (263) | 263 | held in manual-review queue (real leads, ranking cutoff only) |
| `eligible_employer`, selected for enrichment (48) → dropped as micro-business/individual before fetching | 15 | excluded (`rejected_low_value_micro_business_or_individual`) |
| `eligible_employer`, selected and enriched (33) → `needs_manual_review` (no careers channel found or technically blocked) | 21 | held in manual-review queue |
| `eligible_employer`, selected and enriched (33) → `no_official_source_found` (dead/redirected domain, social-only) | 2 | excluded |
| `eligible_employer`, selected and enriched (33) → **`new_verified`** | **10** | **staged for promotion** |
| **Total** | **467** ✓ | (47+1+108+263+15+21+2+10 = 467) |

**Manual-review queue after this pass: 392 rows** (`enrichment/manual-review-queue.csv`) — real, honestly-labeled leads, none discarded.
**Rejected-candidates total: 64 rows** (`enrichment/rejected-candidates.csv`) — 47 auto-classified small retail/generic, 15 manually-dropped micro-businesses/individuals, 2 dead-domain/social-only.

## 4. The 10 promote-now companies

| canonical_company_id | Company | City | Industry | Careers evidence |
|---|---|---|---|---|
| cc-killa-design | Killa Design | Dubai | Architecture | Dedicated careers page |
| cc-design-infinity | Design Infinity | **Dubai; Abu Dhabi** | Interior Design/Fit-out | Dedicated careers page; confirmed dual-city offices — filed as ONE row, not two, per the task's explicit branch-collapsing instruction |
| cc-capital-engineering-consultancy | Capital Engineering Consultancy | Abu Dhabi | Engineering Consultancy | Dedicated careers page (see caveat below) |
| cc-ama-global-audit-tax-advisory | AMA Global Audit Tax Advisory | Abu Dhabi | Consulting/Professional Services | Dedicated careers page |
| cc-sundus | Sundus Recruitment and Outsourcing Services | Abu Dhabi | HR and Recruitment | Dedicated careers page + a secondary portal |
| cc-nmc-specialty-hospital-abu-dhabi | NMC Specialty Hospital Abu Dhabi | Abu Dhabi | Healthcare | **Confirmed Oracle Cloud HCM ATS** — the only `suitable_public_ats` row this pass |
| cc-medeor-hospital | Medeor 24x7 Hospital | Abu Dhabi | Healthcare | Dedicated careers page |
| cc-healthpoint | Healthpoint | Abu Dhabi | Healthcare | Dedicated careers page |
| cc-harley-street-medical-centre | Harley Street Medical Centre | Abu Dhabi | Healthcare | Dedicated careers page |
| cc-global-care-hospital | Global Care Hospital | Abu Dhabi | Healthcare | Dedicated careers page |

**City imbalance is real, not an artifact**: 9 of 10 are Abu Dhabi-only, 1 is dual-city, 0 are Dubai-only. This reflects what the enrichment pass actually found (Dubai candidates in the same sector-clusters more often had no careers page, a blocked domain, or turned out to be micro-businesses), not a selection bias — the underlying sample was city-balanced at every prior stage (30/30 search terms split evenly, 24 of 48 enrichment-selected candidates were Dubai). This imbalance is flagged, not smoothed over.

**Flagged caveat (not silently resolved):** Capital Engineering Consultancy's own website shows a Sharjah headquarters address, even though it was discovered via an Abu Dhabi Google Maps search. Filed under Abu Dhabi per the Google Maps discovery evidence, with the HQ discrepancy explicitly noted in `researcher_notes` and `uae-promotion-staging-manifest.csv` — a human reviewer should confirm the exact nature of its Abu Dhabi presence (branch office vs. project-only listing) before treating this as a confirmed Abu Dhabi employer.

## 5. Validation (all checks passed, run programmatically — see inline script output)

- Staging CSV header is byte-identical to `uae.csv`'s 34-column header. ✓
- All 10 staging rows have exactly 34 fields, zero malformed rows. ✓
- All 10 `canonical_company_id` and `source_record_id` values are unique among themselves and do not collide with any of the 39 `uae.csv` rows or 288 `master-company-registry.csv` rows. ✓
- Zero normalized-domain collisions between the 10 staged rows and the existing registry. ✓
- `review_status` for all staged rows ∈ the documented enum (`verified`). ✓
- All 10 `verified` rows have a non-empty `evidence_urls` field. ✓
- Zero `linkedin.com/in/` (personal-profile) URLs anywhere in the staged output. ✓
- All 10 staged rows have an explicit `target_city` value (Dubai, Abu Dhabi, or "Dubai; Abu Dhabi"). ✓
- Dry-run classification is exhaustive: 467 = 10 promote_now + 392 hold_manual_review + 64 exclude_rejected + 1 hold_duplicate_review. ✓
- `uae.csv`, `master-company-registry.csv`, all other market files, and `AGENTS.md` are unmodified (confirmed via `git status`/`git diff` — only `source-expansion/source-catalog.csv` gained 7 new source rows, purely additive, and the new `pilots/apify-uae/` directory is untracked). ✓

## 6. Schema-mapping decisions (documented, not silently defaulted)

Following the Lebanon promotion's precedent (`pilots/apify-lebanon/reconciliation/lebanon-promotion-reconciliation-report.md` §0):
- `early_career_relevance`, `internship_or_graduate_program_detected`, and `current_open_jobs_detected` are set to `unknown` for all 10 staged rows — not assessed this pass, not invented.
- `company_size_category` is a reasonable estimate from the evidence gathered (e.g. `large_enterprise` for NMC/Sundus given their stated scale, `small` for single-site medical centres), not independently verified against a headcount source.
- `linkedin_company_url`/`linkedin_jobs_url`/`linkedin_presence_status` are all `not_verified` — LinkedIn was not researched this pass, consistent with the fixed product policy.
- `source_confidence` is `high` for all 10 — each rests on a direct WebFetch of the company's own domain, never a search snippet or aggregator.

## 7. Open policy question for the product owner (not resolved here)

Should the 392-row manual-review queue and 21 enriched-but-unresolved `needs_manual_review` companies (real, confirmed-legitimate businesses that lack only a discoverable hiring channel — e.g. Design/architecture firms with only a general contact form, or SEHA-network hospitals blocked by a 403 this pass) be prioritized for a follow-up enrichment pass, or held indefinitely as a discovery backlog? No action was taken on this question — consistent with the Lebanon precedent, this report surfaces it rather than deciding it.
