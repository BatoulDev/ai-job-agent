# Qatar Expansion — Final Verification, Hilton Normalization, and Production Promotion

Follows `correction-application-report.md`. This pass ran the Hilton impact check, resolved it via an explicit product-owner decision, ran the three final spot-checks, and — since every gate passed — promoted the verified Qatar staging set and six sources into production.

> **CORRECTION (2026-09-10, post-commit blocking review):** Section 5 and Section 8 of this report originally stated `uae.csv` row count as "110 → 110 (unchanged)". **This was wrong** — it was a misreading of a `git diff --stat` delta count from the initial branch setup (see `integrity-check-uae-149.md` for the full investigation) as an absolute file total. The actual, verified figure — confirmed with a proper quote-aware CSV parser against git HEAD, the working tree, `origin/main`, and the exact UAE-completion commit `6137c16570d6050afa9f4271b507e43bb89ab45f` — is **149 data rows in every one of those four references**, both before and after this pass's Hilton edit. All 149 UAE employers are present; the only change is the approved `cc-hilton-uae` → `cc-hilton` canonical-ID normalization (0 additions, 0 deletions, 1 modification). Section 5's table and Section 8's counts below are corrected accordingly; the surrounding prose describing the normalization itself was accurate and is unchanged.

## 1. Hilton impact check

| Check | Result |
|---|---|
| Repo-wide search for `cc-hilton-uae`, `Hilton UAE`, `Hilton Salwa`, `Hilton Qatar`, related aliases/domains | 11 files matched "Hilton" repo-wide (via the Grep tool, corroborated by a full independent repo-wide `grep -r`). **Every single match is under `docs/job-source-discovery/`** — 2 production CSVs (`uae.csv`, `master-company-registry.csv`) and 9 documentation/report files (this pass's own artifacts plus 3 historical UAE round-6/7/8 reports). |
| Application code / database / scripts referencing `cc-hilton-uae` | **Zero.** No match in any `.js`/`.ts`/`.tsx`/`.sql`/`.json` file outside `docs/job-source-discovery/`. |
| Is `canonical_company_id` documentation/CSV-controlled only, or referenced by production code/database records? | **Documentation/CSV-controlled only.** Confirmed by the repo-wide search above — nothing in the application, database schema, or scripts reads this field. |
| Is `cc-hilton` already assigned to another company? | **No.** `grep "^cc-hilton,"` across all registry files returned zero matches before this pass. |
| Does renaming `cc-hilton-uae` → `cc-hilton` (a) preserve identity, (b) avoid collision, (c) avoid altering unrelated UAE data, (d) allow Qatar to reuse the ID? | **Yes to all four.** Only the `canonical_company_id` field of the single existing Hilton row was changed; `company_name`, `legal_or_official_name`, all URLs, and every other field are byte-identical to before. `git diff` on `uae.csv` and `master-company-registry.csv` confirms exactly 1 line changed in each, nothing else. |

**Result: safe, documentation/CSV-only normalization. Applied.**

### Exact old → new references changed

| File | Before | After |
|---|---|---|
| `docs/job-source-discovery/uae.csv` (1 row) | `cc-hilton-uae,sr-ae-hilton-uae,Hilton,...` | `cc-hilton,sr-ae-hilton-uae,Hilton,...` (only `canonical_company_id` changed; a traceability note was appended to that row's existing `researcher_notes` field) |
| `docs/job-source-discovery/master-company-registry.csv` (1 row) | same | same change, mirrored |

`source_record_id` (`sr-ae-hilton-uae`) was deliberately **left unchanged** — the product-owner instruction specifically targeted `canonical_company_id`, and touching additional fields would have widened the blast radius of a production edit beyond what was explicitly authorized.

Historical audit/report files (`human-quality-audit-report.md`, `correction-application-report.md`, the three UAE round-6/7/8 reports) **were not rewritten** — they still say `cc-hilton-uae`, preserving an accurate historical record of what was found and decided at the time, per instruction. Live reconciliation artifacts that must reflect current state (`duplicate-and-alias-review.csv`, `manual-review-queue.csv`, `staging-manifest.csv`) were updated to the resolved state.

## 2. Final three spot-checks

### Accenture — **PASS**

A `site:accenture.com/qa-en` search returned zero results — the previously-guessed `/qa-en/careers` path was never actually confirmed. Re-searched and found an independent source directly citing `accenture.com/ae-en/careers` as "the official Accenture careers gateway URL" for the Middle East region. Corrected `official_careers_url` to this confirmed real gateway (not US-locked; a legitimate official entry point). 4 independently-listed "Accenture Middle East" Qatar vacancies via Naukrigulf corroborate real regional hiring through this channel.

### GE Vernova — **PASS (client-side filter, documented honestly)**

Direct `WebFetch` of `careers.gevernova.com/` confirmed the site's own City filter lists **"Ad Dawhah" with 1 associated job** out of 2,031 total. The exact filtered-results URL is not exposed as a static link (client-side JS filtering) — the previously-guessed query-parameter URL was **not** confirmed real and was removed. This is documented as a confirmed-but-client-side-reproducible result rather than a clickable URL, per instruction.

### Accor / Pullman evidence — **PASS (channel valid; Pullman downgraded to alias-only)**

Direct `WebFetch` of the Qatar-filtered Accor results URL confirmed it is **live and renders real results**: 7 postings across 4 Doha properties — Alwadi Hotel Doha (MGallery Collection), La Cigale Hotel Managed by Accor, Rixos Gulf Hotel Doha, Swissôtel Residences Corniche Park Towers — plus the previously-confirmed ibis Doha and Our Habitas Ras Abrouq postings. **Pullman Doha West Bay returned zero results in this same fetch.** No active Pullman vacancy is claimed anywhere in the promoted row; Pullman Doha West Bay is retained only as a named property/brand alias inside `cc-accor`'s researcher_notes, explicitly marked as having no current vacancy evidence. (No literal "Pullman Dubai" URLs were ever present in the row's `evidence_urls` field to begin with — that risk existed only in an earlier draft's prose description, which has now been rewritten to reflect the direct verification result.)

## 3. Final staging decision

All three gates passed and the Hilton normalization was safe, so the projected total from the task brief holds exactly: **37 promotable employers** (36 from the prior correction pass + Hilton Qatar, resolved this pass under `cc-hilton`).

## 4-5. Promotion executed

Used a small one-shot Node script (deleted immediately after running) to append rows byte-exactly rather than hand-transcribing 37 large CSV rows into production files — this removes transcription risk on files that cannot be safely hand-edited at this size.

| File | Before | After | Change |
|---|---|---|---|
| `docs/job-source-discovery/qatar.csv` | 40 rows | **77 rows** | +37 new rows appended after the existing 40 (which remain cell-for-cell, byte-for-byte unchanged — confirmed via `git diff`: 37 insertions, **0 deletions**) |
| `docs/job-source-discovery/master-company-registry.csv` | 398 rows | **435 rows** | +37 new Qatar rows appended (same content as qatar.csv's new rows) + 1 line changed (the Hilton ID normalization) — confirmed via `git diff`: 38 insertions, 1 deletion, matching exactly |
| `docs/job-source-discovery/source-expansion/source-catalog.csv` | 107 rows | **113 rows** | +6 new recruitment-agency source rows (the 7th proposed row — a LinkedIn-exclusion reaffirmation — was correctly **not** added, since an identical exclusion row already exists in production) |
| `docs/job-source-discovery/uae.csv` | **149 rows** (corrected — originally mis-reported as 110, see correction note above) | **149 rows** (unchanged count) | 1 line changed: `cc-hilton-uae` → `cc-hilton` |
| `docs/job-source-discovery/international-remote.csv` | — | — | **Not touched** (per instruction — no Qatar-eligible remote candidates existed to add) |

Schema, column order, quoting, BOM (present on `qatar.csv` and `master-company-registry.csv`, absent on `source-catalog.csv` — both preserved exactly as they were), UTF-8 encoding, and CRLF line endings were all verified byte-identical to the pre-existing convention of each file before and after the append (confirmed programmatically, not by eye).

### Final list of 37 promoted Qatar employers

Al Abdulghani Motors, Ali Bin Ali, American Academy School Qatar, Anantara Hotels & Resorts (Banana Island Resort Doha), **Accor** (consolidated brand-level row covering ibis Doha, Our Habitas Ras Abrouq, Alwadi Hotel Doha, La Cigale Hotel Managed by Accor, Rixos Gulf Hotel Doha, Swissôtel Residences Corniche Park Towers, and Pullman Doha West Bay as a property alias), Accenture, BAE Systems, Cisco, Doha Golf Club, Ecolab, Everllence, EPAM Systems, GE Vernova, **Hilton** (Hilton Salwa Beach Resort & Villas, under the newly-normalized market-neutral `cc-hilton`), International Schools Partnership, KBR, Lesha Bank, malomatia, Millennium Hotel Doha, Mowasalat (Karwa), North Oil Company, Power International Holding, ProgressSoft Corporation, Qatar Stock Exchange, Regency Technology Qatar, Rosewood Doha, Scale AI, Shell Qatar, SLB, Supermicro, Systems Limited, TGP International, Tata Consultancy Services, The Utopia Studio, Tivoli Hotels & Resorts, University of Doha for Science and Technology, Forvis Mazars in Qatar.

### 6 promoted sources (all `discovery_only`)

Manforce Group, MACH Consultants, Edison Smart, Fusion Outsourcing & Services, Vistas Global, Kingston Stanley — none classified as `approved_for_automated_ingestion` (no robots.txt/ToS/access-policy evidence was ever gathered). The employer-angle follow-up notes for Edison Smart, Vistas Global, and Kingston Stanley (possible internal-hiring signal) are preserved in the promoted rows' `notes` field. None of the three were added as employers — no new evidence conclusively proved internal Qatar hiring this pass.

## 6. Validation results

| # | Check | Result |
|---|---|---|
| 1 | Final `qatar.csv` count = baseline + promoted count | ✅ 40 + 37 = **77**, confirmed by direct row count. |
| 2 | Every original Qatar row cell-for-cell unchanged | ✅ `git diff` on `qatar.csv` shows 37 insertions, **0 deletions** — mathematically impossible for any existing row to have been altered. |
| 3 | Exactly the approved employers were added | ✅ 37 rows added, matching the final staging file exactly (verified by row-count and canonical-ID cross-check). |
| 4 | Hilton uses one stable market-neutral ID across UAE and Qatar | ✅ `cc-hilton` appears exactly once in `uae.csv` and exactly once in the new Qatar rows — same ID, two market rows, matching the `cc-newtecx` cross-market precedent. |
| 5 | Accor has one Qatar market row | ✅ Exactly one `cc-accor` row with `target_country=Qatar` in both `qatar.csv` and `master-company-registry.csv`. |
| 6 | No false claim of an active Pullman Doha vacancy | ✅ Confirmed by direct re-read of the promoted `cc-accor` row's `researcher_notes` — Pullman is explicitly named as having zero live results from the direct verification fetch. |
| 7 | Accenture and GE Vernova evidence reflects the direct spot-check result | ✅ Both rows carry "FINAL SPOT-CHECK" notes describing exactly what was and wasn't directly confirmed. |
| 8 | No duplicate `canonical_company_id` within Qatar | ✅ Programmatic check on all 77 `qatar.csv` rows — zero duplicates. |
| 9 | No duplicate `(canonical_company_id, target_country)` pair in master registry | ✅ Programmatic check on all 435 rows — zero duplicates. |
| 10 | Cross-market canonical-ID reuse only for the same employer identity | ✅ `cc-hilton` = Hilton Worldwide in both rows; `cc-accor` = Accor in both rows; no other cross-market reuse occurred this pass. |
| 11 | No normalized-name/alias/domain/ATS-tenant/LinkedIn-page collision | ✅ Spot-checked; the only shared identifiers (`cc-hilton`, `cc-accor`) are intentional cross-market reuse of the same real company, not accidental collisions. |
| 12 | All six sources present exactly once, `discovery_only` | ✅ 6 rows added to `source-catalog.csv`, each carrying the `discovery_only` decision in its notes field (the schema has no dedicated automation-eligibility column). |
| 13 | No aggregator/agency stored as an employer's official careers URL | ✅ Spot-checked; TGP International's bayt.com citation remains explicitly labeled as a third-party mirror, not `official_careers_url`. |
| 14 | No personal `linkedin.com/in/` URL | ✅ `grep` across the full diff of all 4 modified production files — zero matches. |
| 15 | No held/rejected/unsafe/ambiguous/insufficient-evidence candidate promoted | ✅ Only the 37 fully-verified rows were promoted; the remaining 13 leads stay in `manual-review-queue.csv`, 8 in `rejected-and-insufficient-evidence.csv`, 1 rejected. |
| 16 | All enum values documented and valid | ✅ Every value introduced or changed this pass (`government_owned`, `private`, `consulting_professional_services`, `multinational_subsidiary`) was checked against `qatar.csv`'s own existing value set before use. |
| 17 | CSV schemas/quoting/BOM/CRLF/UTF-8/column counts preserved | ✅ Verified programmatically pre- and post-append for all 3 promoted-into files. |
| 18 | `international-remote.csv` and unrelated country registries byte-for-byte unchanged, except the approved Hilton normalization | ✅ `git diff --stat` empty for `international-remote.csv`, `lebanon.csv`, `kuwait.csv`, `saudi-arabia.csv`; `uae.csv` shows exactly the 1 approved Hilton line. |
| 19 | `AGENTS.md` untouched and unstaged | ✅ `git diff --stat` empty; not in `git status` output. |
| 20 | No Apify or paid-service call | ✅ WebSearch/WebFetch only. |
| 21 | No secrets/tokens/env files/backups/screenshots/temp artifacts included | ✅ The one-shot promotion script (`_promote.js`) was deleted immediately after use and does not appear in `git status`. |
| 22 | Git diff contains only the intended Qatar artifacts, registry updates, source-catalog update, and minimum Hilton normalization | ✅ See Section 7 below — exactly 4 modified files + 1 new directory, nothing else. |

## 7. Exact files changed

```
 M docs/job-source-discovery/master-company-registry.csv   (+38 / -1: 37 new Qatar rows + Hilton ID normalization)
 M docs/job-source-discovery/qatar.csv                      (+37 / -0: 37 new employer rows)
 M docs/job-source-discovery/source-expansion/source-catalog.csv  (+6 / -0: 6 new recruitment-agency source rows)
 M docs/job-source-discovery/uae.csv                         (+1 / -1: Hilton ID normalization only)
?? docs/job-source-discovery/pilots/qatar-expansion/         (all discovery/staging/audit/correction/final-verification artifacts)
```

No other file in the repository was touched.

## 8. Final counts

| Metric | Before | After |
|---|---|---|
| `qatar.csv` | 40 | **77** |
| `master-company-registry.csv` | 398 | **435** |
| `source-expansion/source-catalog.csv` | 107 | **113** |
| `uae.csv` row count | **149** (corrected — see correction note above) | **149** (unchanged; 1 field normalized) |
| Final promoted employer count | — | **37** |
| Final held employer list | — | **0** (Hilton was the only hold, and it resolved) |
| Remaining in manual review (never promotable this pass) | — | 13 leads in `manual-review-queue.csv` |
| Rejected / insufficient evidence | — | 9 (8 insufficient-evidence + 1 rejected) |

## 9. Git diff summary

```
 docs/job-source-discovery/master-company-registry.csv         | 39 +++++++++++++++++++++-
 docs/job-source-discovery/qatar.csv                            | 37 +++++++++++++++++++++++++++++++++++++
 docs/job-source-discovery/source-expansion/source-catalog.csv  |  6 ++++++
 docs/job-source-discovery/uae.csv                               |  2 +-
 4 files changed, 82 insertions(+), 2 deletions(-)
?? docs/job-source-discovery/pilots/qatar-expansion/
```

## 10. Verdict

**READY_FOR_COMMIT**

All 22 validation checks pass. The Hilton canonical-ID normalization was verified safe before being applied (documentation/CSV-only, zero code/database impact, no collision), all three final spot-checks passed with honest evidence (including one downgrade — Pullman Doha West Bay — rather than a false claim), and the promoted content is byte-exact, schema-correct, and fully traceable back through `staging-manifest.csv` to every original candidate ID. Nothing was staged, committed, pushed, merged, or opened as a PR — the working tree is ready for a human to review and commit.
