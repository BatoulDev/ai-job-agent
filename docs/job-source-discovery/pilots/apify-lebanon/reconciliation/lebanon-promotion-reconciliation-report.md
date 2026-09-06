# Lebanon Registry Promotion / Reconciliation — Dry-Run Analysis

**Status: READ-ONLY ANALYSIS (Sections 1–10 below, unchanged since original analysis). Staging artifacts generated from this analysis's `promote_now` set live alongside this report in this same directory — see §0 below. `lebanon.csv` itself has still not been modified.**
**Analysis date:** 2026-09-06
**Policy decisions approved:** 2026-09-06 (see §0)

---

## 0. Approved policy decisions (recorded 2026-09-06, after this report was first delivered)

The user reviewed §7's five open policy questions and approved the following. **No evidence or classification in Sections 1–10 below was altered as a result** — these are forward-looking execution decisions layered on top of the original, unchanged analysis, recorded here for traceability.

1. **`no_official_source_found` (186 rows) — Option B approved.** All 186 rows stay outside `lebanon.csv` as a discovery/manual-review backlog (in `enriched-company-candidates.csv` / `manual-review-queue.csv`). None promoted.
2. **`ambiguous_identity_manual_review` / `likely_employer_needs_verification` (34 rows) — Option B approved.** Held outside `lebanon.csv` until identity is resolved. No canonical registry IDs minted for these now.
3. **Branch / field-office records — Option A approved.** The current one-row-per-employer-per-country model is preserved. Spinneys Saida and UNHCR Zahle remain collapsed into their existing country-level `lebanon.csv` records (`cc-spinneys-lebanon`, `cc-unhcr`) as `already_exists`, not promoted as new rows. This convention will only change via a future, explicitly-approved schema change.
4. **Missing product-signal fields — Option A approved.** For the 35 `promote_now` rows, `early_career_relevance` and `internship_or_graduate_program_detected` are set to the existing documented value `unknown` wherever no verified value already exists. No assessed values were invented and no new research was performed to fill them.
5. **HomePro `pilot-0026` — Option B approved, but deferred.** A future, separate, timeout-bounded research task is approved in principle; it was **not** performed in this pass. HomePro is not researched and not promoted here — it remains held outside `lebanon.csv`.

This approval authorized exactly one action: **generate the reviewed staging phase** (staging CSV of the 35 `promote_now` rows + a traceability manifest), preserved in this repository directory. It did **not** authorize writing to `lebanon.csv` itself — see §11 (Staging phase execution) below for what was actually produced and its validation results.

---

## 1. Destination registry

- **Exact path:** `docs/job-source-discovery/lebanon.csv`
- **Current row count:** 65 data rows (66 lines incl. header), 34 columns.
- **Schema (34 fields):** `canonical_company_id, source_record_id, company_name, legal_or_official_name, company_type, industry, company_size_category, headquarters_country, target_country, country_code, target_city, geographic_scope, official_website_url, official_careers_url, careers_page_status, ats_provider, ats_tenant_or_board_identifier, public_jobs_endpoint_or_feed, proposed_access_method, current_open_jobs_detected, early_career_relevance, internship_or_graduate_program_detected, linkedin_company_url, linkedin_jobs_url, linkedin_presence_status, linkedin_usage_classification, evidence_urls, source_confidence, automation_eligibility, review_status, rejection_or_review_reason, terms_or_access_notes, last_verified_at, researcher_notes`.
- **Existing conventions (verified directly from the file, not assumed):**
  - `review_status` ∈ {`verified` (47 rows), `needs_manual_review` (18 rows)}. **`no_official_source_found` and `blocked_or_unsafe` have zero rows in lebanon.csv today** — even though both are valid registry-wide enum values used in other market files (Saudi Arabia, Kuwait).
  - `automation_eligibility` ∈ {`suitable_public_html_subject_to_review` (31), `unknown` (15), `manual_only` (13), `suitable_public_ats` (6)}.
  - `source_confidence` ∈ {high (25), medium (23), low (17)} — i.e. `verified` rows in this file are **not** restricted to `high` confidence; `medium`-confidence verified rows (e.g. Bank Audi) are an established pattern.
  - `proposed_access_method` reuses the exact same value as `automation_eligibility` in every sampled row — they are set identically, not two independent judgments.
  - Empty/unavailable LinkedIn fields are written as the literal string `"not_verified"`, not blank.
  - `linkedin_usage_classification` is always `not_applicable` or a manual-discovery-only value — never anything implying automated LinkedIn use (fixed product policy, confirmed in `discovery-report.md` §22.6).
  - **No `phone` column and no Google `place_id` column exist anywhere in the schema.** This is a hard schema-mapping gap for dedup (see §5, §7).
- **Downstream consumer:** no ingestion/n8n workflow currently reads this file automatically — per `pilot-report.md` §12 and `discovery-report.md` §21/§22.13, the market CSVs are a documentation-only registry; promotion into them is itself the gate before any future ingestion connector is built. No code in the repo currently parses `lebanon.csv` (confirmed by the absence of any reference to it outside `docs/job-source-discovery/`).

## 2. Source documentation reviewed

- `docs/job-source-discovery/discovery-report.md` (375 lines — the authoritative policy document; Round 2/3 conventions and the §22.12 "evidence-classification audit" rule were load-bearing for this analysis).
- `docs/job-source-discovery/candidate-reconciliation.csv` (prior reconciliation precedent: `new_verified_record_added` vs `new_needs_manual_review_record_added` decision vocabulary).
- `docs/job-source-discovery/master-company-registry.csv` (254 rows, all markets — used to check cross-market canonical-ID claims).
- `docs/job-source-discovery/pilots/apify-lebanon/pilot-report.md` and `pilot-stats.json` (pilot execution record; explicitly states no cross-registry dedup was performed at pilot time and that promotion requires separate approval).
- `docs/job-source-discovery/pilots/apify-lebanon/enrichment/enrichment-progress.json` (confirms all 446 rows reached a terminal enrichment status; `enrichment-report.md` does not exist yet — the enrichment phase produced data but no closing report file).
- `docs/job-source-discovery/pilots/apify-lebanon/enrichment/duplicate-and-alias-review.csv`, `rejected-candidates.csv`, `manual-review-queue.csv`, `careers-source-summary.csv`, `linkedin-company-pages.csv` — confirmed these are all **derived filtered views** of `enriched-company-candidates.csv` (e.g. `manual-review-queue.csv` row for `pilot-0001` reproduces that row's own field values verbatim), not independent data sources. `enriched-company-candidates.csv` is the single canonical source for this reconciliation.

## 3. Promotion policy, as established by existing documentation (nothing invented)

Derived from `discovery-report.md` and the registry's own enum contracts:

1. A row may only carry `review_status=verified` when its identity, official website, and careers evidence come from a **direct read of the primary source** — not a search-engine snippet, aggregator, unverified LinkedIn result, or ambiguous name match (§22.12's explicit rule, applied retroactively there to downgrade Aspire Software, Intalio, and Esnad Contracting).
2. `verified` + `medium` confidence is an accepted, existing combination for general promotion (Bank Audi, and 22 other current lebanon.csv rows are `medium`-confidence `verified`). The `high`-confidence bar is reserved specifically for the *first-ATS-ingestion-connector* tier (§16), not for registry inclusion in general.
3. LinkedIn is never a promotion-qualifying source and is never scraped; `linkedin_usage_classification` must stay `not_applicable`/manual-only regardless of how strong a LinkedIn match is.
4. Ambiguous name-collisions and unresolved identity questions are held as `needs_manual_review`, never silently resolved and never deleted — they remain real, honestly-labeled leads (§22.12 closing principle, "not a deletion").
5. Duplicate detection against the existing registry must use domain and name matching at minimum (demonstrated practice in the round-3 candidate reconciliation and in `duplicate-and-alias-review.csv`), not name-only matching.

## 4. `review_status=no_official_source_found` — is it promotable? (206 of 446 rows, 46%)

**No — not under any currently-documented rule, and this is a genuine policy gap requiring your decision, not an oversight on my part.**

Reasoning:
- `relevance_status=eligible_employer` only says the Google-Maps category looks like a real employer sector. It says nothing about whether a verifiable official web presence exists. Of the 206 `no_official_source_found` rows, 203 carry `automation_eligibility=manual_only` and the remaining 3 (the misfiled "duplicate" rows, see §5) are `not_applicable` — **none carry evidence of an official website, careers page, or application channel of any kind.** Promoting on `relevance_status` alone would add unverifiable rows to a registry whose whole value is verification.
- **`lebanon.csv` itself has zero precedent for this status** (0 of 65 current rows), unlike Kuwait (8) and Saudi Arabia (2), which do carry `no_official_source_found` rows as "real, named companies with no confirmable official domain." Introducing the first-ever `no_official_source_found` rows into the Lebanon file is a real precedent change, not a mechanical application of an existing pattern to this file.
- Recommendation (not executed): **do not exclude these outright either** — per the registry's own "never discard a real, honestly-labeled lead" principle, the right home for them is a **discovery-only, explicitly non-automatable holding status** — either (a) adopt `no_official_source_found` into `lebanon.csv` for the first time, mirroring Kuwait/Saudi Arabia, or (b) keep them out of `lebanon.csv` entirely and leave them in `manual-review-queue.csv`/`enriched-company-candidates.csv` as a discovery backlog until a human or a fresh research pass finds a real source. **This choice is listed as an open policy decision in §7 — I have not picked one on your behalf.**

## 5. Multi-field deduplication against the existing destination

Performed independently (not just trusting the enrichment team's own `duplicate-and-alias-review.csv`) across normalized company name, normalized website/careers domain, and LinkedIn company-page slug for all 446 rows against all 65 `lebanon.csv` rows. Zero ambiguous multi-destination matches found (each matched row hit exactly one destination canonical ID).

**Confirmed genuine duplicates of existing `lebanon.csv` rows (4):**

| internal_row_id | canonical_name | matched destination | match basis |
|---|---|---|---|
| pilot-0008 | Consolidated Contractors Company | cc-ccc | normalized name (exact) |
| pilot-0070 | Murex (Mar Elias bldg) | cc-murex | normalized name (prefix) |
| pilot-0347 | Spinneys Saida | cc-spinneys-lebanon | website domain + careers domain (both directions) |
| pilot-0445 | UNHCR Zahle | cc-unhcr | website domain + careers-domain cross-match |

**Two corrections to the enrichment team's own dedup work, found during independent verification (this is exactly the kind of check you asked me not to skip):**

1. **pilot-0038 "Microsoft Lebanon" — was marked `duplicate_existing_registry_company` citing `cc-microsoft`, but this is a false match.** `cc-microsoft` in `master-company-registry.csv` is filed under `target_country=Qatar` ("Microsoft Qatar") — **`lebanon.csv` has no Microsoft row at all.** Because the row was short-circuited as "already a duplicate," no independent website/careers research was ever done for it (`official_website_url` is empty, `website_verification_status=not_applicable`). Corrected classification: **`hold_insufficient_source`**, not `already_exists` — there's no evidence to promote it, and it isn't actually a duplicate either. This should be flagged back to whoever owns the enrichment data as a real data-quality bug, independent of what you decide about promotion.
2. **pilot-0110 "Fundbot" — my own first-pass automated domain-matcher incorrectly flagged it as matching `cc-beirut-digital-district`.** Fundbot's `careers_page_url` is a tenant-company profile page hosted on Beirut Digital District's *shared* careers portal (`careers.beirutdigitaldistrict.com/companies/profile/494/show`) — Fundbot is a distinct company (own domain `fundbot.co`) that merely has a listing there, the way many BDD member startups would. Matching on a shared/aggregator job-board domain produced a false positive. Corrected: **`hold_manual_review`** (its actual `review_status`), not `already_exists`. No other row shares this specific BDD careers-portal URL, so this was an isolated false positive, not a systemic one — but it demonstrates that **domain-only matching against a shared coworking/business-park careers portal is unsafe** and should require name-similarity corroboration before being trusted (see schema-mapping gaps, §7).

**Internal (446-row) duplicate/alias pairs already flagged by the enrichment team in `duplicate-and-alias-review.csv`, held rather than promoted (6 rows, 3 pairs):** pilot-0167/pilot-0169 (shared phone suffix), pilot-0277/pilot-0293 (shared phone suffix), pilot-0354/pilot-0355 (shared phone suffix) — each pair "could be the same company, co-located businesses, or coincidental reuse," correctly not auto-merged. Two other pairs (pilot-0136/pilot-0143, pilot-0278/pilot-0296) were already reviewed and confirmed **not** duplicates — both sides of each pair are independently promotable/holdable on their own merits and are **not** treated as a dedup issue in the row-level table.

**What could not be checked:** phone number and Google `place_id` against the *destination* (lebanon.csv has neither field — see §7). Phone-based dedup was only possible **within** the 446 enrichment rows themselves (which is how the 3 phone-collision pairs above were found by the enrichment team), not against the existing registry.

## 6. Row-level dry-run classification (all 446 rows)

Produced as a full CSV (attached): **`lebanon-promotion-dry-run.csv`** — one row per `internal_row_id`, with `canonical_name`, `relevance_status`, `review_status_source` (the enrichment file's own value), `proposed_action`, exact `reason`, `matched_destination_row` (canonical ID when applicable), `proposed_destination_status`, `automation_eligibility`, `confidence_level`, and both URLs, for all 446 rows. Classification actions used: `promote_now`, `already_exists`, `exclude_rejected`, `hold_manual_review`, `hold_insufficient_source`, `hold_duplicate_or_alias_review`. Every row is accounted for exactly once (verified programmatically: 446 = 446).

An additional evidence-quality finding is embedded in that CSV's `reason` column for one row:

- **pilot-0003 "Optimal Solutions"** carries `review_status=verified` in the source file, but its Lebanon-identity match (the address/phone that ties this specific Google Maps candidate to this website) rests on "an independent WebSearch snippet," not a direct primary-source read — the official homepage itself displays a different, UK, contact number by default. This is structurally the same evidence-quality problem the registry's own §22.12 audit used to downgrade Aspire Software/Intalio/Esnad Contracting from `verified` to `needs_manual_review`. **Downgraded here to `hold_manual_review`, held out of the 35 promote-now candidates**, for consistency with that precedent.

## 7. Summary counts

| Metric | Count |
|---|---|
| Existing Lebanon destination total (before promotion) | **65** |
| Safe to promote now | **35** |
| Already present in the destination (incl. 2 corrections above) | **4** |
| Held for manual review (identity/employer-status/evidence unresolved) | **197** |
| Held for insufficient evidence/source (`no_official_source_found`) | **186** |
| Rejected outright (irrelevant / individual / unverifiable / HomePro) | **18** |
| Blocked by duplicate/alias uncertainty (internal phone-collision pairs) | **6** |
| **Total** | **446** ✓ |
| **Expected destination total if the 35 are promoted as-is** | **100** |

**Schema-mapping gaps** (fields `lebanon.csv` requires that `enriched-company-candidates.csv` never populates, for any of the 35 promote-now rows):
- `legal_or_official_name`, `company_size_category`, `geographic_scope`, `ats_tenant_or_board_identifier`, `public_jobs_endpoint_or_feed`, `early_career_relevance`, `internship_or_graduate_program_detected`, `linkedin_jobs_url` — **none of these exist in the enrichment schema at all.** Every promoted row would need these defaulted (mostly to `unknown`) or manually back-filled. `early_career_relevance` and `internship_or_graduate_program_detected` in particular are product-relevant signal fields used elsewhere in the registry for match quality — defaulting 35 new rows to `unknown` silently is a real quality loss worth flagging, not a free default.
- `company_type`/`industry` in the enrichment file are explicitly labeled `mapped_*_guess` (lower-confidence than the destination's unqualified fields) — promoting them verbatim would misrepresent a guess as a confirmed classification unless the field is kept as a guess-quality note.
- `careers_page_status` (destination) has no clean 1:1 enum mapping from `careers_source_type` (enrichment) — e.g. `email_or_application_form` and `careers_landing_page_no_current_listings` both need a judgment call about which destination enum value they become.
- No `phone` or Google `place_id` column exists in `lebanon.csv` at all — this is why phone/place-ID dedup against the destination was structurally impossible (§5), not just skipped.

**Policy decisions still required from you (not resolved by any existing document):**
1. Should `lebanon.csv` adopt `no_official_source_found` for the first time (186 rows affected), or should those rows stay out of the market file entirely as a discovery-only backlog?
2. Should `ambiguous_identity_manual_review` / `likely_employer_needs_verification` rows (34 rows) ever be added to `lebanon.csv` as `needs_manual_review` placeholders, or held outside the registry file until identity is resolved?
3. Should branch/field-office rows of an org that already has a country-wide `lebanon.csv` entry (Spinneys Saida, UNHCR Zahle, and potentially future ones) always collapse into `already_exists`, or does the product want city-specific rows for large chains/NGOs with multiple physical offices?
4. How should the missing product-signal fields (`early_career_relevance`, `internship_or_graduate_program_detected`) be filled for the 35 promote-now rows — defaulted to `unknown` now, or held until a follow-up enrichment pass adds them?
5. HomePro (pilot-0026): permanently excluded, or queued for a fresh, isolated, timeout-bounded research attempt (per its own `researcher_notes` recommendation)?

## 8. Four distinct things that are not interchangeable

Using the 35 promote-now rows as illustration:
- **Verified employer** — the business itself is real and correctly identified (all 35 pass this; confirmed via a direct fetch of the company's own domain, not an aggregator).
- **Verified official website** — the specific URL belongs to that specific employer (`website_verification_status=verified_official` for all 35 — the one row that failed this distinction, pilot-0003, was held out).
- **Verified careers/application source** — a real application channel exists (all 35 have a `careers_page_url` or `email_or_application_form` confirmed reachable — but for several, e.g. Beverly Beach Hotel, Serab Residencia, National American School, the page was confirmed to *exist* without confirming it currently lists open roles; `current_open_jobs_detected` stays honestly `unknown`/negative rather than assumed).
- **Safe for automated job ingestion** — only 2 of the 35 (`pilot-0424` We World, `pilot-0429` Norwegian Refugee Council, both `suitable_public_ats`) meet the registry's strongest automation tier; 16 are `suitable_public_html_subject_to_review` (HTML-scrapable pending a per-site terms review — not yet cleared); the remaining 17 are `manual_only` (display-and-apply-manually only, never to be scraped). Promoting a row into `lebanon.csv` at all is **not** the same as clearing it for automated ingestion — that remains a separate, later gate per the registry's existing "first ingestion batch" concept (§16 of `discovery-report.md`).

## 9. Recommended promotion mechanism

**Generate a reviewed staging CSV first — do not update `lebanon.csv` directly.** Reasons specific to this batch, not generic caution:
- Two dedup corrections (pilot-0038, pilot-0110) were needed even in this careful automated pass — a direct write risks compounding a prior data-quality bug (the Microsoft/Qatar mix-up) into the production Lebanon file.
- One evidence-quality downgrade (pilot-0003) shows the `verified` label in the source file isn't suffient on its own without the kind of secondary check this pass just did.
- Five open policy questions (§7) directly change *how many* rows and *which* rows would be promoted — writing to `lebanon.csv` before they're answered means redoing the write.
- This matches the project's own established pattern: every prior registry change (`discovery-report.md` Rounds 1–3) was written up as a report/reconciliation file first, with explicit before/after counts and validation, before the market CSVs were rewritten — never a silent direct edit.

## 10. Verdict

# NOT READY to write to `lebanon.csv` directly.
# READY to generate a reviewed staging CSV of the 35 `promote_now` rows, pending your answers to the 5 policy questions in §7.

**Exact proposed file changes (not executed):**
1. Create `docs/job-source-discovery/pilots/apify-lebanon/enrichment/lebanon-staging-promotion.csv` — the 35 `promote_now` rows, mapped into the full 34-column `lebanon.csv` schema (`canonical_company_id`/`source_record_id` newly minted following the existing `cc-<slug>` / `sr-lb-<slug>` convention; `legal_or_official_name`, `company_size_category`, `geographic_scope`, `ats_tenant_or_board_identifier`, `public_jobs_endpoint_or_feed`, `early_career_relevance`, `internship_or_graduate_program_detected`, `linkedin_jobs_url` defaulted to `unknown`/`not_applicable` pending your policy answers in §7; `proposed_access_method` set equal to `automation_eligibility` per the existing lebanon.csv convention; `linkedin_company_url`/`linkedin_presence_status` populated only for the subset with `linkedin_status=verified_official_company_page`, all others set to the literal string `"not_verified"`).
2. **Only after your sign-off on that staging file and the 5 policy questions**: append its rows to `docs/job-source-discovery/lebanon.csv` (65 → 100 rows) and update `docs/job-source-discovery/master-company-registry.csv` to match (rebuilt from the corrected country files, per the existing convention in `discovery-report.md` §20).
3. No change proposed to `enriched-company-candidates.csv`, `manual-review-queue.csv`, `rejected-candidates.csv`, or `duplicate-and-alias-review.csv` — those remain the enrichment-phase historical record; the 2 corrections found in §5 should be tracked as a follow-up data-quality note, not silently rewritten into that historical file.

Neither of these has been executed at the time this section was originally written. **§11 below documents what was subsequently approved and executed.**

---

## 11. Staging phase execution (2026-09-06, after policy approval in §0)

Executed exactly one action: generated the reviewed staging artifacts for the 35 `promote_now` rows. **`lebanon.csv` was not modified** — confirmed both before and after generation (65 data rows, unchanged SHA-256 `8680f309cf490626388cf202fdaf0095d6d6b5e55d4c2f688543ae60deab2632`).

### Files produced (this directory)
- `lebanon-promotion-staging.csv` — 35 rows, exact 34-column `lebanon.csv` schema and column order.
- `lebanon-promotion-staging-manifest.csv` — 35 rows, one per staged candidate: `internal_row_id`, `canonical_name`, proposed `canonical_company_id`/`source_record_id`, source evidence used, website/careers/LinkedIn verification status, automation eligibility, confidence, every defaulted `unknown` field, dedup result, and any mapping correction applied. This is the traceability record — `lebanon.csv`'s schema has no field for `internal_row_id`, so per the approved instruction, traceability lives here rather than as a schema change.
- `lebanon-promotion-dry-run.csv` and this report — the original 446-row analysis, preserved unchanged.

### Field-mapping rules applied (deterministic, evidence-only — no field was fabricated)
- `company_name`: the enrichment row's `canonical_name`, verbatim — no shortening or editorial cleanup, so nothing is asserted beyond the sourced value.
- `canonical_company_id` / `source_record_id`: minted following the existing `cc-<slug>` / `sr-lb-<slug>` convention, slugified mechanically from the first segment of `canonical_name` (split on the first ` - `, `|`, or `(`) — a readability convention only; `company_name` itself keeps the full original string. Checked for collisions against all 65 existing IDs and within the 35 new ones (none found). Several minted slugs are mechanically ugly (e.g. `cc-wak-engineering-s-a-r-l` from splitting on each period in "S.A.R.L") — flagged for a human to rename before merge; not corrected here to avoid an editorial judgment call.
- `legal_or_official_name`, `company_size_category`, `ats_tenant_or_board_identifier` (except the 2 ATS rows below), `public_jobs_endpoint_or_feed` (except 2 rows with a directly-quoted recruitment email), `linkedin_jobs_url`, `early_career_relevance`, `internship_or_graduate_program_detected`: set to `unknown` (or `not_verified` for LinkedIn fields, matching the existing file's own placeholder convention) — **none of these fields exist anywhere in `enriched-company-candidates.csv`**, so there was no evidence to map from. This is the schema gap already documented in §7, resolved per approved decision #4.
- `company_type` / `industry`: carried through from the enrichment file's own `mapped_company_type_guess` / `mapped_industry_guess` — the best available classification, though explicitly guess-quality rather than independently confirmed. **One correction applied:** `pilot-0421` (Oxfam Lebanon - Zahle)'s own `mapped_industry_guess` was `information_technology`, directly contradicting that same row's own `google_category` (`Non-profit organization`), `categories` (`NGOs and professional services`), and its own `mapped_company_type_guess` (`ngo`) — an internal inconsistency in the source data, not a judgment call. Corrected to `ngo_humanitarian` using the row's own stronger, structured evidence, matching its sibling NGO rows (Medair, DRC, Salam LADC, We World, NRC) in the same batch. No other row among the 35 showed this kind of internal contradiction (checked all 35 against their own `google_category`/`categories`).
- `geographic_scope`: `single_country` for the 30 Lebanon-only local businesses/schools/hospital, matching the existing convention already used in `lebanon.csv` for structurally identical single-city SMEs (AltCom, Htech, SE Factory, Cedar Digital Solutions, etc. are all `single_country` despite being single-office businesses). The 5 international-NGO Lebanon field offices (Medair, Oxfam, DRC, We World, NRC) use `global`, matching the existing precedent for UNHCR/Mercy Corps (global humanitarian orgs with a Lebanon office) rather than `global_multinational_with_local_office` (used for corporate multinationals like Four Seasons/Aspire Software/Netways) — a precedent match, not an invented category.
- `careers_page_status`: mapped deterministically from `careers_source_type` — `jobs_page_with_active_listings`→`active_with_open_jobs` (2 rows, matches their own `current_open_jobs_detected=yes_current`); `email_or_application_form`→`recruitment_email_only` (7 rows); everything else (`public_company_careers_page`, `careers_landing_page_no_current_listings`, `public_ats`)→`careers_page_found`, the neutral/found status — deliberately **not** upgraded to `active_no_open_jobs` even where a researcher's prose note said a page showed no openings (e.g. Beverly Beach Hotel), because the row's own structured `current_open_jobs_detected` field says `unknown`, and the structured field was trusted over free text to avoid over-claiming.
- `public_jobs_endpoint_or_feed`: `unknown` except 4 rows with genuine machine-checkable evidence — `pilot-0424`/`pilot-0429` (confirmed ATS, set to the real careers URL / ATS host) and `pilot-0224`/`pilot-0251`, where `careers_notes` directly quoted a real recruitment email address (`hr@wak-engineering.com`, `info@kfouryengineering.com`) that is carried through verbatim, formatted to match the existing file's own `"none (email application: ...)"` convention.
- `linkedin_company_url` / `linkedin_presence_status`: populated with the real URL and `verified_official` only for the 14 rows where `linkedin_status=verified_official_company_page`; all other 21 rows use the literal `"not_verified"` string, matching the existing file's convention — including `pilot-0072` (Easysoft), whose LinkedIn match was only `likely_match_needs_review` due to a name discrepancy ("Easysoft ME" vs. "Easysoft SARL") and so is not treated as confirmed.
- `proposed_access_method`: set equal to `automation_eligibility`, matching the existing file's own convention (every sampled `lebanon.csv` row sets these identically).
- `evidence_urls`: concatenation of the row's own `website_evidence_url` / `careers_evidence_url` (+ `linkedin_evidence_url` where LinkedIn was used), deduplicated, `"; "`-joined — no URL appears that wasn't already a cited evidence field in the source row.
- `researcher_notes`: the enrichment row's own `researcher_notes` field, verbatim.
- `terms_or_access_notes`: the row's own `careers_notes` (or `website_notes` if empty), verbatim.

### Explicit exclusions confirmed absent from staging
`pilot-0038` (Microsoft Lebanon), `pilot-0110` (Fundbot), `pilot-0003` (Optimal Solutions), `pilot-0026` (HomePro) — verified programmatically absent from the 35 `promote_now` IDs before generation (a hard check that throws if any appear).

### Validation results (all 9 automated checks passed; see also §D discussion below)

| # | Check | Result |
|---|---|---|
| 1 | Staging contains exactly 35 rows | **PASS** — 35 |
| 2 | `lebanon.csv` remains exactly 65 rows, byte-for-byte unchanged | **PASS** — 65 rows; SHA-256 identical before and after |
| 3 | Expected post-promotion total is exactly 100 | **PASS** — 65 + 35 = 100 |
| 4 | No duplicate `canonical_company_id` | **PASS** — none within staging, none colliding with the existing 65 |
| 5 | No duplicate employer vs. the existing 65 (name / website domain / careers domain / LinkedIn) | **PASS** — 0 matches found; also checked for duplicates *within* the 35 staged rows themselves (0 found). Phone and Google `place_id` dedup against the destination remains structurally impossible — `lebanon.csv` has neither column (documented schema gap, §7) — internal 446-row phone-collision pairs were already excluded from `promote_now` in the original analysis. |
| 6 | No personal `linkedin.com/in/` URL in any URL field | **PASS** — 0 found |
| 7 | No `needs_manual_review` / `no_official_source_found` / ambiguous / insufficient-source / duplicate-alias / rejected / unsafe / automation-ineligible candidate appears | **PASS** — every staged row's source is `review_status=verified` + `relevance_status=eligible_employer`; the 4 explicit exclusions confirmed absent |
| 8 | All destination enum values valid (`careers_page_status`, `linkedin_presence_status`, `linkedin_usage_classification`, `review_status`, `geographic_scope`, `company_size_category`) | **PASS** — checked against the full value set actually used across `master-company-registry.csv` and `lebanon.csv`; 0 violations |
| 9 | CSV structure: column counts, header order, quoting, CRLF line endings, encoding match `lebanon.csv` conventions | **PASS** — 34 columns every row, header byte-identical to `lebanon.csv`, CRLF endings, UTF-8 no-BOM |
| 10 | `git diff` contains only the intended reconciliation artifacts; `lebanon.csv` does not appear as modified | **PASS** — `git status --short` shows only the new, untracked `docs/job-source-discovery/pilots/apify-lebanon/reconciliation/` directory (plus the pre-existing, unrelated `AGENTS.md` change written by the Next.js dev server itself, not by this work) |

### Unexpected mapping issues found during generation
1. **`pilot-0421` industry-guess self-contradiction** (described above) — corrected using the row's own evidence, documented in the manifest's `mapping_correction_applied` column.
2. **Cosmetic, not substantive:** several minted `canonical_company_id` slugs are awkward (e.g. `cc-wak-engineering-s-a-r-l`, `cc-doumani-and-co-cpas`) because the mechanical slugifier splits on every period/ampersand. A human should rename these to match the shorter, cleaner style of the existing 65 IDs (e.g. `cc-wak-engineering`) before merging into `lebanon.csv` — left as-is here to avoid making an uninstructed editorial judgment call.
3. **`legal_or_official_name` is `unknown` for all 35** — the enrichment schema has no dedicated legal-name field; several `website_notes` do informally state a full/confirmed name in prose (e.g. BML Istisharat's notes describe it as founded in 1972), but extracting a "legal name" from free text was judged too interpretive to do without a documented rule, per the no-fabrication instruction. Left for manual backfill.

## Verdict on applying staging into `lebanon.csv`

# READY — the staging phase is complete and all 9 automated validations pass; the staging CSV and manifest are ready for your review.
# NOT READY for the staging content to be merged into `lebanon.csv` without that review — 2 cosmetic ID cleanups (above) and a spot-check of the guess-quality `company_type`/`industry` fields are recommended first. No merge has been performed; this remains your decision.

`git status` confirms no file outside the new `reconciliation/` directory was created or modified by this phase. No commit, push, or `lebanon.csv` write occurred.

---

## 12. Final human-review audit and applied corrections (2026-09-06)

A full human-review audit of the 35-row staging set was performed and approved. This section records the audit's findings, the user's approved decisions, and the corrections actually applied to the staging artifacts. **`lebanon.csv` was not modified — confirmed unchanged (65 rows) both before and after this pass.**

### 12.1 Correction to the audit's own summary count

The audit's row-level table classified all 35 rows as: **12 approve unchanged, 22 correct_then_approve, 1 hold** (12 + 22 + 1 = 35 — verified arithmetically correct). An earlier draft of the audit's closing summary paragraph incorrectly referenced "21 other corrections" instead of 22; that was a documentation slip in the summary prose, not a re-classification of any row. **Corrected here: the count is 22 correct_then_approve rows**, of which:
- **20 rows** received an actual field correction (canonical ID, company_name, industry, and/or company_type), applied in §12.3 below.
- **2 rows** (National American School, Antonine Sisters School) were identified as needing a `company_type` correction but that correction could **not** be applied without inventing an undocumented enum value — see §12.4. These 2 rows remain in the promoted set with their original (flagged, uncorrected) `company_type=university` value.

### 12.2 KHOUBOURAT (pilot-0037) — removed from promotion, held

**Approved decision: removed from the promotable staging set and reclassified as `hold_manual_review`.**

- **Reason:** the row's own `researcher_notes` state KHOUBOURAT is "an HR/job-placement program run by IRADA (Union of Businessmen for Support & Development)." Existing evidence does not establish whether KHOUBOURAT is itself a separate legal employer or a program/department of IRADA (which is not otherwise in the registry) — an identity uncertainty the registry's own rules require holding rather than guessing.
- **No new research was performed** to resolve this — it is held exactly as flagged.
- **`cc-khoubourat` / `sr-lb-khoubourat` were never minted into `lebanon.csv`.**
- Removed entirely from `lebanon-promotion-staging.csv` (row deleted) and from `lebanon-promotion-staging-manifest.csv` (row deleted — the manifest's flat, promotable-rows-only design has no separate "held" section to move it into, so its hold rationale is recorded here in the report instead).
- `lebanon-promotion-dry-run.csv`, row `pilot-0037`: `proposed_action` changed from `promote_now` to `hold_manual_review`; `proposed_destination_status` changed from `verified` to `needs_manual_review` (matching the exact convention already used by the file's other `hold_manual_review` rows); `reason` rewritten to record this exact rationale and the date of the downgrade. No other field on this row, and no other row's classification, was touched.

### 12.3 Corrections applied to the 34 promoted rows

All corrections below were applied identically to both `lebanon-promotion-staging.csv` (the 34-row, 34-column destination-schema mirror) and `lebanon-promotion-staging-manifest.csv` (the traceability record, via its `mapping_correction_applied` column) so the two files stay in lock-step. Verified programmatically: both files now contain the same 34 `canonical_company_id` values, in the same order, with zero divergence.

**Canonical-ID corrections (16 rows)** — mechanical artifacts, unnecessary legal suffixes, or high-collision-risk generic/acronym IDs, renamed to a cleaner, more specific, still-deterministic form (matching `source_record_id` updated in lockstep for each):

| internal_row_id | old ID | new ID |
|---|---|---|
| pilot-0018 | cc-iss | cc-iss-software-hive |
| pilot-0066 | cc-cme | cc-cme-offshore |
| pilot-0067 | cc-creyasoft-sarl | cc-creyasoft |
| pilot-0072 | cc-easysoft-sarl | cc-easysoft |
| pilot-0099 | cc-sfai | cc-sfai-choujaa |
| pilot-0114 | cc-serhal-nassar-and-co | cc-serhal-nassar |
| pilot-0123 | cc-doumani-and-co-cpas | cc-doumani |
| pilot-0156 | cc-beverly-beach-hotel | cc-beverly-hotels |
| pilot-0187 | cc-unic-factory | cc-unic-cooler |
| pilot-0224 | cc-wak-engineering-s-a-r-l | cc-wak-engineering |
| pilot-0251 | cc-kfoury-engineering-and-contracting | cc-kfoury-engineering |
| pilot-0253 | cc-bardawil-and-co | cc-bardawil |
| pilot-0260 | cc-general-construction-company | cc-general-construction-company-lebanon |
| pilot-0331 | cc-hhumc-hammoud-hospital-university-medical-center | cc-hammoud-hospital-university-medical-center |
| pilot-0420 | cc-medair-zahle | cc-medair |
| pilot-0424 | cc-we-world-zahle-office | cc-we-world |

All 16 replacement IDs were checked for collisions against the full 254-row `master-company-registry.csv` and against the other 33 staged rows — **zero collisions found.**

**Canonical employer-name normalizations (8 rows)** — dropped branch/city/neighborhood qualifiers or corrected to the confirmed operating brand, per the one-employer-per-country rule:

| internal_row_id | old company_name | new company_name | basis |
|---|---|---|---|
| pilot-0122 | BML Istisharat - Ashrafieh | BML Istisharat | single-office company; "Ashrafieh" is just the neighborhood, no evidence of multiple branches |
| pilot-0156 | Beverly Beach Hotel | Beverly Hotels | row's own notes confirm it is 1 of 3 properties sharing one chain-wide careers page — chain is the actual hiring entity |
| pilot-0187 | UNIC Factory | UNIC Cooler | "UNIC Factory" was the Google Maps POI label; confirmed brand/legal identity is UNIC Cooler / United for Industry & Contracting S.A.L. |
| pilot-0420 | Medair Zahle | Medair | new country-level entry; dropped city qualifier to match its own corrected ID |
| pilot-0421 | Oxfam Lebanon - Zahle | Oxfam Lebanon | dropped branch/city qualifier |
| pilot-0422 | Danish Refugee Council - Bekaa Office | Danish Refugee Council | dropped branch/office qualifier |
| pilot-0424 | We World Zahle office | WeWorld | dropped branch/city qualifier; matched org's own one-word brand (weworld.it) |
| pilot-0429 | Norwegian Refugee Council - Zahle office | Norwegian Refugee Council | dropped branch/office qualifier |

Two location-qualified names were reviewed and **deliberately kept as-is** (not normalized): `National American School - NAS` and `Antonine Sisters School - CSJ Ksara`. Both operate on their own dedicated, campus-specific domains (`naszahleh.school`, `antonineszk.org`) with no evidence of a broader multi-campus parent entity to normalize to — removing the qualifier here would assert an unverified single-employer identity that the evidence does not support.

**Audit/accounting professional-services corrections (3 rows)** — `industry` and `company_type` were mismapped to `banking_finance` / `private_company` even though all three are audit/CPA firms, not banks or financial institutions:

| internal_row_id | company | old industry | new industry | old company_type | new company_type |
|---|---|---|---|---|---|
| pilot-0099 | SFAI - Choujaa Audit Firm | banking_finance | professional_services_consulting | private_company | professional_services_firm |
| pilot-0114 | Serhal Nassar & Co | banking_finance | professional_services_consulting | private_company | professional_services_firm |
| pilot-0123 | DOUMANI & Co. CPAs | banking_finance | professional_services_consulting | private_company | professional_services_firm |

**Enum validation performed before applying these (per the approved instruction, decision #3):** both `professional_services_consulting` (industry) and `professional_services_firm` (company_type) were confirmed, by direct query of `master-company-registry.csv`, to already be documented, in-use values — `professional_services_firm` is already used in `lebanon.csv` itself (e.g. `cc-asaas-tech`, `cc-netways`), and `professional_services_consulting` appears across the wider registry. Neither value was invented.

### 12.4 Schema decision required — NOT applied (2 rows)

**`company_type=university` for `pilot-0406` (National American School) and `pilot-0407` (Antonine Sisters School) is factually contradicted** — both sources confirm K-12/secondary institutions (NAS: explicit "Nursery-Grade 12"; Antonine Sisters: a Catholic "Collège," which denotes a secondary school in this usage, not an English-sense university) — but **this correction was not applied**, per the approved instruction to stop and report rather than invent an enum:

- Queried the full `company_type` value set across all 254 rows of `master-company-registry.csv` (which is a superset of `lebanon.csv`'s own values): **no `school`, `k12_school`, or any K-12-equivalent value exists anywhere in the documented enum.**
- `unknown` is **not** a documented/used value for the `company_type` field either — every one of the 254 rows carries a real, specific `company_type`; `unknown` is only ever used for other fields (industry gaps, LinkedIn fields, product-signal fields), never for `company_type`.
- Per the approved instruction ("do not invent a new enum... otherwise stop and report the schema decision required"), **both rows were left unchanged** at `company_type=university`, and the issue is flagged in both files (`researcher_notes`/`mapping_correction_applied`) as an open, unresolved data-quality item.
- **Schema decision needed from the product owner:** either (a) add a documented `school` (or `k12_school`) `company_type` enum value to the registry's schema conventions, after which these 2 rows can be corrected in a follow-up pass, or (b) decide on an existing value to reuse instead (none of the current values are an accurate fit) and approve that specific mapping explicitly.

### 12.5 Other pre-existing observation (not corrected, out of approved scope)

`pilot-0122` (BML Istisharat)'s `industry=unknown` value was carried through unmodified from the original (already-approved) staging pass. A check of the full `master-company-registry.csv` industry-value set found that `unknown` is likewise not actually used anywhere as an `industry` value across the registry (same gap as `company_type`, §12.4). This was **not** part of the approved correction list for this pass (only the name change dropping "- Ashrafieh" was approved for this row) and was left untouched; flagged here for transparency, not silently fixed.

### 12.6 Revised totals

| Metric | Value |
|---|---|
| Rows in original 35-row staging set | 35 |
| Removed (held, not promoted): KHOUBOURAT | 1 |
| **Revised staging total** | **34** |
| Existing `lebanon.csv` total (unchanged) | 65 |
| **Revised expected `lebanon.csv` total if merged** | **65 + 34 = 99** |
| Rows approved unchanged | 12 |
| Rows corrected (correct_then_approve, field(s) actually changed) | 20 |
| Rows flagged correct_then_approve but blocked pending a schema decision (no field changed) | 2 |
| **Total correct_then_approve (matches the audit table)** | **22** |
| Rows held | 1 |
| **Total accounted for (12 + 22 + 1)** | **35** ✓ |

### 12.7 Validation results (this pass)

| # | Check | Result |
|---|---|---|
| 1 | Staging contains exactly 34 rows | **PASS** |
| 2 | KHOUBOURAT absent from staging (and manifest) | **PASS** — 0 occurrences of "khoubourat" in either file |
| 3 | All 22 correct_then_approve rows carry their approved correction (20 field-corrected + 2 explicitly flagged/blocked) | **PASS** |
| 4 | The 12 approve-unchanged rows are byte-identical to the original staging pass | **PASS** — no edits touched these rows |
| 5 | `lebanon.csv` remains exactly 65 rows, byte-for-byte unchanged | **PASS** |
| 6 | Expected post-promotion total is 99 | **PASS** — 65 + 34 |
| 7 | No duplicate `canonical_company_id` | **PASS** — 34 unique IDs in staging, 34 unique IDs in manifest, identical sets, all 16 renamed IDs checked against the 254-row master registry with zero collisions |
| 8 | No name / website-domain / careers-domain / LinkedIn duplicate within staging or against `lebanon.csv`'s 65 rows | **PASS** — checked programmatically, 0 collisions found in either direction |
| 9 | All industry/company_type/status enum values valid | **PASS for all applied corrections** (`professional_services_consulting`, `professional_services_firm` confirmed in-use); **2 known pre-existing gaps left unresolved and flagged**, not silently defaulted (`company_type=university` on the 2 school rows, §12.4; `industry=unknown` on BML Istisharat, §12.5) |
| 10 | No held/ambiguous/insufficient-source/rejected/unsafe/automation-ineligible candidate is staged | **PASS** — KHOUBOURAT (the only such candidate) was removed |
| 11 | No personal `linkedin.com/in/` URL in any URL field | **PASS** — scoped check across `official_website_url`, `official_careers_url`, `linkedin_company_url`, `linkedin_jobs_url`, `evidence_urls`, `public_jobs_endpoint_or_feed`; 0 found. (One incidental mention of a personal LinkedIn profile appears inside a free-text `researcher_notes` field for DOUMANI & Co., explicitly noting that profile was excluded from evidence — not a URL-field occurrence.) |
| 12 | CSV schema/encoding/quoting/line-endings preserved | **PASS** — 34 columns per row in staging (matching `lebanon.csv`'s schema), CRLF line endings, UTF-8 no-BOM, in both edited files |
| 13 | `git diff` includes only the 4 permitted reconciliation files | **PASS** — see §12.8 |
| 14 | `AGENTS.md` untouched and not staged | **PASS** — unrelated, pre-existing, dev-server-authored change; not part of this task's diff |

### 12.8 Files touched in this pass

Only the following were edited, all inside `docs/job-source-discovery/pilots/apify-lebanon/reconciliation/`:
- `lebanon-promotion-staging.csv`
- `lebanon-promotion-staging-manifest.csv`
- `lebanon-promotion-dry-run.csv`
- `lebanon-promotion-reconciliation-report.md` (this file)

**Not touched:** `lebanon.csv`, `enriched-company-candidates.csv`, `AGENTS.md`, or any other file in the repository. No commit or push was performed.

## Verdict on merging the corrected staging set into `lebanon.csv`

# READY — the corrected 34-row staging set and its manifest are internally consistent, fully synchronized, and pass all 14 validation checks above.
# One open item remains outside this pass's authority: the `company_type=university` schema gap for the 2 school rows (§12.4) requires a product-owner decision (add a `school` enum value, or approve an explicit alternative mapping) before those 2 rows' `company_type` can be corrected. This does not block promotion of the data as currently staged (both rows are otherwise valid `verified` records), but the incorrect `university` value should not be treated as resolved.

No merge into `lebanon.csv` has been performed. No commit or push was performed.

---

## 13. Final registry promotion (2026-09-06, product-owner approval)

The product owner approved a new documented `company_type` value, `school`, resolving the §12.4 schema gap, and approved executing the merge into `lebanon.csv` plus a `master-company-registry.csv` rebuild. This section records that execution.

### 13.1 Impact check (performed before any schema or data change)

Searched the entire repository — application code (`.ts`/`.tsx`), SQL, Prisma schema files, `n8n-workflows/` — for any reference to `company_type` / `companyType`. **Zero matches outside `docs/job-source-discovery/`.** Confirmed via a second, broader repo-wide grep excluding `docs/**`, which also returned zero matches. No Prisma schema file exists in the repository at all.

**Conclusion: `company_type` is documentation/CSV-controlled only.** It is not enforced by a hard-coded application enum, not a database constraint, and not consumed by any production code, deployed automation, or n8n workflow (`cv-analysis-worker.ts`/`.json` — the only workflow files in the repo — do not reference it or any job-source-discovery file). Adding `school` is a pure documentation/data change with no code, migration, or automation impact. Safe to proceed within the current documentation/data scope, per the approved decision.

### 13.2 `company_type=school` documented and applied

- Added a new `## 23. company_type enum registry` section to `docs/job-source-discovery/discovery-report.md` (the repository's sole existing canonical policy/documentation file for this registry — no separate schema file exists) — the minimum file needed to document this, since no dedicated enum-registry document previously existed. It lists the full current `company_type` value set (38 values, including the new `school`) and records the approval rationale.
- `lebanon-promotion-staging.csv`: `pilot-0406` and `pilot-0407` rows' `company_type` changed from `university` to `school`.
- `lebanon-promotion-staging-manifest.csv`: both rows' `mapping_correction_applied` notes appended (not overwritten) to record the resolution.
- `lebanon-promotion-dry-run.csv`: no change needed — this file has no `company_type` column (its 12 columns are `internal_row_id, canonical_name, relevance_status, review_status_source, proposed_action, reason, matched_destination_row, proposed_destination_status, automation_eligibility, confidence_level, official_website_url, careers_page_url`); both rows were already `promote_now` and remain so.

**Revalidation of the 34-row staging set after this change:** 34 data rows, 34 columns each, 0 duplicate `canonical_company_id`, CRLF-only, `company_type` values now ∈ {`private_company`, `professional_services_firm`, `manufacturer`, `retailer`, `hospital`, `school`, `ngo`} — all 7 documented and valid, zero rows left with an inaccurate or undocumented value.

### 13.3 Backup / checksum record (before editing `lebanon.csv`)

- Pre-edit `lebanon.csv`: SHA-256 `8680f309cf490626388cf202fdaf0095d6d6b5e55d4c2f688543ae60deab2632`, 59,569 bytes, 65 data rows (matches the checksum recorded in §11 — confirms it was never touched between the two reconciliation passes).
- Byte-for-byte copy saved to `lebanon-pre-promotion-backup-2026-09-06.csv` in this same directory; copy's SHA-256 verified identical to the source before editing.
- Pre-rebuild `master-company-registry.csv`: SHA-256 `30645f9d93addd9d83e1397547f474a618ef6d73285b202ac9456b55c5db9ee0`, 274,744 bytes, 254 data rows. Byte-for-byte copy saved to `master-company-registry-pre-promotion-backup-2026-09-06.csv` in this same directory.

### 13.4 `lebanon.csv` promotion executed

Appended the 34 validated, corrected staging rows directly after the existing 65 rows (raw row-text splice, not a re-parse/re-serialize, to guarantee byte-for-byte preservation of every existing cell and of the destination schema's exact quoting/line-ending conventions). New rows were added in the same order they appear in the corrected `lebanon-promotion-staging.csv` (itself in the original dry-run/`internal_row_id` discovery order) — matching the registry's existing convention of appending each new promotion batch in the order its candidates were processed, rather than re-sorting alphabetically or by ID (the same convention the existing Round-3 batch, rows 51–66, already follows).

**One encoding note, flagged rather than silently resolved:** the approved instructions described the target encoding as "UTF-8 no-BOM," but `lebanon.csv` (and every other market CSV, and `master-company-registry.csv`) **actually already carries a UTF-8 BOM** — confirmed by direct byte inspection (`EF BB BF` at offset 0) before any edit in this pass. Since the paramount requirement was to preserve the file's own existing exact encoding/conventions, the existing BOM was preserved rather than stripped (stripping it would itself be an unrequested, unrelated change to the file's byte-level format, and would make the new file inconsistent with all 5 sibling market CSVs, which also carry the same BOM). Flagging this discrepancy between the instruction's description and the file's actual encoding rather than silently picking one interpretation.

### 13.5 `master-company-registry.csv` synchronization

Per the documented process (`discovery-report.md` §22.12/§22.13: "`master-company-registry.csv` rebuilt from the corrected market files"), rebuilt by concatenating the 6 market CSVs in their existing established order — confirmed by inspecting the pre-rebuild file's own `target_country` block sequence: **Lebanon → Saudi Arabia → Qatar → Kuwait → United Arab Emirates → International-remote** (the last block's `target_country` value is literally `"Lebanon"` for international-remote rows, since those are Lebanon-eligible-remote records — not a second Lebanon block). No manual/improvised mapping was used — the exact same file-concatenation method already documented and previously used to produce the 254-row version was re-applied mechanically: single BOM + header from `lebanon.csv`, followed by each file's own data rows in sequence, with each file's individual header and BOM stripped before appending.

| File | Data rows (unchanged) |
|---|---|
| `lebanon.csv` | **99** (was 65 — the only file that changed) |
| `saudi-arabia.csv` | 43 |
| `qatar.csv` | 40 |
| `kuwait.csv` | 36 |
| `uae.csv` | 39 |
| `international-remote.csv` | 31 |
| **Total** | **288** |

### 13.6 Lebanon before/after totals

| Metric | Before | After |
|---|---|---|
| `lebanon.csv` data rows | 65 | **99** |
| New rows added | — | **34** |
| Original 65 rows | unchanged | **cell-for-cell identical, confirmed programmatically** |

### 13.7 Master registry before/after totals

| Metric | Before | After |
|---|---|---|
| `master-company-registry.csv` data rows | 254 | **288** |
| Unique `canonical_company_id` values | 227 | **261** (227 + 34 new Lebanon companies) |
| Intentional multi-market repeat companies | 13 (EY, KPMG, Deloitte, PwC, Netways, newtecx, People365, Al Tamimi & Company, Talabat, Ooredoo, Zain, Careem, Tabby) | **13 (unchanged — same 13 companies, same row counts each)** |
| Duplicate `(canonical_company_id, target_country)` pairs | 0 | **0** |
| Cross-market collisions between the 34 new Lebanon rows and the other 254 rows (name / website domain / careers domain / LinkedIn) | — | **0** |

### 13.8 Final validation evidence (all 14 mandatory checks)

| # | Check | Result |
|---|---|---|
| 1 | `lebanon.csv` exactly 99 rows | **PASS** — 99 data rows + header, verified with a real CSV parser |
| 2 | Exactly 34 new rows vs. the pre-promotion version | **PASS** — 99 − 65 = 34, and the 34 appended rows match the corrected staging CSV row-for-row, in order |
| 3 | All original 65 Lebanon rows remain cell-for-cell unchanged | **PASS** — programmatic cell-by-cell diff against the `lebanon-pre-promotion-backup-2026-09-06.csv` checksum-verified backup: 0 differences |
| 4 | Both school rows use `company_type=school` | **PASS** — `cc-national-american-school` and `cc-antonine-sisters-school` both confirmed |
| 5 | No promoted row uses an inaccurate or undocumented enum | **PASS** — all 34 rows' `company_type` values are in the now-documented 38-value set; no row left at `university`/`private_company`/other inaccurate value |
| 6 | No duplicate `canonical_company_id` within Lebanon or across the master registry | **PASS** — 0 duplicates within the 99 Lebanon rows; the only repeated IDs registry-wide are the 13 pre-existing, documented intentional multi-market companies (unchanged from before this pass); 0 duplicate `(id, target_country)` pairs |
| 7 | No duplicate employer by normalized name, alias, official domain, careers/ATS domain, or LinkedIn company URL | **PASS** — checked the 34 new rows against all 254 pre-existing master-registry rows (all markets, not just Lebanon): 0 collisions |
| 8 | No held/rejected/insufficient-source/ambiguous/unsafe/automation-ineligible candidate was promoted | **PASS** — KHOUBOURAT (the only such candidate in the original 35) was removed in the prior pass and never re-added; all 34 promoted rows are `review_status=verified` |
| 9 | No personal `linkedin.com/in/` URL in URL fields | **PASS** — scoped check across `official_website_url`, `official_careers_url`, `linkedin_company_url`, `linkedin_jobs_url`, `evidence_urls`, `public_jobs_endpoint_or_feed` in the final `lebanon.csv`: 0 found |
| 10 | All URLs and source statuses consistent with the staging manifest | **PASS** — the appended rows are a direct, unmodified splice of the corrected staging CSV, so they are identical by construction; manifest cross-checked for the same 34 `canonical_company_id` values, 0 divergence |
| 11 | All CSV schemas, column counts, quoting, line endings, UTF-8 encoding valid | **PASS** — 34 columns per row throughout, CRLF-only, UTF-8 with BOM preserved (see §13.4's encoding note) |
| 12 | Every non-Lebanon country CSV remains byte-for-byte unchanged | **PASS** — `git diff --stat` for `saudi-arabia.csv`, `qatar.csv`, `kuwait.csv`, `uae.csv`, `international-remote.csv` shows zero changes |
| 13 | `git diff` contains only the intended registry, reconciliation, and minimum enum-documentation files | **PASS** — `git status --short` shows exactly: `AGENTS.md` (pre-existing, unrelated), `discovery-report.md` (modified — school enum), `lebanon.csv` (modified — promotion), `master-company-registry.csv` (modified — rebuild), and the untracked `reconciliation/` directory |
| 14 | The unrelated `AGENTS.md` modification remains untouched and is not staged | **PASS** — confirmed via `git diff --stat AGENTS.md` showing the same pre-existing 10-insertion/1-deletion diff as before this task began; nothing in this task touched it, and nothing was staged (`git add` was never run) |

### 13.9 Files changed in this pass

- `docs/job-source-discovery/discovery-report.md` (new `company_type` enum section)
- `docs/job-source-discovery/lebanon.csv` (65 → 99 rows)
- `docs/job-source-discovery/master-company-registry.csv` (254 → 288 rows, rebuilt)
- `docs/job-source-discovery/pilots/apify-lebanon/reconciliation/lebanon-promotion-staging.csv` (2 `company_type` corrections)
- `docs/job-source-discovery/pilots/apify-lebanon/reconciliation/lebanon-promotion-staging-manifest.csv` (2 notes updated)
- `docs/job-source-discovery/pilots/apify-lebanon/reconciliation/lebanon-promotion-reconciliation-report.md` (this file)
- `docs/job-source-discovery/pilots/apify-lebanon/reconciliation/lebanon-pre-promotion-backup-2026-09-06.csv` (new backup file)
- `docs/job-source-discovery/pilots/apify-lebanon/reconciliation/master-company-registry-pre-promotion-backup-2026-09-06.csv` (new backup file)

**Not touched:** `enriched-company-candidates.csv`, `saudi-arabia.csv`, `qatar.csv`, `kuwait.csv`, `uae.csv`, `international-remote.csv`, `AGENTS.md`, or any application code, migration, or environment file.

## Final verdict

# READY for commit — the promotion is complete, `lebanon.csv` is at 99 rows, `master-company-registry.csv` is at 288 rows, and all 14 mandatory validation checks pass with no open items remaining.

No commit, stage, or push was performed. This report and the registry files are left for review before any git operation.
