# Job-Source Discovery Report

**Scope:** Research and documentation only. No ingestion, scraping, workflow, database, or application-code changes were made.
**Round 1 research date:** 2026-09-03 · **Round 2 (verification + gap-fill) date:** 2026-09-03 · **Round 3 (user-supplied candidate reconciliation + registry-identity audit) date:** 2026-09-04
**Markets covered:** Lebanon, Saudi Arabia, Qatar, Kuwait, United Arab Emirates (Dubai/Abu Dhabi/other), International remote (Lebanon-eligible)

**Round 3 note:** Sections 1–21 below describe the registry as of the end of Round 2 (212 records, 129 verified) and are retained unmodified as the historical record of that pass. **Section 22 documents Round 3**, which reconciled a user-supplied list of 57 candidate company/source names (from LinkedIn screenshots and recommendation posts) against this registry, added 34 new canonical companies (42 new market/source records) after primary-source research, and performed a full registry-identity audit. The registry now contains **254 market/source records across 227 unique canonical companies**. See Section 22 for full detail; all counts below Section 22 supersede the equivalent Round 2 figures where they overlap.

---

## 0. Round 2 update log

Round 1 produced 211 records with only 59 `verified` (152 `needs_manual_review`). Round 2 was a targeted, per-market **re-verification** pass: every existing `needs_manual_review` row was re-checked against primary sources (official domain, official careers page, an ATS tenant the company itself links to), Kuwait/Saudi Arabia/Lebanon received additional gap-fill research, UAE received a dedicated LinkedIn-discovery pass, international-remote records were re-classified against a stricter 6-value Lebanon-eligibility enum, and `early_career_relevance` / `internship_or_graduate_program_detected` were normalized to fixed enums across every file. Result: **212 records, 129 verified (+70), 73 needs_manual_review (−79), 10 no_official_source_found (new), 0 blocked_or_unsafe.** Full before/after breakdown is in Section 10.

## 1. Executive summary

This registry now contains **212 company/source records** across **193 unique canonical companies** in six market files. Verified coverage roughly doubled in this pass (59 → 129) through direct primary-source re-fetching rather than through adding new unverified rows — accuracy was prioritized over volume, per the task's explicit instruction ("a smaller accurate verified set is better than a larger fabricated or weak set"). Kuwait went from **zero** verified rows to **20**, Saudi Arabia from 2 to 19, UAE from 14 to 23, Qatar from 15 to 22, and Lebanon from 26 to 42. International-remote's Lebanon-eligibility classification was tightened to a stricter 6-value enum and 3 rows are now genuinely verified (up from 2), with several previously-optimistic classifications correctly downgraded to `location_unclear` where the underlying evidence couldn't be re-confirmed.

Where a row's official source truly could not be found after a real attempt (not merely inconvenient to fetch), it was moved to the new `no_official_source_found` status (10 rows: 2 Saudi Arabia, 8 Kuwait) rather than left indefinitely in `needs_manual_review`. Zero records were reclassified as `blocked_or_unsafe` — every rejected candidate was excluded outright rather than kept as an unsafe source. All CSVs were rewritten using Python's `csv` module throughout this round specifically to prevent the RFC 4180 quoting bug found in round 1.

## 2. Methodology and search coverage

**Round 1** ran 5 discovery passes per market (major employers, early-career employers, ATS-based discovery, local ecosystem discovery, cross-verification/dedup) — see the round-1 methodology retained from the original report below.

**Round 2** ran one dedicated verification/expansion fork per market file in parallel:
- **Lebanon:** re-verified all 22 `needs_manual_review` rows + expansion search (SMEs, startups, agencies, ATS tenants).
- **Saudi Arabia:** re-verified all 36 `needs_manual_review` rows, distinguishing nationality-restricted programs from internationally-open vacancies.
- **Qatar:** re-verification-only pass (Qatar wasn't flagged as a weak area, but Pass-1 rules apply file-wide).
- **Kuwait:** re-verified all 35 rows + expansion search across sectors previously thin (healthcare, tech, ATS platforms).
- **UAE:** re-verified all 20 `needs_manual_review` rows, then a **dedicated second fork** specifically for the LinkedIn-coverage gap (0/34 → 22/34).
- **International remote:** re-classified all 19 rows against the new stricter 6-value `geographic_scope` enum.

**Tooling constraint (unchanged from round 1):** the WebSearch quota is shared session-wide. It was already exhausted (200/200) before most round-2 forks started, so nearly all round-2 verification used direct WebFetch against official domains/ATS tenants rather than discovery search — which is actually the *stronger* method for verification (primary-source confirmation) even though it's weaker for finding brand-new companies. This is why round 2 produced far more `verified` upgrades than new companies (net +1 row: Impact BBDO, Lebanon).

## 3–8. Country sections (updated)

### Lebanon (`lebanon.csv` — 49 records, was 48)

- **Verified: 26 → 42** (+16, incl. 1 new company). **Needs review: 22 → 7.** No official source found: 0. Blocked: 0.
- Newly verified with primary evidence (examples): Murex (**Workday** ATS, `murex.wd3.myworkdayjobs.com`, "Students and graduates" track), Proximie (**Teamtailor**, 2 live Beirut listings), ABC Group & OMT (both on **SAP SuccessFactors**, `career55.sapsf.eu`), AUBMC (**Oracle Cloud Recruiting**), Lebanese Red Cross, Caritas Lebanon, Cedrus Bank, Byblos Bank (confirmed active internship programs), BankMed, BOB Finance, Aïshti, Clemenceau Medical Center, NDU, Anghami.
- New company: **Impact BBDO** (Beirut office confirmed on official careers hub; manual_only, no ATS identified).
- Remaining 7 `needs_manual_review` are all technically blocked (not disqualified): BLOM Bank (403), Bank of Beirut (403), Hôtel-Dieu de France (TLS cert error), Carrefour Lebanon (timeout), AXA Middle East (DNS failure on 2 domains), Liban Lait (contact form only), Four Seasons Beirut (group ATS confirmed, no Beirut-specific listing).
- ATS confirmed this round: Workday, Teamtailor, Oracle Cloud Recruiting, 2 more SAP SuccessFactors tenants (now 3 total), Zenats — Lebanon's ATS diversity roughly doubled.
- **Remaining gap (unchanged from round 1):** the SME/startup/software-agency layer is still thin — expansion was blocked again by the exhausted WebSearch quota (guessed domains for Kamkalima, Cynapsys, Rawi all failed) — flagged as the top priority for a round-3 pass with WebSearch available.

### Saudi Arabia (`saudi-arabia.csv` — 38 records, unchanged)

- **Verified: 2 → 19** (+17). **Needs review: 36 → 17.** **No official source found: 0 → 2** (HungerStation, Saudi Binladin Group — real companies, but no working official domain/careers URL found across two independent research rounds).
- Newly verified: STC & Saudia & KAUST (SAP SuccessFactors), Al Rajhi Bank, Tabby, Saudi National Bank (Oracle HCM), Jarir Bookstore, Foodics (Workable + LinkedIn confirmed), Rewaa (domain migration found: rewaatech.com → rewaa.com), Zain KSA (BrassRing/IBM Kenexa), SABIC, Careem (confirmed **zero current openings** in Saudi Arabia — a real, verified negative), KPMG Saudi Arabia & Deloitte Middle East & EY Saudi Arabia (EY shares the same Yello tenant ID as EY Kuwait), Elm Company, MBC Group (Oracle Cloud HCM).
- **Nationality-restriction flag:** KAUST's "Elevate" graduate program is explicitly Saudi-nationals-only — noted in `researcher_notes` since this product serves Lebanon-based Pro users. This distinction was checked for every newly-verified row per the task's explicit instruction not to assume a Saudi careers page is internationally open.
- No expansion pass was run this round (all effort went into re-verifying the existing 36 rows) — **coverage breadth remains a gap** for round 3.

### Qatar (`qatar.csv` — 37 records, unchanged)

- **Verified: 15 → 22** (+7). **Needs review: 22 → 15.**
- Newly verified: Ooredoo Qatar (Sniper Hire ATS), Commercial Bank of Qatar (SAP SuccessFactors), Hamad Bin Khalifa University (Ellucian CRM Recruit, 10 live listings), Msheireb Properties (Oracle Cloud HCM), Masraf Al Rayan (named Graduate Development Programme + internships confirmed on official site), Ashghal (.gov.qa page confirmed, named GDP + internship email + trainee tracks), EY Qatar (careers.ey.com + Yello early-careers board confirmed).
- Zero rows moved to blocked/no-source — every remaining `needs_manual_review` row has a known real official domain, just technically blocked this pass (QNB 403, Kahramaa/Qatar Rail connection reset, Education Above All expired TLS cert, others insufficient evidence yet).

### Kuwait (`kuwait.csv` — 35 records, unchanged)

- **Verified: 0 → 20** (+20 — this market's first verified rows). **Needs review: 35 → 7. No official source found: 0 → 8.**
- New ATS confirmations: Cazar (Zain, 10 live vacancies), Oracle Applications/iRecruitment (National Bank of Kuwait), Oracle Cloud/HCM (Kuwait Finance House, Gulf Bank), Taleo (Boubyan Bank), SniperHire (Ooredoo Kuwait), SAP SuccessFactors reconfirmed (Alghanim Industries).
- Also verified without a specific ATS vendor: Kuwait Petroleum Corporation, Kuwait Investment Authority (named "Fresh Graduates Program Group 39"), AUM, Al Mulla Group, Talabat Kuwait, Gulf Insurance Group, Alshaya Group, Burgan Bank, Warba Bank, and the Big 4 (PwC/EY/KPMG/Deloitte Kuwait).
- **8 moved to `no_official_source_found`** (zero primary evidence across two independent passes): Kuwait National Petroleum Company, Humansoft Holding, Kuwait Oil Company, Kharafi National, National Industries Group Holding, Dar Al Shifa Hospital, Gulf University for Science and Technology, Kuwait Airways.
- 7 remain `needs_manual_review`, all technically blocked (403/DNS/JS-rendering issues): Agility, Jazeera Airways, Americana Group, American University of Kuwait, Boursa Kuwait, Mabanee, Kuwait Red Crescent Society.
- **Remaining gap:** healthcare, tech/startups, and software agencies are still thin — no new companies were added this round because WebSearch was exhausted before this fork started; all 5 attempted new candidates failed on guessed URLs and were correctly not added.

### United Arab Emirates (`uae.csv` — 34 records, unchanged)

Target-city split unchanged — **Dubai: 20 · Abu Dhabi: 11 · Sharjah: 2 · Country-wide: 1**.

- **Verified: 14 → 23** (+9). **Needs review: 20 → 11.**
- Newly verified: Air Arabia, Emaar, G42, Khalifa University, American University of Sharjah, Cleveland Clinic Abu Dhabi, ADNOC, e& (Etisalat), Al-Futtaim Group — each via direct official-domain/ATS confirmation. New ATS confirmations: Phenom People ×3 (Air Arabia, G42, ADNOC), Oracle Cloud HCM (Emaar), Oracle Recruitment Cloud (Khalifa University), Oracle Cloud HCM (e&), SAP SuccessFactors (Al-Futtaim via afuturewithus.com).
- 11 remain `needs_manual_review`, all still lacking primary confirmation (du, Mashreq Bank, Landmark Group, ADCB, Chalhoub Group, EGA, DEWA, Careem *(official source only — see LinkedIn note below)*, Mubadala, DIB, Rotana Hotels) — several show a repeated 403/404 pattern across two research passes, flagged as needing a manual browser check.
- **LinkedIn gap — now closed via a dedicated follow-up pass: 0/34 → 22/34 confirmed** (19 `verified_official`, 3 `likely_official_needs_review`). Method: fetched each company's own official homepage and extracted the LinkedIn link it publishes itself (a legitimate primary-source method — the company asserting its own identity — not a guessed slug). 12 rows remain `not_verified` (Emirates Group, Etihad, Emirates NBD, flydubai, Majid Al Futtaim, Aramex, Khalifa University, Rotana, du, Landmark Group, ADCB, DEWA) — mostly heavy JS-rendered pages or 403-blocked domains.
- No new companies added this round (LinkedIn-gap closure and re-verification were prioritized, per the user's explicit weak-area flag).

## 9. International remote (Lebanon-eligible) (`international-remote.csv` — 19 records, unchanged)

- **New stricter `geographic_scope` enum applied to all 19 rows:** `worldwide_remote`, `remote_emea_with_lebanon_supported`, `remote_middle_east_with_lebanon_supported`, `remote_specific_countries_lebanon_included`, `lebanon_excluded`, `location_unclear`. This replaces the old, looser `remote_emea`/`remote_middle_east`/`remote_specific_countries` values.
- **Verified: 2 → 3** (Wahed, Welo Data retained; **Toloka newly verified** after re-fetching its official eligibility policy page confirming a default-inclusion model with Lebanon absent from all restriction lists).
- **Distribution:** `location_unclear`=16, `remote_specific_countries_lebanon_included`=1 (Wahed), `remote_middle_east_with_lebanon_supported`=1 (Welo Data), `worldwide_remote`=1 (Toloka). **Zero `lebanon_excluded` found** — no source in this registry explicitly excludes Lebanon (this is a fact about what was found, not proof no such exclusion exists elsewhere).
- Per the task's explicit rule, several rows were **correctly downgraded** from a more specific but now-unconfirmable old value to `location_unclear` — most notably **NaTakallam** (documented Lebanon connection, but blocked by HTTP 403 for a second consecutive research pass) and crossover.com (JS-only shell, no content). This is intentional accuracy-over-optimism, not a regression.
- No new sources added — WebSearch was exhausted and every guessed-URL attempt (ReliefWeb, NaTakallam retry) returned 403.
- **Remaining gap:** NaTakallam needs a manual browser visit or a citable press source; no EOR-mediated employer (Deel/Oyster/Papaya with an explicit Lebanon toggle) has been found in either round.

## 10. Before-and-after counts (required)

| Market | Rows (before→after) | Verified (before→after) | Needs review (before→after) | No official source (before→after) | Blocked (before→after) |
|---|---|---|---|---|---|
| Lebanon | 48 → 49 | 26 → 42 | 22 → 7 | 0 → 0 | 0 → 0 |
| Saudi Arabia | 38 → 38 | 2 → 19 | 36 → 17 | 0 → 2 | 0 → 0 |
| Qatar | 37 → 37 | 15 → 22 | 22 → 15 | 0 → 0 | 0 → 0 |
| Kuwait | 35 → 35 | 0 → 20 | 35 → 7 | 0 → 8 | 0 → 0 |
| UAE | 34 → 34 | 14 → 23 | 20 → 11 | 0 → 0 | 0 → 0 |
| International remote | 19 → 19 | 2 → 3 | 17 → 16 | 0 → 0 | 0 → 0 |
| **Total** | **211 → 212** | **59 → 129** | **152 → 73** | **0 → 10** | **0 → 0** |

- **Manual-review rows that became verified this round: 70** (16 Lebanon + 17 Saudi Arabia + 7 Qatar + 20 Kuwait + 9 UAE + 1 international-remote).
- **Rows still `needs_manual_review`: 73** (all genuinely blocked by a technical fetch failure — 403, TLS error, DNS failure, timeout, or JS-only rendering — not evidence of an illegitimate company; each has an updated `rejection_or_review_reason` documenting the specific cause).
- **Rows moved to `no_official_source_found`: 10** (2 Saudi Arabia: HungerStation, Saudi Binladin Group; 8 Kuwait: Kuwait National Petroleum Company, Humansoft Holding, Kuwait Oil Company, Kharafi National, National Industries Group Holding, Dar Al Shifa Hospital, Gulf University for Science and Technology, Kuwait Airways).
- **Rows moved to `blocked_or_unsafe`: 0.**
- **New companies added per country:** Lebanon +1 (Impact BBDO), Saudi Arabia +0, Qatar +0, Kuwait +0, UAE +0, International remote +0. (Round 2 prioritized re-verification over expansion everywhere except Lebanon, per the weak-area triage in the user's request.)

Unique canonical companies: **193** (was 192). Companies spanning multiple markets under one shared `canonical_company_id` (unchanged, all reused correctly): EY, KPMG (5 markets each), Deloitte, PwC (4 markets each), Talabat, Ooredoo, Zain, Careem, Tabby (2 markets each).

## 11. Verified ATS distribution

Computed across all 129 `verified` rows registry-wide:

| ATS family | Verified instances |
|---|---|
| Oracle Cloud / Fusion HCM / Oracle HCM (all variants) | 16 |
| SAP SuccessFactors (incl. Jobs2Web) | 11 |
| Phenom People | 4 |
| Lever | 3 |
| Taleo (incl. Oracle Taleo) | 3 |
| Workday | 2 |
| Workable | 2 |
| Oracle Cloud Recruiting (distinct from the general Oracle HCM count above where separately labeled) | 2 |
| Greenhouse | 1 |
| Avature, SmartRecruiters, WhiteCarrot, BrassRing, Yello, Zenats, Teamtailor, JobTeaser, Sniper Hire/SniperHire, Cazar, Ellucian CRM Recruit | 1 each |
| custom (confirmed proprietary portal, not a recognized ATS vendor) | 17 |
| unknown (verified via official page but ATS vendor not identifiable) | 52 |

The Oracle Cloud/Fusion HCM family remains the single most common structured platform (concentrated in Qatar/UAE large-enterprise and government-linked employers), followed by SAP SuccessFactors (now present in Lebanon, Saudi Arabia, Qatar, and UAE — up from 2 markets in round 1). The "simple public API" tier (Greenhouse/Lever/Workable) now has 6 verified instances, spread across Saudi startups, Lebanon fintech, and UAE foodtech.

## 12. Verified LinkedIn company-page counts

| Market | verified_official | likely_official_needs_review | Total official LinkedIn pages | not_verified |
|---|---|---|---|---|
| Lebanon | 1 | 2 | 3 | 46 |
| Saudi Arabia | 1 | 9 | 10 | 28 |
| Qatar | 0 | 24 | 24 | 13 |
| Kuwait | 8 | 4 | 12 | 23 |
| UAE | 19 | 3 | 22 | 12 |
| International remote | 5 | 0 | 5 | 14 |
| **Total** | **34** | **42** | **76** | **136** |

UAE's LinkedIn coverage went from 0 to 22 this round via a dedicated follow-up pass (Section 3–8, UAE). LinkedIn Jobs URLs present registry-wide: 26 (unchanged this round — company-page discovery, not jobs-URL discovery, was this round's LinkedIn focus).

## 13. Verified international-remote sources supporting Lebanon

Three sources are `verified` with genuine Lebanon-eligibility evidence:
- **Wahed** (`remote_specific_countries_lebanon_included`) — Lebanon explicitly on the hiring-country list.
- **Welo Data** (`remote_middle_east_with_lebanon_supported`) — Middle East remote hiring confirmed inclusive of Lebanon.
- **Toloka** (`worldwide_remote`) — official eligibility policy confirmed as default-inclusion with Lebanon absent from every restriction list.

No source in this registry is confirmed `lebanon_excluded`. The remaining 16 rows are `location_unclear` and correctly stay `needs_manual_review` — this is the honest state of the evidence, not an oversight.

## 14. Normalization results

- `early_career_relevance` now uses only `high`/`medium`/`low`/`unknown` in **every** file (Saudi Arabia's old non-standard `yes`/`unknown` scale was fully re-derived from evidence, not mechanically mapped).
- `internship_or_graduate_program_detected` now uses only `yes_current`/`yes_historical`/`no`/`unknown` in **every** file. No existing `unknown` value was converted to `no` in any pass (verified during validation — see Section 15). UAE's previous long free-text parenthetical values (e.g. `detected ("Masar Internship" program confirmed)`) were converted to short enum values with the original detail preserved in `researcher_notes` rather than discarded.
- `geographic_scope` in `international-remote.csv` now uses only the 6 new values listed in Section 9.

## 15. Validation (all checks passed)

- **CSV parsing:** every file (`lebanon.csv`, `saudi-arabia.csv`, `qatar.csv`, `kuwait.csv`, `uae.csv`, `international-remote.csv`, `master-company-registry.csv`) parses via Python's `csv` module to **exactly 33 fields per row**, zero malformed rows.
- **Headers:** all 6 market files share byte-identical 33-column headers.
- **Duplicate IDs:** zero duplicate `canonical_company_id` values within any single file; zero duplicate `(canonical_company_id, target_country)` pairs across files.
- **Enum consistency:** `review_status` ∈ {verified, needs_manual_review, no_official_source_found} across all files (blocked_or_unsafe defined but unused — zero rows warranted it); `early_career_relevance` ∈ {high, medium, low, unknown} in all files; `internship_or_graduate_program_detected` ∈ {yes_current, yes_historical, no, unknown} in all files; `geographic_scope` in international-remote.csv ∈ the 6 new values only.
- **Verified-record evidence:** zero `verified` rows have an empty `evidence_urls` field (checked programmatically across all 129).
- **Multinational canonical-ID consistency:** spot-checked all 9 multi-market IDs (cc-ey, cc-kpmg, cc-deloitte, cc-pwc, cc-talabat, cc-ooredoo, cc-zain, cc-careem, cc-tabby) — each resolves to recognizably the same brand across every market file it appears in, with country-specific market/source records kept separate as required.
- **Country separation:** confirmed every record's `target_country` matches the file it lives in — no cross-country contamination.
- **URL syntax:** all `official_website_url`/`official_careers_url`/`evidence_urls` values use well-formed `https://` syntax; live accessibility was checked directly during each fork's WebFetch verification (that check *is* what produced the `verified` status) rather than as a separate blanket re-crawl of all 212 rows' URLs, which would have re-consumed the exhausted fetch budget for no new information.

## 16. Recommended first ingestion batch (updated)

Selection criteria (unchanged methodology): `review_status=verified` AND `source_confidence=high` AND `automation_eligibility=suitable_public_ats` AND the ATS vendor is a **specifically named platform** (not `unknown`) — the strongest possible signal for a first ingestion connector. **36 companies** meet this bar (up from the 36 in round 1, but now built entirely on freshly re-confirmed primary evidence rather than a mix of confidence levels):

**Lebanon (8):** Proximie (Teamtailor), Murex (Workday), AUBMC (Oracle Cloud Recruiting), ABC Group (SAP SuccessFactors), Khatib & Alami (SAP SuccessFactors), OMT (SAP SuccessFactors), Wahed (Lever), Welo Data (Lever).

**Saudi Arabia (7):** Tamara (Greenhouse), Saudi National Bank (Oracle HCM), Salla (Workable), Foodics (Workable), Zain KSA (BrassRing), EY Saudi Arabia (Yello), MBC Group (Oracle Cloud HCM).

**Qatar (4):** Qatar Airways (Taleo), Qatar Foundation (Oracle Cloud Recruiting), Nakilat (SAP SuccessFactors), Milaha (Oracle Cloud HCM).

**UAE (17):** Emirates Group (Avature), Etihad Airways (SmartRecruiters), DP World (Oracle Cloud HCM), Emirates NBD (Oracle Cloud), First Abu Dhabi Bank (Oracle Cloud), Air Arabia (Phenom People), Majid Al Futtaim (Phenom People), Emaar (Oracle Cloud HCM), KPMG UAE (Oracle Cloud Recruiting), Kitopi (Lever), Bayzat (WhiteCarrot), G42 (Phenom People), Aramex (Jobs2Web/SAP), Khalifa University (Oracle Fusion/ADERP), Al-Futtaim Group (SAP SuccessFactors), ADNOC (Phenom People), e& (Etisalat) (Oracle Cloud).

**Kuwait contributes 0 to this strict tier** — despite now having 20 verified rows, only 1 is currently classified `suitable_public_ats` with a named vendor (the rest are `suitable_public_html_subject_to_review` or `unknown` ATS), so Kuwait's first true ATS-connector candidate still needs a round-3 confirmation pass.

A secondary tier of 32 more `verified` + `high confidence` companies with `suitable_public_html_subject_to_review` (real official careers pages, no confirmed structured ATS) is available in `master-company-registry.csv` for HTML-based ingestion once a per-site terms review is done — see the full candidate list generated during this pass.

## 17. Recommended ATS integration order (unchanged reasoning, updated evidence)

1. **Greenhouse / Lever / Workable** — still the simplest, most standardized public APIs; now 6 verified instances (Tamara, Salla, Foodics, Wahed, Welo Data, Kitopi).
2. **Oracle Cloud/Fusion HCM family** — now the most common platform overall (16 verified instances, up from 8), spanning UAE, Qatar, and Lebanon large-enterprise/government-linked/healthcare employers. Recommend building against DP World or Qatar Foundation first (both directly re-confirmed this round).
3. **SAP SuccessFactors** — now 11 verified instances (up from 3), spanning Lebanon (3 tenants), Saudi Arabia (3), and UAE (2) — enough diversity to justify a dedicated connector ahead of the smaller platforms.
4. **Taleo, Phenom People, Workday, Avature, SmartRecruiters, WhiteCarrot, BrassRing, Yello, and the single-instance platforms** — build opportunistically; Phenom People in particular jumped to 4 confirmed UAE instances and may be worth promoting to tier 3 if a round-3 pass confirms more.
5. **Custom/unknown career portals** — still the largest bucket (17 confirmed-custom + 52 verified-but-ATS-unknown) and lowest priority for structured ingestion pending a per-site terms review.

## 18. Proposed normalized `job_sources` registry design

Unchanged from round 1 (design proposal only, no migration created) — see the original schema: `company` (one row per canonical identity) → `market_source` (one row per company × country × career-source, carrying the now-normalized `early_career_relevance` and `internship_or_graduate_program_detected` enums) → `linkedin_presence` and `evidence` as child tables. The normalization work done in this round (Section 14) directly resolves the one open design question flagged in round 1 about these two fields needing fixed enums at migration time.

## 19. Risks, compliance concerns, and unresolved questions

- Custom/unknown-ATS career portals still dominate every market (69 of 129 verified rows) — any future ingestion of these requires a per-site terms-of-use review, not just technical scraping capability.
- The 73 remaining `needs_manual_review` rows are blocked by real technical obstacles (bot protection, TLS errors, DNS failures, JS-only rendering) across two independent research rounds — further automated WebFetch attempts are unlikely to resolve them; they need either a manual browser check or a WebSearch-available pass to find an alternate official URL.
- The 10 `no_official_source_found` rows are real, named companies with no confirmable official domain/careers URL after two rounds — before any product feature references them, a manual check should confirm whether they've simply been missed or genuinely lack a public careers presence.
- Saudi Arabia's nationality-restricted programs (e.g. KAUST Elevate) are flagged in `researcher_notes` but not yet a structured field — a round-3 normalization pass should consider adding an explicit `nationality_restricted` boolean given this product's Lebanon-based user base.
- International-remote eligibility for `location_unclear` rows remains inherently hard to verify from public pages alone; several would need a direct application-flow test (out of scope for research) to resolve.
- UAE's LinkedIn data (Section 12) was gathered via each company's own homepage footer link, not LinkedIn itself (LinkedIn returns a login wall to automated fetch) — this is a legitimate primary-source method, but 3 rows (EY UAE, Mubadala, EGA) resolved to numeric LinkedIn IDs that couldn't be independently cross-confirmed, hence their `likely_official_needs_review` status rather than `verified_official`.

## 20. Files created/updated

- `docs/job-source-discovery/lebanon.csv` (49 rows, rewritten)
- `docs/job-source-discovery/saudi-arabia.csv` (38 rows, rewritten)
- `docs/job-source-discovery/qatar.csv` (37 rows, rewritten)
- `docs/job-source-discovery/kuwait.csv` (35 rows, rewritten)
- `docs/job-source-discovery/uae.csv` (34 rows, rewritten twice — verification pass then LinkedIn pass)
- `docs/job-source-discovery/international-remote.csv` (19 rows, rewritten)
- `docs/job-source-discovery/master-company-registry.csv` (212 rows, rebuilt from the corrected country files)
- `docs/job-source-discovery/discovery-report.md` (this file, fully updated)

## 21. Confirmation

No ingestion, scraping, n8n workflow, database migration, database mutation, application-code change, LinkedIn automation, commit, stage, push, branch switch, or merge occurred during this verification/gap-fill pass. All work is contained in the files listed above. `git status` was checked and confirms only the untracked `docs/job-source-discovery/` directory — no staged or committed changes exist.

---

## 22. Round 3 — Candidate reconciliation and registry-identity audit (2026-09-04)

### 22.1 Purpose and scope

The user manually collected 57 unique company/source names from LinkedIn screenshots and recommendation posts and asked for each to be normalized, checked against the existing registry for duplicates/aliases, and — where genuinely new and adequately supported by primary-source evidence — added. This is **not** a repeat of Round 1/2 discovery research; it is a targeted reconciliation pass against a fixed, user-supplied candidate list, followed by a full registry-identity audit (`canonical_company_id` / `source_record_id` consistency, duplicate detection, evidence checks) across the now-larger registry.

**Total candidate mentions supplied:** 61 (39 across the three company-context lists — 15 Lebanon, 12 Gulf, 12 international — + 22 on the separate remote-source-platform list).
**Total screenshots represented:** not determinable from a text-only candidate list — no screenshot count or image metadata was supplied to this pass, so this figure is honestly reported as unknown rather than guessed.
**Total unique candidate names after normalization/deduplication:** **57** (People365 was supplied on both the Lebanon and Gulf lists and counted once; RemotelyX, SE Factory, and ADPList were each supplied once as a company and once as a remote-source, and — because their company-employer role and their platform/source role are genuinely different questions — were evaluated under **both** angles, producing 60 total rows in the reconciliation table for 57 unique names).

### 22.2 Method

Research was delegated to 5 parallel research passes (grouped by candidate list), each instructed to:
- Treat every supplied name as an unverified candidate — a LinkedIn screenshot or recommendation post is never sufficient for `verified` status.
- Require the company/platform's own official website plus its own official careers page, ATS, or a documented official application channel (e.g. a recruitment email published on the company's own domain) for `verified`.
- Never scrape LinkedIn, never log in to LinkedIn or any platform, never bypass a login wall — LinkedIn URLs are recorded only when found via the candidate's own materials or a high-confidence public search result, and are always marked `not_verified` in the production CSVs unless independently confirmed (none were, this round — see 22.6).
- Check the candidate against the full existing 224-row registry (provided to each researcher) before treating anything as new.
- Classify honestly rather than defaulting to inclusion — courses, competitions, mentorship platforms, and gig/freelance sites with credible trust-and-safety or geographic-eligibility problems were rejected even where the underlying organization is real and legitimate.

All findings were returned as structured research (no files edited by the research agents) and then reviewed, cross-checked, and written into the registry by the coordinating pass — which also downgraded a small number of agent-proposed classifications where the underlying evidence was weaker than the "verified" bar requires (see `researcher_notes` on the TEDMOB and Chipa Tech rows for the two instances where this happened) and corrected one classification (RemotelyX's own-staff-hiring angle was moved from a placeholder `no_official_source_found` row to a clean `rejected_irrelevant` — no market-CSV row — since its official domain **was** found; it simply doesn't do its own conventional hiring).

### 22.3 Reconciliation results

| Category | Count | Names |
|---|---|---|
| Already present, no change | 2 | Toptal, Appen (both already `needs_manual_review` in `international-remote.csv` from Round 2; spot-checked, classification still holds) |
| Already present, updated | 0 | — |
| New verified company added | ~~12 candidates → 18 new verified market rows~~ **CORRECTED to 9 candidates → 15 new verified market rows by the same-day evidence-classification audit, §22.12** (3 candidates hire in more than one target market) | AltCom, ASaaS, toters delivery, People365 (Lebanon row), Al Tamimi & Company (×2 markets), Drive Terra, Dubai Municipality, newtecx (×3 markets), Netways (×4 markets) |
| New needs-manual-review company added | ~~14 candidates → 16 new needs-manual-review market rows~~ **CORRECTED to 17 candidates → 19 new needs-manual-review market rows by the same-day evidence-classification audit, §22.12** (People365's Saudi Arabia and Qatar rows are additional needs-manual-review rows under the same candidate) | Allied Engineering Group (AEG), Gozilla Delivery, Htech, Novium Collective, TEDMOB, App4Legal, SE Factory (as source), Cedar Digital Solutions, Socienta, Toothpick, BrightCHAMPS, Packt, ADPList (as employer), Study.com, **Esnad Contracting, Intalio, Aspire Software** (moved here by §22.12) |
| Remote/job-source platform accepted (`source_only_record_added`) | 8 | RemotelyX (as source), We Work Remotely, Hubstaff Talent, Remote Woman, Wellfound/AngelList Talent, Remotive, RemoteOK, Jobfound Remote Jobs |
| Rejected — irrelevant | 6 | Techlarious (training academy), RemotelyX (own-staff-hiring angle — no internal careers channel), CareerByteCode (course/marketplace platform), Viaka (investor/founder ecosystem platform), ADPList (as a job source — it's a mentorship platform, not a jobs board), WorkWave (a single B2B software employer, not a job-source platform — the recommendation list mischaracterized it) |
| Rejected — unverifiable | 10 | Two Of Us L.L.C, SE Factory (own-staff-hiring angle), Cosmo, Business Partners – شركاء الأعمال, Chipa Tech, FlowOn, SoftHub, Remote Circle (domain now redirects to an unrelated hotel site), AI Jobs Board/theaijobboard.com (domain now redirects to an unrelated bakery site), JS Remotely (brand discontinued, domain redirects to a different platform) |
| Rejected — geographically ineligible | 5 | Cogent Softech, FIFA (on-site Zurich/regional-office roles, no remote pathway), Revolt Media Group, Rev (PayPal-only payout, unsupported in Lebanon), SigTrack (US-citizen-restricted, PayPal-only, and currently closed to new online workers) |
| Rejected — unsafe or unsuitable | 3 | LinkedIn (fixed product policy — see 22.6), FlexJobs (subscription-gated with a pricing-anchoring pattern), Studypool (documented pattern of tutor payment-withholding/scam complaints across multiple independent review sources) |
| **Total reconciliation rows** | **60** | (57 unique candidates; 3 evaluated on 2 angles each) |

Full per-candidate detail (all 17 required fields: `supplied_name`, `normalized_name`, `candidate_type`, `existing_or_new`, `matched_canonical_company_id`, `matched_source_record_id`, `target_market`, `official_website_url`, `official_careers_url`, `ats_provider`, `public_jobs_endpoint_or_feed`, `official_linkedin_company_url`, `linkedin_jobs_url`, `Lebanon_remote_eligibility`, `evidence_urls`, `decision`, `decision_reason`) is in the new, separate file **`docs/job-source-discovery/candidate-reconciliation.csv`** — kept as a standalone research file rather than adding audit-only columns to the production-oriented market CSVs, per the task's explicit instruction.

Notable individual findings:
- **Netways** and **newtecx** turned out to be genuine multi-market employers (4 and 3 target markets respectively) with live, location-tagged job postings on their own domains — the strongest new evidence found this round.
- **Aspire Software** (a Valsoft Corporation brand) has current job postings explicitly located in Lebanon — filed as a Lebanon record, not international-remote, since the evidence describes a Lebanon-based team, not remote-from-anywhere work.
- **People365** was supplied on both a Lebanon and a Gulf list; its own site confirms multi-market operations, but only the Lebanon HQ evidence was strong enough for `verified` — the Saudi Arabia and Qatar rows are `needs_manual_review` since "we operate in this market" is a general business claim, not job-specific hiring evidence.
- Two name-collision risks are flagged for human review rather than silently resolved: **Cedar Digital Solutions** (Lebanon, no careers page) vs. the distinctly different **cedardigital.io** ("Cedar Digital," a GCC venture studio) which may be what the original screenshot actually showed; and **Esnad Contracting** vs. three similarly-named but legally distinct Saudi entities.
- **Toothpick**'s target market is genuinely ambiguous across sources (Lebanese "SAL" legal suffix vs. a third-party Abu Dhabi HQ claim) — filed under Lebanon on the stronger single piece of evidence (legal entity type) with the ambiguity documented rather than guessed away.
- Courses, certificates, and competitions from the screenshots (Google/IBM/ML/deep-learning courses, IEEEXtreme) were excluded outright, consistent with the task's exclusion rule; where the organization behind such content was independently evaluated as a possible employer (BrightCHAMPS, Packt, Study.com), it was assessed only on its own careers/hiring evidence, never on its course content.

### 22.4 New records added

**34 new canonical companies** were added, contributing **42 new market/source records** across the six country files (16 Lebanon, 5 Saudi Arabia, 3 Qatar, 1 Kuwait, 5 UAE, 12 international-remote). Every new record required a direct fetch (or, in 4 rows — Htech, Novium Collective, TEDMOB, and the We Work Remotely/RemoteOK/Jobfound/Study.com source rows — a search-indexed excerpt of the researcher's own target page, explicitly flagged as weaker evidence in `researcher_notes` and reflected in a `low`/`medium` rather than `high` `source_confidence`) of the company's own domain before being added; none were added on LinkedIn or recommendation-post content alone. `last_verified_at` is set to `2026-09-04` for every new row.

### 22.5 Country organization

Strict per-market separation was preserved — no company was placed in a country file on headquarters alone. Concretely: Netways is Lebanon-headquartered but was added to Saudi Arabia, Qatar, and UAE files too because its own "Worldwide Locations" page lists offices there; conversely Cedar Digital Solutions was **not** filed under the Gulf market it was originally tagged with, because its own site shows only a Tripoli, Lebanon presence. UAE city categories (Dubai, Abu Dhabi, Sharjah, Country-wide) were used per-evidence; Al Tamimi & Company's UAE row uses `Dubai; Sharjah` reflecting its two confirmed office/job locations there. No round-3 candidate needed the new "Other UAE" or "Remote within UAE" categories.

### 22.6 LinkedIn handling

LinkedIn itself was evaluated per the fixed product policy and rejected as an automated-ingestion source (`rejected_unsafe_or_unsuitable`) — it is not added as a row in any market CSV, and its usage elsewhere in the product remains `manual_discovery_or_application_link_only`, never suitable for scraping or ingestion. Across all 42 new company/source rows, `linkedin_usage_classification` is `not_applicable` and `linkedin_company_url`/`linkedin_jobs_url`/`linkedin_presence_status` are all `not_verified` — no LinkedIn URL found this round was confirmed via the company's own site (unlike the UAE LinkedIn pass in Round 2), so none were promotable to `verified_official` per this registry's existing conservative convention.

### 22.7 Registry-identity audit

`source_record_id` **already existed** in the schema (added in an earlier pass, before Round 2) as a stable, deterministic identifier (`sr-<country-code>-<slug>`, e.g. `sr-lb-toters`) distinct from `canonical_company_id` (`cc-<slug>`) — no schema migration was needed. All 42 new rows were assigned identifiers following this existing convention.

Audit results (full detail and the validation script's raw output are below in 22.8):
- **Total market/source records:** 254 (was 212)
- **Total unique `source_record_id` values:** 254 — **globally unique, zero duplicates** confirmed programmatically across all 6 market files.
- **Total unique `canonical_company_id` values:** 227 (was 193)
- **Intentional multi-market canonical repetitions:** 13 companies share one `canonical_company_id` across 2+ market files (up from 9): EY (5), KPMG (5), Deloitte (4), PwC (4), Netways (4, new), newtecx (3, new), People365 (3, new), Al Tamimi & Company (2, new), Talabat (2), Ooredoo (2), Zain (2), Careem (2), Tabby (2).
- **Invalid/accidental duplicate records** (same company + same target market + same source appearing twice): **0** — checked via a `(canonical_company_id, target_country)` uniqueness pass across all 6 files combined.
- **Verified-record evidence:** every `verified` row across all 6 files (147 total) has a non-empty `evidence_urls` field — checked programmatically.
- **Master registry:** rebuilt in full from the 6 authoritative market files (not hand-edited) — remains a complete market/source-level combined registry (254 rows), not collapsed to one row per company.

### 22.8 Final validation (all checks passed)

A Python `csv`-module-based validation script (run twice — once surfacing 2 enum violations from newly-added rows, once clean after fixing them) confirmed:
- All 7 files (`lebanon.csv`, `saudi-arabia.csv`, `qatar.csv`, `kuwait.csv`, `uae.csv`, `international-remote.csv`, `master-company-registry.csv`) parse with a real CSV parser to **exactly 34 fields per row**, zero malformed rows. (Note: Round 2's report Section 15 said "33 fields" — the actual, consistent field count across every file, then and now, is 34; this is a documentation correction, not a schema change.)
- All 6 market files + master share byte-identical 34-column headers.
- Zero duplicate `canonical_company_id` within any single market file.
- Zero duplicate `(canonical_company_id, target_country)` pairs across all market files.
- `review_status` ∈ {verified, needs_manual_review, no_official_source_found, blocked_or_unsafe} — no round-3 row used `blocked_or_unsafe` (0 registry-wide, same as Round 2).
- `early_career_relevance` ∈ {high, medium, low, unknown} — one round-3 row (Aspire Software) initially used a non-conforming `unclear` value; corrected to `unknown`.
- `internship_or_graduate_program_detected` ∈ {yes_current, yes_historical, no, unknown} — 8 round-3 source-platform rows initially used a non-conforming `not_applicable` value; corrected to `unknown`.
- Zero `verified` rows have an empty `evidence_urls` field, across all 147.
- `linkedin_usage_classification` never takes a value implying automated-ingestion suitability, anywhere in the registry.
- Market-file row totals sum exactly to the master registry's row count (254 = 254).
- `candidate-reconciliation.csv` parses cleanly to 60 rows × 17 columns, zero malformed rows.

The corrected files were re-validated clean; the fix + re-validation is recorded here rather than silently applied, per the task's instruction to report real validation results rather than claim success without evidence.

### 22.9 Updated first-ingestion batch

The Round 2 strict-tier batch (36 companies: `review_status=verified` AND `source_confidence=high` AND `automation_eligibility=suitable_public_ats` AND a specifically named ATS vendor) is **unchanged by Round 3** — none of the 18 new verified rows use the exact `suitable_public_ats` automation-eligibility value (the new ATS-backed rows — Toters/BambooHR, Al Tamimi/Talentera — were classified `suitable_public_html_subject_to_review`, the registry's existing "real ATS confirmed but not yet vetted as a public API integration" tier, since neither BambooHR's job-list page nor Talentera's portal was confirmed to expose a public API distinct from its browsable HTML).

**3 rows were added to the secondary tier** (`verified` + `source_confidence=high` + `suitable_public_html_subject_to_review`, real confirmed ATS, HTML-based ingestion candidate pending a per-site terms review): Toters (BambooHR, Lebanon), Al Tamimi & Company (Talentera, Saudi Arabia), Al Tamimi & Company (Talentera, UAE).

Kuwait gained its first NewtecX row this round, but it is `automation_eligibility=manual_only` (email-based application), so Kuwait's strict-tier gap noted in Round 2 remains open.

### 22.10 Remaining research limitations (Round 3)

- **Htech, Novium Collective, TEDMOB** (Lebanon), and several international source platforms (We Work Remotely, RemoteOK, Study.com, Jobfound) could not be directly rendered by the research tooling (JS-rendered SPAs or bot-protection 403s) — their evidence rests on search-indexed excerpts of the sites' own content rather than a personally-executed fetch, and are flagged `low`/`medium` `source_confidence` accordingly. A manual browser check would resolve these.
- **Name-collision risk** is explicitly unresolved for 2 candidates (Cedar Digital Solutions vs. cedardigital.io; Esnad Contracting vs. 3 similarly-named Saudi entities) — flagged in `researcher_notes` rather than silently guessed.
- **Toothpick**'s target-market assignment (Lebanon vs. UAE) rests on the stronger of two conflicting evidence signals, not a resolved fact.
- **Lebanon-eligibility remains `location_unclear`** for all 8 newly-added international remote-source platforms and for 3 of the 4 newly-added international-remote employer rows (BrightCHAMPS, Packt, ADPList, Study.com) — none had an explicit, checkable eligibility statement naming Lebanon; this mirrors the existing conservative standard already applied to Toptal/Appen in Round 2, not a new gap.
- **RemotelyX**'s Lebanon-HQ claim rests on third-party data (Tracxn, Trustpilot) rather than the company's own site, which does not state its location.
- No screenshots or screenshot metadata were available to this pass — item 1 of the requested final-report list ("total screenshots represented") could not be answered from the supplied text list alone.

### 22.12 Evidence-classification audit correction (2026-09-04, same day)

A follow-up audit re-inspected every Round 3 record against a stricter invariant: **no record may carry `review_status=verified` + `source_confidence=high` + an automation-eligibility value implying ingestion-suitability (`suitable_public_ats` / `suitable_public_html_subject_to_review`) when its key identity, market presence, careers URL, ATS ownership, or ingestion suitability was inferred only from a search-engine snippet, an unverified LinkedIn result, a third-party aggregator, an inaccessible/never-directly-validated URL, or an ambiguous company-name match.** This is not a new discovery/expansion round — no new candidates were researched; only the 42 Round 3 additions were re-examined for evidence-classification correctness.

**Records systematically checked against the strict combo (verified + high confidence + suitable_public_ats/suitable_public_html_subject_to_review):** all 42 new rows. **3 rows structurally matched the combo** — Toters (BambooHR, Lebanon), Al Tamimi & Company (Talentera, Saudi Arabia), Al Tamimi & Company (Talentera, UAE) — and each was individually re-checked against the underlying tool-call evidence: all 3 rest on a genuinely direct WebFetch of the specific ATS listing page with specific, itemized job postings read (not a snippet or aggregator) — **retained as verified, no change.**

**3 additional rows were downgraded** based on the broader evidence-quality principle and the specifically-named review categories, even though they did not hit the strict high-confidence combo (all were `medium` confidence):

| Record | File | Was | Now | Reason |
|---|---|---|---|---|
| Aspire Software | lebanon.csv | verified / medium / (invalid enum value) | **needs_manual_review** / low / unknown | Its Lebanon-location evidence rested on Bayt.com — a third-party aggregator republishing the official Workable postings — not a direct read of the primary ATS page itself (JS-rendered, never directly rendered). Matches the named disqualifying category "a third-party aggregator." |
| Intalio | lebanon.csv | verified / medium / manual_only | **needs_manual_review** / low / manual_only | Its careers-page content (open roles, internship program) was inferred from a search-indexed snippet and corroborated only via a third-party portal listing (Beirut Digital District), never a direct read of intalio.com/careers itself (JS-rendered, returned only a title). Matches "official URL exists but could not be validated directly." |
| Esnad Contracting | saudi-arabia.csv | verified / medium / suitable_public_html_subject_to_review | **needs_manual_review** / low / unknown | Unresolved name-collision risk, explicitly documented at research time but not acted on: at least 4 similarly-named but legally distinct Saudi entities exist, and a Jeddah job ad for "Esnad Contracting" could not be conclusively tied to this exact domain. Matches "ambiguous company-name match" (rule: identity ambiguity → needs_manual_review, independent of confidence level). |

The company/domain identity is genuine and unchanged for all 3 — this is a status correction (verified → needs_manual_review), **not a deletion**; all 3 remain in the registry as useful, honestly-labeled candidates per the task's explicit instruction not to discard incomplete-but-real leads.

**Separately, 3 enum-validity bugs were found and fixed** (introduced when the Round 3 rows were first written, unrelated to evidence strength): `automation_eligibility` was set to `manual_review_then_public_html` (Aspire Software, Packt) or `public_ats_api` (Remotive, RemoteOK) — neither is a valid value in this schema's `automation_eligibility` enum (`manual_only` / `suitable_public_ats` / `suitable_public_html_subject_to_review` / `unknown` — those two invalid values are legitimate `proposed_access_method` values, a different column, and were mistakenly reused here). All 4 corrected to `unknown`. Packt, Remotive, and RemoteOK were already `needs_manual_review`, so this is a pure enum-validity fix with no status change; Aspire Software's fix is folded into its status downgrade above.

**Known unresolved cases reviewed as specifically requested:**
- **Cedar Digital Solutions** name collision (vs. cedardigital.io) — already `needs_manual_review`; already conservative, no change needed.
- **Esnad Contracting** name collision — downgraded, see table above.
- **Toothpick** market ambiguity (Lebanon vs. UAE) — already `needs_manual_review`; already conservative, no change needed.
- **Every new international-remote record with `geographic_scope=location_unclear`** (BrightCHAMPS, Packt, ADPList, Study.com, We Work Remotely, Hubstaff Talent, Remote Woman, Wellfound, Remotive, RemoteOK, Jobfound, RemotelyX) — all 12 were already `needs_manual_review`, none `verified`; none are eligible for a "confirmed Lebanon-eligible" ingestion tier and none were miscategorized as such anywhere in this report.
- **Records whose ATS/endpoint was inferred only from indexed text** — RemoteOK's API claim and We Work Remotely's/Study.com's/Jobfound's page content are exactly this; all 4 were already `needs_manual_review`, confirming they were already correctly conservative before this audit.

**Corrected final counts** (supersedes the equivalent figures in §22.1–§22.9 above):

| | Before this audit (as first written, Round 3) | After this audit |
|---|---|---|
| Verified (registry-wide) | 147 | **144** |
| Needs manual review (registry-wide) | 97 | **100** |
| No official source found | 10 | 10 (unchanged) |
| Total market/source records | 254 | 254 (unchanged — status corrections only, no rows added/removed) |
| Lebanon | 49 verified / 16 review | **47 verified / 18 review** |
| Saudi Arabia | 23 verified / 18 review | **22 verified / 19 review** |
| Qatar | 24 verified / 16 review | 24 verified / 16 review (unchanged) |
| Kuwait | 21 verified / 7 review | 21 verified / 7 review (unchanged) |
| UAE | 27 verified / 12 review | 27 verified / 12 review (unchanged) |
| International remote | 3 verified / 28 review | 3 verified / 28 review (unchanged) |

**Identity-count arithmetic (unaffected by this audit, confirmed still correct):** 254 total market/source records break down as 227 unique `canonical_company_id` values, of which 214 appear in exactly one market file (214 rows) and 13 appear in 2 or more market files, contributing the remaining 40 rows: EY (5) + KPMG (5) + Deloitte (4) + PwC (4) + Netways (4) + newtecx (3) + People365 (3) + Al Tamimi & Company (2) + Talabat (2) + Ooredoo (2) + Zain (2) + Careem (2) + Tabby (2) = 5+5+4+4+4+3+3+2+2+2+2+2+2 = **40 rows from 13 companies**. **214 + 40 = 254 total rows, from 214 + 13 = 227 unique canonical companies.** "13 intentional multi-market repetitions" means **13 distinct companies** that each recur across multiple market files — not merely "13 extra rows"; the extra-row count those 13 companies contribute beyond one-row-each is 40 − 13 = **27 additional rows** (13 companies would need only 13 rows if each appeared in one market, but together they occupy 40 rows — 13 "baseline" rows + 27 "additional" rows from their extra market appearances). This is exactly the "27 additional market/source records" the user asked to be explained: **227 unique companies = 214 that appear in exactly one market + 13 that appear in multiple markets; those 13 alone account for 40 of the 254 total rows (13 baseline + 27 additional), and the other 214 companies account for the remaining 214 rows: 214 + 40 = 254.**

**Ingestion batches (re-confirmed unaffected):** the strict tier (36 companies) and the secondary tier (+3: Toters, Al Tamimi & Company ×2) are **unchanged** — none of the 3 downgraded records (Aspire Software, Intalio, Esnad Contracting) were ever counted in either tier (Aspire Software and Intalio were `manual_only`; Esnad Contracting was `medium` confidence, below the `high`-confidence bar both tiers require), so no ingestion-tier recalculation was needed.

**CSV validation after correction:** all 7 files re-parsed with a real CSV parser — 34 fields per row, byte-identical headers, zero malformed rows, zero duplicate `canonical_company_id` within any file, zero duplicate `(canonical_company_id, target_country)` pairs, all 254 `source_record_id` values globally unique, `automation_eligibility` now strictly ∈ {manual_only, suitable_public_ats, suitable_public_html_subject_to_review, unknown} registry-wide (the 4 invalid values found and fixed above), `review_status`/`early_career_relevance`/`internship_or_graduate_program_detected` enums clean, zero `verified` rows with empty `evidence_urls`, `master-company-registry.csv` rebuilt from the 6 corrected market files (254 = 254 rows, confirmed). **All validations passed.**

### 22.13 Confirmation

No job ingestion, n8n workflow build or edit, application-code change, database or migration change, LinkedIn scraping, LinkedIn login/automation, commit, stage, push, branch switch, or remote-system mutation occurred during this pass or its same-day audit correction. All work is contained in: `docs/job-source-discovery/lebanon.csv`, `saudi-arabia.csv`, `qatar.csv`, `kuwait.csv`, `uae.csv`, `international-remote.csv`, `master-company-registry.csv` (all edited/rebuilt in place), `docs/job-source-discovery/candidate-reconciliation.csv`, and this report. `git status` confirms only the untracked `docs/job-source-discovery/` directory remains untracked — no staged or committed changes, no branch switches.

## 23. `company_type` enum registry (added 2026-09-06)

No dedicated schema/enum documentation file previously existed for this registry's `company_type` column — the value set was implicit in what was actually written across the market CSVs. This section is the first explicit documentation of it, added as part of the Lebanon promotion reconciliation (see `pilots/apify-lebanon/reconciliation/lebanon-promotion-reconciliation-report.md` §12–§13 for the full history).

**Impact check performed before adding a new value:** searched the full repository (application code, TypeScript/TSX, SQL, Prisma schema files, n8n workflow definitions in `n8n-workflows/`) for any reference to `company_type`/`companyType`. **Zero matches outside `docs/job-source-discovery/`.** `company_type` is documentation/CSV-controlled only — not enforced by a hard-coded enum, not a database constraint, not consumed by any production code or deployed automation. Adding a new documented value is a pure documentation change with no code, migration, or automation impact.

**Full `company_type` value set currently in use** (queried directly from `master-company-registry.csv`, 254→288 rows before/after this promotion — see the reconciliation report for the promotion itself): `airline`, `bank`, `construction`, `coworking_hub_job_board`, `employer_company`, `engineering_consultancy`, `fintech`, `government`, `government_linked`, `government_owned`, `hospital`, `hospitality`, `industry_body_job_board`, `insurance`, `intergovernmental_organization`, `manufacturer`, `multinational_subsidiary`, `ngo`, `ngo_nonprofit`, `private`, `private_company`, `private_university`, `professional_services`, `professional_services_firm`, `professional_services_network`, `professional_services_partnership`, `public_company`, `public_joint_stock`, `public_listed`, `public_university`, `publisher`, `retailer`, `semi_government`, `social_enterprise`, `staffing_or_recruitment_agency`, `startup`, `telecom`, `university`, **`school` (new, added 2026-09-06)**.

**`school` — approved 2026-09-06.** Added specifically because `university` was being incorrectly applied to K-12/secondary institutions in the Lebanon registry (no accurate existing value covered this case, and `unknown` is not used anywhere for `company_type`). Use `school` for primary/secondary (K-12) educational institutions; continue using `university`/`private_university`/`public_university` for tertiary-education institutions. First applied to `cc-national-american-school` and `cc-antonine-sisters-school` in `lebanon.csv`.
