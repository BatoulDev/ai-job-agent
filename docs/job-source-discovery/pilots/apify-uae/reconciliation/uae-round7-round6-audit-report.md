# UAE Registry Expansion — Round 7: Human-Quality Audit of the 48 Round-6 Promotions

**Date:** 2026-09-07. **Audit-only. No commit, no push, no Apify calls. `uae.csv`, `master-company-registry.csv`, `source-catalog.csv`, and all staging/decision files were read-only throughout — confirmed unchanged at the end (see §11).**

---

## 1. Round-6 accounting verification

Confirmed by extracting exactly rows 107–154 of `uae.csv` (the 48 rows appended after the pre-existing 106) and cross-checking against the round-6 report's decision table:

| Bucket | Count |
|---|---|
| Promoted employers | 48 |
| Already present | 4 |
| Source-catalog additions | 3 |
| Geographically ineligible | 5 |
| Manual review | 24 |
| Insufficient evidence | 6 |
| **Total processed** | **90** ✓ |

- `uae.csv`: confirmed 106 → 154 (106 pre-round-6 rows, unchanged in count and order — row 106 is still `cc-katch-international` — followed by exactly 48 new rows).
- `master-company-registry.csv`: confirmed 355 → 403 (+48), inserted at the end of the UAE block; no duplicate `(canonical_company_id, target_country)` pair exists (0 found programmatically, including `cc-talabat`'s new UAE row coexisting correctly with its pre-existing Qatar and Kuwait rows).
- `source-catalog.csv`: confirmed 104 → 107 (+3): `src-ae-txm-manpower-solutions`, `src-ae-nameless-ventures`, `src-ae-trevex-business-directory`, each present exactly once.
- The same 48 `canonical_company_id`s exist in both `uae.csv` and `master-company-registry.csv` — confirmed programmatically, no gaps.
- No previous promotion was repeated: zero duplicate `canonical_company_id`, zero duplicate normalized company name, zero duplicate official-website domain, zero duplicate LinkedIn URL anywhere across all 154 `uae.csv` rows (checked as a whole, not just within the 48).
- No candidate received more than one final outcome (machine-verified in round 6 and re-confirmed this round: all 90 names map to exactly one bucket).

## 2. Method this round

Round 6 relied primarily on WebSearch (search-result summaries, several of which themselves quoted or paraphrased official-domain content). This audit went further: **every one of the 48 official/careers URLs was mechanically re-checked for live HTTP status** (92 URLs, direct HTTP requests — not AI-summarized), and the highest-risk/most-flagged companies (§3 of the task) were **directly re-WebFetched** against their own official domains, or against an independent regulator/authoritative register where the company's own domain was blocked. Findings are recorded honestly per company as `direct_official_evidence` (this pass's own successful fetch), `authoritative_indirect_evidence` (strong multi-source corroboration, not independently re-confirmed this pass), or `insufficient_evidence` / `contradicted` where a real problem was found.

**Genuine defects found by this audit that round 6's evidence-gathering missed:**
1. **Two rows had a completely non-functional official source**: `careers.alghurair.com` (Al Ghurair Group) does not resolve (DNS failure, confirmed twice), and `lestarsmc.com` (Lestars Management Consultancy) does not exist at all (DNS: "Non-existent domain").
2. **One row's own official domain contradicted, rather than corroborated, the round-6 claim**: ADM's own `adm.com/en-us/careers/` page, directly fetched, shows no Dubai-specific office or listing anywhere — only a broad "EMEA" region bucket.
3. **One row's careers evidence was a third-party job board showing zero current openings**, not Hyatt's own system: Park Hyatt Dubai's stored careers URL (hcareers.com) is not Hyatt's own domain and showed "0 jobs" this pass.
4. **One row's identity/physical-presence evidence could not be confirmed on the company's own domain across two separate fetch attempts**: Slicit never discloses a legal entity name, UAE registration, or physical address on its own site.
5. **One row's official evidence returned a technical/SSL failure on both fields**: Independent Food Company (`indpt.com` returns HTTP 526 — invalid origin SSL certificate; `careers.indpt.com` does not resolve).
6. **Six rows had `official_careers_url` pointing to a generic third-party job aggregator** (GulfTalent, Indeed, HireHabibi) rather than the company's own domain or a dedicated company-specific ATS vendor instance — a real field-quality defect, distinct from the many other rows that legitimately use a dedicated ATS vendor subdomain (Workable, Betterteam, PyjamaHR) tied to that specific company.
7. **Two rows had stale/incorrect deep-link paths** on otherwise-legitimate official domains (Amazon's Dubai-specific jobs URL, OKX's `/careers` path) — both returned HTTP 404.
8. **One row understated genuinely strong evidence**: BRAU's own careers portal, directly fetched, shows 5 real currently-open positions across Dubai and Abu Dhabi — stronger than the "unknown" values originally recorded.

## 3. Full 48-row employer audit table

| internal ref | Canonical name | Canonical ID | Location | Official-domain verdict | Careers/ATS verdict | Parent/brand verdict | Evidence verdict | Duplicate verdict | Final recommendation | Exact reason | Correction/removal required |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Bayut | cc-bayut | Dubai | live (401 anti-bot on root, not broken) | live, own domain | Part of Dubizzle Group (disclosed) | authoritative_indirect_evidence | none | **approve** | Strong multi-source identity; own careers evidence page live | none |
| 2 | McGraw Hill | cc-mcgraw-hill-uae | Dubai; Abu Dhabi | live | live, own subdomain | Global McGraw Hill LLC subsidiary | authoritative_indirect_evidence | none | **approve** | Own careers.mheducation.com live with Dubai-tagged roles | none |
| 3 | CFI Financial Group | cc-cfi-financial-group | Dubai | blocked (403) this pass, not contradicted | blocked (403) this pass | Independent group, Beirut-founded/Dubai-HQ'd | authoritative_indirect_evidence | none | **approve** | Specific CMA license number (20200000154) previously confirmed from the official domain | none |
| 4 | Amana Contracting and Steel Buildings | cc-amana-contracting | Dubai; Abu Dhabi | **directly confirmed live this pass** | live, own domain (jobs.groupamana.com) | Group AMANA; Saudi ops under a distinct "Saudi AMANA Contracting Co" entity (noted, not conflated) | direct_official_evidence | none | **approve** | Directly fetched: named Dubai + Abu Dhabi addresses, live careers link | none |
| 5 | ClearGrid | cc-cleargrid | Dubai | live | live, own subdomain | Independent | authoritative_indirect_evidence | none | **approve** | Own domain and careers.cleargrid.co both live | none |
| 6 | Justlife | cc-justlife | Dubai | live | live, own subdomain | Independent | authoritative_indirect_evidence | none | **approve** | Own domain and career.justlife.com both live | none |
| 7 | Revolut | cc-revolut-uae | Dubai | blocked (403) this pass, not contradicted | blocked (403) this pass | Global Revolut Ltd | authoritative_indirect_evidence | none | **approve** | Overwhelming brand certainty; 63 specific job titles previously confirmed from revolut.com | none |
| 8 | DarGlobal | cc-darglobal | Dubai | live | **third-party (GulfTalent)** | Dar Al Arkan Group (LSE-listed) | authoritative_indirect_evidence | none | **correct_then_approve** | Real employer; careers field wrongly recorded a job-board link as "official" | Clear `official_careers_url`; downgrade `careers_page_status`/`automation_eligibility` to `not_verified`/`unknown` until an owned-domain source is found |
| 9 | Sunset Hospitality Group | cc-sunset-hospitality-group | Dubai | live | live, own domain | Independent | authoritative_indirect_evidence | none | **approve** | Own domain and /careers both live | none |
| 10 | Amazon | cc-amazon-uae | Dubai | live | **404 (stale deep-link)** | Amazon.com, Inc. | authoritative_indirect_evidence | none | **correct_then_approve** | Identity beyond doubt; the specific Dubai deep-link had gone stale | `official_careers_url`: `.../locations/dubai-united-arab-emirates` → `https://www.amazon.jobs/en/` (confirmed HTTP 200 this pass) |
| 11 | OKX | cc-okx | Dubai | live | **404 (stale path)** | OKX Middle East Fintech FZE | authoritative_indirect_evidence | none | **correct_then_approve** | Regulatory identity strong (VARA VASP license, regulator's own coverage); careers path is dead and no working replacement was found this pass | Clear `official_careers_url`; downgrade `careers_page_status`/`automation_eligibility` to `not_verified`/`unknown` until a working careers URL is located |
| 12 | Tabreed | cc-tabreed | Abu Dhabi; Dubai | live | live | Mubadala portfolio company | authoritative_indirect_evidence | none | **approve** | Own domain live; extremely well-documented UAE infrastructure role | none |
| 13 | Unity Star Import and Export FZE LLC | cc-unity-star-import-export | Dubai | live | live (dedicated PyjamaHR ATS instance) | Independent | authoritative_indirect_evidence | none | **approve** | Own domain live; company-specific ATS listing, not a generic aggregator | none |
| 14 | haus & haus | cc-haus-and-haus | Dubai | live | live, own domain | Independent | authoritative_indirect_evidence | none | **approve** | Own domain and /careers both live | none |
| 15 | Guild (Real Estate Marketing) | cc-guild-real-estate-marketing | Dubai | live | live, own domain | Independent marketing agency, not a recruiter | authoritative_indirect_evidence | none | **approve** | Genuine direct employer, same pattern as Katch International | none |
| 16 | CHANEL | cc-chanel-uae | Dubai | live | **third-party (Indeed)** | CHANEL S.A. | authoritative_indirect_evidence | none | **correct_then_approve** | Identity beyond doubt; careers field wrongly recorded an Indeed link as "official" | Clear `official_careers_url`; downgrade `careers_page_status`/`automation_eligibility` to `not_verified`/`unknown` until CHANEL's own careers page is located |
| 17 | Qashio | cc-qashio | Dubai; Abu Dhabi | live | live, own subdomain | Independent, Alinma Bank-backed | authoritative_indirect_evidence | none | **approve** | Own domain and careers.qashio.com both live | none |
| 18 | Hilton | cc-hilton-uae | Dubai; Abu Dhabi | **directly confirmed live this pass** (careers portal) | live, official Oracle Cloud-backed portal | Hilton Worldwide Holdings | authoritative_indirect_evidence | none | **approve** | jobs.hilton.com directly WebFetch-confirmed as the official portal | none |
| 19 | Ounass | cc-ounass | Dubai | live | **directly confirmed live this pass, 25 open roles** | Al Tayer Group subsidiary (well-corroborated, not shown on this specific page) | direct_official_evidence | none | **approve** | Directly fetched: 25 real open Dubai-majority positions | none |
| 20 | Park Hyatt Dubai | cc-park-hyatt-dubai | Dubai | live (hyatt.com property page) | **third-party board, "0 jobs" shown** | Hyatt Hotels Corporation (Chicago HQ) — control of recruitment (property vs. corporate) unresolved | insufficient_evidence | unresolved_identity vs. a future Hyatt-brand record | **hold_manual_review** | Careers source is not Hyatt's own system and shows no current openings; whether this should be a property record, a Hyatt-brand record, or held entirely is unresolved | **Must be removed from both `uae.csv` and `master-company-registry.csv` pending resolution** |
| 21 | Pathos Communications | cc-pathos-communications | Dubai | live | live, own domain | UK-incorporated, AIM-listed parent (Pathos Communications plc); DIFC Dubai operations | authoritative_indirect_evidence | none | **approve** | Own domain and /about-us/ both live | none |
| 22 | Slicit | cc-slicit | Dubai | live (homepage only) | live (careers section, real listings) | Unconfirmed (no legal entity disclosed on-site) | insufficient_evidence | unresolved_identity | **hold_manual_review** | Two direct fetches found real careers content but never a legal entity name, UAE registration, or physical address on Slicit's own domain | **Must be removed from both `uae.csv` and `master-company-registry.csv` pending resolution** |
| 23 | Sarwa | cc-sarwa | Abu Dhabi | live | live, own subdomain | Independent | **direct_official_evidence** | none | **approve** | Directly fetched the ADGM regulator's own public register: Active FSP License 190037, registered Abu Dhabi address — the strongest evidence class available | none |
| 24 | Printerpix | cc-printerpix | Dubai | live | live (dedicated Betterteam ATS instance) | Independent | authoritative_indirect_evidence | none | **approve** | Own domain live; company-specific ATS listing | none |
| 25 | Element Materials Technology | cc-element-materials-technology | Dubai; Abu Dhabi | live | live, own domain | Global Element Group | authoritative_indirect_evidence | none | **approve** | Own domain and /careers both live | none |
| 26 | Independent Food Company | cc-independent-food-company | Dubai | **HTTP 526 (invalid SSL)** | **DNS failure** | Independent, multi-brand (SALT, Parker's, etc.) | insufficient_evidence | none | **hold_manual_review** | Both recorded official sources are technically broken this pass | **Must be removed from both `uae.csv` and `master-company-registry.csv` pending resolution** |
| 27 | Al Ghurair Group | cc-al-ghurair-group | Dubai | live | **stored URL broken (DNS failure); working alternative directly confirmed this pass** | Independent, family-owned conglomerate | direct_official_evidence | none | **correct_then_approve** | Real, well-established employer; the recorded careers subdomain does not exist, but al-ghurair.com/en/careers works and was directly confirmed | `official_careers_url`: `https://careers.alghurair.com/` → `https://al-ghurair.com/en/careers` (confirmed HTTP 200 this pass, links to an Oracle Cloud recruitment system) |
| 28 | Fruitful Day | cc-fruitful-day | Dubai | 403 this pass (Cloudflare), not contradicted | 403 this pass, not contradicted | Independent | authoritative_indirect_evidence | none | **approve** | Specific Dubai Investments Park address and confirmed opening from round 6 | none |
| 29 | Azizi Developments | cc-azizi-developments | Dubai | live (429 rate-limited this pass, transient) | **third-party (HireHabibi)** | Independent | authoritative_indirect_evidence | none | **correct_then_approve** | Identity beyond doubt (1,200+ staff); careers field wrongly recorded an aggregator link as "official" | Clear `official_careers_url`; downgrade `careers_page_status`/`automation_eligibility` to `not_verified`/`unknown` until Azizi's own careers page is located |
| 30 | Sun Power-Gen | cc-sun-power-gen | Dubai; Abu Dhabi | 406 this pass (WAF), not contradicted | 406 this pass, not contradicted | Part of SuperTech Group | authoritative_indirect_evidence | none | **approve** | Named Jebel Ali + Abu Dhabi addresses confirmed in round 6 | none |
| 31 | Salayel Hospitality | cc-salayel-hospitality | Abu Dhabi | live | live, own subdomain | Independent, Emirati-owned | authoritative_indirect_evidence | none | **approve** | Own domain and careers subdomain both live; dedicated Abu Dhabi location page | none |
| 32 | ADM | cc-adm | Dubai | **live but contradicts the Dubai claim** | live, own domain, no Dubai content | Archer Daniels Midland Company | **contradicted** | none | **hold_manual_review** | Own official careers page shows only broad "EMEA" regional hiring, no Dubai-specific office/entity/listing — does not corroborate round 6's Dubai claim | **Must be removed from both `uae.csv` and `master-company-registry.csv` pending resolution** |
| 33 | Al Masaood Energy | cc-al-masaood-energy | Abu Dhabi | live | live, own domain | Al Masaood Group | authoritative_indirect_evidence | none | **approve** | Own domain and /careers/ both live; Abu Dhabi HQ since 1971 | none |
| 34 | Accor | cc-accor | Dubai | live | **directly confirmed live this pass**, 85+ named UAE properties | Accor S.A. group | direct_official_evidence | none | **approve** | Directly fetched: named Dubai/Abu Dhabi properties, "17,740+ Heartists across the UAE" | none |
| 35 | Jumeirah Group | cc-jumeirah-group | Dubai | live | **directly confirmed live this pass** | Emirati state-owned; distinct from Hilton/Accor/Rotana | direct_official_evidence | none | **approve** | Directly fetched: "our corporate office in Dubai" explicitly stated | none |
| 36 | Keolis-MHI | cc-keolis-mhi | Dubai | live | live (same domain) | Keolis / Mitsubishi Heavy Industries consortium; RTA holds infrastructure, Keolis-MHI holds the operating contract | authoritative_indirect_evidence | none | **approve** | Unambiguous identity as Dubai Metro/Tram operator | none |
| 37 | D4 Insight | cc-d4-insight | Dubai; Abu Dhabi | live | live (same domain) | Independent | authoritative_indirect_evidence | none | **approve** | Own domain live; specific Business Bay address and 34 open roles confirmed in round 6 | none |
| 38 | Vega Worldwide Logistics | cc-vega-worldwide-logistics | Dubai | live | **third-party (GulfTalent)** | Independent | authoritative_indirect_evidence | none | **correct_then_approve** | Real employer, specific Dubai address confirmed; careers field wrongly recorded a job-board link as "official" | Clear `official_careers_url`; downgrade `careers_page_status`/`automation_eligibility` to `not_verified`/`unknown` until an owned-domain source is found |
| 39 | Ali & Sons Holding | cc-ali-and-sons-holding | Abu Dhabi; Dubai | live | live, own domain | Independent, family-owned conglomerate | authoritative_indirect_evidence | none | **approve** | Own domain and /en/careers both live | none |
| 40 | Humai | cc-humai | Dubai | live | live (same domain) | Independent | authoritative_indirect_evidence | none | **approve** | Own domain and /about both live; Dubai-founded 2025, visa sponsorship confirmed | none |
| 41 | Jannah Hotels & Resorts | cc-jannah-hotels-resorts | Abu Dhabi; Dubai | live | live, own domain | Independent hospitality brand | authoritative_indirect_evidence | none | **approve** | Own domain and /careers/ both live; confirmed genuine Abu Dhabi + Dubai properties | none |
| 42 | Lestars Management Consultancy | cc-lestars-management-consultancy | Dubai | **domain does not exist (DNS: non-existent)** | LinkedIn only | Unconfirmed | insufficient_evidence | none | **hold_manual_review** | Stored official website is a fabricated/dead domain; only "evidence" is a bare LinkedIn page, explicitly disallowed as sufficient verification | **Must be removed from both `uae.csv` and `master-company-registry.csv` pending resolution** |
| 43 | Talabat | cc-talabat | Dubai; Abu Dhabi | live | live (corporate subdomain) | Delivery Hero group | authoritative_indirect_evidence | legitimate_separate_subsidiary (new UAE target_country pair, same ID as existing Qatar/Kuwait rows) | **approve** | Unambiguous major operator; correctly reuses the existing canonical ID under a distinct market pair | none |
| 44 | Max Accelerate Technology Group | cc-max-accelerate-technology-group | Dubai | live | live (dedicated Workable instance) | Independent | authoritative_indirect_evidence | none | **approve** | Own domain live; company-specific ATS listing | none |
| 45 | Janus Digital | cc-janus-digital | Dubai | live | live (dedicated Workable instance) | Independent; correctly disambiguated from 3 unrelated same-named "Janus" entities | authoritative_indirect_evidence | none | **approve** | Own domain live; company-specific ATS listing | none |
| 46 | Datamaze AI | cc-datamaze-ai | Dubai | live | live, own domain | Independent | authoritative_indirect_evidence | none | **approve** | Own domain and /careers both live | none |
| 47 | Osome | cc-osome | Dubai | live | live (same domain) | Global Osome group | authoritative_indirect_evidence | none | **approve** | Own domain live; dedicated Dubai office opening independently reported | none |
| 48 | BRAU | cc-brau | Dubai; Abu Dhabi | live | **directly confirmed live this pass, 5 open roles** | Independent | direct_official_evidence | none | **correct_then_approve** | Careers page directly fetched confirms real, currently-open Dubai + Abu Dhabi positions — stronger evidence than originally recorded | `careers_page_status`: `careers_page_found` → `active_with_open_jobs`; `current_open_jobs_detected`: `unknown` → `yes_current` |

## 4. Source-catalog audit (3 rows)

| Source | Official domain | UAE relevance | True-employer transparency | Original-source linking | Duplicate/expiry risk | Public access | Classification verdict | Ingestion eligibility | Final recommendation |
|---|---|---|---|---|---|---|---|---|---|
| TXM Solutions | txmmanpowersolutions.ae — **live (200), directly confirmed this pass** | Dubai office confirmed | N/A — recruitment agency (client placements, not itself an employer of note in this registry) | Not assessed (ToS/robots not reviewed) | Not assessed | Open | recruitment_agency (correct) | discovery_only (correctly conservative — no ToS/robots/technical review performed) | **approve_in_source_catalog** |
| Nameless Ventures | nameless-ventures.io — **live (200), directly confirmed this pass** | Dubai HQ confirmed | N/A — tech recruitment/talent-venture-building firm | Not assessed | Not assessed | Open | recruitment_agency (correct) | discovery_only (correctly conservative) | **approve_in_source_catalog** |
| TREVEX | trevex.io/en-ae — **live (200), directly confirmed this pass** | Dubai HQ, UAE-wide business directory | N/A — a company-verification directory, not a jobs board | Not assessed | Not assessed | Open | general_business_directory (correct — explicitly not a job source) | discovery_only (correctly conservative) | **approve_in_source_catalog** |

**No source was approved for automated ingestion** — none received a ToS, robots.txt, access-control, or technical-feasibility review this round, consistent with the round-6 report's own honest "discovery_only" classification. All three domains were freshly confirmed live and reachable this pass, and none show signs of employer misattribution (they are correctly excluded from `uae.csv` as intermediaries/directories, not miscategorized as employers).

## 5. Special-case conclusions (task §3)

**A. ADM / Archer Daniels Midland.** The observed "ADM" genuinely is Archer Daniels Midland (confirmed via its own official careers.mheducation-style domain, adm.com — a huge, unambiguous global agribusiness, no other "ADM" candidate is plausible). However, ADM's own official careers page, directly fetched this pass, shows **no Dubai-specific office, entity, or job listing** — only a generic "Europe, Middle East, and Africa" regional bucket. The canonical ID `cc-adm` does not conflict with any other ADM entity in the registry (checked — unique). **Recommendation: hold_manual_review.** The Dubai-tagged roles round 6 found (Senior Scientist, Lab Technician - Beverage Applications) came from third-party job-board listings, not ADM's own site, and this pass's direct check could not corroborate them — a genuinely unresolved material link, exactly the scenario the task instructed to hold rather than approve.

**B. Park Hyatt Dubai / Hyatt.** This should **not remain a separate, standalone property-level employer record on its current evidence**. The stored careers source (hcareers.com) is a third-party hospitality job board, not Hyatt's own system, and shows zero current openings. Whether recruitment is controlled by the property or by Hyatt corporate (careers.hyatt.com, blocked to direct fetch this pass) is unresolved. This is not a duplicate of an existing Hyatt Hotels group record (no such group record exists in `uae.csv`), so the finding is not "remove as duplicate" — it is "the evidence for this specific record is currently too weak to stand on its own." **Recommendation: hold_manual_review**, pending either (a) a direct fetch of careers.hyatt.com confirming property-specific hiring, or (b) a decision to represent Hyatt at the group level instead (mirroring the Accor/Jumeirah treatment) once its recruitment structure is actually confirmed.

**C. Hilton, Accor, Jumeirah, Ounass, Al Ghurair, AMANA (GMG was not among the 48).** All six are confirmed as legitimate parent/group-level or company-level records, not duplicative of each other or of anything already in the registry: Hilton, Accor, and Jumeirah are three genuinely distinct hospitality corporations (Hilton Worldwide, Accor S.A., and Dubai's own state-owned Jumeirah — not subsidiaries of one another, and Accor's own careers portal shows hiring is coordinated at group level across dozens of individually-branded properties, which is why a single group-level Accor record — not per-property records — is the correct and non-duplicative representation). Ounass is correctly represented as a specific subsidiary brand (Al Tayer Group parent, well-corroborated, not itself already a separate registry entry). Al Ghurair and AMANA are both correctly represented as their own independent, family-owned/founder-owned groups with genuine group-level careers portals — no existing canonical record already represents either hiring channel.

**D. BRAU.** Confirmed as its own genuine, substantial brand: "BRAU | Premium Brow Bar & Semi-Permanent Makeup Studio," directly fetched at brau.ae and career.brau.ae, with **5 real currently-open positions** and confirmed Dubai (Head Office, Jumeirah, Springs Souk) and Abu Dhabi locations. No identity collision with any unrelated "BRAU" company was found in this or prior rounds. **Recommendation: correct_then_approve** — the record itself is sound; only its `careers_page_status`/`current_open_jobs_detected` fields understate the now-directly-confirmed evidence and should be upgraded.

**E. Slicit / SlicitOfficial.** Canonical name and spelling ("Slicit") and official domain (slicit.com) are confirmed. UAE market focus is extensively referenced on-site (Dubai Gold Visa program, positioning within the UAE innovation ecosystem). However, **no UAE physical presence, legal entity name, or registration was disclosed on the company's own domain across two separate direct fetches** — the only source for a specific registered address was an unverified WebSearch snippet, never independently confirmed, and per the task's explicit instruction this is not sufficient (no LinkedIn/social-only verification was used, but the physical-presence bar was still not met by direct official evidence). **Recommendation: hold_manual_review.**

**F. Regulated financial/crypto companies.** Sarwa is the strongest case in the entire batch — its UAE regulatory identity was directly confirmed via ADGM's own public FSRA register (Active License 190037), not a marketing claim. OKX's VARA VASP license is corroborated by the regulator's own prior press coverage (found in round 6, not re-fetched this pass since the VARA licensed-VASPs list page 404'd) — regulation is not "confirmed from company marketing claims alone" here, but the specific careers URL is dead and needs correction. CFI Financial Group's specific CMA license number was previously read directly from its own domain (this pass's re-fetch was blocked, not contradicted). Revolut and ClearGrid/Qashio's evidence rests on strong multi-source identity corroboration rather than a specific regulator register hit — flagged honestly as `authoritative_indirect_evidence`, not overstated as regulator-confirmed. None of the 48 relies on a broker's own marketing page as the sole regulatory proof.

**G. Remote/global technology companies.** Confirmed: **none of GitLab, Cohere, ElevenLabs, Nebius, Kraken, or Mintlayer are among the 48** (all six were correctly held at `needs_manual_review` in round 6 for lacking a confirmed physical UAE office, and remain outside `uae.csv` entirely). This audit re-confirms their continued absence programmatically.

## 6. Duplication audit results

Checked all 48 against: the prior 106 UAE rows, each other, the full 403-row master registry, and the round-6 held/source-catalog candidates. **Zero duplicates found** by canonical ID, normalized name, alias, official domain, careers/ATS domain, or LinkedIn company URL. The only cross-market ID reuse (`cc-talabat`, shared with existing Qatar and Kuwait rows) is a `legitimate_separate_subsidiary`-equivalent case — the same brand operating as a distinct, separately-evidenced entity per market, an intentional and pre-existing registry convention, not an error.

## 7. Field-quality audit results

- No annotation text, spaces, or stray parentheses found inside any URL field across the 48 (mechanically verified).
- No personal `linkedin.com/in/` URL anywhere in the 48 (all stored as `not_verified`, per round-6 policy of not researching LinkedIn).
- All `target_city` values are valid Dubai/Abu-Dhabi-only combinations — no Sharjah/RAK/Al-Ain-only value slipped through.
- All industry and company_type values use free-text/documented conventions consistent with the rest of the registry — no invalid enum values found.
- No unsupported "active job" or "internship/graduate program" claim was found beyond the one correction identified for BRAU (§3, #48), which under-claimed rather than over-claimed.
- The one systemic field-quality issue found: **6 rows recorded a generic third-party job aggregator (GulfTalent ×2, Indeed, HireHabibi) as `official_careers_url`**, which should never be presented as an "official" source — corrected in §3 (DarGlobal, CHANEL, Azizi Developments, Vega Worldwide Logistics — 4 of the 8 `correct_then_approve` rows; the other 4 `correct_then_approve` rows are the Al Ghurair broken-DNS fix, the Amazon/OKX stale-path fixes, and BRAU's status upgrade).

## 8. Reconciled totals

| | Count |
|---|---|
| Approved unchanged | **35** |
| Correct then approve | **8** |
| Hold (must be removed pending resolution) | **5** |
| Duplicate removal | **0** |
| Geographic-ineligibility removal | **0** |
| Unsafe rejection | **0** |
| **Total audited** | **48** ✓ |
| **Final round-6 promotable employer count** (approve + correct_then_approve, once corrections are applied) | **43** |
| **Expected `uae.csv` count after corrections** (106 + 43) | **149** |
| **Expected `master-company-registry.csv` count after corrections** (355 + 43) | **398** |
| **Approved source-catalog count** | **3 / 3** |

## 9. Exact corrections/removals proposed (for the next, separate apply step — not executed here)

**Remove from both `uae.csv` and `master-company-registry.csv` (5):** `cc-park-hyatt-dubai`, `cc-slicit`, `cc-independent-food-company`, `cc-adm`, `cc-lestars-management-consultancy`.

**Field corrections (8, all remain in both files):**
- `cc-darglobal`: clear `official_careers_url` (was a GulfTalent link); downgrade `careers_page_status`/`automation_eligibility` to `not_verified`/`unknown`.
- `cc-amazon-uae`: `official_careers_url` → `https://www.amazon.jobs/en/`.
- `cc-okx`: clear `official_careers_url` (was dead); downgrade `careers_page_status`/`automation_eligibility` to `not_verified`/`unknown`.
- `cc-chanel-uae`: clear `official_careers_url` (was an Indeed link); downgrade `careers_page_status`/`automation_eligibility` to `not_verified`/`unknown`.
- `cc-al-ghurair-group`: `official_careers_url` → `https://al-ghurair.com/en/careers`.
- `cc-azizi-developments`: clear `official_careers_url` (was a HireHabibi link); downgrade `careers_page_status`/`automation_eligibility` to `not_verified`/`unknown`.
- `cc-vega-worldwide-logistics`: clear `official_careers_url` (was a GulfTalent link); downgrade `careers_page_status`/`automation_eligibility` to `not_verified`/`unknown`.
- `cc-brau`: `careers_page_status` → `active_with_open_jobs`; `current_open_jobs_detected` → `yes_current`.

## 10. File created

- `docs/job-source-discovery/pilots/apify-uae/reconciliation/uae-round7-round6-audit-report.md` (this file) — the only file created or modified this round.

## 11. Confirmation all data files remained unchanged

Verified via `git status`/`git diff` at the end of this audit: `uae.csv`, `master-company-registry.csv`, `source-catalog.csv`, all staging/manifest/dry-run/manual-review-queue files, all other country registries, and `AGENTS.md` show **no new changes** from this audit session (the pre-existing round-1-through-6 diffs remain exactly as they were; `AGENTS.md`'s pre-existing unrelated diff remains untouched and unstaged). No `git add`, `commit`, or `push` was run. No Apify calls were made.

## 12. Final verdict

**READY_TO_APPLY_CORRECTIONS** — 35 of the 48 round-6 employer records are fully sound and approved unchanged; 8 require a specific, already-identified field correction; 5 must be removed from both `uae.csv` and `master-company-registry.csv` pending further resolution (evidence gaps this audit found, not previously caught). All 3 round-6 source-catalog additions are confirmed correctly classified and remain live. No corrections were applied in this step — audit only, as scoped.
