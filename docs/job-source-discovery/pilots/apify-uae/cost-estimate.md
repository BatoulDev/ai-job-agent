# Apify Google Maps — Dubai + Abu Dhabi Pilot: Cost Estimate

**Status: PROPOSED. No actor has been run for this pilot. No credits have been spent. This document requires explicit user approval before any execution.**

---

## 1. Query and result-count summary

| Metric | Value |
|---|---|
| Number of Apify actor runs proposed | **10** |
| Number of distinct search terms across those runs | **30** |
| Cities covered | **2 of 2 requested** (Dubai, Abu Dhabi) |
| Categories covered | **15 of 15 gap-sector categories, identical set per city** |
| Max results per search term (`maxCrawledPlacesPerSearch`) | **30** |
| **Absolute maximum total records across the whole pilot** | **900** (30 search terms × 30) |

This is a deliberately bounded sample, sized close to (1.67×) the Lebanon pilot's 540-record ceiling to reflect covering 2 cities with a broader gap-sector set, not an open-ended extraction. 900 records is the hard ceiling *by construction* (`maxCrawledPlacesPerSearch` caps each search term), not an estimate that could be exceeded by the actor returning more than requested.

## 2. Actor and pricing basis

**Actor:** `compass/crawler-google-places` ("Google Maps Scraper") — same actor used for the completed Lebanon pilot, so this estimate is grounded in **actually observed** pricing from that pilot rather than the headline rate alone (see §3).

**Documented base/headline pricing (pay-per-event):** "from $1.50 / 1,000 scraped places" — the same floor rate cited in the Lebanon cost estimate. As in that pilot, every enrichment toggle is disabled (see `pilot-plan.md` §6), so no enrichment add-on charges apply, and `scrapePlaceDetailPage: false` avoids the separate "additional place details" charge.

## 3. Expected cost — grounded in the Lebanon pilot's actual observed rate

| Basis | Calculation | Cost |
|---|---|---|
| Headline base rate applied to the hard ceiling of 900 records | 900 / 1,000 × $1.50 | $1.35 (theoretical floor) |
| **Lebanon pilot's actual observed rate** (`pilot-stats.json`: $2.3116 actual cost ÷ 465 actual records) | ≈ $4.97 / 1,000 places | — |
| **Expected actual cost at the Lebanon-observed rate, applied to this pilot's 900-record ceiling** | 900 / 1,000 × $4.97 | **≈ $4.47** |

The Lebanon pilot's actual cost came in **2.85× above** the theoretical $1.50/1,000 floor rate — almost certainly reflecting per-run fixed overhead (10 runs in that pilot too) and/or a plan-tier rate above the advertised floor, neither of which was resolvable in advance (see the same uncertainty documented in `pilots/apify-lebanon/cost-estimate.md` §4). This pilot uses the same run count (10) and the same actor/settings, so the Lebanon-observed rate is the more reliable planning basis than the un-tested headline figure.

**Stated cost ceiling for this pilot: up to approximately $4.50 expected, hard-capped at $8.00.** The $8.00 hard cap is set with real margin above the $4.47 Lebanon-rate projection (1.8×) to absorb the same categories of uncertainty documented below, without being large enough to represent a meaningfully different spend decision than what Lebanon's $2.00 cap (relative to its $2.31 actual) already established as an acceptable precedent scale.

## 4. Uncertainty in this estimate

- The exact reason Lebanon's actual rate exceeded the headline rate was never conclusively identified (plan tier, per-run fixed cost, or both) — this estimate inherits that same uncertainty rather than resolving it.
- Search-term "hit density" varies by category and city — a niche category (e.g. "interior design company") in a smaller search radius could return fewer than 30 real matches, which would only ever **reduce** cost below the ceiling, consistent with the Lebanon pilot (its actual record count, 465, came in under its own 540 ceiling).
- No run can return more than its stated `max_records_this_run` — the 900-record ceiling itself carries no uncertainty, only the dollar-per-1,000 conversion rate does.

## 5. Duplicate-query and runaway-pagination prevention

- **No two proposed runs target the same (city, search-term) pair** — verified programmatically: all 30 rows in `proposed-queries.csv` have a unique `(region_query_string, search_term)` combination.
- **Every run has an explicit `maxCrawledPlacesPerSearch: 30`** — a hard per-search-term cap, not a soft suggestion.
- **No run uses `startUrls` or an unbounded sweep mode** — every run uses `searchStringsArray` + `locationQuery`, the actor's most-bounded mode.
- **No run will be resubmitted or retried automatically** on partial failure — if a run errors or returns incomplete results, execution stops and reports back rather than re-queuing silently.
- **This document is the single source of truth for what will run.** No query, city, or category beyond what is listed in `proposed-queries.csv` and `proposed-apify-input.json` will be added during execution without a new, separate approval.

## 6. Stop conditions

Execution — if and when separately approved — will halt and report back to the user, without proceeding further, if any of the following occurs:

1. **The approved cost ceiling ($8.00, or whatever figure the user explicitly approves instead) is reached or would be exceeded by continuing.**
2. **The Apify token turns out to be invalid/expired at execution time** — reported as a stop condition, not silently worked around.
3. **The actor's live pricing, input schema, or rate limits differ materially** from what is documented here at the moment of execution.
4. **Any single run returns an error, a rate-limit response, or an unexpectedly large result count** inconsistent with the bounded design above.
5. **Any of the explicit non-actions listed in `pilot-plan.md` §9 would otherwise occur.**

## 7. Summary for approval

| Item | Value |
|---|---|
| Actor | `compass/crawler-google-places` (Google Maps Scraper) |
| Runs | 10 (5 Dubai + 5 Abu Dhabi) |
| Search terms | 30 |
| Max results per search term | 30 |
| **Absolute maximum records** | **900** |
| **Expected cost (Lebanon-observed rate)** | **≈ $4.47** |
| **Requested approval ceiling** | **$8.00 (hard stop)** |
| Enrichment | All disabled (no reviews, no images, no leads, no contacts, no social profiles, no competitor analysis) |
| Fields collected | Business name, category, website, public phone (if present), address/city/region, Google Maps URL, place ID, rating/review count, source, retrieval timestamp only |
| Production registry changes during this pilot | **None** |

**This plan is not executed. It awaits explicit approval of the cost ceiling above before any Apify actor is called.**
