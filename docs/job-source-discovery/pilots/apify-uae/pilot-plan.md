# Apify Google Maps — Dubai + Abu Dhabi Company-Discovery Pilot Plan

**Date:** 2026-09-07
**Status: PROPOSED, NOT EXECUTED.** No Apify actor has been called for this pilot. No credits have been spent. This document, `proposed-queries.csv`, `proposed-apify-input.json`, and `cost-estimate.md` are the complete pre-execution deliverable set. Execution requires explicit user approval of the exact cost ceiling in `cost-estimate.md`, consistent with the precedent set by `pilots/apify-lebanon/pilot-plan.md`.

---

## 1. Apify configuration status

**Apify access IS configured in this project.** `APIFY_API_TOKEN` exists in `.env.local` (confirmed by inspection of the variable name only — the value itself was never printed or logged). This is a change from the Lebanon pilot's starting state ("not configured") — the credential was added to the project after that pilot plan was written, presumably as part of executing the Lebanon pilot itself (`pilots/apify-lebanon/raw/*.json` contains real run output, confirming the token was live and used at that time).

**Consequence:** unlike the Lebanon pilot's original plan, this pilot *can* be executed directly from this session via an authenticated API call, without requiring a separate manual step — but it will still not be executed without the same explicit cost-ceiling approval Lebanon required, since real Apify credits would be spent.

## 2. Actor confirmed

**`compass/crawler-google-places`** ("Google Maps Scraper") — the same actor used for the Lebanon pilot (`pilots/apify-lebanon/`) and evaluated for the UAE specifically in the 6-market source-expansion project (`source-expansion/apify-discovery-design.md`, UAE section) and `source-expansion/source-catalog.csv` (`src-ae-bayt-uae`, `src-ae-gulftalent-apify` rows document adjacent job-board actors also considered but not selected as the primary discovery mechanism — Google Maps remains the strongest **company-identity discovery** source, since job boards only surface companies that are already actively hiring, which understates true employer coverage).

## 3. Existing UAE coverage inspected (baseline this pilot is measured against)

- `uae.csv`: **39 records** (27 `verified`, 12 `needs_manual_review`) — target-city split: **Dubai 23 · Abu Dhabi 12 · Sharjah 2 · Country-wide 1 · Dubai;Sharjah 1**. Computed directly from the file this pass (not reused from a prior report), see `discovery-report.md` §22.12 for the last full narrative snapshot (27 verified / 12 review, matching exactly).
- `master-company-registry.csv`: 288 records across all markets combined (rebuilt most recently during the Lebanon promotion, per `discovery-report.md` §23).
- **Industry-distribution gap analysis** (computed directly from `uae.csv`'s `industry` column this pass): existing UAE rows cluster heavily in **Aviation (4), Banking (4), Higher Education/Telecom (2 each), Consulting (2)** with only **one row each** (or zero) in: civil/electrical/mechanical engineering, architecture, interior design, graphic design, marketing/media, HR/recruitment (Bayzat is insurtech, not a recruitment agency), construction (Emaar is a developer, not a contractor), K-12 schools (zero — only 2 universities), hospitals (Cleveland Clinic Abu Dhabi only), manufacturing (EGA only), NGOs/international organizations (zero). This pilot's query design (§4 below) directly targets these gaps rather than re-covering the already-dense aviation/banking/telecom sectors.
- `source-expansion/source-catalog.csv`: 25 UAE-tagged sources now cataloged (18 from the original source-expansion pass + 7 added this pass — TECOM/DIC unified community directory, Dubai Design District community+retail directory, DHCC facility directory, KHDA Dubai private-school directory, ADEK Abu Dhabi private-school directory, DHA Dubai licensed-facility register, arab.org UAE NGO directory). None of these directory sources were used to extract company names into any candidate file this pass — per the DMCC precedent (`src-ae-dmcc-directory`, explicitly excluded on terms-of-service grounds), directory-only sources are catalogued for future reference and are not treated as sufficient standalone verification per the task's explicit Section 3 rule ("A directory result alone is not sufficient final verification").

## 4. Query design — 15 gap-sector categories × 2 cities, not a full cross-product

Per the task's explicit instruction to search Dubai and Abu Dhabi **separately** and avoid overconcentration in technology, this pilot uses **30 search terms across 10 runs** (5 sector-cluster runs per city), deliberately selected so that:
- **Both requested cities appear with an identical, balanced set of 15 categories each** — no city receives a richer or thinner query set than the other.
- **Categories were chosen specifically to fill the gaps identified in §3**, not to re-search sectors the existing registry already covers well. Only **one** of the 15 categories per city ("software company") is a general technology query — the other 14 span engineering, architecture, interior design, graphic design, marketing, HR/recruitment, accounting, construction, logistics, retail, hospitality, healthcare, manufacturing, and NGOs, directly satisfying the task's "avoid overconcentration in technology" instruction and its explicit sector list (Section 2 of the task).
- Runs are grouped into **5 sector-clusters of 3 categories each, per city** (10 runs total), mirroring the Lebanon pilot's "bounded batches with checkpoints after every batch" design — a failure partway through only loses one 3-term/90-record batch, not the whole pilot, and each run is independently retryable/resumable.

Full detail: `proposed-queries.csv` (30 rows: `query_id`, `region_label`, `region_query_string`, `category`, `search_term`, `max_results_per_search_term`, `actor_run_group`, `rationale`).

## 5. Proposed Apify input

`proposed-apify-input.json` contains **10 complete, standalone actor-input objects** (5 runs for Dubai, 5 for Abu Dhabi — one per sector-cluster, since grouping 3 related search terms per run keeps run count low while preserving checkpoint granularity). Every run shares the same data-minimization settings (see §6).

| Run | City | Sector cluster | Search terms | Max records this run |
|---|---|---|---|---|
| run-dubai-g1 | Dubai | Engineering & Design | engineering consultancy, architecture firm, interior design company | 90 |
| run-dubai-g2 | Dubai | Creative & Professional Services | graphic design agency, marketing agency, HR recruitment agency | 90 |
| run-dubai-g3 | Dubai | Finance & Built Environment | accounting firm, construction company, logistics company | 90 |
| run-dubai-g4 | Dubai | Retail, Hospitality & Healthcare | retail company, hotel group, hospital | 90 |
| run-dubai-g5 | Dubai | Manufacturing, Tech & Social Sector | manufacturing company, software company, NGO nonprofit organization | 90 |
| run-abudhabi-g1 | Abu Dhabi | Engineering & Design | engineering consultancy, architecture firm, interior design company | 90 |
| run-abudhabi-g2 | Abu Dhabi | Creative & Professional Services | graphic design agency, marketing agency, HR recruitment agency | 90 |
| run-abudhabi-g3 | Abu Dhabi | Finance & Built Environment | accounting firm, construction company, logistics company | 90 |
| run-abudhabi-g4 | Abu Dhabi | Retail, Hospitality & Healthcare | retail company, hotel group, hospital | 90 |
| run-abudhabi-g5 | Abu Dhabi | Manufacturing, Tech & Social Sector | manufacturing company, software company, NGO nonprofit organization | 90 |
| **Total** | **2 cities** | **10 runs** | **30 search terms** | **900** |

## 6. Data minimization — enrichment explicitly disabled

Identical toggle set to the Lebanon pilot (see `pilots/apify-lebanon/pilot-plan.md` §6 for the full field-by-field rationale) — `scrapeContacts`, `scrapeSocialMediaProfiles`, `maximumLeadsEnrichmentRecords`, `verifyLeadsEnrichmentEmails`, `maxReviews`, `scrapeReviewsPersonalData`, `maxImages`, `maxQuestions`, `enableCompetitorAnalysis`, `scrapePlaceDetailPage`, and the restaurant/venue-specific enrichments are all disabled/zeroed in every proposed run. **Fields that will be collected** (default, non-enriched output only): business name, category, website, public phone (if present), address/city/region, Google Maps URL, place ID, rating/review count, source, retrieval timestamp — the exact field list the task authorizes in Section 4. No reviews, no reviewer identities, no personal emails, no employee data, no social-profile enrichment will be collected.

## 7. Deduplication design (against `uae.csv` and `master-company-registry.csv`, read-only — no file will be modified by this pilot)

Same priority order as the Lebanon pilot (`pilots/apify-lebanon/pilot-plan.md` §7): normalized official domain (strongest signal) → Google place ID (within-pilot only, since the registry doesn't store place IDs) → normalized company name (legal-suffix-stripped) → phone/address as a corroborating-only signal → manual review for any non-clean match. **Dubai/Abu Dhabi branch handling**: per the task's explicit Section 5 instruction, a company found operating in both cities is folded into **one canonical row** with `target_city = "Dubai; Abu Dhabi"` (matching the existing `uae.csv` convention already used for Al Tamimi & Company's `"Dubai; Sharjah"` value) rather than being duplicated — this grouping is a post-collection reconciliation step, not something executed during this preparation phase.

## 8. What happens if this plan is approved

If approved, the **only** action that will occur is: the 10 actor runs in `proposed-apify-input.json` are submitted to Apify's `compass/crawler-google-places` actor, up to the approved cost ceiling, and the raw results are saved to `docs/job-source-discovery/pilots/apify-uae/raw/` for review — structured identically to the Lebanon pilot (a raw JSON per run, a normalized CSV applying the deduplication logic above, and a pilot report). **No company will be added to `uae.csv` or `master-company-registry.csv`. No job will be ingested. No application/database/n8n change will occur.** A second, separate approval would be required before any discovered company is promoted out of a review queue into the production registry CSVs (matching the Lebanon precedent, where pilot execution and registry promotion were two separately-approved steps).

## 9. Explicit non-actions (unchanged from every task in this project)

Not performed and not proposed as part of this plan: modifying `uae.csv` or `master-company-registry.csv`; adding any pilot company to the registry; ingesting jobs; building n8n automation; scraping LinkedIn; modifying application/database code; git staging, commit, push, merge, or branch switch.
