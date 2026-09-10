# Qatar Expansion — Deep-Search Query Matrix

Scope note: this pass's primary research input was a **user-supplied, externally-reviewed list of 77 unique employer/entity names** extracted from 37 LinkedIn screenshots that could not be attached inside this Claude Code session (see reconciliation-report.md, Section 1). All 77 leads were run through targeted WebSearch verification queries (Section A below). Section B documents the additional category/city query cells that were run or attempted against the broader task brief (AGENTS.md-adjacent research brief Sections 3A-3E) to extend coverage beyond the supplied lead list, and honestly marks which cells were **not** attempted this pass due to session/time budget.

## A. Per-lead verification queries (executed — 1 primary WebSearch query per lead, all 77 leads)

Pattern used: `"<Company Name>" Qatar careers official site` (or a company-appropriate variant, e.g. adding "office", "Doha", or the parent brand name for ambiguous/generic names). Full per-lead results and citations are recorded in the conversation trace and summarized in `manual-review-queue.csv`, `rejected-and-insufficient-evidence.csv`, and `proposed-qatar-staging.csv`.

## B. Category x city query-matrix cells (broader task brief)

| Cell | Status this pass | Notes |
|---|---|---|
| Qatar Chamber / QCCI directory | not re-run | Already documented in `source-expansion/source-catalog.csv` (`src-qa-qatar-chamber`, login-required, not accessed) — carried forward, not duplicated. |
| QFC public register / QFCRA register | not re-run | Already documented (`src-qa-qfc-public-register`, `src-qa-qfcra-register`, the latter confirmed accessible) — carried forward, not duplicated. |
| Qatar Free Zones Authority (QFZA) | not re-run | Already documented (`src-qa-qfza`, no public tenant directory found) — carried forward. |
| Qatar Science & Technology Park (QSTP) | not re-run | Already documented (`src-qa-qstp`) — carried forward; this pass independently reconfirmed Cisco's QSTP office as a live employer signal. |
| Qatar Business Incubation Center (QBIC) | not re-run | Already documented (`src-qa-qbic`) — carried forward. |
| Qatar FinTech Hub (QFTH) | not re-run | Already documented (`src-qa-qfth`, certificate error) — carried forward. |
| Mesaieed Industrial City employer cluster | not re-run | Already documented (`src-qa-mesaieed-industrial`) — carried forward; this pass independently added Ras Laffan Industrial City coverage via Everllence. |
| Ras Laffan Industrial City employer cluster | partially covered this pass | Everllence (Qatar) confirmed operating from Ras Laffan; no dedicated Ras Laffan employer-cluster directory search was run. Flagged as a gap for a future pass. |
| Lusail city-specific employers | partially covered this pass | Power International Holding (HQ Lusail) and Rosewood Doha (property confirmed in Lusail despite its brand name) both surfaced from the supplied lead list, not from a dedicated "Lusail" query sweep. |
| Al Rayyan / Education City | not re-run this pass | Already covered by existing verified rows (Qatar Foundation, HBKU, Sidra Medicine) per `source-expansion/source-catalog.csv`'s QSTP finding that these are mistagged `Doha` when they sit in Al Rayyan — flagged there as a correction candidate for a future pass, not re-investigated here. |
| Dukhan / Mesaieed / Al Khor sector sweeps (energy, industrial) | not attempted this pass | Genuine gap — see reconciliation-report.md Section 10 (Remaining Gaps). |
| Arabic-language query variants (e.g. "وظائف قطر", "شواغر قطر") | not attempted this pass | Genuine gap — all queries this pass were English-only. See Remaining Gaps. |
| Internship / graduate-programme-specific sweep across sectors | not attempted as a distinct sweep | Internship/graduate signals were captured opportunistically per-employer (e.g. North Oil Company, SLB, GE Vernova, UDST) rather than via a dedicated cross-sector internship query sweep. |
| ATS-platform-targeted searches (`site:myworkdayjobs.com Qatar`, `site:*.successfactors.* Qatar`, etc.) | not attempted this pass | Genuine gap — ATS platforms were identified opportunistically per-employer (Workday for KBR/Tivoli, Taleo for QSE, SmartRecruiters for Anantara/Tivoli, iCIMS for UDST, Trakstar for Mowasalat, Workable for ProgressSoft/TGP, Ashby for The Utopia Studio, Teamtailor for Millennium Hotel Doha) rather than via dedicated ATS-domain search operators. |
| Licensed recruitment-agency directory (Ministry of Labour list) | referenced, not fetched | `mol.gov.qa` "List of Registered Recruitment Agencies" PDF surfaced once in a search result (during the MACH Consultants query) but was not independently fetched/cross-checked against the 6 staffing agencies found this pass. Flagged as a gap. |

## C. Why the matrix is narrower than the full task-brief grid

The originating task brief (AGENTS.md-adjacent research prompt) specifies a much larger combinatorial grid (7 city terms x ~19 sector terms x English/Arabic). This pass prioritized **exhaustively resolving every supplied screenshot-derived lead** (all 77, zero silently dropped) over running the full independent discovery grid from scratch, given that:

1. The existing `qatar.csv` (40 rows) and `source-expansion/source-catalog.csv` Qatar section (16 rows, `src-qa-*`) already represent a prior, more systematic sweep across most of these categories (chambers, free zones, QSTP, QBIC, QFTH, Mesaieed).
2. The user's explicit mid-task correction narrowed the immediate deliverable to processing the supplied lead list as the screenshot-equivalent evidence set.

This is recorded honestly as a scope decision, not concealed. See reconciliation-report.md Section 10 for the full list of remaining gaps a future pass should close.
