# Kuwait Employer & Source Adversarial Human-Quality Audit

Branch: `feat/kuwait-registry-expansion`, baseline `73cab12`. This audit is a separate pass over the research already completed — it does not re-derive identity or presence evidence from scratch; it challenges the existing conclusions.

## 1. Scope

- **50 staged employers** in `kuwait-promotion-staging.csv` (45 derived from the 131 supplied leads + 5 independent discoveries), each assigned a verdict in `human-quality-audit-employers.csv`.
- **21 proposed sources** across `kuwait-source-research.csv` and the source-type rows of `independent-discovery-candidates.csv`, each assigned a verdict in `human-quality-audit-sources.csv`.

## 2. Method

Every staged employer was checked against a fixed list of failure modes: mistaken identity, wrong country/city, expired job, stale URL, generic careers page, incorrect official domain, aggregator miscast as official careers, unsupported active-job claim, unverified remote eligibility, parent/subsidiary conflation, group/property inconsistency, cross-market ID mismatch, duplicate/alias miss, incorrect industry/company type, unsafe automation assumption, missing restrictions, and unsupported evidence strength. Checks that could be run mechanically (domain-consistency, duplicate canonical IDs, blank required fields, self-contradicting careers-page claims) were run programmatically across all 50 rows; the rest were reviewed individually against each row's own `researcher_notes`.

## 3. Employer audit results

| Verdict | Count |
|---|---|
| `approve_unchanged` | 37 |
| `correct_then_approve` | 13 |

**No employer received `hold_manual_review`, `reject_unsafe_or_invalid`, or `duplicate_or_alias` as a result of this audit** — the identity and presence research underlying every staged row held up under challenge. One row was fully removed from staging (see 3.2).

### 3.1 Systemic finding: careers-page overclaim (11 rows corrected)

`Procapita Group, Palms Agro Production Company, BFL Group, SV7 Advisory, Al Mashaan General Trading & Contracting, United Steel Industrial Co., SRVME, Ali Abdulwahab Al Mutawa Commercial Co., Diyar United Company, Oryx Holding (Kuwait), KitchenPark`

**Finding:** Each of these rows had `official_careers_url` set to the exact same value as `official_website_url` (i.e., no distinct careers subpage was ever actually fetched) but `careers_page_status` claimed `careers_page_found`. In 5 of the 11 cases the row's own `researcher_notes` explicitly said "careers page not independently confirmed this pass" — a direct self-contradiction the original pass missed.

**Root cause:** A script default (`careers_page_status: d.staging.careers_status || 'careers_page_found'`) silently filled in an optimistic value whenever the research notes didn't set one explicitly, rather than defaulting to an honest unknown state.

**Correction applied:** `careers_page_status` → `not_verified`, `current_open_jobs_detected` → `unknown`, `public_jobs_endpoint_or_feed` → `unknown` for all 11 rows. The underlying identity, official-domain, and Kuwait-presence evidence for each of these 11 companies remains strong and unaffected — only the careers-page-specific claim was corrected. All 11 remain staged (`correct_then_approve`).

### 3.2 Group/property policy inconsistency: Hilton Worldwide (removed from staging)

**Finding:** In the same pass that correctly kept IHG Hotels & Resorts at `hold_manual_review` because it is a brand-level lead without one confirmed specific property (per the explicit "parent brand should not be staged separately from a confirmed property" policy), Hilton Worldwide was staged at the brand level anyway. The one live job used as evidence (Concierge Agent, Al Farwaniya) does not match the location of any of the 4 confirmed named Kuwait Hilton properties (Hilton Garden Inn Kuwait/The Avenues, Waldorf Astoria Kuwait, Hampton by Hilton Kuwait Salmiya, Hilton Kuwait Mangaf Resort) — Al Farwaniya is a distinct area from all four.

**Correction applied:** Removed from `kuwait-promotion-staging.csv` and `kuwait-promotion-staging-manifest.csv`. Reverted `kuwait-employer-research.csv`, `normalized-candidate-inventory.csv`, and `supplied-lead-inventory.csv` (lead #20) back to `hold_manual_review`, consistent with the IHG treatment. A future pass should confirm one specific named property (most likely Hilton Garden Inn Kuwait, which has its own confirmed official hotel page) with a matching live job before staging.

### 3.3 Evidence-tier downgrade: Taiba Hospital

**Finding:** The "7 current openings" claim rested entirely on aggregator summaries (GulfTalent, Neelim), not a first-party fetch of `taibahospital.com`'s own careers content.

**Correction applied:** `current_open_jobs_detected` downgraded from `yes` to `unknown`. Identity, official domain, and Kuwait presence (Mubarak Al-Kabeer) remain strongly confirmed; the row stays staged.

### 3.4 Imprecise URL: American International University | Kuwait

**Finding:** `official_careers_url` pointed to the root domain (`aiu.edu.kw`) instead of the specific careers path the original research had actually found and cited (`aiu.edu.kw/careers/jobs`, referenced as "Jobs at AIU").

**Correction applied:** URL corrected to the specific path.

### 3.5 Disclosed, pre-existing findings carried forward (not new)

`Foodics` (`cc-foodics`) and `Apparel Group` (`cc-apparel-group`) intentionally reuse a `canonical_company_id` already assigned to the same company in the Saudi market registry, per established repository convention from the original pre-Kuwait-pilot research pass. This was already disclosed in each row's `researcher_notes` and flagged for human confirmation of the ID-reuse decision — the audit re-confirms this is a deliberate, documented choice, not an error, and takes no further action.

### 3.6 Rows with no findings (37 of 50)

The remaining 37 staged rows — including all confirmed hotel properties (Marriott ×4, Millennium ×2, Four Seasons, Radisson, Grand Hyatt, Hyatt Regency), all global-major confirmations (Siemens, SLB, Nestlé, Larsen & Toubro, Fluor, Leidos, Bureau Veritas, Worley, Hitachi Energy, Sephora, ABYAT, Egis, URC, HRInvest, Iron Mountain), the Commercial Bank of Kuwait/AlTijaria identity resolution, and the newly staged independent discoveries (Behbehani Motors, Ali Alghanim & Sons Automotive, Warba Insurance & Reinsurance, KEO International Consultants) — were individually checked against the same failure-mode list and no issue was found. Identity, domain, city, evidence-tier labeling, and job-claim support were all internally consistent with the underlying evidence in `researcher_notes`.

## 4. Source audit results

| Verdict | Count |
|---|---|
| `duplicate_or_alias` | 8 |
| `hold_manual_review` | 10 |
| `move_to_source_catalog` | 2 |
| `insufficient_evidence` | 1 |

### 4.1 Duplicates caught and corrected (2 new this pass)

**Boursa Kuwait (the exchange itself)** and **Kuwait Investment Authority (KIA) — potential portfolio directory**, both logged in `independent-discovery-candidates.csv` as new finds, were found on cross-reference to already be verified rows in the production `kuwait.csv` baseline (`cc-boursa-kuwait`, `cc-kuwait-investment-authority` — the latter with an already-confirmed careers page). Both corrected to `already_present` and excluded from staging. This is the most consequential audit finding: without this check, two duplicate employer rows would have been proposed against entities already live in production.

The other 6 `duplicate_or_alias` rows (Alghanim Industries, Deloitte Kuwait, Gulf Bank, National Bank of Kuwait, American University of Kuwait, Al Mulla Group) were correctly identified as duplicates in earlier passes and are confirmed correct here.

### 4.2 `move_to_source_catalog` (2)

**HRInvest** and **Libera Consultants** are real, Kuwait-relevant (Libera is Dubai-HQ'd, regionally covering Kuwait) entities correctly classified `not_applicable` as automatable job-board sources — they are private placement/executive-search consultancies, not public multi-employer boards. HRInvest is separately staged as an employer (`cc-hrinvest`); Libera is not (no confirmed Kuwait office).

### 4.3 `hold_manual_review` (10)

Includes the corrected SpaStaff.com (Kuwait coverage now confirmed, access-policy check still inconclusive), Wathif (robots.txt confirmed permissive with a published sitemap this pass — the strongest access-policy evidence found for any source this pass), the Kuwait Civil Service Commission recruitment portal, Public Authority for Manpower, and the newly discovered Airswift/NES Fircroft/SOS HR Solutions/Al Oula Steel Manufacturing/Anton-OSS candidates (all real, none with a completed access-policy check).

### 4.4 `insufficient_evidence` (1)

SSC HR Solutions — identity itself remains genuinely unresolved for the exact supplied name (the real SSC HR Solutions operates only in Saudi/Egypt/UAE; a likely-intended Kuwait match, SOS HR Solutions, was found and flagged but not substituted).

**No source was approved for `approved_for_automated_ingestion` this pass** — every candidate either lacks a completed robots.txt+ToS check, or is not itself a suitable automation target (consultancy/placement firms).

## 5. What this audit did not do

- It did not re-run WebSearch/WebFetch for every one of the 50 staged rows from scratch — it challenged the existing evidence for internal consistency and correctness, which is how the careers-page-overclaim and Hilton findings were actually caught (they were consistency failures, not missing research).
- It did not use a browser (unavailable this session) to visually verify any JS-rendered page.
- It did not complete a full ToS review for any source — only robots.txt-level checks were performed where done at all.

## 6. Verdict (through pass 4)

The audit surfaced and corrected real defects (12 employer-row corrections, 1 full removal, 2 source-duplicate corrections) rather than rubber-stamping the prior research. All corrections are reflected in `kuwait-promotion-staging.csv`, `kuwait-promotion-staging-manifest.csv`, `kuwait-employer-research.csv`, `normalized-candidate-inventory.csv`, `supplied-lead-inventory.csv`, `manual-review-queue.csv`, `independent-discovery-candidates.csv`, and `access-policy-audit.csv`. No correction was applied to any production file.

## 7. Pass 5 addendum — 79-candidate individual verification + recruitment agencies

**Scope extension:** `human-quality-audit-employers.csv` extended from 74 to **80** rows (the 6 newly-staged Boursa individual-verification candidates: KIPCO/KPROJ, Makhazen, KCPC, MRC, Mezzan, Integrated Holding). `human-quality-audit-sources.csv` extended from 32 to **38** rows (the 6 recruitment agencies from `recruitment-agency-final-verification.csv`).

**Findings on the 6 new employer rows:** 0 issues — all 6 had a genuinely confirmed official domain AND a genuinely confirmed distinct careers page (not the root domain) verified via direct fetch before staging, avoiding the careers-page-overclaim pattern caught earlier in this project.

**Full structural re-audit of all 80 staged rows** (not just the 6 new ones, per this pass's explicit "do not blindly trust earlier staging" instruction): re-ran every mechanical check (aggregator-as-careers-URL, personal LinkedIn URLs, wildcard/malformed URLs, careers-page-status self-contradiction, wrong-country, duplicate canonical IDs) across the complete current set. **Zero new issues found** — the prior passes' corrections held up under a fresh full pass, not just incremental checking of new rows.

**Findings on the 79 individually-verified Boursa candidates as a set** (beyond the 6 staged): the individual verification itself functioned as an audit of the *prior pass's* batch-classification — and found it materially wrong in at least one high-value case (KIPCO, one of the region's largest conglomerates, had been in the "likely shell" bucket) and confirmed 3 candidates were flagged for the wrong market entirely (GFH, Inovest — Bahrain; QIC — UAE) despite Boursa Kuwait cross-listing. This validates the task's explicit prohibition on name-pattern classification as a final state.

**Findings on the 6 recruitment agencies:** Al-Hafez Company's one attempted domain guess (`alhafez.com`) was fetched and found to be a confirmed-different, unrelated Syria-based appliance manufacturer — a real near-miss that was caught and explicitly ruled out rather than silently accepted as a match.

**No correction was applied to any production file this pass either.**

## 8. Pass 6 addendum — final promotion-eligibility audit and closure

**New artifacts audited:** `final-promotion-eligibility-manifest.csv` (all 80 staged rows) and `final-source-classification.csv` (all 38 audited sources, mapped to the required 7-value ingestion-decision enum).

**Key finding corrected during this pass's own self-check:** an early draft of the final-promotion-eligibility manifest mechanically re-flagged 14 rows as `correct_then_approve` by pulling a *historical* audit verdict field, without checking whether that correction had already been applied to the underlying `kuwait-promotion-staging.csv` data (it had, in pass 3/4). This would have misrepresented 14 already-clean rows as still needing work. Caught by manually inspecting one flagged row (`cc-procapita-group`) against the live staging data, which showed the `careers_page_status` field already correctly reading `not_verified` (the fix), not the overclaimed `careers_page_found`. The manifest-generation logic was corrected to distinguish "historically corrected, now verified consistent" from "currently defective" — the former reports `approve_unchanged` with a traceability note; only a genuinely still-open defect would report `correct_then_approve`. **Zero rows needed a live correction in this pass** — the full structural re-audit (aggregator-URLs, LinkedIn, wildcards, contradictions, wrong-country) found nothing new across all 80 rows.

**Recruitment-agency re-verification:** Bing search via WebFetch was confirmed to be a working, unblocked channel this pass (unlike DuckDuckGo, web.archive.org, and Bayt.com's directory search, all of which were blocked or unavailable). This let 4 previously "budget exhausted" agencies get genuine negative-evidence-based classifications instead of a bare tooling excuse.

**No correction was applied to any production file this pass.**
