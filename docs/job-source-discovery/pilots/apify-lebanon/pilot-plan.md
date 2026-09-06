# Apify Google Maps — Lebanon Company-Discovery Pilot Plan

**Date:** 2026-09-04
**Status: PROPOSED, NOT EXECUTED.** No Apify actor has been called. No credits have been spent. This document, `proposed-queries.csv`, `proposed-apify-input.json`, and `cost-estimate.md` are the complete pre-execution deliverable set. Execution requires explicit user approval of the exact cost ceiling in `cost-estimate.md`.

**Objective:** test whether Google Maps, accessed through Apify's `compass/crawler-google-places` actor, can materially expand the Lebanon company registry (`docs/job-source-discovery/lebanon.csv`) across diverse sectors and regions — as a **company-discovery** source, not a job board. A discovered business may hire across IT, marketing, HR, accounting, administration, engineering, design, sales, and operations regardless of its primary industry; this pilot does not filter by hiring likelihood.

---

## 1. Apify configuration status

**Apify access is NOT configured in this project.** Confirmed by inspection (no secret values printed or exposed):
- No `APIFY_*` environment variable name exists in `.env`, `.env.local`, or `.env.example`.
- No Apify SDK/client package (`apify-client`, `apify`) appears in `package.json` dependencies or devDependencies.
- No Apify-related integration code exists anywhere in the application source.

**Consequence:** even after approval, this pilot cannot be executed as an authenticated API/SDK call from within this codebase today. Execution would require either (a) the user running it manually through the Apify Console/CLI with their own account, or (b) a separate, explicitly-authorized step to add Apify credentials to this project's environment first. This plan does not assume or request that step — it is out of scope for "preparation and cost estimation."

## 2. Actor confirmed

**`compass/crawler-google-places`** ("Google Maps Scraper") — the same actor already evaluated in the prior 6-market source-expansion project (see `docs/job-source-discovery/source-expansion/apify-discovery-design.md`, Lebanon section) and re-verified fresh today via direct WebFetch of its live Apify Store listing. Full current specification (pricing, input schema, output fields, limits, compliance notes) is in `cost-estimate.md` §2 and was cross-checked against the actor's documentation as it exists today, not assumed from the prior pass's notes alone.

## 3. Existing Lebanon coverage inspected (baseline this pilot is measured against)

- `lebanon.csv`: 65 company/source records (47 verified, 18 needs_manual_review, per the existing registry) — see the file itself for the authoritative current count.
- `master-company-registry.csv`: 254 records across 227 unique canonical companies, all markets combined.
- `source-expansion/source-catalog.csv`: 10 Lebanon sources already cataloged (Bayt, HireLebanese, Akhtaboot, Jobs.com.lb, Beirut Digital District, CCIB, Daleel Madani, Amaken, IDAL, LinkedIn-excluded). **None of these is a geography × category business directory with Google-Maps-level granularity** — the closest prior candidate (CCIB, claiming 15,000+ members) was rate-limited (429) and never actually sampled. This is the specific gap this pilot targets.
- `source-expansion/apify-discovery-design.md`: already flagged the Google Maps Scraper as "viable for a different job: discovering companies with a real Lebanon address/domain that never appear on any job board (a genuine gap-filler)" — this pilot is the first actual test of that hypothesis with real proposed inputs and a real cost ceiling, not just a design note.

## 4. Query design — stratified sample, not a full cross-product

Per the explicit instruction not to attempt every region × category combination, this pilot uses **18 search terms across 10 regions**, deliberately selected so that:
- **Every one of the 10 requested regions appears at least once** (Beirut, Greater Beirut, Metn, Baabda, Jounieh/Keserwan, Tripoli/North Lebanon, Saida/South Lebanon, Zahle/Bekaa, Nabatieh, Lebanon country-wide).
- **Every one of the 14 requested employer categories appears at least once** (Software/IT, Engineering/industrial, Construction/contracting, Architecture/interior design, Marketing/advertising/graphic design, Accounting/audit/financial, Hospitals/clinics/labs, Schools/universities/training, Hotels/restaurants/hospitality, Retail/distribution/e-commerce, Logistics/transportation, Manufacturing/factories, NGOs/professional services, Telecom/fintech).
- Region-category pairings were chosen to reflect **real, known sectoral concentrations** rather than arbitrary assignment — e.g., Metn and Tripoli both get a "factory/manufacturing" query because they are Lebanon's two most distinct industrial belts (worth comparing, not redundant); Jounieh/Keserwan gets hospitality (coastal tourism corridor); Zahle/Bekaa gets NGOs (a real, well-documented humanitarian-sector concentration in that region); Nabatieh — currently zero Lebanon-registry coverage of any kind — gets 2 general-purpose categories (construction, retail) specifically to test whether Google Maps can surface *any* usable data for a region this project has never touched.
- The Lebanon country-wide query (q18) is a **deliberate cross-check**, not incremental coverage: it tests whether a broad, unscoped query mostly duplicates the city-level queries (expected) or surfaces genuinely different results (a finding worth knowing either way — see `cost-estimate.md`'s per-query rationale).

Full detail: `proposed-queries.csv` (18 rows: `query_id`, `region_label`, `region_query_string`, `category`, `search_term`, `max_results_per_search_term`, `actor_run_group`, `rationale`).

## 5. Proposed Apify input

`proposed-apify-input.json` contains **10 complete, standalone actor-input objects** (one per Apify run, since the actor's `locationQuery` parameter applies to one location per run; grouping multiple search terms under one shared region keeps the run count — and therefore any per-run overhead — low while still exercising all 18 search terms). Every run shares the same data-minimization settings (see §6).

| Run | Region | Search terms | Max records this run |
|---|---|---|---|
| run-beirut | Beirut, Lebanon | software company, marketing agency | 60 |
| run-greater-beirut | Beirut Governorate, Lebanon | accounting firm, fintech company | 60 |
| run-metn | Metn, Mount Lebanon, Lebanon | engineering company, factory | 60 |
| run-baabda | Baabda, Mount Lebanon, Lebanon | construction company | 30 |
| run-jounieh | Jounieh, Keserwan, Lebanon | hotel, architecture firm | 60 |
| run-tripoli | Tripoli, Lebanon | distribution company, factory | 60 |
| run-saida | Saida, Lebanon | hospital, logistics company | 60 |
| run-zahle | Zahle, Bekaa, Lebanon | school, NGO | 60 |
| run-nabatieh | Nabatieh, Lebanon | construction company, retail store | 60 |
| run-countrywide | Lebanon | software company Lebanon | 30 |
| **Total** | **10 runs** | **18 search terms** | **540** |

**"Greater Beirut" note**: Google Maps has no official administrative entity named "Greater Beirut." `Beirut Governorate, Lebanon` is used as the closest real, geocodable proxy (it is broader than Beirut city proper without being the whole of Mount Lebanon). This substitution is stated explicitly here and in `proposed-queries.csv` rather than silently guessed.

## 6. Data minimization — enrichment explicitly disabled

Per the task's explicit instruction, every enrichment feature that could return personal, employee, or reviewer-level data is set to disabled/zero in every proposed run:

| Setting | Value | Effect |
|---|---|---|
| `scrapeContacts` | `false` | No "company contacts enrichment" (would extract personal social/contact info from the business website) |
| `scrapeSocialMediaProfiles` | `false` | No per-platform social profile enrichment |
| `maximumLeadsEnrichmentRecords` | `0` | No business-leads enrichment (names, job titles, personal emails, LinkedIn profiles — explicitly excluded) |
| `verifyLeadsEnrichmentEmails` | `false` | No email verification (moot with leads enrichment disabled) |
| `maxReviews` | `0` | No review text or reviewer data collected |
| `scrapeReviewsPersonalData` | `false` | No reviewer ID/name/photo (moot with reviews disabled, set explicitly anyway) |
| `maxImages` | `0` | No image scraping |
| `maxQuestions` | `0` | No Q&A section scraping |
| `enableCompetitorAnalysis` | `false` | No AI competitor-analysis add-on (extra cost, not needed for discovery) |
| `scrapePlaceDetailPage` | `false` | Avoids the "additional place details" extra charge entirely; not needed since all required fields are already present on the default (non-detail) output |
| `scrapeTableReservationProvider`, `scrapeOrderOnline`, `scrapeDirectories`, `includeWebResults` | `false` | Restaurant/venue-specific enrichments not relevant to company discovery |
| `skipClosedPlaces` | `true` | Excludes permanently/temporarily closed businesses from results (reduces noise, not a privacy control) |

**Fields that will be collected** (the default, non-enriched output, per the actor's documented schema): `title` (business name), `categoryName`, `url` (Google Maps URL), `placeId`, `address`/`street`/`city`/`state`/`postalCode`/`countryCode`/`neighborhood`, `location` (lat/lng), `phone`/`phoneUnformatted` (public business phone, if Google Maps returns one for the listing — not separately enriched), `website`, `totalScore`, `reviewsCount`, `scrapedAt`, `searchString`, `rank`. This matches exactly the field list the task specified as acceptable ("business name, category, website, public business phone if returned normally, address, city/region, Google Maps URL, place ID, rating/review count only if useful for identity confidence, source and retrieval timestamp"). No reviews, no reviewer identities, no personal emails, no employee data, no social-profile enrichment will be collected.

## 7. Deduplication design (against `master-company-registry.csv` and `lebanon.csv`, read-only — no file will be modified by this pilot)

Applied in this priority order, per the task's instruction:

1. **Normalized official domain** — strip protocol/`www.`/trailing slash/path from both the actor's `website` field and the registry's `official_website_url`; exact match on the normalized root domain is the strongest signal.
2. **Google place ID** — the registry does not currently store `placeId` for any existing row (it predates this pilot), so this signal can only prevent *duplicates within this pilot's own results* (e.g., if the same business is returned by two different search terms) for now; it becomes usable against the registry only after a first ingestion adds `placeId` to a company's record.
3. **Normalized company name** — lowercase, strip legal suffixes (`S.A.L.`, `W.L.L.`, `Sarl`, `LLC`, `Inc.`, etc.), strip punctuation/extra whitespace; compared against the registry's `company_name` field. Fuzzy/partial matches are flagged for manual review, not auto-merged.
4. **Public phone and address** — used only as a **secondary, corroborating** signal (e.g., to help decide a name-based near-match), never as a sole basis for concluding two records are the same or different company.
5. **Manual review for ambiguous collisions** — any match that isn't a clean domain or exact-normalized-name match is queued for human review, not auto-resolved either way.

**Branch handling**: Google Maps frequently returns multiple physical locations of the same legal company (e.g., multiple branches of one bank or restaurant chain) as separate place records. Per the task's explicit instruction, branches are **not** automatically treated as separate companies. The proposed reconciliation approach: group candidate records that share a normalized domain or a normalized name (after stripping branch/location qualifiers like "- Downtown", "Hamra Branch", etc.) into one canonical company entry, and preserve the individual branch addresses/place IDs as a list under that one entry rather than as separate top-level company rows. This grouping logic is a **design decision for the post-pilot ingestion step**, not something executed in this preparation phase — no data has been collected yet to group.

**This entire deduplication design is read-only against the existing registries.** No pilot company will be added, and no existing row will be modified, during this preparation phase or during the pilot run itself (data collection only — see `cost-estimate.md` for the explicit list of actions that will and will not occur).

## 8. What happens if this plan is approved

If approved, the **only** action that will occur is: the 10 actor runs in `proposed-apify-input.json` are submitted to Apify's `compass/crawler-google-places` actor, up to the approved cost ceiling, and the raw results are saved to `docs/job-source-discovery/pilots/apify-lebanon/` for review (structured similarly to the completed Himalayas pilot: a raw sample, a normalized CSV applying the deduplication logic above, and a pilot report). **No company will be added to any production registry CSV. No job will be ingested. No application/database/n8n change will occur.** A second, separate approval would be required before any discovered company is promoted out of a review queue into `lebanon.csv` or `master-company-registry.csv`.

## 9. Explicit non-actions (unchanged from every task in this project)

Not performed and not proposed as part of this plan: modifying `lebanon.csv` or any production registry CSV; adding any pilot company to the registry; ingesting jobs; building n8n automation; scraping LinkedIn; modifying application/database code; git staging, commit, push, merge, or branch switch.
