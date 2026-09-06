# Apify Google Maps — Lebanon Pilot: Consolidated Run Plan (10 → 8 runs)

**Date:** 2026-09-05
**Status:** Consolidation applied per explicit user approval, immediately before paid execution. This document records exactly what changed and why, without modifying the original `pilot-plan.md`, `proposed-queries.csv`, `cost-estimate.md`, or `preflight-validation.md` (those remain the historical pre-approval record).

## What changed

The two smallest runs (`run-baabda`, 30 places; `run-countrywide`, 30 places) are each folded into one of the other 8 regional runs, per `preflight-validation.md` §8 recommendation (b). This reduces the run count from 10 to 8 while keeping all 18 region/search-term pairs, all 14 categories, and all 10 regions intact — nothing is removed, only regrouped into fewer Apify actor calls.

| Change | Detail |
|---|---|
| `run-baabda` removed as standalone | Its search term is added to `run-metn` (adjacent Mount Lebanon district) as `"construction company Baabda"` — the district name is baked directly into the search string so the geographic target is preserved in the query text itself, independent of the host run's `locationQuery`. |
| `run-countrywide` removed as standalone | Its search term `"software company Lebanon"` (already country-scoped in its own text) is added to `run-beirut`. No rewording needed — the term already carries "Lebanon" explicitly. |

## Why this preserves the required constraints

- **No region/search-term pair removed**: all 18 pairs from `proposed-queries.csv` still exist, now executed under 8 physical runs instead of 10. `region_label` is preserved per-pair in `consolidated-apify-input.json`'s metadata for reporting/normalization purposes, independent of which run executed it.
- **`maxCrawledPlacesPerSearch` not increased above 30**: every search term, including the two folded-in ones, keeps `maxCrawledPlacesPerSearch: 30`.
- **Absolute maximum not increased above 540**: 18 terms × 30 = 540, unchanged — consolidation moves terms between runs, it does not add or remove terms.
- **Geographic/sector coverage not weakened**: the folded-in terms keep their original geographic target by encoding it directly in the search string (`"construction company Baabda"`, `"software company Lebanon"`), the same technique the original plan already used for the country-wide query. Category coverage (14 categories) is unchanged.

## Updated run table

| Run | Region (host `locationQuery`) | Search terms | Max records this run |
|---|---|---|---|
| run-beirut | Beirut, Lebanon | software company, marketing agency, **software company Lebanon** | 90 |
| run-greater-beirut | Beirut Governorate, Lebanon | accounting firm, fintech company | 60 |
| run-metn | Metn, Mount Lebanon, Lebanon | engineering company, factory, **construction company Baabda** | 90 |
| run-jounieh | Jounieh, Keserwan, Lebanon | hotel, architecture firm | 60 |
| run-tripoli | Tripoli, Lebanon | distribution company, factory | 60 |
| run-saida | Saida, Lebanon | hospital, logistics company | 60 |
| run-zahle | Zahle, Bekaa, Lebanon | school, NGO | 60 |
| run-nabatieh | Nabatieh, Lebanon | construction company, retail store | 60 |
| **Total** | **8 runs** | **18 search terms** | **540** |

## Updated cost basis (live pricing, re-verified 2026-09-05)

- `place-scraped`: $0.004/place (FREE-tier rate, used conservatively; actual tier may be cheaper)
- `filter-applied` (ambiguous whether `skipClosedPlaces` counts): $0.001/place, worst case
- `apify-actor-start`: $0.00005 per GB of actor memory (minimum 1 event), one-time per run — negligible (~$0.0004 total across 8 runs at 1GB), corrects the prior pre-flight assumption of $0.007/run flat (a decrease, not an increase)

| Scenario | Calculation | Total |
|---|---|---|
| Best case | 540 × $0.004 + negligible actor-start | **≈ $2.16** |
| Worst case | 540 × ($0.004 + $0.001) + negligible actor-start | **≈ $2.70** |

Both fit within the approved $3.00 ceiling, with more margin than the original 10-run estimate (actor-start fees are far smaller than previously assumed).

## Execution order

1. **Validation run: `run-metn`** (consolidated, includes the Baabda fold-in) — run first, output structure/fields/cost/duplicates checked before any other run proceeds.
2. `run-beirut` (consolidated, includes the countrywide fold-in)
3. `run-greater-beirut`
4. `run-jounieh`
5. `run-tripoli`
6. `run-saida`
7. `run-zahle`
8. `run-nabatieh`

Runs execute strictly sequentially. Cumulative actual cost is checked after every run; execution stops before starting the next run if cumulative cost has reached $3.00, the next run could push it over $3.00, or any other stop condition in the approved instructions occurs.
