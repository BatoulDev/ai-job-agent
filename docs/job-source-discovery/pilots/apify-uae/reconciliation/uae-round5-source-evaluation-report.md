# UAE Registry Expansion — Round 5: Job-Source vs. Employer Classification of a Supplied Candidate List

**Date:** 2026-09-07. **No commit, no push, no Apify calls.** Research performed via WebSearch/WebFetch only, against the sources' own official domains (never LinkedIn, never bypassing robots/login/CAPTCHA).

---

## 1. Why this round exists

The supplied candidate list (Dubai Careers, TALENTMATE, Jobgether, Confidential Careers, Hays, Salt, Hanson Search, Katch International, Penta Consulting, Paires, Marlow Hire) mixes three fundamentally different kinds of entity, and the prior rounds' pipeline had no explicit mechanism to route them correctly:

1. **A genuine direct employer that isn't a recruiter at all** (Katch International — an advertising/PR agency) — belongs in `uae.csv`.
2. **Recruitment/staffing agencies**, which can legitimately be *both* an employer (their own internal roles) *and* a job source (client vacancies they publish) — these two roles must never be conflated into one record.
3. **Portals, aggregators, and government platforms** that publish other employers' jobs but are not employers themselves — belong only in the UAE source catalog (`source-expansion/source-catalog.csv`), never in `uae.csv`.

This round evaluated all 11 supplied names individually against their own official domains and classified each accordingly.

## 2. Method

For each candidate: WebSearch for identity/UAE-coverage corroboration, then direct WebFetch of the official domain (homepage, UAE-specific page, internal-careers page where found, and `robots.txt` where reachable) to confirm identity, employer transparency, original-source linking, access restrictions, and — where a recruiter's own internal-hiring page was found — whether it currently lists an open Dubai/Abu-Dhabi-specific role. No Apify calls; LinkedIn was never fetched (`src-ae-linkedin-excluded` policy, unchanged).

## 3. Per-source evaluation

| canonical_source_name | source_type | official_url | UAE/city coverage | public access | employer transparency | original-source linking | ingestion eligibility | discovery eligibility | application handling | terms/safety notes | duplicate/expiry risk | date checked | evidence URL(s) | final decision | decision reason |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Dubai Careers (jobs.dubaicareers.ae) | official_government_job_portal | https://jobs.dubaicareers.ae/ | Dubai — 45+ government entities | Open browsing; candidate account required to apply | High — every vacancy attributable to a named government entity (org-filterable) | Yes — org-filtered URLs route to the specific entity | Not yet — robots.txt/ToS not directly confirmed | Yes | Through the portal itself | robots.txt returned HTTP 404 (no file — absence ≠ explicit allow); ToS not read this pass | Low (single official source, not an aggregator) | 2026-09-07 | jobs.dubaicareers.ae/careersection/...; dubaicareers.ae/en/pages/default.aspx | **discovery_only** | Strong official identity/transparency, but robots.txt/ToS/anti-bot posture unconfirmed — mirrors how it's already used (as evidence for `cc-dubai-municipality`), not yet cleared for automated ingestion. |
| TALENTMATE | public_job_board | https://www.talentmate.com/ | UAE and GCC-wide | Open, no login to browse | Likely high (direct-posting model); not individually confirmed | Not confirmed this pass | Not yet — ToS/listing structure unconfirmed | Yes | Unconfirmed (own-platform vs. redirect) | robots.txt directly confirmed fully open (wildcard UA, zero disallows, sitemap present) — a strong positive signal | Unconfirmed | 2026-09-07 | talentmate.com/jobs; talentmate.com/robots.txt | **discovery_only** | Open robots.txt is favorable, but ToS and listing-level employer-attribution still need direct confirmation before ingestion. |
| Jobgether (UAE pages) | job_aggregator | https://jobgether.com/remote-jobs/united-arab-emirates | Worldwide remote, dedicated UAE URL paths | Open (not directly fetched this pass) | Unconfirmed (platform claims "verified employers only") | Unconfirmed | Not yet | Yes | Unconfirmed | No public API found (consistent with the existing International-Remote catalog entry for the same platform) | Moderate — aggregator, re-publishes from multiple originals | 2026-09-07 | jobgether.com/remote-jobs/united-arab-emirates(/web-developer) | **discovery_only** | Identity/UAE-URL-structure confirmed via search only; not yet directly fetched this pass. |
| Confidential Careers (confidential.careers) | job_aggregator *(not confidential_job_publisher — see finding)* | https://confidential.careers/ | Global, 16 countries incl. UAE; 717 Dubai-tagged listings at check time | Open, no login | **High** — despite the brand name, individual listings directly confirmed to show real employer names (MCI Careers, Charles Schwab, etc.) | Not confirmed (Apply-button redirect target unverified) | Not yet | Yes | Unconfirmed | Terms/Privacy links present, content not read | Unconfirmed | 2026-09-07 | confidential.careers/ | **manual_review_only** | Real UAE coverage and non-anonymized employers are promising, but redirect behavior, ToS content, and robots posture still need direct confirmation. |
| Hays (Middle East/UAE) | recruitment_agency | https://www.hays.ae/ | Dubai + Abu Dhabi offices, since 2005 (search-corroborated) | **Blocked** — HTTP 403 on both hays.ae and the internal-hiring domain ae.hays-careers.com | Not confirmed (block) | Not confirmed (block) | No | No (blocked) | N/A | Both domains 403'd to automated fetch this pass | N/A | 2026-09-07 | hays.ae; ae.hays-careers.com; ae.hays-careers.com/about-us | **blocked_or_restricted** | Strong secondary-source identity, but both domains technically blocked this pass — held, not promoted or ingested on search-snippet evidence alone. |
| Salt (welovesalt.com) | recruitment_agency | https://welovesalt.com/ae/ | Dubai office (MENA hub); part of a global network | Open, both client and internal-careers pages directly fetched | N/A (agency; client jobs, not Salt's own listings, on this page) | N/A | Not yet — ToS/robots unreviewed | Yes | N/A | ToS/robots not reviewed this pass | Unconfirmed | 2026-09-07 | welovesalt.com/ae/; welovesalt.com/global-talent-solutions/careers | **discovery_only** | Real Dubai office confirmed; client-jobs page is a plausible future source, but ToS/robots review still needed. |
| Hanson Search | recruitment_agency | https://www.hansonsearch.com/executive-search-dubai/ | Dubai Internet City office confirmed | Homepage open; internal-careers URL not located (guessed slug 404'd) | N/A (executive search; client placements) | Not confirmed | Not yet | Partial (homepage only) | N/A | Not reviewed this pass | Unconfirmed | 2026-09-07 | hansonsearch.com/; hansonsearch.com/executive-search-dubai/ | **manual_review_only** | Solid identity, but the internal-careers URL and any listing structure need a follow-up pass with the correct URL. |
| Penta Consulting | staffing_platform | https://www.pentaconsulting.com/ | Dubai office corroborated only by secondary sources (Glassdoor, GulfTalent) | Open (homepage); UAE-specific page not located | N/A (ICT staffing; client placements) | Not confirmed | Not yet | Partial | N/A | Not reviewed this pass | Unconfirmed | 2026-09-07 | pentaconsulting.com/; gulftalent.com/companies/penta-consulting-careers; Glassdoor Dubai-location page | **manual_review_only** | Identity solid; UAE presence not confirmed on the company's own domain this pass, and one snippet stated "Dubai isn't hiring right now." **Disambiguation:** Penta Consulting is unrelated to "Pentabell" (a separate Middle-East EOR/payroll firm) — the two share no ownership, only name similarity in search results. |
| Paires | *(unclassifiable)* | — | — | — | — | — | — | — | — | — | — | 2026-09-07 | — | **insufficient_evidence** | No matching UAE/Dubai recruitment or staffing entity found across two independent WebSearch passes. Not fabricated or guessed. Needs a URL or additional identifying detail from the user to proceed. |
| Marlow Hire | *(unclassifiable)* | — | — | — | — | — | — | — | — | — | — | 2026-09-07 | — | **insufficient_evidence** | The only close match found ("Marlow Recruitment," marlowrecruitment.com.au) is Australia-based with no UAE connection found. Not treated as the same entity. Needs a URL or additional identifying detail from the user to proceed. |

**Katch International** — evaluated per the same list, but is **not a job source at all**: see §4.

No source above was assigned `approved_for_future_ingestion` this pass — consistent with this entire pipeline's standing evidence bar (a source is only cleared for automated ingestion after a direct, unblocked fetch confirms employer-attribution, original-source linking, and ToS/robots compliance; none of the 8 reached that bar this pass). None were assigned `reject_unsafe` or `unsafe_or_disallowed` — nothing found was itself unsafe, only under-confirmed.

## 4. Employer-classification correction: Katch International

**Katch International was misfiled by the supplied list as a potential recruiter/source candidate. It is not.** Direct WebFetch of `katchinternational.com` and `katchinternational.com/careers` confirms it is an independent **advertising/PR/communications agency** based in Dubai — its careers page lists its own internal openings (Business Development Manager, Copywriter, Junior Public Relations Account Manager, all Dubai-based), not client placements. This is exactly the misclassification risk the task warned against, just in the opposite direction (a genuine employer nearly discarded as a "not a direct employer" source).

**Added to `uae.csv` and `master-company-registry.csv`** as `cc-katch-international` (industry: `Advertising / Creative Agency`, an existing enum value already used elsewhere in the master registry — no new schema value introduced), following the same direct-WebFetch verification standard used throughout this pilot. Dedup-checked clean against both files before writing. **Not added to the source catalog** — it does not publish other employers' jobs, so it does not qualify as a source.

## 5. Recruitment agencies represented in both roles

Per the explicit rule ("Recruitment agencies may be both A: an employer for internal roles, and B: a job source for client opportunities — represented separately"), three agencies were directly confirmed to have this dual structure:

| Agency | Role A (internal employer) | Role B (job source) |
|---|---|---|
| **Hays** | A separate internal-hiring domain (`ae.hays-careers.com`) exists — confirmed via search, but both it and the client domain (`hays.ae`) returned HTTP 403 to direct fetch this pass. **Not promoted as an employer** — no currently-open Dubai role could be directly confirmed. | Catalogued as `src-ae-hays-recruitment`, `blocked_or_restricted`. |
| **Salt** | A separate internal-careers page (`welovesalt.com/global-talent-solutions/careers`) was directly fetched and confirmed active (8 open roles at check time) — but **none of the visible roles were Dubai-specific** (Nottingham/London/Toronto only). **Not promoted as an employer** — no currently-open UAE role to stage, consistent with this pipeline's "no confirmed current opening, do not fabricate" standard. | Catalogued as `src-ae-salt-recruitment`, `discovery_only`. |
| **Hanson Search** | Homepage confirms a "Work for us" internal-careers section exists, but its exact URL was not located this pass. **Not promoted** — no directly-confirmed current Dubai role. | Catalogued as `src-ae-hanson-search`, `manual_review_only`. |

None of the three were promoted as employers this pass — each failed the same evidence bar the rest of this pilot has held to throughout (a currently-open, directly-fetched role on the agency's own domain). All three remain flagged for a follow-up pass. This is a deliberate, conservative outcome, not an oversight: the architecture (dual representation) is now correctly established in the catalog and documented here, ready to be completed the moment direct evidence exists.

## 6. Source classification summary (do not mix with employer totals)

| Bucket | Sources |
|---|---|
| **Discovery-only** (4) | Dubai Careers, TALENTMATE, Jobgether (UAE), Salt |
| **Manual-review-only** (3) | Confidential Careers, Hanson Search, Penta Consulting |
| **Blocked/restricted** (1) | Hays |
| **Insufficient evidence, not catalogued** (2) | Paires, Marlow Hire |
| **Ingestion-eligible** (0) | none this pass |
| **Reject/unsafe** (0) | none found |
| **New source-catalog rows added** | **8** (`src-ae-dubai-careers-portal`, `src-ae-talentmate`, `src-ae-jobgether-uae`, `src-ae-confidential-careers`, `src-ae-hays-recruitment`, `src-ae-salt-recruitment`, `src-ae-hanson-search`, `src-ae-penta-consulting`) |

## 7. Employer totals (separate from source totals)

| | Before this round | After this round | Change |
|---|---|---|---|
| `uae.csv` | 105 | **106** | +1 (Katch International) |
| `master-company-registry.csv` | 354 | **355** | +1 (Katch International) |

**Existing employers already present from the supplied list:** none. Dedup checks (canonical ID, normalized name, domain) confirmed zero collisions between any of the 11 supplied names and the existing `uae.csv`/`master-company-registry.csv` content before Katch International was added.

**Job-source totals (`source-catalog.csv`):** 96 → **104** (+8). These are catalog rows, not employers, and are never counted toward the `uae.csv`/master-registry employer totals above.

## 8. Validation performed

35 programmatic checks, all passing:
- Row counts: `uae.csv` = 106, `master-company-registry.csv` = 355, `source-catalog.csv` = 104.
- Katch International present exactly once in `uae.csv` and `master-company-registry.csv`; non-empty evidence; `review_status = verified`; industry uses an existing enum value.
- Katch appended as a pure last-row addition (no reordering of the prior 105 rows).
- No duplicate `canonical_company_id` in `uae.csv`; no duplicate `(canonical_company_id, target_country)` in the master registry.
- No domain or normalized-name collision between Katch and any existing row in either file.
- No personal `linkedin.com/in/` URL anywhere in `uae.csv`.
- CSV schema, 34/16-column counts, BOM (`uae.csv`/master registry) and no-BOM (`source-catalog.csv`, matching its pre-existing convention), and CRLF line endings all preserved.
- All 8 new `source_id`s present exactly once; no duplicate `source_id` in the catalog overall.
- Katch International, Paires, and Marlow Hire confirmed **absent** from `source-catalog.csv` (correctly not fabricated/miscategorized).
- All non-UAE country CSVs (`lebanon.csv`, `saudi-arabia.csv`, `qatar.csv`, `kuwait.csv`, `candidate-reconciliation.csv`, `international-remote.csv`) confirmed byte-for-byte unchanged.
- `AGENTS.md` confirmed not staged.

**35/35 checks pass. 0 failures.**

## 9. Exact files changed

**Created:**
- `reconciliation/uae-round5-source-evaluation-report.md` (this file)

**Modified:**
- `docs/job-source-discovery/uae.csv` (105 → 106 rows, +1 insertion)
- `docs/job-source-discovery/master-company-registry.csv` (354 → 355 rows, +1 insertion, inserted at the end of the UAE block per the established convention)
- `docs/job-source-discovery/source-expansion/source-catalog.csv` (96 → 104 rows, +8 insertions)

**Not modified:** all other country CSVs, `AGENTS.md`, staging/manifest/dry-run/mrq files from the prior rounds, application code, database migrations, n8n workflows.

## 10. Git diff summary

```
 M AGENTS.md                                                        (pre-existing, unrelated, unstaged - untouched)
 M docs/job-source-discovery/master-company-registry.csv             (+67 insertions cumulative: 66 round-4 + 1 this round)
 M docs/job-source-discovery/source-expansion/source-catalog.csv     (+15 insertions cumulative: 7 earlier + 8 this round)
 M docs/job-source-discovery/uae.csv                                 (+67 insertions cumulative: 66 round-4 + 1 this round)
?? docs/job-source-discovery/pilots/apify-uae/                       (untracked pilot working directory)
```

No `git add`, `commit`, or `push` was run.

## 11. Final verdict

**READY_FOR_COMMIT** — one genuine employer (Katch International) correctly added to `uae.csv`/`master-company-registry.csv`; 8 legitimate job sources correctly catalogued in `source-catalog.csv` with an honest, conservative eligibility classification for each; 3 recruitment agencies' dual employer/source architecture explicitly documented (none promoted as employers pending a currently-open, directly-confirmed UAE role); 2 names left unclassified rather than fabricated. Employer and source-platform totals are reported separately throughout, as required. All 35 validation checks pass.
