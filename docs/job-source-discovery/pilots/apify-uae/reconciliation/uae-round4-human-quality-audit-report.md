# UAE Registry Expansion — Round 4: Human-Quality Product Audit (Audit Only, No Promotion)

**Date:** 2026-09-07. **Audit-only step. Nothing was promoted. `uae.csv` and `master-company-registry.csv` were not touched. No commit/push. No Apify calls.**
**Scope:** all 67 rows currently in `uae-promotion-staging.csv` (10 round 1 + 12 round 2 + 45 round 3), individually re-evaluated for product-level correctness — not just the schema/programmatic checks the round-3 comprehensive validation already passed.

---

## 1. Executive summary

All 67 staged companies were audited individually against their full evidence trail (staging row, manifest evidence, and the original round 1/2/3 verification notes). **51 rows are clean and approvable unchanged. 15 rows are genuine employers with a specific, mechanical field defect that should be corrected before promotion. 1 row has an unresolved identity/location question that should be held. 0 rows are rejected outright** — the candidates that didn't hold up were already filtered out in rounds 1–3 before reaching staging; this audit found no new safety, duplicate, or invalid-employer problems among the 67.

The defects found are almost entirely **data-hygiene**, not identity fraud: 12 rows have a `official_careers_url` field polluted with parenthetical annotation text instead of a clean URL (a real problem for any automated URL consumer downstream); 2 rows overstate their careers channel (`careers_page_found` when only an email or an informal on-site statement exists — both have an honest, already-documented enum value available instead); 1 row's `target_city` omits a Dubai office its own evidence already documents; 1 row's `official_website_url` points to a firm's former/redirected domain instead of its current brand domain. The single hold is **Capital Engineering Consultancy** — a real firm, but its Abu Dhabi presence has been flagged unresolved (Sharjah HQ address) since round 1 and was never independently re-verified.

No duplicate, branch, or parent/subsidiary problem was found among the 67. The three genuine group-recruiting cases in the set (NMC Specialty Hospital Abu Dhabi / NMC Healthcare; Mediclinic Al Mamora / Mediclinic Middle East; Noatum Logistics ME / AD Ports Group) already transparently disclose the group relationship in `legal_or_official_name` and `researcher_notes` — none needed correction. All 15 dual-city rows were re-checked against their underlying evidence and every one cites a specific, named Dubai *and* Abu Dhabi office/address (not an inferred "serves the whole UAE" claim) — all 15 hold up.

**Final proposed promotion count: 66** (51 approve + 15 correct-then-approve). **Expected `uae.csv` total after promotion: 105** (39 existing + 66).

**Verdict: READY_TO_APPLY_CORRECTIONS.**

---

## 2. Audit methodology

For each of the 67 rows, this audit cross-referenced:
- `uae-promotion-staging.csv` (the 34-column proposed row itself, including `researcher_notes`)
- `uae-promotion-staging-manifest.csv` (`source_evidence_used`, `dedup_result_against_39_existing`, `mapping_correction_applied`)
- The row's original verification finding — `enrichment/enriched-company-candidates.csv` (rounds 1–2) or the `round3-batch1..5-findings.js` / `round3-round1-reconciliation.js` notes (round 3)
- The raw Google Maps discovery record in `all-classified-candidates.csv` (category, address, rating, review count) — used to sanity-check location and category claims
- `uae.csv` and `master-company-registry.csv` — for name/domain collision and canonical-ID-format consistency
- The round-3 comprehensive validation report — for what was already programmatically confirmed (uniqueness, non-empty evidence, no personal LinkedIn URLs), so this audit could focus on what that pass *couldn't* check: product-level correctness

No new WebFetches or Apify calls were made — this audit evaluates the evidence already gathered and documented, as scoped ("Inspect... source and evidence artifacts under the UAE pilot directory").

---

## 3. The complete 67-row audit table

See the table in this file's companion export, reproduced in full in the chat response delivered alongside this report (§9 of that response). All 67 `internal_row_id`s are covered; **51 approve, 15 correct_then_approve, 1 hold_manual_review, 0 reject**.

---

## 4. Exact corrections proposed, by internal_row_id

### 4.1 Location correction (1 row)

- **`uae-pilot-0079` (AMA Global Audit Tax Advisory, `cc-ama-global-audit-tax-advisory`)** — `target_city`: `Abu Dhabi` → `Dubai; Abu Dhabi`. The row's own `website_notes`/`researcher_notes` already state "offices in Abu Dhabi, Dubai, India, Singapore, and the USA" — the Dubai office was documented at verification time but never reflected in `target_city`.

### 4.2 Official-source correction (1 row)

- **`uae-pilot-0144` (Agile Vertex Advisory, `cc-agile-vertex-advisory`)** — `official_website_url`: `https://complybridgeglob.com/` → `https://www.agilevertexadvisory.com/`. The firm rebranded; its own `official_careers_url` is already recorded on the new domain, so the website field should match. (Functionally the old domain 301-redirects to the new one, so no harm was done to a downstream fetch — but the two fields disagreeing is a genuine data-quality issue worth fixing for consistency.) Also strip the `(footer link observed)` annotation from `official_careers_url` into `researcher_notes`.

### 4.3 Careers-channel honesty corrections (2 rows)

- **`uae-pilot-0345` (Paradise Home Engineering Consultancy, `cc-paradise-home-engineering`)** — `careers_page_status`: `careers_page_found` → `recruitment_email_only` (an enum value already in use elsewhere in `uae.csv`/`master-company-registry.csv` — no new schema value needed). `automation_eligibility`/`proposed_access_method`: → `recruitment_email_only`/`manual_only`. `official_careers_url`: replace the prose ("work/internship inquiries via info@phengc.com (no dedicated page)") with a clean `mailto:info@phengc.com`, moving the descriptive detail into `researcher_notes` (already substantially present there).
- **`uae-pilot-0334` (NSB Luxury Transport, `cc-nsb-luxury-transport`)** — `careers_page_status`: `careers_page_found` → `unavailable` (existing enum value; honest given there is no formal page or email, only an on-site staffing-need statement). `automation_eligibility`/`proposed_access_method`: → `manual_only`. `official_careers_url`: clear the field; the informal signal is already documented in `researcher_notes`.

### 4.4 URL-field-cleanliness corrections (12 rows — mechanical, same fix pattern)

`official_careers_url` currently embeds parenthetical/prose annotation text (e.g. `"(nav link observed)"`, `"(footer link observed)"`, an inline email, or a parent-portal note) instead of containing a clean URL. This is a real defect for any downstream system that treats the field as a fetchable URL. **Fix: keep only the clean URL in the field; move the annotation text into `researcher_notes` (in most cases the same substance is already present there, so this is close to a pure formatting fix).**

| internal_row_id | canonical_company_id | current `official_careers_url` |
|---|---|---|
| uae-pilot-0141 | cc-civilco | `http://www.civilco.ae/careers (VACANCIES/APPLY FORM pages observed)` |
| uae-pilot-0157 | cc-datum-engineering-consultants | `http://www.datum.ae/careers (nav link observed)` |
| uae-pilot-0037 | cc-al-dhafra-international-projects | `http://dhafra.org/careers (hr@dhafraint.ae)` |
| uae-pilot-0147 | cc-construction-general-contracting-house | `https://www.cgchouse.com/careers (nav link observed)` |
| uae-pilot-0104 | cc-avanti-contracting | `http://www.avanti-uae.com/careers (footer link observed)` |
| uae-pilot-0366 | cc-rank-accounting-consultancy | `http://www.rank-consultancy.com/join-us (nav link observed)` |
| uae-pilot-0077 | cc-am-audit | `http://www.amaudit.ae/career (nav link observed)` |
| uae-pilot-0189 | cc-elqen-chartered-accountants | `https://elqen-cpa.com/careers (nav link observed)` |
| uae-pilot-0415 | cc-talal-group | `https://www.talalgroupintl.com (People & Careers nav link observed)` |
| uae-pilot-0131 | cc-capriole-construction | `http://www.capriole-construction.com/careers (nav link observed)` |
| uae-pilot-0144 | cc-agile-vertex-advisory | `https://www.agilevertexadvisory.com/careers (footer link observed)` (also has the website-domain fix above) |
| uae-pilot-0329 | cc-noatum-logistics-me | `https://www.noatum.com/en/compromiso/empleo/ (parent AD Ports Group / Noatum portal)` |

For `cc-talal-group`, the clean URL has no path deeper than the homepage (the "People & Careers" section was confirmed via nav link, not a distinct URL) — the corrected field should be the homepage URL alone, with the nav-link detail in `researcher_notes` (already there).

---

## 5. Duplicate, parent/subsidiary, hospital-group, and branch findings

**No duplicate, branch, or unresolved parent/subsidiary problem was found among the 67 staged rows.**

- **NMC Specialty Hospital Abu Dhabi (`cc-nmc-specialty-hospital-abu-dhabi`)** — genuinely a facility of NMC Healthcare, one of the UAE's largest private hospital groups. The relationship is already disclosed in `legal_or_official_name` ("NMC Specialty Hospital Abu Dhabi (NMC Healthcare)") and `researcher_notes`. "Abu Dhabi" in the name is the facility's own official self-identification (NMC operates multiple similarly-named "Specialty Hospital" facilities in different emirates), not a mechanical branch-disambiguation suffix — kept as-is per the audit's own exception rule. **parent_subsidiary_but_separate, approve.**
- **Mediclinic Al Mamora (`cc-mediclinic-al-mamora`)** — a facility of Mediclinic Middle East. The evidence is unusually explicit that the confirmed ATS is a "central, group-wide" portal, not facility-specific — and this is already disclosed transparently in `researcher_notes`/`careers_notes` rather than being silently presented as a facility-only channel. No other Mediclinic-named facility exists in this staged set, so there is no within-batch duplication risk. **parent_subsidiary_but_separate, approve.**
- **Noatum Logistics ME (`cc-noatum-logistics-me`)** — disclosed subsidiary of AD Ports Group (Abu Dhabi's state-owned ports/logistics conglomerate); careers channel is the parent's portal, already disclosed. **parent_subsidiary_but_separate, approve** (plus the URL-cleanliness fix in §4.4).
- **Assist Plus (`cc-assist-plus`)** — self-discloses being "An Assist Plus Group Company" with separate subsidiaries; Assist Plus itself holds the confirmed careers page, so it is the correct entity to stage. **parent_subsidiary_but_separate, approve.**
- **Aramex (Khalidiya Outlet)** — correctly **not** among the 67; remains held in `duplicate-and-alias-review.csv` pending manual confirmation against the existing registry, exactly as reported in round 3. No action needed here.
- **KWEC (Al Khawaja Engineering Consultants)** — correctly **not** among the 67; remains excluded per the round-2 finding of casino/gambling-affiliate content mixed into its site. Re-confirmed absent this audit.

**Similar-name-only pairs (no identity confusion, flagged for downstream matching awareness only):**
- `cc-ama-global-audit-tax-advisory` ("AMA Global Audit Tax Advisory", amaaudit.com, est. 1999) vs. `cc-am-audit` ("Am Audit", amaudit.ae, est. 2016) — different domains, different founding years, different offices. Genuinely distinct firms; not merged.
- A broad name-token similarity scan was run across Construction, Engineering Consultancy, Consulting/Professional Services, Logistics, and Healthcare (the categories the task flagged for special attention). All other overlaps found were generic category words ("hospital", "medical centre", "accounting", "logistics", "cargo") shared across unrelated firms — expected in these sectors, not evidence of duplication.

---

## 6. Suspicious or insufficient-source findings

- **Capital Engineering Consultancy (`cc-capital-engineering-consultancy`)** — the one **hold_manual_review**. Its own website's HQ address reads as Sharjah (Abu Shagara), not Abu Dhabi, even though it was staged under `target_city = Abu Dhabi` based solely on the Google Maps discovery pin. This was flagged as unresolved in the round-1 report and again in the round-3 manifest (`mapping_correction_applied`) — and was never independently re-verified in rounds 2 or 3. **Held, not rejected**, because the firm itself is clearly real (ISO/ICV certified, MENA Winner Award 2024, 85 Google reviews at 4.7 rating) — only its Abu Dhabi presence (branch office vs. project-only listing) is unconfirmed.
- No other row showed signs of a compromised, hijacked, or otherwise unsafe website. (KWEC, the one compromised-site finding from round 2, is confirmed absent from the 67 — see §5.)
- No Google Maps URL or search-result URL was found stored as a row's primary evidence; all 67 rows' `evidence_urls` point to the company's own domain and/or careers page, consistent with round-3 validation.
- No personal `linkedin.com/in/` URL was found (re-confirmed; matches round-3 validation). Every stored LinkedIn URL uses the `linkedin.com/company/` form.

---

## 7. Corrected city totals (after applying the 1 location correction, excluding the 1 hold)

| | Count |
|---|---|
| Dubai only | 26 |
| Abu Dhabi only | 24 |
| Dubai + Abu Dhabi (dual-city) | 16 |
| **Total promotable** | **66** |

(Capital Engineering Consultancy — held, city unconfirmed — is excluded from this total. Its prior "Abu Dhabi" classification should not be treated as final until the hold is resolved.)

---

## 8. Corrected sector totals (66 promotable)

| Sector | Count |
|---|---|
| Consulting/Professional Services | 15 |
| Healthcare | 14 |
| Construction | 12 |
| Engineering Consultancy | 11 |
| Logistics | 6 |
| Architecture | 4 |
| Interior Design/Fit-out | 1 |
| HR and Recruitment | 1 |
| Retail | 1 |
| Hospitality | 1 |
| **Total** | **66** ✓ |

(Engineering Consultancy drops from 12 to 11 because Capital Engineering Consultancy is held.)

---

## 9. Decision totals

| Decision | Count |
|---|---|
| approve | 51 |
| correct_then_approve | 15 |
| hold_manual_review | 1 |
| reject | 0 |
| **Total audited** | **67** ✓ |

**Final proposed promotion count (approve + correct_then_approve): 66.**
**Expected `uae.csv` total after promotion: 39 (existing) + 66 = 105.**

---

## 10. Files created or modified by this audit

**Created:**
- `reconciliation/uae-round4-human-quality-audit-report.md` (this file)

**Modified:** none.

**Confirmed unchanged (verified via `git diff`/`git status` at the end of this audit):**
- `uae-promotion-staging.csv`, `uae-promotion-staging-manifest.csv`, `uae-promotion-dry-run.csv`
- `uae.csv`, `master-company-registry.csv`, all other market-country CSVs
- `AGENTS.md` (not staged; its pre-existing working-tree diff predates this session and was not touched)
- No `git add`, `commit`, or `push` was run. No Apify calls were made.

---

## 11. Final verdict

**READY_TO_APPLY_CORRECTIONS** — 66 of 67 staged companies are genuine, evidence-backed employers ready for promotion once the 15 documented mechanical corrections (§4) are applied; 1 (Capital Engineering Consultancy) should be held pending confirmation of its Abu Dhabi presence. No corrections were applied in this step — this was audit-only, as scoped.
