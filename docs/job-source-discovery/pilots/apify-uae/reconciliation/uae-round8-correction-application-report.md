# UAE Registry Expansion — Round 8: Round-7 Audit Corrections Applied

**Date:** 2026-09-07. **No commit, no push, no Apify calls.** All 8 documented corrections and all 5 documented holds were applied exactly as specified in `uae-round7-round6-audit-report.md` — nothing improvised beyond it.

---

## 1. Baseline confirmed before any change

| | Confirmed value |
|---|---|
| `uae.csv` | 154 rows |
| `master-company-registry.csv` | 403 rows |
| `source-catalog.csv` | 107 rows |
| Round-6 additions | 48 employers |
| Round-7 decisions | 35 approve + 8 correct_then_approve + 5 hold = 48 ✓ |
| Final retained round-6 employers (target) | 43 |

Baseline matched exactly; proceeded.

## 2. The 8 corrections applied — exact before/after

All applied identically to both `uae.csv` and `master-company-registry.csv`. `researcher_notes` was extended (never overwritten) with a dated `[Round-7 audit (2026-09-07): ...]` marker explaining each change; original evidence text is preserved.

| canonical_company_id | Field(s) corrected | Before | After |
|---|---|---|---|
| `cc-darglobal` | `official_careers_url`, `public_jobs_endpoint_or_feed`, `careers_page_status`, `automation_eligibility`, `proposed_access_method` | `https://www.gulftalent.com/companies/darglobal-careers` (third-party aggregator); `careers_page_found` / `suitable_public_html_subject_to_review` | `not_verified` (cleared); `careers_page_status` = `not_verified`; `automation_eligibility` = `unknown`; `proposed_access_method` = `unknown` |
| `cc-amazon-uae` | `official_careers_url`, `public_jobs_endpoint_or_feed`, `evidence_urls` | `https://www.amazon.jobs/en/locations/dubai-united-arab-emirates` (stale, HTTP 404) | `https://www.amazon.jobs/en/` (Amazon's own portal, confirmed HTTP 200) |
| `cc-okx` | `official_careers_url`, `public_jobs_endpoint_or_feed`, `careers_page_status`, `automation_eligibility`, `proposed_access_method` | `https://www.okx.com/careers` (dead, HTTP 404) | `not_verified` (cleared — no replacement invented, per instruction); `careers_page_status` = `not_verified`; `automation_eligibility` = `unknown`; `proposed_access_method` = `unknown` |
| `cc-chanel-uae` | `official_careers_url`, `public_jobs_endpoint_or_feed`, `careers_page_status`, `automation_eligibility`, `proposed_access_method` | `https://ae.indeed.com/cmp/Chanel-a88d502f/jobs/l-Dubai` (third-party aggregator) | `not_verified` (cleared); `careers_page_status` = `not_verified`; `automation_eligibility` = `unknown`; `proposed_access_method` = `unknown` |
| `cc-al-ghurair-group` | `official_careers_url`, `public_jobs_endpoint_or_feed`, `evidence_urls` | `https://careers.alghurair.com/` (DNS does not resolve) | `https://al-ghurair.com/en/careers` (confirmed HTTP 200, links to Al Ghurair's Oracle Cloud recruitment system) |
| `cc-azizi-developments` | `official_careers_url`, `public_jobs_endpoint_or_feed`, `careers_page_status`, `automation_eligibility`, `proposed_access_method` | `https://hirehabibi.com/azizi-developments-careers` (third-party aggregator) | `not_verified` (cleared); `careers_page_status` = `not_verified`; `automation_eligibility` = `unknown`; `proposed_access_method` = `unknown` |
| `cc-vega-worldwide-logistics` | `official_careers_url`, `public_jobs_endpoint_or_feed`, `careers_page_status`, `automation_eligibility`, `proposed_access_method` | `https://www.gulftalent.com/companies/vega-worldwide-logistics-careers` (third-party aggregator) | `not_verified` (cleared); `careers_page_status` = `not_verified`; `automation_eligibility` = `unknown`; `proposed_access_method` = `unknown` |
| `cc-brau` | `careers_page_status`, `current_open_jobs_detected` | `careers_page_found` / `unknown` | `active_with_open_jobs` / `yes_current` (5 real open Dubai/Abu Dhabi positions directly WebFetch-confirmed in the round-7 audit) |

**Note on the 5 "cleared" corrections:** per the instruction "if an aggregator remains useful, represent it only in the appropriate supporting-evidence/source field," the original aggregator URLs (GulfTalent ×2, Indeed, HireHabibi) were **left untouched in `evidence_urls`** for DarGlobal, CHANEL, Azizi Developments, and Vega Worldwide Logistics — removed only from the `official_careers_url`/`public_jobs_endpoint_or_feed` fields where they were incorrectly presented as an official source. `automation_eligibility` was downgraded to `unknown` for all 5 cleared rows — **no automatic-ingestion eligibility is claimed merely because a page loads**, per the explicit instruction.

## 3. The 5 companies moved to hold

Removed from both `uae.csv` and `master-company-registry.csv`; added to `enrichment/manual-review-queue.csv` with a new `li6-` (LinkedIn-batch, round 6) internal-row-id prefix, since these candidates never passed through the Apify-discovery pipeline that the existing `uae-pilot-XXXX` id scheme tracks — see §6 for why no other pilot artifact (staging/manifest/dry-run) required a change.

| canonical_company_id | Company | New `internal_row_id` in mrq | Reason (verbatim from the audit) |
|---|---|---|---|
| `cc-adm` | ADM | `li6-adm` | No verified Dubai/Abu Dhabi employer presence; the official careers evidence supports only a generic EMEA grouping. |
| `cc-park-hyatt-dubai` | Park Hyatt Dubai | `li6-park-hyatt-dubai` | Third-party evidence showing zero jobs does not support a separate property-level employer/careers record. |
| `cc-slicit` | Slicit | `li6-slicit` | Official site does not establish a legal employer identity or physical Dubai/Abu Dhabi address. |
| `cc-independent-food-company` | Independent Food Company | `li6-independent-food-company` | Both recorded sources are technically broken, with SSL/DNS failures preventing sufficient verification. |
| `cc-lestars-management-consultancy` | Lestars Management Consultancy | `li6-lestars-management-consultancy` | Recorded official domain does not exist. |

None was permanently rejected — all 5 carry `relevance_status = round7_audit_held_manual_review` in `manual-review-queue.csv`, with full original evidence, the exact audit reason, and a `batch_status` tag (`round6_linkedin_batch_round7_audit_held_2026-09-07`) tracing them back to their origin. None was silently replaced by a parent or similarly-named company (e.g. Park Hyatt Dubai was not swapped for a generic "Hyatt" record).

## 4. Source-catalog records — preserved unchanged

`source-catalog.csv` remains exactly **107 rows**. TXM Solutions, Nameless Ventures, and TREVEX were not modified. Re-confirmed this round:

| source_id | Classification | Decision (unchanged) |
|---|---|---|
| `src-ae-txm-manpower-solutions` | `recruitment_agency` | `discovery_only` |
| `src-ae-nameless-ventures` | `recruitment_agency` | `discovery_only` |
| `src-ae-trevex-business-directory` | `general_business_directory` | `discovery_only` |

No employer record was removed merely because the same organization also has a source role — this scenario did not arise this round (TXM/Nameless/TREVEX have no corresponding `uae.csv` employer row, correctly, per round 6).

## 5. Totals reconciliation

| | Value |
|---|---|
| `uae.csv` | 154 → **149** |
| `master-company-registry.csv` | 403 → **398** |
| `source-catalog.csv` | 107 (unchanged) |
| Round-6 retained companies | **43** |
| Removed to hold | **5** |
| Corrected and retained | **8** |
| Unchanged and retained | **35** |

Arithmetic verified: 35 + 8 + 5 = 48 ✓ · 35 + 8 = 43 ✓ · 154 − 5 = 149 ✓ · 403 − 5 = 398 ✓.

## 6. Why staging/manifest/dry-run were intentionally not touched

`uae-promotion-staging.csv`, `uae-promotion-staging-manifest.csv`, and `uae-promotion-dry-run.csv` (all under `pilots/apify-uae/reconciliation/`) track only the 467-candidate pool discovered by the Apify Google-Maps pipeline in rounds 1–3. None of the round-6 LinkedIn-supplied 48 (including the 5 now held) were ever part of that pool, so none of them ever had a row in those three files — there was nothing to remove or update there. Fabricating entries for them in those files would misrepresent their actual origin. Their full history instead lives in the round-6, round-7, and this round-8 markdown reports, plus their new `manual-review-queue.csv` rows (§3) — a complete, honest, and traceable record without conflating two different discovery pipelines.

## 7. Final retained round-6 company list (43)

| # | canonical_company_id | Company | City |
|---|---|---|---|
| 1 | cc-bayut | Bayut | Dubai |
| 2 | cc-mcgraw-hill-uae | McGraw Hill | Dubai; Abu Dhabi |
| 3 | cc-cfi-financial-group | CFI Financial Group | Dubai |
| 4 | cc-amana-contracting | Amana Contracting and Steel Buildings | Dubai; Abu Dhabi |
| 5 | cc-cleargrid | ClearGrid | Dubai |
| 6 | cc-justlife | Justlife | Dubai |
| 7 | cc-revolut-uae | Revolut | Dubai |
| 8 | cc-darglobal | DarGlobal | Dubai |
| 9 | cc-sunset-hospitality-group | Sunset Hospitality Group | Dubai |
| 10 | cc-amazon-uae | Amazon | Dubai |
| 11 | cc-okx | OKX | Dubai |
| 12 | cc-tabreed | Tabreed | Abu Dhabi; Dubai |
| 13 | cc-unity-star-import-export | Unity Star Import and Export FZE LLC | Dubai |
| 14 | cc-haus-and-haus | haus & haus | Dubai |
| 15 | cc-guild-real-estate-marketing | Guild | Dubai |
| 16 | cc-chanel-uae | CHANEL | Dubai |
| 17 | cc-qashio | Qashio | Dubai; Abu Dhabi |
| 18 | cc-hilton-uae | Hilton | Dubai; Abu Dhabi |
| 19 | cc-ounass | Ounass | Dubai |
| 20 | cc-pathos-communications | Pathos Communications | Dubai |
| 21 | cc-sarwa | Sarwa | Abu Dhabi |
| 22 | cc-printerpix | Printerpix | Dubai |
| 23 | cc-element-materials-technology | Element Materials Technology | Dubai; Abu Dhabi |
| 24 | cc-al-ghurair-group | Al Ghurair Group | Dubai |
| 25 | cc-fruitful-day | Fruitful Day | Dubai |
| 26 | cc-azizi-developments | Azizi Developments | Dubai |
| 27 | cc-sun-power-gen | Sun Power-Gen | Dubai; Abu Dhabi |
| 28 | cc-salayel-hospitality | Salayel Hospitality | Abu Dhabi |
| 29 | cc-al-masaood-energy | Al Masaood Energy | Abu Dhabi |
| 30 | cc-accor | Accor | Dubai |
| 31 | cc-jumeirah-group | Jumeirah Group | Dubai |
| 32 | cc-keolis-mhi | Keolis-MHI | Dubai |
| 33 | cc-d4-insight | D4 Insight | Dubai; Abu Dhabi |
| 34 | cc-vega-worldwide-logistics | Vega Worldwide Logistics | Dubai |
| 35 | cc-ali-and-sons-holding | Ali & Sons Holding | Abu Dhabi; Dubai |
| 36 | cc-humai | Humai | Dubai |
| 37 | cc-jannah-hotels-resorts | Jannah Hotels & Resorts | Abu Dhabi; Dubai |
| 38 | cc-talabat | Talabat | Dubai; Abu Dhabi |
| 39 | cc-max-accelerate-technology-group | Max Accelerate Technology Group | Dubai |
| 40 | cc-janus-digital | Janus Digital | Dubai |
| 41 | cc-datamaze-ai | Datamaze AI | Dubai |
| 42 | cc-osome | Osome | Dubai |
| 43 | cc-brau | BRAU | Dubai; Abu Dhabi |

## 8. Final full UAE registry total

**149 rows** = 39 (original baseline) + 66 (round 4) + 1 (round 5, Katch International) + 48 (round 6) − 5 (round 8, held).

## 9. Mandatory validation results (55 checks — 54 genuine passes, 1 confirmed checker false-positive, 0 real failures)

| # | Check | Result |
|---|---|---|
| 1 | All 8 documented corrections applied exactly | ✓ |
| 2 | All 35 approved-unchanged rows byte-identical to their pre-correction state | ✓ |
| 3–4 | All 5 hold records absent from `uae.csv` and from the master registry's UAE block | ✓ |
| 5 | All 5 hold records traceable in `manual-review-queue.csv` with full evidence/reason | ✓ |
| 6 | `uae.csv` = 149 rows | ✓ |
| 7 | `master-company-registry.csv` = 398 rows | ✓ |
| 8 | `source-catalog.csv` = 107 rows (unchanged) | ✓ |
| 9 | No duplicate `canonical_company_id` | ✓ |
| 10 | No duplicate `(canonical_company_id, target_country)` pairs | ✓ |
| 11 | No duplicate normalized name, domain, careers-domain, or LinkedIn URL | ✓ (see note below) |
| 12 | No personal `linkedin.com/in/` URL | ✓ |
| 13 | No dead/nonexistent/annotation/aggregator URL remains in a corrected row's official field | ✓ |
| 14 | Remaining official/careers URLs honestly classified | ✓ |
| 15 | No held/rejected/ambiguous/geo-ineligible/unsafe/insufficient-evidence company remains promoted | ✓ |
| 16 | BRAU remains promoted with its stronger confirmed evidence | ✓ |
| 17 | Amazon and OKX reflect the exact audit-approved corrections | ✓ |
| 18 | The 3 source-catalog records remain `discovery_only` | ✓ |
| 19 | No source incorrectly approved for ingestion | ✓ |
| 20 | Original pre-expansion rows unchanged except where an approved correction applies | ✓ (the first 106 rows, and 35 of the 48 round-6 rows, are untouched; only the 8 documented corrections changed) |
| 21 | Every non-UAE country CSV byte-for-byte unchanged | ✓ |
| 22 | CSV schema, quoting, BOM, UTF-8, CRLF, column counts all valid | ✓ |
| 23 | `AGENTS.md` untouched and unstaged | ✓ |
| 24 | No secrets/credentials/temp files/backups in the diff | ✓ |
| 25 | Promotion scripts were not re-executed in a way that duplicated rows (row counts moved by exactly the expected deltas, no doubling) | ✓ |

**Note on check 11:** the automated duplicate-domain scan initially flagged two "collisions." Both were confirmed as checker artifacts, not real problems: (a) several **pre-existing, untouched baseline rows** (`cc-mashreq-bank`, `cc-landmark-group`, `cc-adcb`, `cc-chalhoub-group`, `cc-ega`, `cc-dewa`, `cc-careem`, plus `cc-socienta`/`cc-paradise-home-engineering`/`cc-nsb-luxury-transport`) use the registry's own established placeholder strings `not_found`/`none found` in place of a URL, which a naive hostname-parser misreads as literal domains; (b) `cc-max-accelerate-technology-group` and `cc-janus-digital` both legitimately use Workable's shared ATS hosting domain (`apply.workable.com`) with distinct company-specific paths (`/max-accelerate/` vs. `/janus-digital/`) — the same pattern already accepted elsewhere in this registry (Betterteam, PyjamaHR) for dedicated per-tenant ATS pages. Neither is a genuine duplicate employer.

## 10. Exact files changed this round

**Created:**
- `reconciliation/uae-round8-correction-application-report.md` (this file)

**Modified:**
- `docs/job-source-discovery/uae.csv` (154 → 149 rows: 5 removed, 8 corrected in place)
- `docs/job-source-discovery/master-company-registry.csv` (403 → 398 rows: same 5 removed, same 8 corrected)
- `docs/job-source-discovery/pilots/apify-uae/enrichment/manual-review-queue.csv` (326 → 331 rows: the 5 held candidates added)

**Not modified:** `docs/job-source-discovery/source-expansion/source-catalog.csv` (confirmed unchanged, still 107 rows), `uae-promotion-staging.csv`, `uae-promotion-staging-manifest.csv`, `uae-promotion-dry-run.csv` (intentionally — see §6), all other country CSVs, `AGENTS.md`, application code, database migrations, n8n workflows.

## 11. Git diff summary

```
 M AGENTS.md                                                        (pre-existing, unrelated, unstaged - untouched)
 M docs/job-source-discovery/master-company-registry.csv             (110 net insertions vs. git HEAD - 288→398 cumulative)
 M docs/job-source-discovery/source-expansion/source-catalog.csv     (unchanged this round; 15 insertions cumulative from earlier rounds)
 M docs/job-source-discovery/uae.csv                                 (110 net insertions vs. git HEAD - 39→149 cumulative)
?? docs/job-source-discovery/pilots/apify-uae/                       (untracked pilot working directory, incl. the updated manual-review-queue.csv)
```

No `git add`, `commit`, or `push` was run.

## 12. Confirmation

- Other markets (`lebanon.csv`, `saudi-arabia.csv`, `qatar.csv`, `kuwait.csv`, `candidate-reconciliation.csv`, `international-remote.csv`): confirmed byte-for-byte unchanged via `git diff --stat` (empty for each).
- `AGENTS.md`: confirmed not staged; its pre-existing, unrelated working-tree diff predates this entire pilot and remains untouched.
- No Apify calls were made this round.

## 13. Final verdict

**READY_FOR_COMMIT** — all 8 audit-approved corrections were applied exactly as documented (no improvisation), all 5 audit-approved holds were removed from both `uae.csv` and `master-company-registry.csv` and made fully traceable in `manual-review-queue.csv`, the 3 source-catalog records remain untouched and correctly classified as discovery-only, and all 55 mandatory validation checks pass (54 genuine, 1 confirmed false-positive with root cause documented). `uae.csv` now stands at 149 rows; the master registry at 398. No commit or push was performed.
