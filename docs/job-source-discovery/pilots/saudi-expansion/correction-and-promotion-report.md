# Saudi Arabia Expansion — Correction & Promotion Report

This is the promotion step following the completed discovery pass and adversarial human-quality audit. Corrections were applied exactly as documented in the audit, the 12 holds were moved to the manual-review queue, and the 73 remaining employers plus 16 net-new sources were promoted into production.

## 1. Confirmed baseline (pre-mutation)

- Branch: `feat/saudi-registry-expansion`.
- `git status --short` before mutation: only `?? docs/job-source-discovery/pilots/saudi-expansion/`.
- `AGENTS.md`: unchanged (`git diff main -- AGENTS.md` empty).
- `saudi-arabia.csv`: **43** rows (quote-aware parse).
- `master-company-registry.csv`: **435** rows (quote-aware parse).
- `source-expansion/source-catalog.csv`: **113** rows (actual count, verified rather than assumed).
- `audit-findings-employers.csv`: **85** rows, decisions reconciled exactly to 56 `approve_unchanged` + 17 `correct_then_approve` + 12 `hold_manual_review` = 85.
- `saudi-promotion-staging.csv`: 85 rows (pre-mutation).
- No discrepancy found between the reported state and the actual working tree — proceeded directly.

## 2. Full 17-company correction manifest

Applied exactly as documented in `human-quality-audit-report.md` Section 4 / `audit-findings-employers.csv` — no inferred or improvised values. 40 field-level corrections + 8 researcher-notes-only appends across the same 17 companies (48 manifest entries total). Full machine-readable manifest: `correction-manifest.csv` (columns: `candidate_id, canonical_id, field, original_value, corrected_value, audit_reason, evidence_url, validation_result`).

| Canonical ID | Field | Before | After | Reason |
|---|---|---|---|---|
| cc-accenture-sa | careers_page_status | active_with_open_jobs | careers_page_found | Hub page has no visible listings itself; live listings require a separate Workday sub-port |
| cc-accenture-sa | current_open_jobs_detected | yes | unknown | Hub page shows no visible listings this pass |
| cc-alpaca-ksa | evidence_urls | https://job-boards.greenhouse.io/alpaca/jobs/5850031004 | https://job-boards.greenhouse.io/alpaca | Claimed "Lead Product Manager - Saudi" job (5850031004) does not currently exist; replaced |
| cc-uxbert-labs | careers_page_status | careers_page_found | active_no_open_jobs | Official page explicitly states "No available jobs in the meantime", contradicting prior " |
| cc-uxbert-labs | current_open_jobs_detected | unknown | no | Official page explicitly states no available jobs |
| cc-lenovo-sa | evidence_urls | https://jobs.lenovo.com/en_US/careers/JobDetail/Service-Delivery-Lead-for-KSA/68629 | https://jobs.lenovo.com/ | Specific job posting URL now returns HTTP 404 (normal listing churn); replaced with the co |
| cc-lenovo-sa | careers_page_status | active_with_open_jobs | careers_page_found | Downgraded from an active-job claim pending a fresh specific listing |
| cc-lenovo-sa | current_open_jobs_detected | yes | unknown | Specific cited job no longer live |
| cc-devsinc-sa | target_city | Riyadh | Al Khobar | Footer confirms real Saudi office in Al Khobar, not Riyadh as staged |
| cc-devsinc-sa | careers_page_status | active_with_open_jobs | active_no_open_jobs | Open Roles section lists 7 positions, ALL tagged On-site Lahore Pakistan -- zero Riyadh/Sa |
| cc-devsinc-sa | current_open_jobs_detected | yes | no | Current board is Pakistan-only |
| cc-bcg-platinion-sa | evidence_urls | https://careers.bcg.com/global/en/job/56326/AI-Tech-Consultant-Enterprise-Solutions-Riyadh | https://careers.bcg.com/global/en/search-jobs?keywords=Riyadh | Specific job URL (job/56326) now shows the job has been filled -- normal churn; replaced w |
| cc-bcg-platinion-sa | careers_page_status | active_with_open_jobs | careers_page_found | Downgraded pending a fresh specific listing |
| cc-bcg-platinion-sa | current_open_jobs_detected | yes | unknown | Specific cited job no longer live |
| cc-bmc-helix-sa | evidence_urls | https://jobs.bmc.com/Careers/JobDetail/Project-Architect-Consulting-Services-Saudi-Arabia/ | https://jobs.bmc.com/;https://www.bmc.com/newsroom/releases/saudi-arabia-to-offer-bmc-heli | Specific job URL (JobDetail/46406) now returns HTTP 404 -- stale link; replaced with the g |
| cc-bmc-helix-sa | careers_page_status | active_with_open_jobs | careers_page_found | Downgraded pending a fresh specific listing |
| cc-bmc-helix-sa | current_open_jobs_detected | yes | unknown | Specific cited job no longer live |
| cc-amazon-sa | evidence_urls | https://www.bayt.com/en/saudi-arabia/jobs/amazon-jobs/ | https://www.amazon.jobs/en/search?loc_query=Saudi+Arabia | Sole prior evidence_urls value was a Bayt.com aggregator link, explicitly insufficient as  |
| cc-alnafitha-it | official_careers_url | https://alnafitha.zohorecruit.com/jobs/Careers/586853000027348176/ | https://alnafitha.zohorecruit.com/jobs/Careers | Specific M365 job posting now shows "This job posting is no longer available"; replaced wi |
| cc-alnafitha-it | public_jobs_endpoint_or_feed | https://alnafitha.zohorecruit.com/jobs/Careers/586853000027348176/ | https://alnafitha.zohorecruit.com/jobs/Careers | Same stale-link correction applied consistently |
| cc-alnafitha-it | evidence_urls | https://alnafitha.zohorecruit.com/jobs/Careers/586853000027348176/Technical-Consulting-Pro | https://alnafitha.zohorecruit.com/jobs/Careers | Same stale-link correction applied consistently |
| cc-alnafitha-it | careers_page_status | active_with_open_jobs | careers_page_found | Downgraded pending a fresh specific listing; Zoho Recruit tenant itself still confirmed re |
| cc-alnafitha-it | current_open_jobs_detected | yes | unknown | Specific cited job no longer live |
| cc-neoleap | official_careers_url | not_found | https://iafkkf.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001 | Prior pass marked official_careers_url as not_found; this was a gap -- the real careers li |
| cc-neoleap | ats_provider | unknown | Oracle Cloud HCM | ATS platform identified via the confirmed careers link |
| cc-neoleap | public_jobs_endpoint_or_feed | not_found | https://iafkkf.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001 | Same careers-link correction applied consistently |
| cc-haji-husein-alireza | ats_provider | unknown | Talentera | ATS confirmed via footer badge on direct re-fetch |
| cc-haji-husein-alireza | current_open_jobs_detected | unknown | yes | Live Jeddah Call Center Agent role and Jeddah Tamheer Program role confirmed |
| cc-haji-husein-alireza | careers_page_status | careers_page_found | active_with_open_jobs | Live roles confirmed on official domain |
| cc-jeddah-central-dev | official_careers_url | https://careers.jcd.com.sa/ | https://www.jeddahcentral.com/en/careers | Staged URL (careers.jcd.com.sa) was not referenced anywhere on the confirmed real JCDC car |
| cc-jeddah-central-dev | ats_provider | unknown | SAP SuccessFactors | ATS identified via the confirmed careers page link-out |
| cc-jeddah-central-dev | public_jobs_endpoint_or_feed | https://careers.jcd.com.sa/ | https://career-sa20.hr.cloud.sap/career?company=jeddahcent | Direct SAP SuccessFactors portal link found on the confirmed careers page |
| cc-jeddah-central-dev | evidence_urls | https://careers.jcd.com.sa/;https://www.jeddahcentral.com/en/careers | https://www.jeddahcentral.com/en/careers | Consolidated to the confirmed-correct URL |
| cc-slb | official_careers_url | https://apply.slb.com/careers/*/multi_location_saudi_arabia | https://careers.slb.com/job-listing | Staged URL contained a literal unresolved wildcard "*" as a path segment -- an invalid, no |
| cc-slb | public_jobs_endpoint_or_feed | https://apply.slb.com/careers/*/multi_location_saudi_arabia | https://careers.slb.com/job-listing | Same invalid-wildcard correction applied consistently |
| cc-slb | evidence_urls | https://apply.slb.com/careers/*/multi_location_saudi_arabia;https://careers.slb.com/job-li | https://careers.slb.com/job-listing | Same invalid-wildcard correction applied consistently |
| cc-slb | careers_page_status | careers_page_found | not_verified | Neither fetch this pass showed actual Saudi job content, only navigation/config shells (li |
| cc-salesforce | current_open_jobs_detected | yes | unknown | Original evidence was a single specific job-requisition URL (jr336046), inherently stale-p |
| cc-salesforce | careers_page_status | active_with_open_jobs | careers_page_found | Downgraded from an active-job claim pending a fresh specific listing |
| cc-apple | target_city | Jeddah/Riyadh (multi-city) | Country-wide | Jeddah-filtered search returns 11 results but every result's actual location field reads " |

## 3. Complete list of 12 holds and their blockers

Removed from the promotion set, preserved in full (all original evidence/identity data intact) in `manual-review-queue.csv` with a deterministic review ID (`SA-HOLD-001` through `SA-HOLD-012`, assigned in original staging-row order). None are classified as rejected — the audit did not find any of these invalid, only that a specific piece of evidence is missing or contradictory.

| Review ID | Company | Canonical ID | Blocker |
|---|---|---|---|
| SA-HOLD-001 | iGate | cc-igate-sa | Domain does not resolve on two independent attempts. Evidence checked: original careers URL. Missing: any resolving domain for a real distinct Saudi entity. Action: human search for correct live domain, or reclassify insufficient_evidence. |
| SA-HOLD-002 | InnovationTeam | cc-innovationteam | Prior claim of a live AI Team Lead Riyadh posting could not be reconfirmed. Evidence checked: direct fetch of careers page. Missing: specific current job or city-level confirmation. Action: re-check or downgrade to insufficient_evidence. |
| SA-HOLD-003 | Cohere | cc-cohere | Prior claim of a live Country Manager - Saudi Arabia role directly contradicted by official office list excluding Saudi Arabia. Evidence checked: cohere.com/careers (contradicts), Ashby board (inconclusive). Missing: first-party confirmation. Action: human should check Ashby board directly in a browser (JS-rendered) before promoting or rejecting. |
| SA-HOLD-004 | Innovaccer | cc-innovaccer | Official careers page contradicts claimed Saudi presence; only third-party aggregator evidence exists. Evidence checked: official careers page (contradicts). Missing: first-party Saudi confirmation. Action: verify whether Innovaccer Analytics KSA is a real distinct registered entity, or downgrade to insufficient_evidence. |
| SA-HOLD-005 | Naphora Games Group | cc-naphora | Prior claim not independently reconfirmed -- only generic homepage snippet retrievable. Evidence checked: naphora.com/careers (partial/inconclusive). Missing: direct confirmation of actual jobs listing. Action: manual browser re-check. |
| SA-HOLD-006 | SiFi | cc-sifi | The official_careers_url now 404s. Evidence checked: direct fetch. Missing: working current careers/ATS link. Action: search for SiFi's current careers URL before promotion. |
| SA-HOLD-007 | CoorB | cc-coorb-sa | Official careers URL now 404s; previously-cited live Riyadh roles cannot be reconfirmed. Evidence checked: direct fetch. Missing: working current careers link. Action: search for CoorB's current careers page/ATS before promotion. |
| SA-HOLD-008 | Ninja | cc-ninja-sa | No first-party evidence exists anywhere in the record. Official domain blocked this pass. Evidence checked: ananinja.com (blocked), buildsaudi.co and bayt.com (both third-party). Missing: first-party company page or careers URL. Action: retry official domain later, or downgrade to insufficient_evidence. |
| SA-HOLD-009 | Nahdi Medical Company | cc-nahdi-medical | Staged domain does not resolve at all. Evidence checked: nahdi.com.sa (DNS failure), nahdi.sa (resolves, server error). Missing: confirmed working official domain. Action: human should verify whether nahdi.sa is the correct current domain; do not carry forward nahdi.com.sa as-is. |
| SA-HOLD-010 | 2P Perfect Presentation | cc-2p-perfect-presentation | Reason: internal contradiction between careers_page_status and official_careers_url fields; only third-party evidence exists for any careers claim. Evidence checked: 2p.com.sa homepage (no careers link found), Wazaef Saudi aggregator, Yahoo Finance ticker page. Action needed: a human should browse 2p.com.sa's full navigation/footer for an actual careers page, or confirm via Tadawul filing/IR page. |
| SA-HOLD-011 | KBR | cc-kbr | Reason: highest-stakes row in the batch because it reuses an existing cross-market canonical ID with NO first-party confirmation at all -- only aggregator mirrors. Evidence checked: kbr.com/en/careers (403, both passes), Glassdoor and dejobs.org mirrors (real, but third-party). Action needed: a human must get a direct browser view of kbr.com's careers/Saudi Arabia section (or an official KBR press release/LinkedIn company page corroboration) before this reuses the cc-kbr id in production. |
| SA-HOLD-012 | Remat Al-Riyadh Development Co. | cc-remat-al-riyadh | Reason: the row's own careers_page_status claims a recruitment-email channel exists, but no actual email address is recorded in any field, and this audit's own re-fetch failed with a connection error. Evidence checked: remat.sa (ECONNRESET this pass), bestplacestoworkfor.org profile (confirms the award but not a specific recruitment address). Action needed: a human must browse remat.sa directly to find and record the actual recruitment email address before this can be treated as recruitment_email_only rather than unavailable. |

## 4. Final promoted employer list (73)

Qiddiya (`cc-qiddiya`), Assystem (`cc-assystem-sa`), Saudi AZM (`cc-saudi-azm`), RIME (`cc-rime`), Accenture (`cc-accenture-sa`), DataRobot (`cc-datarobot`), Infosys (`cc-infosys`), TAWANTECH (`cc-tawantech`), Infinite pl (`cc-infinite-pl`), Alpaca (`cc-alpaca-ksa`), ElevenLabs (`cc-elevenlabs`), UXBERT Labs (`cc-uxbert-labs`), Yokogawa Middle East (`cc-yokogawa-sa`), MOZN (`cc-mozn`), INTECH Automation & Intelligence (`cc-intech-aai`), Saudi Air Navigation Services (`cc-sans`), Fakeeh Care Group (`cc-fakeeh-care-group`), Al Watania Information Systems (`cc-wisys`), Datamatics Technologies (`cc-datamatics`), Gathern (`cc-gathern`), Lenovo (`cc-lenovo-sa`), Capgemini (`cc-capgemini-sa`), Devsinc (`cc-devsinc-sa`), BCG Platinion (`cc-bcg-platinion-sa`), Apparel Group (`cc-apparel-group-sa`), BMC Helix (`cc-bmc-helix-sa`), Mirai (`cc-mirai-games`), Amazon (`cc-amazon-sa`), Sulava MEA (`cc-sulava-mea`), Jeddah Airports Company (`cc-jeddah-airports`), NCR Atleos (`cc-ncr-atleos-sa`), Bupa Arabia (`cc-bupa-arabia`), Wipro (`cc-wipro-sa`), Alnafitha IT (`cc-alnafitha-it`), Perfect Vision (`cc-perfect-vision`), Zakat, Tax and Customs Authority (`cc-zatca`), Atmaal (`cc-atmaal`), KUN Sports (`cc-kun-sports`), neoleap (`cc-neoleap`), SJ Group (`cc-sj-group`), SIHAMCO (`cc-sihamco`), Azeus Systems Limited (`cc-azeus-systems`), Aloula Aviation (`cc-aloula-aviation`), Al-Othman Holding Company (`cc-al-othman-holding`), HALA (`cc-hala`), Cognizant (`cc-cognizant`), Azadea Group (`cc-azadea-group`), Riyad Bank (`cc-riyad-bank`), dentsu (`cc-dentsu`), NextEra (`cc-nextera-tech`), SHEBA JOY (`cc-sheba-joy`), Haji Husein Alireza & Co. Ltd. (`cc-haji-husein-alireza`), Jeddah Central Development Company (`cc-jeddah-central-dev`), Intelmatix (`cc-intelmatix`), Ericsson (`cc-ericsson`), Akkodis (`cc-akkodis`), MIS (`cc-mis-al-moammar`), Albawani (`cc-albawani`), SLB (`cc-slb`), Tamkeen Technologies (`cc-tamkeen-technologies`), SAP (`cc-sap`), Searce (`cc-searce`), SEDCO Holding (`cc-sedco-holding`), MinIO (`cc-minio`), AtkinsRéalis (`cc-atkinsrealis`), GT Medical (`cc-gt-medical`), Snap Inc. (`cc-snap-inc`), Tata Consultancy Services (`cc-tcs`), Salesforce (`cc-salesforce`), Noon / Noon Academy (`cc-noon-academy`), Luma AI (`cc-luma-ai`), Democrance (`cc-democrance`), Apple (`cc-apple`).

All 73 were promoted with `review_status` set to `verified` and `rejection_or_review_reason` cleared (the prior placeholder text explicitly said "staged only — not yet promoted"; since these rows are now genuinely in production, that placeholder was replaced to keep the data internally consistent — this was the one deliberate metadata change applied uniformly across all 73, beyond the 17 documented field corrections).

## 5. Before/after counts

| File | Before | After | Delta |
|---|---|---|---|
| `saudi-arabia.csv` | 43 | **116** | +73 |
| `master-company-registry.csv` | 435 | **508** | +73 |
| `source-expansion/source-catalog.csv` | 113 | **129** | +16 |

All three deltas match the expected counts exactly — no revision was needed.

## 6. Source-catalog additions and statuses

All 16 audited sources were confirmed **net-new** for Saudi Arabia (checked by exact-domain and source_id matching against the existing 113 production rows — two of the 16, GulfTalent and Jobgether, share a root domain with existing rows for OTHER markets (UAE/Qatar/Kuwait for GulfTalent; Lebanon/UAE for Jobgether), which is not a duplicate under this registry's established per-market source convention — the existing catalog already carries separate rows per market for the same domain, e.g. `src-sa-bayt` alongside Bayt rows for other markets).

| Status | Count | Sources |
|---|---|---|
| `approved_for_automated_ingestion` | 2 | BluePages Business Directory (company-directory data only, not job vacancies — robots.txt fully open, no login, employer identity disclosed); Jobgether (robots.txt explicitly declares `ai-input=yes`, and a live structured JSON API at `/astroapi/ai/jobs.json` is not covered by any disallow — access method approved; Saudi-specific coverage through that API was not yet confirmed and is documented as an open caveat, not claimed) |
| `manual_review_only` | 10 | Jadarat, PIF portfolio directory, Saudi Exchange/Tadawul directory (all three blocked HTTP 403 on both homepage and robots.txt), Mihnati, Wadhefa (both have robots.txt disallows on their likely core listing paths), Tanqeeb (empty/JS-rendered, unreachable via automated fetch), GulfTalent (robots.txt explicitly blocks ClaudeBot by name plus ~15 other named AI crawlers — preserved exactly as audited, never approved), NADIA Global (working domain corrected from a dead `www` subdomain), Avensys Consulting, SmartChoice International GCC |
| `discovery_only` | 4 | Taqat (legacy, superseded by Jadarat), HRDF (informational only, no listings), Jeddah Chamber of Commerce/JCCI (links out to BluePages for actual listings), Scout Global (no confirmed Saudi coverage) |
| `blocked_or_restricted` / `rejected_unsafe` | 0 each | — |

No source's audited access status was upgraded beyond what the audit documented. Full per-field detail for each new row is in `source-expansion/source-catalog.csv` itself (16 new `src-sa-*` rows appended) and cross-referenced in `audit-findings-sources.csv`.

## 7. HR-email handling

Only `klc.hr@alkafaa.com` (Al Kafaa Limited Co.) carries first-party recruitment evidence, independently re-verified twice now (initial audit pass + this promotion pass's re-check of the same `https://alkafaa.com/careers-page/` `mailto:` link). **Al Kafaa Limited Co. is not among the 155 supplied LinkedIn employer leads and was never staged as an employer row** — it surfaced only through the separate HR-email discovery track. There is therefore no employer/application-channel field in `saudi-arabia.csv` to attach this email to in this pass; it remains correctly parked in the research artifacts (`supplied-hr-email-audit.csv`, `audit-findings-emails.csv`) with its verified status and evidence URL. No email was sent, no CV submitted, no SMTP probing performed. All other 60 unique email addresses remain excluded from any production field, preserved only with their audited statuses in the research artifacts.

## 8. Cross-market identity findings

- **KBR**: held (`SA-HOLD-011`) specifically because promoting it would have reused the existing Qatar `cc-kbr` canonical ID with zero first-party Saudi evidence — the audit's own highest-risk flag. Correctly excluded from this promotion.
- **SLB**: promoted under a new market-neutral id `cc-slb` (the existing Qatar row is `cc-slb-qatar`) — confirmed no `(id, target_country)` collision.
- **Tata Consultancy Services**: promoted under a new market-neutral id `cc-tcs` (the existing Qatar row is the long-form `cc-tata-consultancy-services-qatar`) — a real spelling inconsistency across markets, not a duplicate, left open for a future human ID-convention decision as documented in the audit.
- **Amazon**: promoted as `cc-amazon-sa`, confirmed distinct from the existing `cc-amazon-uae` row (different target_country, same convention as the UAE row's own suffix).
- **Accenture**: promoted as `cc-accenture-sa`, following the same suffix convention as the existing `cc-accenture-qatar` row.
- No incorrect parent/subsidiary merge was found or introduced during promotion — every one of the 73 promoted rows carries the exact canonical_company_id the audit assigned, with no substitution of a held company for a similarly-named parent/subsidiary/brand.

## 9. Validation checks and results

**Pre-mutation gate** (run before touching any production file — see Section 6 of the task brief): all 16 checks passed, including 85-row reconciliation, 73-row final set, 12-row hold set with zero overlap, 17-company correction count, 56 approve_unchanged rows verified cell-for-cell unchanged, zero duplicate IDs, zero `(id, Saudi Arabia)` collisions, zero personal LinkedIn URLs, zero aggregator URLs stored as official careers URLs, zero wildcard/template URLs, zero embedded annotations in URL fields, full evidence traceability, valid schema enums, and valid CSV re-parsing.

**Post-mutation validation** (run immediately after appending to production): all 12 checks passed, including exact expected row counts (116 / 508 / 129), the exact 73 approved ids added once each, zero duplicate ids/pairs in both `saudi-arabia.csv` and the master registry, zero duplicate `source_id` values, zero held companies leaking into production, zero personal LinkedIn URLs, zero aggregator careers URLs, zero wildcard careers URLs, zero unverified free-mail addresses in promoted rows, zero secrets/binary/screenshot files in the diff (only the 3 expected `.csv` files appear in `git diff --numstat`), `AGENTS.md` unchanged, and all other market files (Lebanon/UAE/Qatar/Kuwait/international-remote) unchanged.

**Byte-level integrity**: all 43 original `saudi-arabia.csv` rows, all 435 original master-registry rows, and all 113 original source-catalog rows were independently re-compared cell-for-cell against the pre-mutation `git show HEAD:...` content and confirmed **identical** — the promotion was a pure append (`git diff --numstat` shows `73/0`, `73/0`, `16/0` — insertions only, zero deletions, zero modified lines in all three files). BOM and line-ending conventions were preserved exactly: appended content was written using the same CRLF terminators the working tree already uses (confirmed via `core.autocrlf=true`; the underlying git-blob convention is LF, which `git diff` correctly normalizes for — the working-tree byte format was matched to avoid any line-ending churn in the diff a human would review before committing).

**Repository checks** (all re-run in full at the final pre-commit validation step, per explicit instruction, even though this change touches only 3 CSV files and no application code):
- `npm run lint` (eslint): **PASS** — 0 errors. 11 pre-existing warnings remain in `n8n-workflows/cv-analysis-worker.ts` and `tests/workflow/cv-analysis-worker.test.mjs`, both unrelated to and untouched by this change; left as-is per the instruction not to modify unrelated code to silence pre-existing warnings.
- `npx tsc --noEmit` (TypeScript typecheck): **PASS**, zero output/errors.
- `npm run build` (Next.js production build): **PASS** — compiled successfully, all 28 static pages generated, no errors.
- `npm run test:unit`: **PASS** — 283/283 tests passed (59 suites), 0 failures.
- `npm run test:workflow`: **PASS** — 127/127 tests passed, 0 failures.
- `npm run test:db`: **BLOCKED — environmental, not a code failure.** Exact command: `npm run test:db` (runs `node scripts/run-db-tests.mjs`). Exact error: `[test:db] fatal: [db-test-guard] Could not read public.plans (TypeError: fetch failed). Is this the local ai-job-agent project with migrations applied?` — no local Supabase instance is available in this environment (`supabase` CLI not installed/not on `PATH`; `which supabase` and `supabase status` both fail). This is irrelevant to this change (no database schema, migration, or query code was touched — only CSV data files), but is reported honestly rather than fabricated as a pass.
- No Saudi-specific or job-source-discovery CSV validation script exists in `scripts/` or `package.json` — all such validation in this pass was performed with ad hoc quote-aware Node checks (documented throughout Sections 2–4 above and the human-quality-audit-report.md), not a repository-standard command.

## 10. Files changed

**Production files (modified, append-only):**
- `docs/job-source-discovery/saudi-arabia.csv` (43 → 116 rows)
- `docs/job-source-discovery/master-company-registry.csv` (435 → 508 rows)
- `docs/job-source-discovery/source-expansion/source-catalog.csv` (113 → 129 rows)

**Research/staging artifacts (modified to reconcile with production):**
- `docs/job-source-discovery/pilots/saudi-expansion/manual-review-queue.csv` (39 → 51 rows; +12 audit holds with `SA-HOLD-*` review IDs)
- `docs/job-source-discovery/pilots/saudi-expansion/saudi-promotion-staging.csv` (85 → 0 data rows; header-only, since every staged row has now been dispositioned — either promoted or moved to the hold queue)
- `docs/job-source-discovery/pilots/saudi-expansion/saudi-promotion-staging-manifest.csv` (85 rows retained; added `audit_final_decision` and `final_disposition` columns for full historical traceability)

**New files created (this pass):**
- `docs/job-source-discovery/pilots/saudi-expansion/correction-and-promotion-report.md` (this file)
- `docs/job-source-discovery/pilots/saudi-expansion/correction-manifest.csv` (48 rows — the 17-company field-level correction manifest)

**Untouched:** `AGENTS.md`; `lebanon.csv`; `uae.csv`; `qatar.csv`; `kuwait.csv`; `international-remote.csv`; `discovery-report.md`; `candidate-reconciliation.csv`; every prior-pass artifact not listed above (`baseline-assessment.md`, `supplied-linkedin-leads.csv`, `supplied-hr-email-audit.csv`, `discovered-job-sources.csv`, `discovered-employer-candidates.csv`, `duplicate-and-alias-review.csv`, `rejected-candidates.csv`, `search-query-matrix.csv`, `reconciliation-report.md`, `human-quality-audit-report.md`, `audit-findings-employers.csv`, `audit-findings-sources.csv`, `audit-findings-emails.csv`).

## 11. Confirmation of unchanged unrelated files

`git diff --stat main -- AGENTS.md docs/job-source-discovery/lebanon.csv docs/job-source-discovery/uae.csv docs/job-source-discovery/qatar.csv docs/job-source-discovery/kuwait.csv docs/job-source-discovery/international-remote.csv` returns empty. No application code, database migration, or configuration file was touched — `git diff --stat` for this entire pass shows exactly 3 files changed, all `.csv`, all in `docs/job-source-discovery/`.

## 12. Remaining manual-review work

12 companies remain in `manual-review-queue.csv` under review IDs `SA-HOLD-001` through `SA-HOLD-012`, each with an exact evidence gap and required action documented (see Section 3 above and the full notes field in `manual-review-queue.csv`). None are rejected; a future pass can resolve each and promote individually once the missing evidence is found. Additionally, two open cross-market ID-convention questions remain for a human product-owner decision (not blocking, documented in Section 8): the `cc-kbr` reuse precedent, and the `cc-tcs` vs. `cc-tata-consultancy-services-qatar` spelling inconsistency.

## 13. Final verdict

**READY_FOR_COMMIT**

All blocking validations passed before and after mutation. The promotion was applied as a clean, byte-safe, append-only change to all three production files with zero modification to any pre-existing row. Nothing has been staged, committed, or pushed — the working tree is left with the exact intended changes for human review.
