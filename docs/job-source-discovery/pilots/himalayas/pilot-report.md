# Himalayas API Pilot — Report

**Date:** 2026-09-04
**Status:** COMPLETE. Strictly bounded, read-only technical pilot of the official Himalayas Remote Jobs API only.
**Scope reaffirmed:** This is a validation pilot for International Remote job discovery and Lebanon-eligibility classification logic. It is NOT the full company-discovery automation and does not replace the future Lebanon/Gulf Apify pilots described in `docs/job-source-discovery/source-expansion/apify-discovery-design.md`.
**Safety confirmation:** Official documented API only. No scraping. No Apify credits spent. No LinkedIn access. No n8n workflow touched. No Supabase/production database writes. No production registry CSV modified. No jobs ingested into the application. No git staging/commit/push/merge/branch switch.

---

## 1. Requests and results

| Metric | Value |
|---|---|
| Total HTTP requests made | **13** (all `GET`, all `200 OK`, zero `429`/`400` responses) |
| Endpoints exercised | `GET /jobs/api/search` (11 requests), `GET /jobs/api` (2 requests) |
| Raw job entries returned across all requests | 152 |
| **Unique jobs** (deduplicated by `guid`) | **123** |
| Duplicate entries (same `guid` returned by more than one request) | 29 |
| **Duplicate rate** | **19.1%** (29 / 152) — expected and benign: role-family queries (R7–R13) all filtered on `country=LB`, so they naturally re-surfaced some jobs already seen in the general `country=LB` pull (R1/R2) |

Full per-request detail (endpoint, exact query parameters, purpose, and `totalCount`/`returned`/`nextCursor` for each) is in `api-contract.md` §3–4 and reproducible from `raw-sample.json`.

## 2. Unique employers represented

**92 unique employers** across the 123 unique jobs. Full list in `normalized-jobs.csv`. No single employer dominated the sample (the most frequent, micro1, appeared on 4 of 123 jobs — all as a recruiting/EOR platform placing candidates with client law firms, not micro1's own internal hiring, consistent with the classification caution already documented in the prior source-expansion project for this exact company).

## 3. Jobs explicitly supporting Lebanon

**26 of 123 unique jobs (21.1%)** were classified `explicitly_hires_in_lebanon` — meaning the job's own `locationRestrictions` field (a structured API field, not inferred from text) explicitly named `"Lebanon"`, either alone or as one of several named eligible countries.

These 26 jobs come from **12 distinct employers**: BigHand, Ensabill, GRID, Greenpeace International, Jobs for Humanity, Perle Systems, RecruitMe Plus, Spiralyze, Translated, Whitecollars, XS.com, division50.

This is a substantially stronger and more concrete finding than anything the prior (search-snippet-based) discovery pass produced for this market — that pass found exactly 1 directly-evidenced Lebanon-specific posting (Greenpeace International) via a single WebFetch of a filtered page. This pilot's direct, per-job API inspection found **26 real postings across 12 employers**, all with the same class of direct structured evidence.

**Important caveat, confirmed empirically in this pilot**: the `country=LB` URL/filter itself is not a reliable Lebanon-eligibility signal on its own — it returned `totalCount=2119`, but only 26 of the 123 unique jobs actually sampled under that filter (and its related role-family sub-queries) carried a `locationRestrictions` array that named Lebanon. The remaining jobs returned under `country=LB` were worldwide-open (empty `locationRestrictions`) or restricted to other countries entirely. **Any future ingestion logic must check the job's own `locationRestrictions` field per job, never trust the country-filtered URL/count alone.**

## 4. Worldwide / MENA / EMEA results

| Classification | Count | % of 123 |
|---|---|---|
| `worldwide_remote` | 77 | 62.6% |
| `explicitly_hires_in_lebanon` | 26 | 21.1% |
| `emea_remote` | 12 | 9.8% |
| `country_restricted` | 7 | 5.7% |
| `mena_remote` | 1 | 0.8% |
| `timezone_compatible_but_location_unclear` | 0 | 0% |
| `lebanon_excluded` | 0 | 0% |
| `location_unclear` | 0 | 0% |

`worldwide_remote` classification rests on the API's own documented semantic ("empty array means worldwide") applied to a structured field — this is tier-4 evidence per this project's evidence hierarchy (maintained structured API data with explicit location restrictions), not a guess from marketing language.

## 5. Restricted or excluded results

**7 jobs (5.7%)** were classified `country_restricted` — each had a non-empty `locationRestrictions` array naming specific countries that did not include Lebanon (e.g., `["United States"]`, `["Colombia"]`, `["Japan"]`). Per this task's explicit instruction, these are correctly treated as **not** available to Lebanon-based candidates despite being labeled "remote" by the employer — a concrete, real-data illustration of exactly the risk this project's stricter eligibility taxonomy exists to prevent.

**Zero jobs** were classified `lebanon_excluded`. This is a genuine finding about the API's schema, not a gap in this pilot's effort: Himalayas' `locationRestrictions` field is an **inclusion list** ("countries where applicants must be based"), not an exclusion list — there is no structured field in this API that names countries a job explicitly bars. A `lebanon_excluded` classification would require either a job whose `locationRestrictions` names many countries but conspicuously omits Lebanon from an otherwise-broad regional list (a text/judgment call, not this pilot's structured-evidence standard) or explicit exclusionary language in the free-text `description` field, which this pilot did not text-mine (out of scope for a structured-data pilot).

## 6. Unclear results

**Zero jobs** were classified `timezone_compatible_but_location_unclear` or `location_unclear`. This is a direct, positive consequence of Himalayas' data quality: every one of the 123 unique jobs sampled carried a structured `locationRestrictions` array (even if empty), so this pilot never had to fall back on the weaker "unclear" categories that dominated the prior source-expansion project's text/snippet-based findings for other sources. This is worth stating plainly as a finding: **a well-structured source like Himalayas can largely eliminate the "unclear" middle ground that was unavoidable with weaker sources** (e.g., DuckDuckGo/Doist in the prior pass, where no structured eligibility field existed at all).

## 7. Role-family coverage

| Role family | Jobs in sample | Of which explicitly_hires_in_lebanon |
|---|---|---|
| marketing_content | 29 | 11 |
| project_product_management | 21 | 2 |
| customer_support | 20 | 5 |
| software_data_ai_it | 18 | 0 |
| other_unclassified | 9 | 0 |
| administration_operations | 9 | 4 |
| design | 6 | 2 |
| sales_business_development | 4 | 2 |
| finance_accounting | 4 | 0 |
| hr_recruitment | 3 | 0 |

All 8 explicitly-required role families from the task instructions were represented in this sample (software/data/AI, marketing/content, design, finance/accounting, HR/recruitment, administration/operations, customer support, sales/business development, project/product management). **Gap worth noting**: none of the 26 Lebanon-eligible postings fell in software/data/AI/IT, finance/accounting, or HR/recruitment in this specific bounded sample — this does not mean no such jobs exist on Himalayas, only that this pilot's small, bounded sample didn't surface any. A larger future sample (still within documented rate limits) would be needed to check whether this gap persists.

`employment_type` distribution across the 123 unique jobs: Full Time 91, Contractor 24, Part Time 6, Intern 2 — confirming the API returns a genuine mix of employment structures, not only full-time roles.

## 8. Stale/expired result rate

**0 of 123 unique jobs (0%)** had an `expiryDate` in the past relative to the pilot's fetch time. All sampled listings were current/live as of 2026-09-04.

**A methodological note worth recording**: this pilot's own analysis script initially miscalculated staleness as 100% (123/123) due to a units bug — treating `pubDate`/`expiryDate` as Unix milliseconds per the (incorrect) OpenAPI-spec summary, when the live API actually returns Unix seconds (see `api-contract.md` §7, Correction 2). This was caught by sanity-checking a single job's `pubDate` against a known-plausible posting date, not assumed. The corrected calculation (0% stale) is the one reported here and used throughout `normalized-jobs.csv`.

## 9. API quality and limitations

**Strengths (all directly verified this pilot, not assumed):**
- Free, no-authentication, officially documented, versioned via a changelog embedded in every response (`comments` field).
- Structured per-job location-eligibility data (`locationRestrictions`) — the strongest single data quality feature for this project's purposes, verified against 123 real jobs.
- Working pagination on the browse endpoint (cursor-based, confirmed zero duplicate `guid`s across 2 pages).
- Clean employment-type, seniority, and role-category fields on every job.
- Zero stale listings in this sample — data appears genuinely fresh (24-hour refresh cycle, per documentation).

**Limitations (all directly verified this pilot, not assumed):**
- The `country=LB` filter's `totalCount` (2,119) is **not** a Lebanon-specific count — this pilot confirmed only ~21% of jobs actually sampled under that filter carry Lebanon in their structured restrictions list; the rest are worldwide-open jobs that simply don't exclude Lebanon.
- Two real discrepancies between the previously-summarized OpenAPI spec and the live API's actual behavior were found and corrected (see `api-contract.md` §7) — `locationRestrictions` is a plain string array, not an array of objects; `pubDate`/`expiryDate` are Unix seconds, not milliseconds. **Any future integration must use the live-verified contract in `api-contract.md`, not the raw OpenAPI-spec summary alone.**
- The search endpoint (`/jobs/api/search`) does not support cursor pagination — only the browse endpoint does. A future ingestion pipeline needing to page through filtered search results must use the `page` integer parameter.
- No direct MENA/EMEA region filter exists; this pilot used `timezone=UTC+2` as an imperfect Beirut-timezone proxy, which returned a large, genuinely distinct result set but does not itself confirm location eligibility (timezone compatibility ≠ location eligibility, per this project's own taxonomy).
- No exclusion-list field exists (`lebanon_excluded` cannot be structurally derived from this API without free-text mining, which was out of scope for this pilot).

## 10. Suitability for recurring ingestion

**Yes, this source is suitable for recurring ingestion**, with two conditions:
1. **Poll at most once per day** — the documented data-refresh cycle is 24 hours, and the documentation explicitly states there is no benefit to polling more frequently.
2. **Filter on `locationRestrictions` per job**, never on the `country=` URL parameter's result count alone, to avoid materially overcounting Lebanon-eligible postings (this pilot found the naive country-filter approach would overcount by roughly 5x relative to the structurally-confirmed Lebanon-eligible subset).

## 11. Recommended polling frequency

**Once per 24 hours**, matching the documented data-refresh cadence exactly. Polling more often would consume rate-limit budget for zero additional freshness benefit, per the API's own stated behavior.

## 12. Proposed deduplication key

**`guid`** (the API's own unique job identifier) — confirmed unique across all 123 jobs in this sample (123 unique `guid` values from 152 raw entries, with the 29 "duplicates" being the exact same `guid` re-appearing across different filtered queries, not a `guid` collision between different jobs). `applicationLink` (job URL) was also independently confirmed unique across all 123 jobs in this sample, making it a viable secondary/fallback dedup key, though `guid` is the primary recommendation since it is the field the API itself designates as the canonical identifier.

## 13. Estimated operational cost

**Effectively free at pilot scale and at the recommended once-daily production cadence.** The API requires no paid tier, no API key, and no Apify credits. The only cost consideration is staying within the undocumented numeric rate limit (this pilot's 13 requests in one burst triggered zero `429` responses, suggesting meaningful headroom above pilot scale) — if a future production integration needs a higher sustained request volume than the default limit allows, the documented path is a direct email to `hi@himalayas.app` requesting an increased quota, not a paid-tier signup (no paid tier was found to exist for this API).

## 14. Exact next engineering step

This pilot validates that a direct integration is technically viable and cheap. The exact next step, **requiring separate explicit authorization before it proceeds** (this pilot's own scope ends here):

1. A human decision on whether to proceed to a real (still-bounded) integration test — e.g., a scheduled job that polls `GET /jobs/api/search?country=LB&limit=20` once daily and writes results to a **staging** table, not production, for a trial period.
2. Before that integration is built, the engineering design must incorporate this pilot's two confirmed schema corrections (§9 above / `api-contract.md` §7) and the confirmed pagination behavior (page-based for search, cursor-based for browse).
3. A separate design pass to define how `lebanon_eligibility` values map onto this project's actual product-facing eligibility model, and how `reconciliation_status` (see `normalized-jobs.csv`) feeds into a human verification queue rather than auto-publishing new employers.

No part of this next step was performed under this pilot.

---

## 15. Company reconciliation summary

92 unique employers were checked against `master-company-registry.csv` (254 rows, read-only — not modified). Full per-job reconciliation status is recorded in `normalized-jobs.csv`'s `reconciliation_status` column.

| Reconciliation status | Unique employers |
|---|---|
| `already_present` | 1 (Tabby → `cc-tabby`, already registered under Saudi Arabia/UAE — a genuine cross-market signal, consistent with the same finding in the prior source-expansion pass) |
| `new_candidate` | 86 |
| `unverifiable` | 5 (Choice, Native, Collider, GPC, CXM — single generic-word company names with real name-collision risk and no distinguishing context available in this API response; flagged rather than guessed, consistent with this project's established caution pattern) |
| `duplicate_or_alias` | 0 |

**No employer discovered through this pilot was added to `master-company-registry.csv` or any other production registry file.** All 86 `new_candidate` employers — and, in particular, the 12 employers behind the 26 `explicitly_hires_in_lebanon` postings — are recommended to enter a future manual-verification queue (own-domain/careers-page confirmation) before any are treated as verified, per this task's explicit instruction that a new employer discovered through the API must not be automatically added as verified.

**Highest-priority verification-queue entries** (strongest Lebanon evidence + real employer identity): BigHand, Ensabill, GRID, Greenpeace International, Jobs for Humanity, Perle Systems, RecruitMe Plus, Spiralyze, Translated, Whitecollars, XS.com, division50 — the 12 employers with a directly-confirmed, structured, Lebanon-inclusive `locationRestrictions` entry.

---

## 16. Confirmation of scope compliance

Only the official, documented Himalayas API was accessed (13 `GET` requests, no authentication, no scraping). No Apify actor was invoked and no Apify credits were spent. LinkedIn was never accessed. No n8n workflow was touched. No Supabase or production database write occurred. All 6 production registry CSVs (`lebanon.csv`, `saudi-arabia.csv`, `uae.csv`, `qatar.csv`, `kuwait.csv`, `international-remote.csv`) and `master-company-registry.csv` were read-only inputs for reconciliation and were not modified — verified by line-count comparison before and after this pilot (see the validation section of the final response). No job was ingested into the application. No git staging, commit, push, merge, or branch switch occurred at any point in this pilot.
