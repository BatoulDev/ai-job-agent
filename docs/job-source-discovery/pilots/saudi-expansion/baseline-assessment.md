# Saudi Arabia Employer & Job-Source Expansion — Baseline Assessment

Branch: `feat/saudi-registry-expansion`, created off `main` at `ca0be35` (`Merge pull request #18 from BatoulDev/feat/qatar-registry-expansion`), which includes the completed Lebanon, UAE, and Qatar registry expansions. Local `main` was 2 commits behind `origin/main`; fast-forwarded via `git pull --ff-only origin main` before branching — no user work was at risk (`git status --short` was clean beforehand).

Phase: baseline inspection only. **No production file has been modified in this phase.**

## 1. Files inspected

All CSVs were parsed with a quote-aware RFC4180 parser (handles embedded commas, quotes, and quoted newlines) — not naive comma-splitting.

| File | Rows (data only) | Columns | Notes |
|---|---|---|---|
| `docs/job-source-discovery/saudi-arabia.csv` | 43 | 34 | Same 34-column schema as other market files |
| `docs/job-source-discovery/master-company-registry.csv` | 435 | 34 | Union of Lebanon (130) + Saudi Arabia (43) + Qatar (77) + Kuwait (36) + UAE (149) = 435; confirmed zero duplicate `(canonical_company_id, target_country)` pairs |
| `docs/job-source-discovery/source-expansion/source-catalog.csv` | 113 | 16 | 13 rows already tagged `market = Saudi Arabia` |
| `docs/job-source-discovery/international-remote.csv` | 31 | 34 | Only 2 rows mention "Saudi" anywhere in the record |

## 2. Saudi Arabia baseline (`saudi-arabia.csv`)

- **43 employer rows, 43 unique `canonical_company_id` values** — no internal duplicates.
- `review_status`: `verified` = 22, `needs_manual_review` = 19, `no_official_source_found` = 2.
- `company_type`: public_listed 13, multinational_subsidiary 9, startup 7, government_linked 4, private 4, professional_services_firm 3, university 1, construction 1, employer_company 1.
- **City coverage**: heavily Riyadh-centric (21 of 43 rows mention Riyadh) and Country-wide (11). Only single rows for Tabuk/NEOM, Thuwal (KAUST), Umluj (Red Sea Global). **Jeddah appears in only 4 rows as primary city** despite being Saudi's second-largest city and main Red Sea port — a clear coverage gap. **Dammam/Khobar/Eastern Province appears in only 1 multi-city row** (HMG) — no dedicated Eastern Province employer yet, despite Aramco (Dhahran), SABIC, and the Asharqia Chamber all pointing to that industrial corridor. **No dedicated Makkah/Madinah row** despite the supplied query list explicitly including وظائف مكة / المدينة.
- **Industry coverage**: reasonable spread (Fintech 4, Professional Services/Consulting 4, Telecom 3, Airlines 3, Banking 2, Energy 2, Construction 2, Food Delivery 2), but **no dedicated retail-grocery, no pure cybersecurity vendor, no pure AI-lab employer, and no healthcare-insurance employer** (Bupa Arabia, one of the supplied leads, is a gap).
- **ATS/careers-channel diversity already present**: SAP SuccessFactors (STC, KAUST, Saudia), Greenhouse (Tamara), Workable (Salla, Foodics), Oracle HCM (SNB/Alahli, MBC Group), BrassRing/IBM Kenexa (Zain KSA), Talentera (Al Tamimi), Yello (EY). **8 of 43 rows are `needs_manual_review` purely due to automated-fetch failures (403/timeout/ECONNRESET)** on companies whose legitimacy is not in question (Aramco, flynas, ACWA Power, Ma'aden, HMG, Almarai, PwC, McKinsey, Red Sea Global, ROSHN, El-Seif, flyadeal, Mobily) — a manual-browser re-check backlog, not a discovery gap.
- **2 rows (`no_official_source_found`)**: HungerStation (careers domain unresolved), Saudi Binladin Group (no official domain found at all, only Wikipedia/LinkedIn).
- Multi-market canonical IDs already shared with other files: `cc-al-tamimi-company` (also UAE), `cc-newtecx` (also Qatar, Kuwait), `cc-netways` (also Lebanon, Qatar, UAE), `cc-people365` (Lebanon-primary).

## 3. Master registry cross-check

`master-company-registry.csv` Saudi block matches `saudi-arabia.csv` exactly (43 = 43), confirming the two files are in sync going into this pass. No `(canonical_company_id, "Saudi Arabia")` collisions exist to worry about yet since Saudi Arabia isn't shared with any other market's rows under a re-used ID.

## 4. Source-catalog baseline

13 Saudi-tagged rows already exist, mostly **discovery-stage, not yet automation-approved**: only `src-sa-growthlist` (GrowthList.co) is `access_status: accessible`; everything else is `unknown_not_directly_tested`, `blocked_*`, or `not_applicable` (LinkedIn, correctly excluded by policy). Existing rows already cover: Bayt Saudi, GrowthList, Fintech Saudi Map, LEAP exhibitors, Biban Forum, Riyadh Chamber, Asharqia Chamber, Council of Saudi Chambers, Monsha'at, MISA/Invest Saudi, National Factories Directory, 500 Global MENA/Saudi portfolio. **Gap**: no government employment portal (Jadarat/Taqat/HRDF/Tamheer) yet, no dedicated recruitment-agency/RPO row, no additional job-board beyond Bayt.

## 5. International-remote baseline

Only 31 total rows, 2 mentioning Saudi Arabia at all — this file is not yet a meaningful channel for Saudi-eligible remote roles and is a discovery target for this pass (Section 5 of the task).

## 6. Coverage gaps entering this pass

- Geographic: Jeddah, Eastern Province (Dammam/Khobar/Dhahran/Jubail), Makkah, Madinah, NEOM/Tabuk beyond one row.
- Sector: healthcare insurance, pure cybersecurity, AI/ML labs, retail-grocery, education-technology.
- Source types: government employment portal (Jadarat/Taqat/HRDF), additional job boards beyond Bayt, recruitment-agency/RPO rows, Saudi-eligible international-remote rows.
- Verification backlog: 8 legitimate companies stuck at `needs_manual_review` from automated-fetch failures, not identity doubt.

This baseline was captured before any new web research in this pass; all counts above are reproducible via quote-aware parsing of the current `main`-branch state of the four files listed in Section 1.
