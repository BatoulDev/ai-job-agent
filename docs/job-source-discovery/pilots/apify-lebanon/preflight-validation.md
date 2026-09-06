# Apify Google Maps — Lebanon Pilot: Pre-Flight Validation

**Date:** 2026-09-05
**Status: PRE-FLIGHT ONLY. No actor has been run. No paid request has been submitted.**

---

## 1. Token presence (value never displayed)

`APIFY_API_TOKEN` is present and non-empty in `.env.local` (confirmed length: 46 characters — consistent with an Apify token format). **The value itself was never printed, logged, partially displayed, or copied at any point in this validation.**

## 2. Git-ignore confirmation

`git check-ignore -v .env.local` → matched by `.gitignore:36` (`.env*`). `git status --short .env.local` returned nothing (not tracked, not staged). **The token cannot be committed under the current `.gitignore`.**

## 3. Authentication test (safe, read-only)

| Endpoint | Purpose | Result |
|---|---|---|
| `GET /v2/users/me` | General account-info check | **403 `insufficient-permissions`** |
| `GET /v2/acts?limit=1` | List actors accessible to this token | **200 OK** — `"total": 2` actors visible |
| `GET /v2/acts/compass~crawler-google-places` | Fetch the target actor's public metadata | **200 OK** |
| `GET /v2/acts/compass~crawler-google-places/runs?limit=1` | List this token's run history for the target actor | **200 OK** — `"total": 0"` (no prior runs, as expected for a never-used pilot) |

**Interpretation:** the token is valid and authenticated for actor-level operations (listing actors, listing/creating runs for `compass/crawler-google-places`) — the two checks that actually matter for executing this pilot. The `/v2/users/me` 403 indicates this specific token has a **restricted/limited scope** that excludes general account endpoints (account profile, usage, and limits all returned the same `insufficient-permissions` error). This is consistent with an intentionally-scoped Apify API token, not a broken or invalid one — the actor-specific checks are the correct authentication test for this task, and they passed.

**Consequence:** the account's exact available usage-credit balance **could not be independently verified via the API** with this token's current scope. The $5.00 figure in this validation is taken as user-reported, not independently confirmed. If independent balance verification is wanted before proceeding, it would require either a broader-scoped token or checking the Apify Console UI directly.

## 4. Actor identity confirmed

```
id:       nwua9Gu5YrADL7ZDj
name:     crawler-google-places
username: compass
title:    Google Maps Scraper
isPublic: true
```

**Exact match to `compass/crawler-google-places`, as required.** Confirmed via two independent calls (direct actor lookup, and its presence in the token's own accessible-actors list) — not assumed from the prior source-expansion pass's notes.

## 5–6. Proposed files re-inspected and reconfirmed

Programmatically re-verified against the actual current file contents (not assumed from memory of preparing them):

| Check | Required | Found |
|---|---|---|
| Planned runs | 10 | **10** (`proposed-apify-input.json`) |
| Unique region/search-term pairs | 18 | **18**, zero duplicates (`proposed-queries.csv`) |
| Max places per search term | 30 | **30** — uniform across all 18 rows |
| Absolute max total scraped places | 540 | **540** (sum of `max_records_this_run` across all 10 runs) |
| Enrichment fully disabled | yes | **Confirmed**: `scrapePlaceDetailPage`, `scrapeContacts`, `scrapeSocialMediaProfiles`, `verifyLeadsEnrichmentEmails`, `scrapeReviewsPersonalData`, `scrapeTableReservationProvider`, `scrapeOrderOnline`, `scrapeDirectories`, `includeWebResults`, `enableCompetitorAnalysis` all `false`; `maximumLeadsEnrichmentRecords`, `maxReviews`, `maxImages`, `maxQuestions`, `maxCompetitorsToAnalyze` all `0` |
| No reviews/reviewer data/personal emails/social profiles/images/leads/employee data | yes | **Confirmed** — every corresponding toggle is off/zero (see row above); no field in the actor's default (non-enriched) output schema carries any of these data types |

## 7. Live pricing — re-verified via the Apify API directly (not the marketing/store page)

**This supersedes the earlier $1.50/1,000 figure found on the Apify Store listing page during the original source-expansion pass — that figure was stale relative to the actor's current live pricing.** The actor's own `pricingInfos` object (fetched live via the authenticated API) confirms **pay-per-event** pricing with these exact chargeable events:

| Event | Price (USD) | Applies to this pilot? |
|---|---|---|
| `actor-start` | $0.007 / run | Yes — flat fee, once per run (10 runs) |
| `place-scraped` | $0.004 / place | Yes — the core cost driver |
| `filter-applied` | $0.001 / place / active filter | **Ambiguous for this proposal — see below** |
| `place-details-scraped` | $0.002 / place | **No** — `scrapePlaceDetailPage: false` in every proposed run |
| `contact-details-scraped` | $0.002 / place | No — `scrapeContacts: false` |
| `lead-scraped` | $0.005 / place | No — `maximumLeadsEnrichmentRecords: 0` |
| `review-scraped` | $0.0005 / review | No — `maxReviews: 0` |
| `image-scraped` | $0.0005 / image | No — `maxImages: 0` |

**This exactly confirms the user-reported Console price**: $0.004/place × 1,000 = **$4.00 per 1,000 places**, matching Apify's own help-article headline ("our base charge is only $4 for 1,000 places") fetched directly from the pricing-change announcement linked inside the live API response.

**`filter-applied` ambiguity, disclosed honestly rather than guessed away:** the proposed input sets `skipClosedPlaces: true`, which is an active filter in the general sense. Apify's own help article lists example chargeable filters as "category selection, minimum star rating, website availability, or title match" — **`skipClosedPlaces` is not explicitly named in that list**, and the input schema/help article do not confirm one way or the other whether it triggers this charge. To stay conservative, both scenarios are costed below rather than assuming the cheaper one.

## 8. Recalculated cost

| Scenario | Calculation | Total |
|---|---|---|
| **Best case** (skipClosedPlaces does not count as a chargeable filter) | (10 × $0.007) + (540 × $0.004) | **$2.23** |
| **Worst case** (skipClosedPlaces does count as 1 chargeable filter) | (10 × $0.007) + (540 × $0.004) + (540 × $0.001) | **$2.77** |

**Both scenarios fit within the requested $3.00 total ceiling.** Both also fit within the user-stated $5.00 available credit — though, per §3, that credit balance itself could not be independently confirmed via the API with this token's current scope.

### A separate, more important finding: the per-run safety-cap floor

The live pricing data also returned `minimalMaxTotalChargeUsd: 0.5`. Cross-checked against Apify's own help article, which states callers "can also set a maximum spend limit to avoid unexpected charges" — this confirms `minimalMaxTotalChargeUsd` is the **platform-enforced minimum value allowed for that per-run safety cap**, not a hidden minimum charge. In plain terms: **Apify will not let a per-run spending cap be set below $0.50**, even though several of this pilot's runs are individually expected to cost well under that (e.g., the `run-baabda` and `run-countrywide` runs, each requesting only 30 places, are expected to cost roughly $0.16–$0.19 each).

**Consequence worth flagging explicitly before approval:** if each of the 10 runs is given a per-run safety cap at the $0.50 platform minimum (the smallest cap technically allowed), the **aggregate worst-case enforceable ceiling across all 10 runs is 10 × $0.50 = $5.00** — exactly the full user-stated available credit, with zero margin, even though the realistically **expected** cost is $2.23–$2.77. This is not a prediction that the pilot will cost $5.00 — the per-place/per-run math above is the real expected cost — but it means the per-run safety net, if set at the platform's allowed minimum, cannot itself guarantee the run stays under $3.00 if something behaved very differently from designed (e.g., an actor bug scraping far more than the requested cap). The `maxCrawledPlacesPerSearch: 30` input cap remains the primary technical control preventing runaway scraping regardless of the spend-cap setting.

**Recommendation for the approval decision:** either (a) proceed as designed, accepting that the enforced worst-case safety-net ceiling is $5.00 while the realistically expected cost is $2.23–$2.77 (comfortably under $3.00), or (b) consolidate the two smallest runs (`run-baabda`, `run-countrywide`, 30 places each) into two of the other regional runs before execution, reducing the run count to 8 and the worst-case floor to $4.00 — a design change, not something this pre-flight step has made unilaterally.

## 9–11. Confirmed non-actions

- **No Apify actor was called or run.** All API calls made during this validation were read-only (`GET` requests to list/inspect actors and runs, and to read this actor's own public pricing metadata) — no run was created, no dataset was produced, no charge was incurred.
- No production registry CSV, application code, database, or n8n workflow was modified.
- No git staging, commit, push, branch switch, or remote action occurred (confirmed via `git status --short`, unchanged from before this validation — only the untracked `docs/job-source-discovery/` directory shows, now including this new file).

---

## Summary for approval

| Item | Value |
|---|---|
| Apify auth | **Working** for actor-level operations (account-level endpoints are out of this token's scope — not a failure, a scope limitation) |
| Actor confirmed | `compass/crawler-google-places` ✓ exact match |
| Runs / search terms / max places | 10 / 18 / 540 (all reconfirmed against the actual files) |
| Enrichment | Fully disabled, reconfirmed |
| Live base price | $4.00/1,000 places + $0.007/run actor-start — **matches your Console figure exactly** |
| **Expected cost** | **$2.23 (best case) – $2.77 (worst case)** |
| Requested ceiling | $3.00 — **both scenarios fit** |
| Stated available credit | $5.00 — not independently verifiable via this token's scope |
| Per-run safety-cap floor | $0.50/run minimum (platform-enforced) → $5.00 aggregate worst-case *floor for the safety net itself*, not the expected charge |

**No paid Actor run will be submitted without your explicit approval of this cost.**
