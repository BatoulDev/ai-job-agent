# Apify Google Maps — Lebanon Pilot: Final Report

**Date executed:** 2026-09-05
**Status: EXECUTED. Paid runs completed within the approved $3.00 ceiling.**

---

## 1. Quick safety-recheck results (performed immediately before execution)

| Check | Result |
|---|---|
| Branch | `feat/job-source-discovery` — confirmed |
| `APIFY_API_TOKEN` present and working | Confirmed (46 chars; authenticated successfully against the actor endpoint). Value never printed, logged, or exposed at any point. |
| `.env.local` git-ignored | Confirmed via `git check-ignore -v .env.local` → matched by `.gitignore:36`; untracked in `git status` |
| Actor identity | Exact match: `id=nwua9Gu5YrADL7ZDj`, `username=compass`, `name=crawler-google-places` |
| Live pricing vs. previously confirmed | `place-scraped` unchanged at $0.004/place (FREE tier). One correction found: the pre-flight's assumed `apify-actor-start: $0.007/run` was stale — live pricing has been $0.00005/GB of actor memory (minimum 1 event) since February 2026, a **decrease**, not an increase. No stop condition triggered. |

All checks passed. Execution proceeded.

## 2. Schema drift discovered during execution (stopped, reported, user approved fix)

The very first submission attempt (before any run was created — $0 charged) was rejected twice by Apify with `400 invalid-input`:
1. `input.website` no longer accepts `"all"` — the live schema requires `"allPlaces"` / `"withWebsite"` / `"withoutWebsite"`.
2. `input.scrapeSocialMediaProfiles` is no longer boolean — the live schema requires an object (`{facebooks, instagrams, youtubes, tiktoks, twitters}`, each boolean).

Per the "prepared files changed unexpectedly → stop before any paid run" instruction, execution paused and the discrepancy was reported to the user before proceeding. The user approved fixing both fields to match the current schema (same disabled/all-inclusive meaning, just updated syntax — confirmed against the actor's live input schema, not guessed). No cost was incurred by either rejected attempt. All 8 runs then used the corrected input.

## 3. Planned runs before and after consolidation

| | Runs | Search terms | Regions | Categories | Max records |
|---|---|---|---|---|---|
| Before consolidation | 10 | 18 | 10/10 | 14/14 | 540 |
| After consolidation | **8** | 18 (unchanged) | 10/10 (unchanged) | 14/14 (unchanged) | 540 (unchanged) |

Consolidation folded the two smallest runs into two of the existing regional runs, exactly as approved:
- `run-baabda` ("construction company") → folded into `run-metn`, reworded to `"construction company Baabda"` to keep the district anchored in the search text itself.
- `run-countrywide` ("software company Lebanon") → folded into `run-beirut` (term text already carried the country-wide scope, unchanged).

No region/search-term pair was removed, `maxCrawledPlacesPerSearch` stayed at 30 everywhere, and the 540-record ceiling was unchanged. Full rationale in `consolidated-run-plan.md`; the exact submitted input is in `consolidated-apify-input.json`.

## 4. Run outcomes

All 8 runs **succeeded**, executed strictly sequentially, validation run first. No run was skipped or left unstarted.

| Run (execution order) | Region(s) | Items returned | Actual cost | Cumulative |
|---|---|---|---|---|
| 1. run-metn (validation) | Metn + Baabda | 90 | $0.4502 | $0.4502 |
| 2. run-beirut | Beirut + Lebanon country-wide | 90 | $0.4502 | $0.9004 |
| 3. run-greater-beirut | Greater Beirut | 39 | $0.1952 | $1.0956 |
| 4. run-jounieh | Jounieh/Keserwan | 60 | $0.3002 | $1.3958 |
| 5. run-tripoli | Tripoli/North Lebanon | 40 | $0.1852 | $1.5810 |
| 6. run-saida | Saida/South Lebanon | 33 | $0.1652 | $1.7462 |
| 7. run-zahle | Zahle/Bekaa | 53 | $0.2652 | $2.0114 |
| 8. run-nabatieh | Nabatieh | 60 | $0.3002 | **$2.3116** |

**Note on run-zahle:** the Apify run itself succeeded and was billed normally; a local network error occurred only in the follow-up dataset-download step (after billing had already happened). Per the "do not automatically retry a paid run" rule, the run was **not** resubmitted — the already-completed dataset was retrieved directly by its known run/dataset ID instead, at no additional cost.

Several runs returned fewer than their 30-per-term cap (e.g., only 3 hospital-category matches in Saida, 39 items across 2 terms in Greater Beirut) — this only reduces cost below the ceiling and is expected per the pre-flight's uncertainty notes.

## 5. Validation-run checks (run-metn, performed before continuing)

- **Output structure:** consistent field set across all 90 items; no missing/malformed `title` or `placeId` in the full dataset (0 malformed records across all 465 raw records, checked again after all runs).
- **Approved fields only:** confirmed no reviewer identities, no personal emails, no leads, no social-profile enrichment, no employee data, no downloaded images. Some default output fields beyond the originally-approved narrow list appeared regardless of settings (aggregate `reviewsDistribution` star breakdown, `openingHours`, a single default `imageUrl`, `imagesCount`, business amenity tags in `additionalInfo`, `claimThisBusiness`) — all are business-level metadata, not personal/reviewer data, but all were **excluded from the normalized output** to strictly match the originally approved field list.
- **Cost:** $0.4502 for 90 places, consistent with the worst-case per-place estimate.
- **Result count:** 90/90 requested, all 3 search terms represented.
- **Duplicates/malformed:** no duplicate `placeId` within the run.

Validation passed; remaining 7 runs proceeded.

## 6. Raw and normalized record counts

- **Raw record count (all 8 runs combined):** 465
- **Malformed records:** 0
- **Normalized unique companies:** 446
- **Duplicates folded in:** 19 (matched by normalized domain or normalized company name within this pilot's own results)
- **Ambiguous cases flagged for manual review (not auto-merged, not auto-separated):** 4 companies across 2 name-collision groups — held as separate rows in `normalized-companies.csv` with `flagged_for_review=true`, pending human review per the dedup hierarchy's rule to never auto-resolve ambiguous collisions.

Deduplication strictly followed the approved hierarchy: normalized domain → Google place ID (used only to detect duplicates within this pilot, since the existing registries don't yet store place IDs) → normalized company name (legal suffixes/punctuation stripped) → phone/address as secondary corroboration only → manual review for anything else. This pilot's dedup was performed **only within its own 465 records** — no cross-check merge into `lebanon.csv` or `master-company-registry.csv` was performed, and none is proposed here (see §9).

## 7. Counts by region and category

**By region (unique companies):**

| Region | Count |
|---|---|
| Nabatieh | 60 |
| Beirut | 59 |
| Metn | 59 |
| Jounieh/Keserwan | 57 |
| Zahle/Bekaa | 52 |
| Tripoli/North Lebanon | 38 |
| Greater Beirut | 39 |
| Lebanon country-wide | 30 |
| Baabda | 30 |
| Saida/South Lebanon | 30 |

**By category (unique companies; a company can span >1 category if it matched multiple search terms):**

| Category | Count |
|---|---|
| Construction and contracting | 60 |
| Software and IT services | 59 |
| Manufacturing and factories | 56 |
| Retail/distribution/e-commerce | 40 |
| Accounting/audit/financial services | 30 |
| Marketing/advertising/graphic design | 30 |
| Hotels/restaurants/hospitality groups | 30 |
| Schools/universities/training institutions | 30 |
| Engineering and industrial companies | 30 |
| Architecture and interior design | 28 |
| Logistics and transportation | 27 |
| NGOs and professional services | 22 |
| Telecom and fintech | 9 |
| Hospitals/clinics/laboratories | 3 |

Nabatieh (previously zero registry coverage) returned a full 60 usable candidates — a positive signal for the specific gap this pilot targeted. The hospital-category search in Saida returned very few real hospital matches (3), suggesting this search term/region pairing has limited density on Google Maps relative to its 30-record cap.

## 8. Website coverage

- **With website:** 226 / 446 (50.7%)
- **Without website:** 220 / 446 (49.3%)

## 9. Cost summary and ceiling compliance

| Item | Value |
|---|---|
| Runs executed | 8 / 8 (all succeeded) |
| Runs failed | 0 |
| Runs skipped | 0 |
| Runs unstarted | 0 |
| **Total actual cost** | **$2.3116** |
| Approved ceiling | $3.00 |
| **Ceiling respected** | **Yes** — $0.6884 under the ceiling |

Cumulative cost was checked and logged after every run before starting the next one; no run was started that could have pushed cumulative cost over $3.00.

## 10. Files created or modified

All new, all confined to the pilot directory — no existing file outside this directory was modified:

- `docs/job-source-discovery/pilots/apify-lebanon/consolidated-run-plan.md` (new)
- `docs/job-source-discovery/pilots/apify-lebanon/consolidated-apify-input.json` (new — the exact 8-run input actually submitted, including the post-discovery schema fix)
- `docs/job-source-discovery/pilots/apify-lebanon/raw/run-*.json` (new, 8 files — full raw dataset + run metadata per run)
- `docs/job-source-discovery/pilots/apify-lebanon/normalized-companies.csv` (new — 446 deduplicated companies, approved fields only)
- `docs/job-source-discovery/pilots/apify-lebanon/pilot-stats.json` (new — machine-readable summary stats)
- `docs/job-source-discovery/pilots/apify-lebanon/pilot-report.md` (this file, new)

The original pre-approval documents (`pilot-plan.md`, `proposed-queries.csv`, `proposed-apify-input.json`, `cost-estimate.md`, `preflight-validation.md`) were **not modified** — they remain the historical record of what was proposed and validated before execution.

## 11. CSV/JSON validation results

- `normalized-companies.csv`: parsed with a quote-aware CSV parser; 446 data rows + 1 header row, **every row has exactly 16 columns** (no structural corruption from embedded commas in addresses/names).
- `pilot-stats.json`: valid JSON, parses cleanly.
- All 8 `raw/run-*.json` files: valid JSON, each containing the full run metadata (status, actual `usageTotalUsd`, input used, item count) plus the complete raw dataset.
- 0 malformed records (missing `title` or `placeId`) across all 465 raw records.

## 12. Production registry confirmation

`git status --short` and `git diff --stat` confirm **no changes to `lebanon.csv`, `master-company-registry.csv`, or any other tracked file** — only the new, untracked `docs/job-source-discovery/` pilot files exist. No company from this pilot was added to any production registry. No application code, database, migration, or n8n workflow was touched. No git staging, commit, push, or branch action occurred; the branch remains `feat/job-source-discovery`.

## 13. Recommended next step (not executed)

Have a human reviewer look at the 4 flagged ambiguous-name records in `normalized-companies.csv` (`flagged_for_review=true`) and spot-check a sample of the 446 candidates for relevance (a small amount of category noise is expected from broad search terms, e.g. a nightclub named "The Grand Factory" matching the "factory" search term) before any decision is made about promoting a subset of these companies into `lebanon.csv` — which would require a separate, explicit approval as stated in the original pilot plan.
