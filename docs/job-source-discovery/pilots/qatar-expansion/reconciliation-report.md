# Qatar Job-Source & Employer-Discovery Expansion — Reconciliation Report

Branch: `feat/qatar-registry-expansion` (created fresh off `main`, per user confirmation, after stashing an unrelated auto-generated `AGENTS.md` footer change from the prior branch).
Date: 2026-09-10.
Phase: discovery, verification, staging, and reconciliation only. **Nothing has been promoted, committed, staged, pushed, or merged.**

## 1. Screenshot handling — honest disclosure

The originating task asked for OCR processing of attached LinkedIn screenshots. **No image files were actually attached to this Claude Code session** — confirmed at the start of this task and again when the user was asked directly. Per the user's explicit mid-task correction:

> "Although the screenshot files are unavailable inside Claude Code, their visible employer names were manually extracted and reviewed outside this session. Treat the following as the complete user-supplied LinkedIn discovery lead set."

**37 user screenshots were externally reviewed by the user and converted into a supplied list of 77 unique employer/entity names**, which this pass treated as the screenshot-derived lead set in place of direct OCR. No screenshots were processed by this session, and this report does not claim otherwise. All 77 supplied names received exactly one traceable outcome — see `screenshot-lead-inventory.csv`.

## 2. Baseline inspected before any research

| File | Baseline state |
|---|---|
| `docs/job-source-discovery/qatar.csv` | 40 employer rows, UTF-8 with BOM, LF line endings, 34-column schema, header confirmed |
| `docs/job-source-discovery/international-remote.csv` | 31 rows, same schema family |
| `docs/job-source-discovery/master-company-registry.csv` | 398 rows (union of all per-country files); Qatar block = rows 144-183, identical content to qatar.csv |
| `docs/job-source-discovery/source-expansion/source-catalog.csv` | 16 Qatar rows (`src-qa-*`, rows 46-61) — note: this file lives at `source-expansion/source-catalog.csv`, not the top-level path named in the original task brief; the top-level path does not exist in this repository. Used the real path. |
| `docs/job-source-discovery/discovery-report.md`, `candidate-reconciliation.csv` | Inspected for context; no Qatar-specific pilot directory existed before this pass |

No prior Qatar-specific pilot directory existed. This is the first dedicated deep-research pass beyond the 40 rows already verified in `qatar.csv`.

## 3. Branch and safety setup

1. Confirmed no dedicated Qatar branch existed (`feat/uae-registry-expansion` was checked out, with an unrelated uncommitted `AGENTS.md` change — the standard `next dev`-regenerated footer block per the note at the top of that file).
2. Presented the user two decisions (branch strategy; how to proceed without screenshots) via `AskUserQuestion`.
3. Per the user's choice: stashed the `AGENTS.md` footer change (`git stash push -u -- AGENTS.md`), switched to `main`, fast-forward pulled (picked up 3 new merged commits including the UAE registry promotion), and created `feat/qatar-registry-expansion` fresh off `main`.
4. `AGENTS.md` remains untouched and unstaged on this branch throughout.

## 4. Deduplication against existing registries

Before any web research, all 79 raw supplied names (77 unique after consolidating obvious duplicates like "Hilton / Hilton Salwa") were grep-matched against `master-company-registry.csv` (which covers every market, not just Qatar). Result: **9 exact employer matches already verified/present in `qatar.csv`**, plus 2 relationship findings resolved without new web research (see `duplicate-and-alias-review.csv`):

- Already present: Qatar Airways, Snoonu, Commercial Bank of Qatar, QNB Group (→ existing row "Qatar National Bank"), Milaha, QatarEnergy, Vodafone Qatar, Qatar Insurance Group, Doha Bank.
- Duplicate/alias: **QatarEnergy LNG** (alias of the already-verified `cc-qatarenergy` row, whose researcher_notes already document the LNG portal); **Minor Hotels** (parent brand of Anantara and Tivoli, both staged separately as distinct properties, consistent with this registry's existing brand-separation convention).

All 68 remaining unique leads were individually verified via live WebSearch this pass (see `query-matrix.md` Section A).

## 5. Final classification of all 77 supplied leads

| Outcome | Count |
|---|---|
| `already_present_qatar_registry` | 9 |
| `duplicate_or_alias` | 2 |
| `new_employer_candidate` → of which: | **44** |
| &nbsp;&nbsp;→ staged (`verified_stage_for_qatar`) | 38 |
| &nbsp;&nbsp;→ escalated to manual review | 6 |
| `recruitment_or_staffing_source` | 6 |
| `insufficient_evidence` → of which: | **15** |
| &nbsp;&nbsp;→ escalated to manual review (real company, weak Qatar-specific evidence) | 7 |
| &nbsp;&nbsp;→ hard insufficient evidence (no confirmable entity match) | 8 |
| `reject` | 1 |
| **Total** | **77** |

Every number above is individually reconciled against the underlying CSVs (`screenshot-lead-inventory.csv`, `proposed-qatar-staging.csv`, `manual-review-queue.csv`, `rejected-and-insufficient-evidence.csv`, `source-candidate-inventory.csv`) — verified with `wc -l`/`grep -c` counts, not estimated.

## 6. 38 employers staged for `qatar.csv` (`proposed-qatar-staging.csv`)

Full 34-column schema match confirmed (header diffed against production), UTF-8 BOM added to match production encoding, LF line endings matched, no duplicate `canonical_company_id` values, zero collisions against `qatar.csv` or `master-company-registry.csv` (checked with `comm -12`).

Company list: Al Abdulghani Motors, Ali Bin Ali, American Academy School Qatar, Anantara Hotels & Resorts (Banana Island Resort Doha), Accenture, BAE Systems, Cisco, Doha Golf Club, Ecolab, Everllence, EPAM Systems, GE Vernova, IBIS (ibis and Adagio Doha), International Schools Partnership, KBR, Lesha Bank, malomatia, Millennium Hotel Doha, Mowasalat (Karwa), North Oil Company, Power International Holding, ProgressSoft Corporation, Pullman Doha West Bay, Qatar Stock Exchange, Regency Technology Qatar, Rosewood Doha, Scale AI, Shell Qatar, SLB, Supermicro, Systems Limited, TGP International, Tata Consultancy Services, The Utopia Studio, Tivoli Hotels & Resorts, University of Doha for Science and Technology, Forvis Mazars in Qatar, Hilton Salwa Beach Resort & Villas.

Notable findings surfaced by this pass:
- **New city coverage**: Everllence confirmed operating from **Ras Laffan Industrial City** (previously zero rows anywhere in `qatar.csv`, per the existing `source-expansion/source-catalog.csv` gap note for `src-qa-mesaieed-industrial`); Power International Holding is HQ'd in **Lusail**; Rosewood Doha's confirmed live job posting places the actual property in **Lusail**, not Doha, despite the brand name — flagged in researcher_notes so ingestion doesn't mis-tag the city.
- **Strong ATS diversity added**: Workday (KBR, Tivoli), Taleo (Qatar Stock Exchange), SmartRecruiters (Anantara, Tivoli), iCIMS (UDST), Trakstar (Mowasalat), Workable (ProgressSoft, TGP International), Ashby (The Utopia Studio), Teamtailor (Millennium Hotel Doha), Greenhouse (Scale AI).
- **Dedicated country-level careers presence** (stronger than the usual global-portal-with-filter pattern already accepted elsewhere in this registry): BAE Systems has its own `careers-in-qatar` page; Shell has a full `.com.qa` careers section with a Qatarization program; TCS, Everllence, EPAM, and International Schools Partnership all have dedicated Qatar-specific careers subpages/filters.

## 7. 13 leads escalated to manual review (`manual-review-queue.csv`)

Real, identifiable entities where evidence fell short of the promotion bar (missing/unconfirmed official careers URL, or genuine name ambiguity between multiple real entities): Al Sharq Technology, Advanced Business Computing, Galfar Al Misnad, Starlink Qatar, beIN Media Group, Wood, Nozomi Networks, ATNS InfoTech, NODA AI, TAQAT, PayTech Group, Society Qatar (Society Lounge Doha), and Leading Holding Group in Qatar (confirmed to be a recurring generic confidential-listing label — plausible real candidates researched: Almana Group, Qatari Investors Group, Tadawul Holding Group, Estithmar Holding).

## 8. 8 leads with hard insufficient evidence + 1 rejection (`rejected-and-insufficient-evidence.csv`)

The Flex, Information & Communication Technology (ICT — reads as a sector label, not a company), Thaura, Lucidya (real company, no Qatar presence found), Tech Ladies, SOAIS (search conflated it with the unrelated real company SOSi), JoVE (real company, no Qatar presence), ROGII (real company, no Qatar presence). **Rejected**: "Confidential Jobs / Confidential employer listings" — explicitly not converted into an invented employer, per task rule.

## 9. 6 recruitment/staffing sources identified (`source-candidate-inventory.csv`, `proposed-source-catalog-additions.csv`)

Manforce Group, MACH Consultants, Edison Smart, Fusion Outsourcing & Services, Vistas Global, Kingston Stanley — all genuine, Qatar-active staffing/recruitment agencies. Per task rule 4B, none were staged as employers in `qatar.csv` because no internally-confirmed (non-client-placement) vacancy was independently verified for any of them. All 6 proposed as `source-expansion/source-catalog.csv` additions (source_category = `recruitment_agency`), with `automation_eligibility` conservatively left `not_evaluated_this_pass`.

## 10. International-remote candidates: none found

`proposed-international-remote-staging.csv` contains only the header row. All 77 supplied leads described on-site/hybrid Qatar postings; none described a non-Qatar-HQ'd employer explicitly open to Qatar-resident remote applicants. This is recorded honestly rather than forcing a match.

## 11. Job boards, portals, aggregators, and directories encountered

No new job-board/portal/directory sources were added to the source catalog this pass beyond the 6 recruitment agencies above — every aggregator surfaced during research (Bayt, GulfTalent, Naukrigulf, Qureos, Glassdoor, Indeed, gulfjobs.el7far.com, etc.) was already either catalogued in the existing `source-expansion/source-catalog.csv` Qatar section or explicitly out of scope (LinkedIn, excluded per AGENTS.md §7 and the existing `src-qa-linkedin-excluded` row). No aggregator URL was stored as any employer's official careers URL.

## 12. Automation-readiness / source-type breakdown (new staging rows)

Of the 38 staged employers: 13 have a confirmed named ATS (`suitable_public_ats`), 25 have a confirmed official HTML careers page without an independently-identified ATS vendor (`suitable_public_html_subject_to_review`). None were marked `manual_only` or left as `unknown` automation eligibility, since every staged row had at least a direct official careers URL.

## 13. Sector and city coverage added

Sectors newly represented or deepened: aviation-adjacent defense (BAE Systems, KBR, Scale AI public-sector), oil & gas services (SLB, Ecolab, Everllence, North Oil Company), hospitality (7 new hotel/venue properties — Anantara, Tivoli, Hilton Salwa, Rosewood, Millennium, Pullman, ibis, Doha Golf Club), retail/automotive (Ali Bin Ali, Al Abdulghani Motors), IT services/consulting (EPAM, Cisco, TCS, Systems Limited, Accenture, malomatia, ProgressSoft, Regency Technology, The Utopia Studio), education (International Schools Partnership, UDST, American Academy School Qatar), finance (Qatar Stock Exchange, Lesha Bank), conglomerate (Power International Holding), hardware (Supermicro, GE Vernova). Cities: Doha (majority), Lusail (new: Power International Holding, Rosewood Doha), Ras Laffan Industrial City (new: Everllence).

## 14. Validation performed

All items from AGENTS.md-adjacent task Section 10 were checked:
- Every one of the 77 supplied leads received exactly one traceable outcome — reconciled by exact count (Section 5 table sums to 77).
- No duplicate `canonical_company_id` within the new staging file, and zero collisions against `qatar.csv` or `master-company-registry.csv` (verified with `comm -12`, empty result both times).
- No duplicate `source_id` between the proposed source-catalog additions and the existing catalog (verified with `comm -12`, empty result).
- No personal `linkedin.com/in/` URL appears anywhere in any new file (grep-checked).
- No job board or aggregator was stored as an employer's official careers URL.
- No employer without independently-confirmed Qatar presence was staged for `qatar.csv`.
- No confidential/anonymized listing was converted into an invented employer.
- CSV schema, BOM (added to match), UTF-8 encoding, and column count all confirmed matching the destination files' conventions.
- `git diff --stat` against `qatar.csv`, `international-remote.csv`, `master-company-registry.csv`, and `source-expansion/source-catalog.csv` is **empty** — all four production files are byte-for-byte unchanged.
- `AGENTS.md` remains untouched and unstaged.
- `git status --short` shows only the new `docs/job-source-discovery/pilots/qatar-expansion/` directory as untracked — no other files touched, no secrets/binaries/screenshots added.
- No Apify calls were made; no paid services were used.
- No commits, staging, pushes, or merges were performed.

## 15. Remaining gaps (honestly documented, not silently dropped)

- **Arabic-language queries**: none were run this pass; all research was English-only.
- **ATS-domain search operators** (`site:myworkdayjobs.com Qatar`, `site:*.successfactors.* Qatar`, etc.): not run as dedicated sweeps; ATS vendors were identified opportunistically per-employer.
- **Dukhan / Al Khor sector sweeps**: not attempted.
- **Ras Laffan employer-cluster directory**: only one employer (Everllence) surfaced there; no dedicated cluster sweep was run (unlike the existing Mesaieed cluster finding in `source-expansion/source-catalog.csv`).
- **Ministry of Labour licensed recruitment-agency list** (`mol.gov.qa` PDF): surfaced once in search results, not independently fetched or cross-checked against the 6 staffing agencies found.
- **Education City / Al Rayyan mistagging**: a pre-existing finding (documented in `source-expansion/source-catalog.csv`'s `src-qa-qstp` row) that Qatar Foundation, HBKU, and Sidra Medicine are tagged `Doha` despite sitting in Al Rayyan Municipality was re-confirmed but not corrected, since amending already-verified production rows is outside this pass's scope.
- **Government/public-authority career portals beyond those already catalogued**: not re-swept this pass.
- Full category x city query-matrix detail and rationale for this pass's narrower scope: see `query-matrix.md`.

## 16. Files created this pass

All under `docs/job-source-discovery/pilots/qatar-expansion/` (new directory, nothing pre-existing overwritten):

1. `screenshot-lead-inventory.csv` — all 77 leads, screenshot-outcome enum
2. `query-matrix.md` — deep-search query matrix and scope rationale
3. `source-candidate-inventory.csv` — 6 staffing-agency source candidates
4. `manual-review-queue.csv` — 13 leads needing human follow-up
5. `duplicate-and-alias-review.csv` — 9 already-present + 2 alias findings
6. `rejected-and-insufficient-evidence.csv` — 8 insufficient-evidence + 1 rejection
7. `proposed-source-catalog-additions.csv` — 7 rows (6 new + 1 confirmatory LinkedIn-exclusion note)
8. `proposed-qatar-staging.csv` — 38 verified employer candidates, exact `qatar.csv` schema
9. `proposed-international-remote-staging.csv` — header only, no candidates found
10. `reconciliation-report.md` — this file

## 17. Confirmations

- **No Apify calls or paid services were used** — all research used WebSearch/WebFetch only.
- **Production registries were not modified** — `qatar.csv`, `international-remote.csv`, `master-company-registry.csv`, and `source-expansion/source-catalog.csv` are byte-for-byte unchanged (confirmed via empty `git diff --stat`).
- **`AGENTS.md` was not modified or staged.**
- **No commit, push, staging, or PR was created.**

## 18. Final verdict (superseded — see update below)

**READY_FOR_HUMAN_REVIEW** (original verdict at time of initial discovery).

All 77 supplied leads were traced to a final outcome with reconciled totals, 38 new employer candidates were originally staged with schema-matched evidence for human review before promotion, 6 staffing-agency sources were proposed for the source catalog, all safety/scope constraints were respected, and remaining research gaps were explicitly documented above rather than concealed.

## 19. Post-audit update (2026-09-10)

This discovery-phase report was followed by two further passes, both documented in sibling files in this same directory:

1. **`human-quality-audit-report.md`** — a human-quality pre-promotion audit of all 38 staged employers and 6 proposed sources. Found 24 clean, 10 needing named corrections, 4 held (Cisco, Pullman Doha West Bay, Hilton Salwa, ibis Doha) pending re-verification or a product-owner policy decision on hotel-brand canonical-ID granularity.
2. **`correction-application-report.md`** — applied the 10 approved corrections, resolved Cisco (re-verified and approved), consolidated Pullman Doha West Bay + ibis Doha into one brand-level `cc-accor` row (reusing the existing shared canonical ID already established in `uae.csv`), and kept Hilton Salwa held pending a production-touching canonical-ID normalization decision. The current staged employer count is **36** (see `staging-manifest.csv` for full before/after traceability of every original candidate ID). The verdict as of this later pass is recorded in `correction-application-report.md`, not restated here to avoid drift between documents.

The counts in Sections 5-6 above reflect the *original* discovery pass and are now superseded by `staging-manifest.csv` and `correction-application-report.md` for the current state.
