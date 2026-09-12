# Saudi Arabia Employer & Job-Source Expansion — Reconciliation Report

Branch: `feat/saudi-registry-expansion`, created off `main` at `ca0be35` (includes the completed Lebanon, UAE, and Qatar expansions). `git status --short` was clean before branching; local `main` was fast-forwarded 2 commits via `git pull --ff-only origin main` (picking up the merged Qatar expansion) before this branch was cut.

Phase: **discovery, verification, staging, and reconciliation only. Nothing has been promoted, committed, staged, pushed, or merged.**

## 1. Baseline (see `baseline-assessment.md` for full detail)

`saudi-arabia.csv`: 43 employer rows, 43 unique canonical IDs, 22 verified / 19 needs_manual_review / 2 no_official_source_found. `master-company-registry.csv`: 435 rows total, Saudi block = 43, matches `saudi-arabia.csv` exactly, zero `(canonical_id, target_country)` collisions. `source-catalog.csv`: 13 Saudi rows, mostly not-yet-automation-approved. `international-remote.csv`: 31 rows total, 2 mention Saudi Arabia.

## 2. Method

Research was run as four parallel deep-research passes (each independently verifying against live web sources via WebSearch/WebFetch, no fabrication, no LinkedIn scraping, no Apify or paid services):
1. Supplied LinkedIn leads, batch 1 (73 names)
2. Supplied LinkedIn leads, batch 2 (73 names) — one name ("Master Works") was inadvertently skipped by this pass and was individually researched afterward once the session's WebSearch budget (200 calls/session) was already exhausted; it landed at `insufficient_evidence` with an honest note about the budget constraint rather than a guess.
3. Supplied HR/recruitment email audit (61 unique addresses)
4. Independent bilingual (English + Arabic) source discovery (see `search-query-matrix.csv`)

All four passes read `AGENTS.md`, the existing per-market CSVs, and the master registry before researching, so cross-market duplicate checks (Lebanon/UAE/Qatar/Kuwait, not just Saudi) were applied throughout.

## 3. Supplied LinkedIn lead accounting — 155/155 reconciled

The task supplied 155 distinct bullet-point leads (verified by direct recount against the task text; several bullets like "The Saudi National Bank / SNB" or "Amazon Web Services / Amazon" intentionally bundle a brand + legal-name pair as one lead, so 155 raw bullets = 155 leads, no further row-level dedup was needed at the list level). All 155 received exactly one final outcome in `supplied-linkedin-leads.csv`:

| Outcome | Count |
|---|---|
| `verified_stage_employer` | 85 |
| `manual_review` | 39 |
| `insufficient_evidence` | 14 |
| `source_catalog_candidate` | 4 |
| `already_present` | 10 |
| `duplicate_or_alias` | 2 |
| `rejected` | 1 |
| **Total** | **155** |

**`already_present` (10)**: KAUST, Red Sea Global, Salla, McKinsey & Company, flynas, HungerStation, stc, Ma'aden, Deloitte, and Saudi National Bank/SNB — all exact matches to already-verified rows in `saudi-arabia.csv`, confirmed by quote-aware normalized-name matching before any web research was spent on them.

**`duplicate_or_alias` (2)**: QuantumBlack (McKinsey's AI division — same corporate entity as the already-present `cc-mckinsey` row) and "Emdad by Elm" (the exact portal already cited as evidence on the existing `cc-elm` row). See `duplicate-and-alias-review.csv` for the full reasoning, including two explicit **negative** findings the task asked to confirm: **HUMAIN (Saudi PIF AI company) is NOT the same entity as UAE's existing `cc-humai`**, and **"Noon – Education for Everyone" (Noon Academy, an EdTech company) is NOT the e-commerce company Noon.com** — both real, distinct, correctly kept separate.

**`source_catalog_candidate` (4)**: Avensys Consulting, Scout Global, SmartChoice International GCC, and Jobgether — recruitment agencies/aggregators, not direct employers; folded into `discovered-job-sources.csv` rather than staged as employers, per Section 7's employer/source separation rule.

**`rejected` (1)**: "Why Hiring" — no identifiable company or platform by this name was found; not invented.

**`insufficient_evidence` (14)**: Scale AI (already verified for Qatar only — genuinely needs new Saudi-specific evidence, not a duplicate), SoftServe, Wonderful, THE-TEAM, Systems Arabia, Star, SoftwareOne, Master Works, The Flex, GESMA, IBES Technologies, Nua-Fit, iSoftStone, UFC Gym KSA. Full reasoning per item in `rejected-candidates.csv`.

**`manual_review` (39)**: real, identifiable companies with genuine Saudi-relevant signal (live third-party job postings, press coverage, or confirmed office presence) but falling short of the full promotion bar — usually a missing/unconfirmed official careers URL, or a genuine name-collision risk against another similarly-named real entity (CODE LTD, Awtad, REEF Group, NAMAA, Ace Creative Hub, PULSE MENA — all flagged the same way the existing registry already flags "Esnad Contracting"). Full list in `manual-review-queue.csv`.

**`verified_stage_employer` (85)**: official domain + confirmed Saudi presence/eligibility + an official careers/ATS channel (or an honestly-documented zero-open-jobs status on the real portal). Staged in `saudi-promotion-staging.csv` — see Section 6.

## 4. Supplied HR-email accounting — 62/62 reconciled (61 unique)

The raw list had 62 entries with one exact duplicate (`al.alshaikh@bonyan.sa`, listed twice per the task's own known-issue note) → 61 unique normalized addresses. All 62 rows received exactly one status in `supplied-hr-email-audit.csv`:

| Status | Count |
|---|---|
| `third_party_or_free_mail_unverified` | 46 |
| `domain_mismatch_or_suspicious` | 5 |
| `company_identity_unresolved` | 5 |
| `official_general_contact_not_recruitment` | 4 |
| `official_recruitment_email_verified` | 1 |
| `duplicate` | 1 |
| `rejected_unsafe` | 0 |
| **Total** | **62** |

**Only 1 email cleared the first-party evidence bar**: `klc.hr@alkafaa.com` (Al Kafaa Limited Co., a Dammam steel/pipe distributor) — its official careers page's own "Apply Now" links are literally `mailto:klc.hr@alkafaa.com`, directly fetched and confirmed. Every other real-company domain (hospitals, contractors, conglomerates) had its *company* identity confirmed but not the *specific mailbox* as an official recruitment channel per the task's evidence standard — correctly kept at `third_party_or_free_mail_unverified` rather than promoted on domain-ownership alone.

**Free-mail addresses (6 of 62)**: `hr.qrm@hotmail.com`, `job.s6@hotmail.com`, `shababwatansa@gmail.com`, `recruitment.amjad@gmail.com`, `jobrydlaw@gmail.com`, `hiringnow.ksa@gmail.com` — all correctly held at `third_party_or_free_mail_unverified`, none promoted.

**`recruiting.ksa@mcmermott.com`**: per the task's explicit instruction, this was investigated for a possible McDermott International connection but **not silently corrected or attributed** — McDermott's real domain is `mcdermott.com`, and `mcmermott.com` does not independently resolve to any indexed company; classified `domain_mismatch_or_suspicious` (plausible typosquat) rather than assumed genuine.

**Generic/non-recruitment mailboxes correctly downgraded**: `marketing.np@nesma.com` (marketing dept, not recruitment), `info@alhumamlaw.com`, `info@atco.com.sa`, `info@familycare.com.sa` — all `official_general_contact_not_recruitment` per the task's explicit rule against labeling generic inboxes as recruitment channels just because they appeared on the list.

No email was sent, no SMTP probing was performed, and no domain/mailbox existence was tested beyond passive WebSearch/WebFetch, per the hard safety rules.

## 5. Independent discovery — sources and incidental employer leads

`discovered-job-sources.csv` (16 rows: 12 from the dedicated independent-discovery pass + 4 recruitment-agency/aggregator leads reclassified out of the supplied-LinkedIn-list per Section 7):

- **Government portals**: Jadarat (جدارات) — the highest-value gap filled this pass, official HRDF-run national platform, but blocked (HTTP 403) to automated fetch both on its homepage and robots.txt; Taqat (طاقة) confirmed as a superseded legacy platform, flagged so it isn't mistaken for a second live portal; HRDF's own informational site is accessible but not itself a listings surface.
- **PIF portfolio directory** and **Saudi Exchange (Tadawul) listed-company directory** — both officially the highest-value company-discovery sources, both blocked (HTTP 403) to automated fetch this pass; third-party mirrors exist as secondary evidence only.
- **Chambers**: Jeddah Chamber of Commerce (JCCI) + its BluePages business directory — genuine new geographic coverage (previously only Riyadh/Asharqia/national-umbrella chambers existed in the catalog).
- **Job boards**: Mihnati.com, Wadhefa.com, Tanqeeb Saudi, GulfTalent's dedicated Saudi page — all real and confirmed, all held at `manual_review_only` rather than `approved_for_automated_ingestion` because each carries a specific technical caution (Mihnati's robots.txt disallows the likely `/ar/` listing path; Wadhefa disallows `/list_featured_jobs/` and sets a 30s crawl-delay; Tanqeeb returned empty/JS-rendered content on direct fetch; **GulfTalent's robots.txt explicitly names and blocks ClaudeBot** even though it allows generic crawlers, which is a hard block for this project's tooling specifically regardless of the general `Allow: /`).
- **Recruitment agencies**: NADIA Global, Cooper Fitch, SmartChoice International, Scout Global, Avensys Consulting — real, but overwhelmingly a B2B/client-identity-undisclosed model, so kept at `manual_review_only`/`discovery_only` rather than treated as ingestible job boards.
- **Remote aggregator**: Jobgether — has Saudi-Arabia-specific category pages, employer identity disclosed per listing.

`discovered-employer-candidates.csv` (2 rows, both flagged only, not verified): Cooper Fitch (dual-role candidate — may itself be a genuine direct employer of its own recruiters, not just a source; needs a follow-up pass) and BAC Middle East (secondary/aggregator evidence only).

**Stopping reason** (see `search-query-matrix.csv` for the full family-by-family breakdown): Saudi government/regulator domains (jadarat.sa, pif.gov.sa, saudiexchange.sa) showed a consistent, repeated HTTP 403 anti-bot pattern regardless of query angle, matching the same pattern already documented in `source-catalog.csv` for the Riyadh Chamber and Council of Saudi Chambers. Recruitment-agency sites overwhelmingly use a B2B lead-gen model rather than public job boards. Additional queries within the remaining families began returning the same handful of names already captured. This is an honest stopping point, not a claim of exhaustive coverage.

## 6. 85 employers staged for `saudi-arabia.csv` (`saudi-promotion-staging.csv`)

Full 34-column schema match confirmed against production (header diff = identical), UTF-8 BOM + LF line endings added to match the confirmed production encoding convention (verified via `git show HEAD:...`, since local checkout auto-converts to CRLF), zero duplicate `canonical_company_id` values, zero `(canonical_id, "Saudi Arabia")` collisions against `saudi-arabia.csv` or `master-company-registry.csv`.

**Every staged row is deliberately marked `review_status = needs_manual_review`, not `verified`** — even though the LinkedIn-lead-level outcome is `verified_stage_employer`. This is intentional: Batch 1's verification methodology was WebSearch-snippet-based (cross-corroborated across 2-3 sources per lead) rather than a direct confirmatory fetch of every official page, and even Batch 2's more WebFetch-heavy pass didn't independently re-verify every field (e.g. `early_career_relevance`, LinkedIn presence fields are honestly left `unknown`/`not_verified` rather than guessed). A human doing the final promotion pass should do one confirmatory browser visit per row before flipping `review_status` to `verified` and merging into production — consistent with the task's instruction to never mark a result successful before it's actually validated.

**Coverage improvement vs. the baseline gaps**: Jeddah goes from 4 rows to 13+ (~15 counting multi-city mentions); Eastern Province (Al Khobar/Dammam/Jubail) goes from 1 multi-city row to 9+; 2 rows are explicitly remote-eligible for Saudi-based candidates (DataRobot, Cohere's Country Manager role). ATS diversity added: SmartRecruiters, Recruitee, Workday, Workable (5), Lever, Greenhouse (2), Oracle Cloud HCM, JazzHR, Breezy HR, MapleHR, Zoho Recruit, Talentera — most staged rows (66/85) have `ats_provider = unknown` because a specific ATS platform wasn't identifiable from the evidence gathered, not because none exists; a human re-check may upgrade some of these.

**Multi-market canonical-ID findings requiring human sign-off** (full detail in `duplicate-and-alias-review.csv`, no production ID was renamed):
- **SLB** and **Tata Consultancy Services** were staged under new market-neutral IDs (`cc-slb`, `cc-tcs`) since no bare id existed yet, while their existing Qatar rows use suffixed forms (`cc-slb-qatar`, `cc-tata-consultancy-services-qatar`) — a human may want to reconcile the spelling.
- **KBR** was staged reusing the *exact same* id as its existing (unsuffixed) Qatar row, `cc-kbr`, which is explicitly allowed since `(id, target_country)` uniqueness was verified — but flagged since it differs from how Amazon/Accenture (suffixed) were staged.
- **Amazon** (`cc-amazon-sa`) and **Accenture** (`cc-accenture-sa`) follow the existing `-uae`/`-qatar` suffix convention already established by their sibling rows.

## 7. 39 leads escalated to manual review (`manual-review-queue.csv`)

Real, identifiable companies with genuine Saudi signal but an evidence gap (usually: no confirmed official careers URL, or a name-collision risk against another real entity). Notable name-collision flags, all handled the same way the existing registry already treats "Esnad Contracting": **CODE LTD** (two distinct real Saudi IT companies both trade as "CODE"), **Awtad** (at least 3 distinct Saudi entities), **REEF Group** (collides with the unrelated global surf brand reef.com), **NAMAA**, **Ace Creative Hub**, **PULSE MENA**. **HUMAIN** is here too — real and distinct (see Section 3), but its own careers/ATS URL wasn't directly confirmed this pass.

## 8. 15 leads rejected or insufficient evidence (`rejected-candidates.csv`)

14 `insufficient_evidence` + 1 `rejected` ("Why Hiring" — no such entity found). None were invented; each row states exactly what was searched and why it fell short.

## 9. Production files confirmed unchanged

`git status --short` shows only the new untracked `docs/job-source-discovery/pilots/saudi-expansion/` directory. `git diff --stat main -- docs/job-source-discovery/` (excluding the new pilot directory) returns empty — `saudi-arabia.csv`, `master-company-registry.csv`, `source-expansion/source-catalog.csv`, `international-remote.csv`, and every other market file are byte-for-byte unchanged. `AGENTS.md` has zero diff against `main` and is not staged. No `git add`, commit, push, or PR was performed. No paid service (Apify or otherwise) was used.

## 10. Validation performed

Quote-aware CSV parsing (not naive comma-splitting) was used throughout, and the following were programmatically verified (see inline conversation for the exact scripted checks):
- All 155 LinkedIn leads and all 62 email rows have exactly one outcome/status each, reconciled against the raw counts.
- Zero duplicate staged `canonical_company_id` values; zero `(id, "Saudi Arabia")` collisions against the existing 435-row master registry.
- Every staged employer has a non-empty, non-aggregator `evidence_urls` value; no aggregator domain (Bayt, Wuzzuf, Glassdoor, GulfTalent, LinkedIn, etc.) is stored as an `official_careers_url`.
- The only `official_recruitment_email_verified` row has direct first-party evidence; zero free-mail addresses were promoted.
- **One violation was found and fixed during validation**: a personal `linkedin.com/in/` profile URL had leaked into the evidence field for the "REEF Group" lead (from the research pass) — removed from both `supplied-linkedin-leads.csv` and `manual-review-queue.csv` before finalizing. Re-validated clean afterward.
- `saudi-promotion-staging.csv` header is byte-identical to production's 34-column schema; BOM/LF encoding matches the confirmed committed convention (verified via `git show`, not the locally-checked-out CRLF form which is a `core.autocrlf` artifact, not the real repository convention).
- All CSVs in the new pilot directory re-parse cleanly with the same quote-aware parser after every edit.

No lint/typecheck/test suite applies to this change — no application code, database file, or migration was touched; only new Markdown/CSV research artifacts were added under `docs/job-source-discovery/pilots/saudi-expansion/`.

## 11. Remaining evidence gaps (honest disclosure)

- 66 of 85 staged employers have `ats_provider = unknown` — a human browser check may identify the actual platform.
- Batch 1's verification methodology (WebSearch-snippet cross-corroboration) is weaker than Batch 2's (more direct WebFetch); all 85 are conservatively held at `needs_manual_review` rather than `verified` specifically to reflect this.
- Jadarat, PIF's portfolio directory, and the Saudi Exchange listed-company directory — the three highest-value remaining discovery sources — are all blocked to automated fetch and need a manual browser visit in a future pass.
- The session's WebSearch budget (200 calls) was exhausted before the HR-email audit's final ~15 domains and before "Master Works" could be researched with search; both were handled with WebFetch-only fallback or honestly flagged as an evidence gap rather than guessed.
- `Cooper Fitch`'s dual role (source vs. genuine direct employer of its own staff) was flagged but not resolved this pass.

## 12. Final verdict

**READY_FOR_HUMAN_REVIEW**
