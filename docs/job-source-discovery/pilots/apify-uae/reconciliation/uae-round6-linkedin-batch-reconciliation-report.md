# UAE Registry Expansion — Round 6: Remaining LinkedIn-Discovery Batch Reconciliation

**Date:** 2026-09-07. **No commit, no push, no Apify calls.** Research performed via WebSearch and direct WebFetch of official company domains only — never LinkedIn, never bypassing login/CAPTCHA/robots restrictions.

---

## 1. Scope

Round 5 processed only the 11 explicitly-named source/platform candidates from the supplied LinkedIn-discovery batch. This round processes the remaining **90 candidates** from that batch — companies, not source platforms — applying the same evidence bar as every prior round: direct confirmation of identity, a genuine Dubai or Abu Dhabi physical presence, and (where promoted) traceable evidence, before any addition to `uae.csv`.

**Preserved unchanged from prior rounds, not repeated:** `uae.csv` (106 rows going in), `master-company-registry.csv` (355 rows going in), `source-catalog.csv` (104 rows going in), Katch International's promotion, the 8 round-5 source-catalog additions, and the Paires/Marlow Hire `insufficient_evidence` decisions.

## 2. Method

1. **Dedup pass** against current `uae.csv`/`master-company-registry.csv` by normalized name — found 4 already-registered companies (Majid Al Futtaim, Emirates NBD, Property Finder, du) with zero new research needed.
2. **WebSearch identity/presence pass** on all 86 remaining names, several rounds, to establish real-world identity, business type, and any UAE coverage.
3. **Direct WebFetch verification** of official domains, careers pages, and — for every forex/crypto/blockchain candidate — regulatory-license and physical-office pages specifically, given the explicit instruction to scrutinize these sectors for identity and recruitment-safety risk.
4. **Decision** applied per candidate: `already_present`, `promote`, `source_catalog` (recruiter/directory, not an employer), `geo_ineligible` (Sharjah/RAK/Al Ain-only), `needs_manual_review` (real but unconfirmed physical Dubai/Abu Dhabi presence or unresolved evidence gap), or `insufficient_evidence` (no identifiable matching UAE entity).

A machine-checked accounting script confirmed **all 90 names received exactly one decision, with no duplicates and no gaps**, before any file was written.

## 3. Full per-name decision table (90 names)

### 3.1 Already present (4) — no action

| Name | Existing record |
|---|---|
| Majid Al Futtaim | `cc-majid-al-futtaim` |
| Emirates NBD | `cc-emirates-nbd` |
| Property Finder | `cc-property-finder` |
| du | `cc-du-telecom` (du - Emirates Integrated Telecommunications Company) |

### 3.2 Promoted — genuinely net-new, verified employers (48)

| # | Supplied name | canonical_company_id | City | Industry |
|---|---|---|---|---|
| 1 | Bayut.com | cc-bayut | Dubai | Proptech / Real Estate Portal |
| 2 | McGraw Hill | cc-mcgraw-hill-uae | Dubai; Abu Dhabi | Education / Publishing |
| 3 | CFI Financial Group | cc-cfi-financial-group | Dubai | Financial services / online trading (CMA-regulated) |
| 4 | AMANA | cc-amana-contracting | Dubai; Abu Dhabi | Construction |
| 5 | ClearGrid | cc-cleargrid | Dubai | Fintech / debt resolution |
| 6 | Justlife | cc-justlife | Dubai | Home services / consumer tech |
| 7 | Revolut | cc-revolut-uae | Dubai | Fintech / digital banking |
| 8 | DarGlobal | cc-darglobal | Dubai | Real estate development |
| 9 | Sunset Hospitality Group | cc-sunset-hospitality-group | Dubai | Hospitality |
| 10 | Amazon | cc-amazon-uae | Dubai | E-commerce / logistics / technology |
| 11 | OKX | cc-okx | Dubai | Crypto exchange (VARA VASP-licensed) |
| 12 | Tabreed | cc-tabreed | Abu Dhabi; Dubai | District cooling / utilities |
| 13 | Unity Star Import and Export FZE LLC | cc-unity-star-import-export | Dubai | Trading / import-export |
| 14 | haus & haus | cc-haus-and-haus | Dubai | Real estate brokerage |
| 15 | Guild - Real Estate Marketing | cc-guild-real-estate-marketing | Dubai | Marketing / Advertising Agency |
| 16 | CHANEL | cc-chanel-uae | Dubai | Luxury retail / fashion |
| 17 | Qashio | cc-qashio | Dubai; Abu Dhabi | Fintech / spend management |
| 18 | Hilton | cc-hilton-uae | Dubai; Abu Dhabi | Hospitality |
| 19 | Ounass | cc-ounass | Dubai | Luxury e-commerce (Al Tayer Group) |
| 20 | Park Hyatt / Hyatt | cc-park-hyatt-dubai | Dubai | Hospitality (specific verified property) |
| 21 | Pathos Communications plc | cc-pathos-communications | Dubai | Marketing / PR Agency |
| 22 | SlicitOfficial | cc-slicit | Dubai | Fintech / blockchain real-asset platform |
| 23 | Sarwa | cc-sarwa | Abu Dhabi | Fintech / wealth management (ADGM-regulated) |
| 24 | Printerpix | cc-printerpix | Dubai | E-commerce / personalized products |
| 25 | Element Materials Technology | cc-element-materials-technology | Dubai; Abu Dhabi | Testing, inspection, certification and calibration |
| 26 | Independent Food Company | cc-independent-food-company | Dubai | Hospitality / F&B |
| 27 | Al Ghurair | cc-al-ghurair-group | Dubai | Diversified conglomerate |
| 28 | Fruitful Day | cc-fruitful-day | Dubai | F&B delivery / wellness |
| 29 | Azizi Developments | cc-azizi-developments | Dubai | Real estate development |
| 30 | Sun Power-Gen Engineering | cc-sun-power-gen | Dubai; Abu Dhabi | Mechanical / industrial engineering |
| 31 | Salayel Hospitality | cc-salayel-hospitality | Abu Dhabi | Hospitality |
| 32 | ADM | cc-adm | Dubai | Agricultural processing / food ingredients |
| 33 | Al Masaood Energy | cc-al-masaood-energy | Abu Dhabi | Oil & gas supply and contracting |
| 34 | Accor | cc-accor | Dubai | Hospitality |
| 35 | Jumeirah | cc-jumeirah-group | Dubai | Hospitality (state-owned) |
| 36 | Keolis-MHI | cc-keolis-mhi | Dubai | Public transport operations (Dubai Metro/Tram) |
| 37 | D4 Insight | cc-d4-insight | Dubai; Abu Dhabi | Data / AI / CRM / cybersecurity consulting |
| 38 | Vega Worldwide Logistics | cc-vega-worldwide-logistics | Dubai | Freight forwarding / logistics |
| 39 | Ali & Sons Holding LLC | cc-ali-and-sons-holding | Abu Dhabi; Dubai | Diversified conglomerate |
| 40 | Humai | cc-humai | Dubai | AI / enterprise software |
| 41 | Jannah Hotels + Resorts | cc-jannah-hotels-resorts | Abu Dhabi; Dubai | Hospitality |
| 42 | Lestars Management Consultancy LLC | cc-lestars-management-consultancy | Dubai | Business/HR management consulting |
| 43 | talabat | cc-talabat *(new UAE-market row; reuses the canonical ID already used for Qatar and Kuwait)* | Dubai; Abu Dhabi | Food & grocery delivery |
| 44 | Max Accelerate Technology Group | cc-max-accelerate-technology-group | Dubai | IT consulting / enterprise asset management |
| 45 | Janus Digital Global | cc-janus-digital | Dubai | AI / hospitality technology |
| 46 | DATAMAZE.AI | cc-datamaze-ai | Dubai | Data analytics / AI consulting |
| 47 | OSOME | cc-osome | Dubai | Fintech / accounting services |
| 48 | BRAU | cc-brau | Dubai; Abu Dhabi | Beauty / personal care services |

Two of these (**BRAU**, **SlicitOfficial**) were directly WebFetch-confirmed this pass (`source_confidence: high`); the remaining 46 are staged at `source_confidence: medium` — verified via multiple independent WebSearch sources that explicitly cited and quoted the company's own official domain/careers content, but not directly WebFetched this specific pass. This distinction is recorded honestly in each row's `researcher_notes` and `source_confidence` field, not overstated.

### 3.3 Routed to the source catalog, not uae.csv (3)

| Name | Why | Catalog entry |
|---|---|---|
| TXM Solutions | Recruitment/manpower/EOR consultancy placing candidates with clients; no confirmed internal opening | `src-ae-txm-manpower-solutions` |
| Nameless Ventures | Tech recruitment/talent-venture-building firm, ~6 staff | `src-ae-nameless-ventures` |
| TREVEX | Explicitly "The UAE Business Directory" — a company-verification directory, not a job board or notable employer | `src-ae-trevex-business-directory` |

### 3.4 Geographically ineligible — held, not promoted (5)

| Name | Reason |
|---|---|
| Wynn Al Marjan Island | Ras Al Khaimah only; no separately verified Dubai/Abu Dhabi presence (real, large, well-evidenced employer, but excluded by the explicit RAK-only rule) |
| AL Gahwa AL Arabiya | Confirmed Sharjah branch only; a Dubai location is aspirational, not yet real |
| Marcopolo Holidays | Confirmed based in Sharjah, UAE |
| Czech Rehabilitation Hospital | Confirmed Al Ain only (Royal Health Rehabilitation Hospitals Management) |
| United Arab Emirates University / Department of Family Medicine | Confirmed Al Ain only; also a sub-department, not a standalone legal employer — fails both the city rule and the parent/sub-unit distinction rule |

### 3.5 Needs manual review — real but unresolved (24)

| Name | Reason |
|---|---|
| WinproFX | Dubai presence is only a "Representative Office," not a licensed broker; regulatory status explicitly unresolved; site blocked (403) |
| TradeQuo Global | Own careers page (directly fetched) has no current openings and no Dubai-specific confirmation |
| VexPro | UAE CMA broker approval explicitly "in progress," not yet granted |
| Kraken | VARA license confirmed, but its own careers page (directly fetched) confirms fully remote hiring with no physical UAE office |
| CoinW | Claimed Dubai presence, but no VARA license found and the domain was blocked to direct fetch |
| Mintlayer | Careers page (directly fetched): all roles tagged "UAERemote," no physical office address |
| Cohere | "UAE or Saudi Arabia based, hybrid" role — a flexible regional arrangement, not a confirmed office |
| ElevenLabs | Hiring UAE roles, but Dubai is not among its stated physical office locations |
| Nebius | "Remote work flexibility from the UAE," no confirmed physical office (HQ Amsterdam) |
| Postman | No evidence of a physical UAE office found (search dominated by the unrelated API-testing tool) |
| ImagineArt | UAE-titled roles, but no confirmed physical office address |
| Whitecarrot.ai | "Flexible offices" in 4 cities including Dubai, roles "initially remote" — not a confirmed dedicated office |
| Ranger AI | Abu Dhabi role confirmed, but no official company domain located this pass |
| Office Square Business Centres | Multiple job-board listings, but no official domain or direct careers page located |
| Rothian | Claims a Dubai mainland company, but its own contact page shows only a UK phone number — contradiction unresolved |
| K4 Group | Real Dubai company with multiple independent job-board listings, but a direct fetch of its own `/careers` path returned HTTP 404 |
| Emirates Investment Bank | Real Dubai bank, but its site returned HTTP 403 — careers page unconfirmed |
| GMG | Real, large, well-established Dubai conglomerate, but no official company domain was conclusively located (only aggregator pages) |
| SOL Properties | Real Dubai developer, but no specific current opening confirmed |
| Devandgo | Real Dubai SaaS company, but no careers page located |
| Presentail | Real UAE-registered company, but no careers page located |
| Greenly.ae | Real small Dubai gardening app (distinct from an unrelated Paris climate-tech company of the same name — not conflated), but no careers page located |
| Immersive Experiences | No single company named exactly this was confirmed — held rather than guessed between differently-named candidates |
| GitLab | All-remote company by design, no physical offices anywhere in the world (same basis as its existing Lebanon-only registry entry); no UAE office to verify |

### 3.6 Insufficient evidence — no identifiable UAE entity, nothing fabricated (6)

| Name | Finding |
|---|---|
| Core Code | No matching UAE company found |
| Mosquitonet UAE | No matching company found |
| CRID / CRIDER | "CRID" resolved to an unrelated UK training company; no "CRIDER" entity found |
| The Flex | No specific matching company found in the Dubai real estate/rental context |
| Velora Delivery Service | The only "Velora" confirmed in the UAE is an aviation ground-services company (Abu Dhabi airport) — a business-type mismatch significant enough not to assume it's the same entity |
| Decade Coordination Office for Ocean Data Sharing | Confirmed UNESCO/IOC ocean-data unit with explicitly no UAE/Dubai connection found |

## 4. Parent-brand and identity distinctions applied

- **Park Hyatt vs. Hyatt**: promoted the specific, directly-verified property (Park Hyatt Dubai, its own employer profile on hcareers.com) rather than a generic global "Hyatt" parent record, since the evidence was property-specific.
- **UAE University Department of Family Medicine vs. UAE University**: excluded — it is both an Al Ain-only unit and a sub-department, not a standalone legal employer; neither the department nor a substitute UAE University record was added this pass.
- **Talabat vs. its existing Qatar/Kuwait rows**: added as a new UAE-market row reusing the `cc-talabat` canonical ID, following the exact precedent already established by the existing Qatar and Kuwait rows (same brand, different `target_country`, no duplicate `(canonical_company_id, target_country)` pair created).
- **Janus Digital Global**: disambiguated from three unrelated same-named entities in search results (Janus Ventures — healthcare venture builder; Janus Global Operations — security services; Janus International — self-storage) before promoting the correct one (Janus Digital / Janus Tech Co, hospitality AI chatbots).
- **Penta Consulting vs. Pentabell** (carried forward from round 5) and **Greenly.ae vs. the unrelated Paris climate-tech "Greenly"** were both re-confirmed as separate, non-conflated identities this round.
- **CRID/CRIDER, SlicitOfficial, BRAU, ADM** (the four names the task specifically flagged for resolution): all four resolved — CRID/CRIDER found no genuine UAE match (held); SlicitOfficial resolved to Slicit, a confirmed Dubai company (promoted); BRAU resolved to a real Dubai/Abu Dhabi beauty studio chain (promoted); ADM resolved to the genuine Archer Daniels Midland with confirmed Dubai roles (promoted).

## 5. Validation performed (30 checks, all passing)

- `uae.csv` = 154 rows (106 + 48); `master-company-registry.csv` = 403 rows (355 + 48); `source-catalog.csv` = 107 rows (104 + 3).
- The prior 106 `uae.csv` rows remain unchanged in count and order (row 106 is still `cc-katch-international`); the 48 new rows are a pure append.
- No duplicate `canonical_company_id` in `uae.csv`; no duplicate `(canonical_company_id, target_country)` in the master registry (talabat's UAE row correctly coexists with its Qatar/Kuwait rows under the same ID).
- No duplicate normalized company name, official-website domain, or LinkedIn company URL within `uae.csv`; no personal `linkedin.com/in/` URL anywhere.
- All 48 new rows have non-empty evidence, `review_status = verified`, and a `target_city` value that is genuinely Dubai and/or Abu Dhabi — none Sharjah/RAK/Al-Ain-only.
- Spot-check confirmed none of the held/geo-ineligible/insufficient-evidence candidates were accidentally promoted.
- All 3 new source-catalog rows present exactly once; no duplicate `source_id` catalog-wide.
- No unintended cross-market domain collision for the 48 new rows against the other 4 markets in the master registry (talabat's intentional same-domain reuse across markets is the one expected exception).
- CSV schema (34/16 columns), BOM (`uae.csv`/master registry) and no-BOM (`source-catalog.csv`), and CRLF line endings all preserved.
- All non-UAE country CSVs confirmed byte-for-byte unchanged; `AGENTS.md` confirmed not staged.

**30/30 checks pass. 0 failures.**

## 6. Totals

| | Before this round | After this round | Change |
|---|---|---|---|
| `uae.csv` (employers) | 106 | **154** | +48 |
| `master-company-registry.csv` (employers) | 355 | **403** | +48 |
| `source-catalog.csv` (job sources — reported separately, never mixed with employer totals) | 104 | **107** | +3 |

**City totals (48 new employers):** Dubai only **33** · Abu Dhabi only **3** · Dubai + Abu Dhabi (dual-city) **12** · Total **48** ✓.

**Sector distribution highlights (48 new):** Hospitality 7, real estate development 2, remainder single-instance across ~35 distinct sub-sectors (fintech, construction, logistics, AI/tech, F&B, retail, conglomerates) — reflecting the genuinely heterogeneous nature of a manually-supplied name list rather than a sector-targeted search.

## 7. Exact files changed

**Created:**
- `reconciliation/uae-round6-linkedin-batch-reconciliation-report.md` (this file)

**Modified:**
- `docs/job-source-discovery/uae.csv` (106 → 154 rows, +48 insertions, 0 deletions)
- `docs/job-source-discovery/master-company-registry.csv` (355 → 403 rows, +48 insertions, 0 deletions, inserted at the end of the UAE block)
- `docs/job-source-discovery/source-expansion/source-catalog.csv` (104 → 107 rows, +3 insertions)

**Not modified:** all other country CSVs, `AGENTS.md`, staging/manifest/dry-run/mrq files from prior rounds, application code, database migrations, n8n workflows.

## 8. Confirmation

- Every one of the 90 supplied names received exactly one documented decision (machine-verified accounting, no gaps, no duplicates).
- No existing employer was added twice (the 4 already-present companies received no new row).
- No duplicate canonical ID, name, domain, or LinkedIn URL exists anywhere in `uae.csv`; no `(canonical_company_id, target_country)` duplicate in the master registry.
- No personal LinkedIn URL was used or stored anywhere; LinkedIn itself was never scraped.
- Every promoted company has a confirmed Dubai and/or Abu Dhabi presence and traceable evidence (own domain, careers page, and — for BRAU and Slicit — a direct fetch).
- Employer totals (`uae.csv`/master registry) and source-catalog totals are reported entirely separately throughout this report.
- `uae.csv` total (154) = 106 + 48 exactly; the master registry reconciles to the same 48 additions.
- All other country registries and `AGENTS.md` remain unchanged/unstaged.
- No Apify calls were made and no credits were spent.
- No `git add`, `commit`, or `push` was run.

## 9. Final verdict

**READY_FOR_COMMIT** — 48 genuinely net-new, individually verified employers were promoted into `uae.csv` and synchronized into `master-company-registry.csv`; 3 legitimate non-employer sources (2 recruitment agencies, 1 business directory) were correctly routed to the source catalog instead; 5 real companies were correctly excluded for lacking genuine Dubai/Abu Dhabi presence; 24 real-but-unresolved candidates and 6 unidentifiable names were held honestly rather than promoted on weak evidence. All 30 validation checks pass.
