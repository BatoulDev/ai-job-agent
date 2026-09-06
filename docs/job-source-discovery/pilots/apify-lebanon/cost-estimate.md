# Apify Google Maps — Lebanon Pilot: Cost Estimate

**Status: PROPOSED. No actor has been run. No credits have been spent. This document requires explicit user approval before any execution.**

---

## 1. Query and result-count summary

| Metric | Value |
|---|---|
| Number of Apify actor runs proposed | **10** |
| Number of distinct search terms across those runs | **18** |
| Regions covered | **10 of 10 requested** (Beirut, Greater Beirut, Metn, Baabda, Jounieh/Keserwan, Tripoli/North Lebanon, Saida/South Lebanon, Zahle/Bekaa, Nabatieh, Lebanon country-wide) |
| Categories covered | **14 of 14 requested** |
| Max results per search term (`maxCrawledPlacesPerSearch`) | **30** |
| **Absolute maximum total records across the whole pilot** | **540** (18 search terms × 30) |

This is a deliberately small, bounded sample — not a full extraction. 540 records is the hard ceiling *by construction* (the actor input itself caps each search term at 30 via `maxCrawledPlacesPerSearch`), not an estimate that could be exceeded by the actor returning more than requested.

## 2. Actor and pricing basis

**Actor:** `compass/crawler-google-places` ("Google Maps Scraper"), re-verified live today (2026-09-04) via direct fetch of its Apify Store listing — not assumed from the prior source-expansion pass's notes.

**Documented base pricing (pay-per-event):** "**from $1.50 / 1,000 scraped places**." This is the headline rate for basic place records with all enrichments (contacts, leads, reviews, images, social profiles, competitor analysis) disabled — exactly the configuration proposed in `proposed-apify-input.json`. No enrichment add-on charges apply to this pilot's proposed input, since every enrichment toggle is explicitly set to `false`/`0` (see `pilot-plan.md` §6).

**`scrapePlaceDetailPage` is set to `false`** in every proposed run, which avoids the separate "additional place details" charge entirely — this pilot only needs the default (non-detail-page) fields, all of which are already present without opening each place's detail page.

## 3. Expected maximum Apify cost

| Basis | Calculation | Cost |
|---|---|---|
| Base rate ("from $1.50/1,000 places") applied to the hard ceiling of 540 records | 540 / 1,000 × $1.50 | **$0.81** |

**Stated cost ceiling for this pilot: up to approximately $1.00, hard-capped at $2.00.** The gap between $0.81 (calculated) and the $2.00 hard cap exists specifically to absorb the pricing uncertainty in §4 below — this pilot will not knowingly be run in a way that could exceed $2.00, and if the actor's actual observed per-1,000 rate would push the run past that figure, the run will be stopped (see §6, Stop Conditions) rather than allowed to continue.

## 4. Uncertainty in this estimate

This is stated honestly rather than presented as a false-precision number:

- **"From $1.50/1,000" is a headline/floor rate, not necessarily the exact rate on every Apify plan tier.** The actor's documentation shows enrichment add-ons priced differently across plan tiers (e.g., company-contacts enrichment: $0.20/100 on the FREE plan vs. $0.15/100 on SILVER — a ~33% premium on the free tier for that specific add-on). No equivalent free-vs-paid-tier breakdown was published for the **base place-scraping rate itself**, so it is not confirmed whether $1.50/1,000 is the free-tier rate, a paid-tier rate, or tier-invariant. **Because Apify access is not configured in this project (see `pilot-plan.md` §1), the actual plan tier that would run this pilot is unknown, and this estimate cannot be tier-verified in advance.**
- Apify's platform also typically has a small fixed per-run initiation cost (observed on sibling actors evaluated earlier in this project, e.g. `~$0.0005/run` for the Bayt actor) — not confirmed for this specific actor's current pricing page, but included conceptually in the $2.00 ceiling's margin rather than added as a separate line item, since 10 runs at even several cents each would still be well under a dollar.
- **Google Maps' own per-search-area result ceiling** (documented: up to 120 places when no location is given) does not apply here since every run specifies a real `locationQuery`, but very dense urban search terms (e.g., "software company" in Beirut) could theoretically return fewer than 30 real matches if Google's own index has fewer relevant businesses than requested — this would only ever **reduce** actual cost below the $0.81 calculated maximum, never increase it, since `maxCrawledPlacesPerSearch` is a hard per-search-term cap.
- No run in this proposal can return more than its stated `max_records_this_run`, so the **540-record ceiling itself carries no uncertainty** — only the exact dollar-per-1,000 conversion rate does.

## 5. Duplicate-query and runaway-pagination prevention

- **No two proposed runs target the same (region, search-term) pair** — verified programmatically: all 18 rows in `proposed-queries.csv` have a unique `(region_query_string, search_term)` combination.
- **Every run has an explicit `maxCrawledPlacesPerSearch: 30`** — the actor cannot "runaway paginate" past this per-search-term cap by design; it is a hard input constraint, not a soft suggestion or a post-hoc filter.
- **No run uses `startUrls` or an unbounded `allPlacesNoSearchAction` sweep** — every run uses a specific `searchStringsArray` + `locationQuery` pair, the actor's own most-bounded, most-predictable mode of operation.
- **No run will be resubmitted or retried automatically** on partial failure — if a run errors or returns incomplete results, the plan is to stop and report, not to re-queue it (consistent with the mandatory stop condition in §6).
- **This document itself is the single source of truth for what will run.** No query, region, or category beyond what is listed in `proposed-queries.csv` and `proposed-apify-input.json` will be added during execution without a new, separate approval.

## 6. Stop conditions

Execution — if and when separately approved — will halt and report back to the user, without proceeding further, if any of the following occurs:

1. **The approved cost ceiling ($2.00, or whatever figure the user explicitly approves instead) is reached or would be exceeded by continuing.**
2. **Apify credentials/access turn out not to be available** at execution time (consistent with the current "not configured" finding in `pilot-plan.md` §1) — this itself is a stop condition, not something to be silently worked around by requesting new credentials without asking first.
3. **The actor's live pricing, input schema, or rate limits differ materially from what is documented in this cost estimate** at the moment of execution (the actor's documentation could change between this pilot-plan being written and being executed) — any such difference will be reported before proceeding, not absorbed silently.
4. **Any single run returns an error, a rate-limit response, or an unexpectedly large/small result count** inconsistent with the bounded design above.
5. **Any of the explicit non-actions listed in `pilot-plan.md` §9 would otherwise occur** (e.g., if executing this plan would require modifying a production file to store results — it will not; results go only into `docs/job-source-discovery/pilots/apify-lebanon/`).

## 7. Summary for approval

| Item | Value |
|---|---|
| Actor | `compass/crawler-google-places` (Google Maps Scraper) |
| Runs | 10 |
| Search terms | 18 |
| Max results per search term | 30 |
| **Absolute maximum records** | **540** |
| **Calculated maximum cost** | **$0.81** |
| **Requested approval ceiling** | **$2.00 (hard stop)** |
| Enrichment | All disabled (no reviews, no images, no leads, no contacts, no social profiles, no competitor analysis) |
| Fields collected | Business name, category, website, public phone (if present), address/city/region, Google Maps URL, place ID, rating/review count, source, retrieval timestamp only |
| Production registry changes during this pilot | **None** |

**This plan is not executed. It awaits explicit approval of the cost ceiling above before any Apify actor is called.**
