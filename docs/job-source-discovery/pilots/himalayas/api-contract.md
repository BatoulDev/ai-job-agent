# Himalayas Remote Jobs API — Verified Contract

**Status: verified via direct HTTP requests (curl) against the live API, 2026-09-04, as part of a strictly bounded, read-only technical pilot.**
**Scope note:** This document describes only the officially documented, public Himalayas API. No scraping, no unofficial endpoints, no authentication bypass. All findings below were produced by (a) reading the official documentation pages directly via WebFetch, and (b) independently confirming behavior against the live API with 13 real, bounded HTTP requests. Where the two disagreed, the **live API's actual behavior is treated as authoritative** and the discrepancy is called out explicitly (see §7).

## 1. Base URLs and endpoints

| Endpoint | Purpose | Verified |
|---|---|---|
| `GET https://himalayas.app/jobs/api` | "Browse" — the full, unfiltered job feed | Yes — 2 live requests (R5, R6) |
| `GET https://himalayas.app/jobs/api/search` | "Search" — filtered by keyword, country, worldwide flag, seniority, employment type, company, timezone | Yes — 11 live requests (R1–R4, R7–R13) |
| `https://himalayas.app/docs/openapi.json` | OpenAPI 3.1 machine-readable spec | Read via WebFetch, not independently re-validated as a schema (see §7 for one confirmed inaccuracy) |

Documentation source pages: `https://himalayas.app/docs/remote-jobs-api` and `https://himalayas.app/api` (the latter also carries the attribution/prohibited-use terms — see §6).

## 2. Authentication

**None required.** Confirmed both in the documentation ("No API key or authentication is required") and empirically — all 13 requests in this pilot succeeded with zero credentials, zero headers beyond the default curl `User-Agent`.

## 3. Request parameters (verified)

### Browse endpoint (`/jobs/api`)
| Param | Type | Notes (verified) |
|---|---|---|
| `limit` | integer | Max and default 20. Verified: `limit=5` returned exactly 5 jobs. |
| `cursor` | string (opaque) | Preferred pagination method. Verified: passing the `nextCursor` value from one response as `?cursor=` on the next request returned a **different, non-overlapping** set of 5 jobs (R5 → R6). |
| `offset` | integer, deprecated | Not used in this pilot; cursor pagination is the documented preferred method and was used instead. |

### Search endpoint (`/jobs/api/search`)
| Param | Type | Notes (verified) |
|---|---|---|
| `q` | string | Free-text query. Verified across 7 role-family test queries (R7–R13), all returned 200 with relevant results. |
| `country` | string | ISO alpha-2 or common name. Verified with `country=LB` (R1, R2) — returned real results, `totalCount=2119`. **Important finding, see §5**: this does NOT mean 2,119 jobs are Lebanon-specific. |
| `worldwide` | boolean | Verified with `worldwide=true` (R3) — returned a smaller, distinct `totalCount=1857`, all with empty `locationRestrictions`. |
| `exclude_worldwide` | boolean | Documented, not exercised this pilot (out of the bounded request budget). |
| `seniority` | string, comma-separated enum | Documented values: `Entry-level, Mid-level, Senior, Manager, Director, Executive`. Not exercised this pilot. |
| `employment_type` | string, comma-separated enum | Documented values: `Full Time, Part Time, Contractor, Temporary, Intern, Volunteer, Other`. Observed as a real field on every returned job object; not used as a filter this pilot. |
| `company` | string, comma-separated slugs | Not exercised this pilot. |
| `timezone` | string, UTC-offset format | Verified with `timezone=UTC+2` (R4, used as a Beirut-timezone proxy since the API has no direct MENA/EMEA region filter) — returned `totalCount=6909`, confirming the parameter is live and produces a large, distinct result set. |
| `sort` | string, enum | Documented values: `relevant, recent, salaryAsc, salaryDesc, nameAToZ, nameZToA, jobs`. Not exercised this pilot. |
| `page` | integer, 1-based | Verified with `page=1` and `page=2` on the same `country=LB` query (R1, R2) — returned 17 jobs each time, no overlapping `guid` values between the two pages (see §5 pagination findings). |

## 4. Pagination behavior (verified)

- **Browse endpoint**: cursor-based, confirmed working as documented. R5 (no cursor) returned `nextCursor` = an opaque base64-like token; passing that token as `?cursor=` in R6 returned a **different** set of 5 jobs (zero `guid` overlap with R5). This matches the documented guarantee: cursor pagination "will never return the same job twice."
- **Search endpoint**: page-based (`page=1`, `page=2`), not cursor-based — `nextCursor` was `null` on every search-endpoint response in this pilot, even when more results existed (`totalCount` far exceeded jobs returned). This is a genuine, useful finding: **cursor pagination applies to `/jobs/api` (browse) only, not `/jobs/api/search`** — a future ingestion pipeline against the search endpoint must page via the `page` integer parameter, not `cursor`.
- Across the 2 `country=LB` pages sampled (R1, R2, 34 raw job entries), **zero duplicate `guid` values** were found between the two pages — page-based pagination behaved correctly in this sample.

## 5. Rate limits and safe retry behavior

- **Documented**: "The API is rate limited. If you exceed the rate limit, you will receive a `429 Too Many Requests` response." The OpenAPI-derived error-handling notes specify waiting 60 seconds on a 429 before retrying.
- **Documented cadence guidance**: "The data is cached and refreshed every 24 hours, so there is no benefit to polling more than once per day" — a future recurring-ingestion job should poll **at most once per day**, not more frequently.
- **This pilot's actual usage**: 13 total requests in a single short burst (well under a minute), all returning `200 OK`. **Zero `429` responses were encountered** — the pilot stayed safely within whatever the undocumented numeric rate limit is. No retry logic was needed or exercised.
- For higher-volume future use: "Contact the team at hi@himalayas.app" for an increased quota, per the documentation.

## 6. Terms of use / attribution / compliance

Two explicit, quoted requirements were found on the official pages:
1. **Attribution**: "Please link back to the URL found on Himalayas AND mention Himalayas as the original source" if job data is displayed publicly.
2. **Prohibited redistribution**: "Please do not submit Himalayas jobs to third-party websites, including but not limited to Jooble, Neuvoo, Google Jobs, or LinkedIn Jobs." This project has no intention of resyndicating Himalayas data to any third-party job board, and this pilot did not do so — noted here for completeness and for any future engineering design to respect.

No other restriction (e.g., a cap on total daily requests, a required commercial license, or a paywall) was found in the documentation.

## 7. Response structure (verified, with 2 corrections to the initial doc summary)

### Top-level response fields (confirmed via live responses)
`comments` (a changelog-style string, not job data — see below), `updatedAt`, `nextCursor`, `offset`, `limit`, `totalCount`, `jobs` (array).

The `comments` field is a genuinely useful, unexpected finding: it contains the API's own changelog notes, e.g. (verbatim from a live response this pilot received): *"21/08/2026: Cursor pagination is now available and is the preferred way to page through the feed... It is faster than offset and will never return the same job twice. The offset parameter is deprecated... 13/03/2026: The API has been updated to include the companySlug field in the response."* This is not mentioned in the static documentation pages and is worth checking on every future poll, since it's how Himalayas appears to announce breaking/additive schema changes.

### Job object fields (confirmed via live responses)
`title, excerpt, companyName, companySlug, companyLogo, employmentType, minSalary, maxSalary, salaryPeriod, seniority, currency, locationRestrictions, timezoneRestrictions, categories, parentCategories, description, pubDate, expiryDate, applicationLink, guid`

### CORRECTION 1 — `locationRestrictions` data type
The OpenAPI-spec summary (produced by an automated documentation read before any live request was made) described `locationRestrictions` as **"array of Location objects"** with sub-fields `alpha2`, `name`, `slug`. **This is incorrect for the live API.** Empirically, across all 123 unique jobs sampled in this pilot, `locationRestrictions` is a **plain JSON array of country-name strings** (e.g. `["Lebanon"]`, `["Greece", "Poland", "Romania"]`, or `[]` for no restriction). No nested objects were observed in any of the 152 raw job entries fetched. Any future ingestion code must parse this field as `string[]`, not as an array of objects.

### CORRECTION 2 — `pubDate` / `expiryDate` units
The OpenAPI-spec summary stated both fields are "Unix timestamp (milliseconds)." **This is incorrect.** Empirically, `pubDate` and `expiryDate` are **Unix timestamps in seconds**, not milliseconds. Verification: the first job in the very first pilot request (R1) had `pubDate: 1788188988`. Interpreted as milliseconds, this resolves to January 1970 (impossible for a live 2026 job posting). Interpreted as **seconds**, it resolves to **2026-08-31**, four days before this pilot ran — a fully plausible "posted" date. This was caught by the pilot's own analysis script initially misclassifying all 123 jobs as "expired" until the units were corrected; re-run with the correct (seconds) interpretation found **zero** genuinely stale/expired listings in this sample (see `pilot-report.md`). **Any future ingestion code must treat `pubDate`/`expiryDate` as Unix seconds, not milliseconds.**

### `locationRestrictions` semantics (confirmed, both from documentation and by direct observation)
"Empty array means worldwide" is the documented semantic, and this pilot's data is consistent with it: every job observed with `locationRestrictions: []` also carried the broad `timezoneRestrictions` array (all UTC offsets, i.e. "any timezone"), which is the behavior one would expect of a genuinely unrestricted, worldwide-open posting.

## 8. Errors (documented, not empirically triggered this pilot)

| Status | Meaning | Documented condition |
|---|---|---|
| 200 | Success | Valid request with results |
| 400 | Bad Request | Invalid query parameters (e.g. non-numeric `offset`, or a `cursor` value not returned as a prior `nextCursor`) |
| 429 | Too Many Requests | Rate limit exceeded; documented safe-retry guidance is to wait 60 seconds |

Error body format (per the OpenAPI spec, not independently triggered/verified this pilot): `{"ok": false, "errors": "<message>"}`.

## 9. Overall suitability assessment

This is the strongest structured-data source found anywhere across the prior 6-market source-expansion project (see `docs/job-source-discovery/source-expansion/apify-discovery-design.md`), and this pilot's direct, live verification confirms that assessment rather than weakening it — with two concrete corrections to the previously-summarized schema (§7) that a future ingestion pipeline must account for. No scraping actor is needed; a direct, low-volume, once-daily HTTP integration against the documented endpoints is both sufficient and the officially sanctioned way to use this data.
