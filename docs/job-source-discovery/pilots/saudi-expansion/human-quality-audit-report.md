# Saudi Arabia Expansion — Human-Quality Pre-Promotion Audit

Audit-only phase. **No corrections have been applied, nothing was promoted, staged, committed, or pushed.** This re-examines the 85 staged employers, 16 proposed job sources, and 61 normalized HR-email leads produced by the prior discovery pass with a deliberately adversarial eye, re-fetching evidence directly wherever technically possible rather than trusting the prior pass's notes.

## 1. Executive summary

Of the 85 staged employers, **56 hold up unchanged, 17 need a mechanical field correction before promotion, and 12 must be held for manual review** — none were found to be fabricated or invented, but real defects were found: two official careers pages that directly **contradict** the staged Saudi-presence claim (Cohere, Innovaccer), one wrong city (Devsinc: Al Khobar, not Riyadh), one nationality-eligibility restriction that wasn't captured (Apple: Saudi/GCC nationals only), one unresolvable domain with a real identity-confusion risk (iGate vs. the unrelated global IGATE Corporation), one domain that doesn't resolve at all (Nahdi Medical's staged `nahdi.com.sa`), one literally invalid URL containing an unresolved wildcard (SLB), four dead/stale specific job links that were otherwise sound (Lenovo, BCG Platinion, BMC Helix, Alnafitha IT), and one row (KBR) that reuses an existing cross-market canonical ID on third-party-only evidence with zero first-party confirmation. Two positive upgrades were also found (ElevenLabs, Bupa Arabia — stronger evidence than originally recorded).

Of the 16 job sources, all decisions from the prior pass held up or were **strengthened** on re-check; two sources were genuinely **upgraded** to `approved_for_automated_ingestion` (BluePages for company-directory data; Jobgether, which turned out to expose a live, explicitly AI-permitted JSON API not found in the prior pass) and one domain correction was found (NADIA Global's `www` subdomain is dead — the bare domain works). GulfTalent's explicit ClaudeBot block was independently re-confirmed and found to be broader than previously characterized (~15+ named AI crawlers blocked).

Of the 61 unique HR emails (62 rows including the duplicate), the sole previously-verified address (`klc.hr@alkafaa.com`) **held up** on re-fetch. One email was **reclassified** to a stronger warning level (`catcosa@catcosa.com`: a TLS certificate mismatch was found, upgrading it from unresolved to actively suspicious).

## 2. Confirmed branch and baseline

- Branch: `feat/saudi-registry-expansion` (confirmed via `git branch --show-current`).
- `git status --short`: only `?? docs/job-source-discovery/pilots/saudi-expansion/` (untracked pilot directory) — nothing staged, nothing modified.
- `git diff main -- AGENTS.md`: empty (unchanged, unstaged).
- `git diff --stat main -- docs/job-source-discovery/saudi-arabia.csv docs/job-source-discovery/master-company-registry.csv docs/job-source-discovery/source-expansion/source-catalog.csv docs/job-source-discovery/international-remote.csv` and every other market file (`lebanon.csv`, `uae.csv`, `qatar.csv`, `kuwait.csv`): empty for all — every production registry is byte-for-byte identical to `main`.
- All 12 prior-pass artifacts in `docs/job-source-discovery/pilots/saudi-expansion/` were confirmed present and intact before this audit began (baseline-assessment.md, supplied-linkedin-leads.csv [155 rows], supplied-hr-email-audit.csv [62 rows], saudi-promotion-staging.csv [85 rows], saudi-promotion-staging-manifest.csv, discovered-job-sources.csv [16 rows], discovered-employer-candidates.csv, duplicate-and-alias-review.csv, manual-review-queue.csv, rejected-candidates.csv, search-query-matrix.csv, reconciliation-report.md) — counts matched the reported baseline exactly, confirmed via the same quote-aware CSV parser used throughout this project (`csv.cjs`, an in-session RFC4180 parser; not naive comma-splitting).
- No discrepancy was found between the reported baseline and the actual working tree — proceeded directly into the audit.

## 3. Complete 85-employer audit table

Full per-field detail (identity notes, URL-check notes, evidence URLs) is in `audit-findings-employers.csv`. The table below is the same 85 rows condensed for readability; long free-text fields are truncated with `…` — the CSV has the untruncated text.

| # | Company (canonical ID) | Saudi presence evidence | Careers/job status | Decision | Key finding / correction |
|---|---|---|---|---|---|
| 1 | Qiddiya (`cc-qiddiya`) | official_saudi_legal_entity | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 2 | Assystem (`cc-assystem-sa`) | current_official_job_in_saudi | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 3 | Saudi AZM (`cc-saudi-azm`) | official_saudi_office_address | official_careers_channel_confirmed | **approve_unchanged** | — |
| 4 | RIME (`cc-rime`) | official_saudi_legal_entity | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 5 | Accenture (`cc-accenture-sa`) | official_saudi_office_address | official_careers_channel_confirmed | **correct_then_approve** | careers_page_status: before=implied active_with_open_jobs, after=careers_page_found (hub only); researcher_no… |
| 6 | iGate (`cc-igate-sa`) | unresolved | not_verified | **hold_manual_review** | Domain does not resolve on two independent attempts. Evidence checked: original careers URL. Missing: any res… |
| 7 | InnovationTeam (`cc-innovationteam`) | official_page_identifying_saudi_operations | not_verified | **hold_manual_review** | Prior claim of a live AI Team Lead Riyadh posting could not be reconfirmed. Evidence checked: direct fetch of… |
| 8 | DataRobot (`cc-datarobot`) | remote_job_explicitly_open_to_saudi | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 9 | Cohere (`cc-cohere`) | unresolved | not_verified | **hold_manual_review** | Prior claim of a live Country Manager - Saudi Arabia role directly contradicted by official office list exclu… |
| 10 | Infosys (`cc-infosys`) | current_official_job_in_saudi | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 11 | TAWANTECH (`cc-tawantech`) | official_saudi_office_address | official_careers_channel_confirmed | **approve_unchanged** | — |
| 12 | Infinite pl (`cc-infinite-pl`) | current_official_job_in_saudi | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 13 | Alpaca (`cc-alpaca-ksa`) | current_official_job_in_saudi (weaker than c… | active_with_confirmed_saudi_jobs | **correct_then_approve** | careers_or_ats evidence: before=Lead Product Manager - Saudi (job 5850031004), after=Brokerage Operations Man… |
| 14 | Innovaccer (`cc-innovaccer`) | unresolved | not_verified | **hold_manual_review** | Official careers page contradicts claimed Saudi presence; only third-party aggregator evidence exists. Eviden… |
| 15 | ElevenLabs (`cc-elevenlabs`) | current_official_job_in_saudi | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 16 | Naphora Games Group (`cc-naphora`) | official_page_identifying_saudi_operations (… | not_verified | **hold_manual_review** | Prior claim not independently reconfirmed -- only generic homepage snippet retrievable. Evidence checked: nap… |
| 17 | UXBERT Labs (`cc-uxbert-labs`) | official_saudi_office_address | careers_page_confirmed_no_current_sau… | **correct_then_approve** | current_open_jobs_detected: before=unknown, after=no; careers_page_status: before=(implied active_with_open_j… |
| 18 | Yokogawa Middle East (`cc-yokogawa-sa`) | official_saudi_office_address (via sa.yokoga… | official_careers_channel_confirmed | **approve_unchanged** | — |
| 19 | MOZN (`cc-mozn`) | official_saudi_office_address | official_careers_channel_confirmed | **approve_unchanged** | — |
| 20 | INTECH Automation & Intelli… (`cc-intech-aai`) | current_official_job_in_saudi | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 21 | Saudi Air Navigation Servic… (`cc-sans`) | official_saudi_legal_entity | official_careers_channel_confirmed | **approve_unchanged** | — |
| 22 | Fakeeh Care Group (`cc-fakeeh-care-group`) | official_saudi_office_address | official_careers_channel_confirmed | **approve_unchanged** | — |
| 23 | Al Watania Information Syst… (`cc-wisys`) | official_saudi_office_address | official_careers_channel_confirmed | **approve_unchanged** | — |
| 24 | Datamatics Technologies (`cc-datamatics`) | current_official_job_in_saudi (from original… | not_verified | **approve_unchanged** | — |
| 25 | Gathern (`cc-gathern`) | official_saudi_office_address | official_careers_channel_confirmed | **approve_unchanged** | — |
| 26 | SiFi (`cc-sifi`) | official_saudi_legal_entity (company real, c… | unavailable | **hold_manual_review** | The official_careers_url now 404s. Evidence checked: direct fetch. Missing: working current careers/ATS link.… |
| 27 | Lenovo (`cc-lenovo-sa`) | official_saudi_office_address | official_careers_channel_confirmed | **correct_then_approve** | evidence_urls: before=dead JobDetail link, after=https://jobs.lenovo.com/ (general search portal, confirmed l… |
| 28 | Capgemini (`cc-capgemini-sa`) | official_saudi_office_address | official_careers_channel_confirmed | **approve_unchanged** | — |
| 29 | Devsinc (`cc-devsinc-sa`) | official_saudi_office_address (Al Khobar, no… | careers_page_confirmed_no_current_sau… | **correct_then_approve** | target_city: before=Riyadh, after=Al Khobar; careers_page_status/current_open_jobs_detected: before=(implied … |
| 30 | BCG Platinion (`cc-bcg-platinion-sa`) | current_official_job_in_saudi (stale) | official_careers_channel_confirmed | **correct_then_approve** | evidence_urls: before=stale job-56326 link, after=https://careers.bcg.com/global/en/search-jobs?keywords=Riya… |
| 31 | Apparel Group (`cc-apparel-group-sa`) | official_page_identifying_saudi_operations | official_careers_channel_confirmed | **approve_unchanged** | — |
| 32 | BMC Helix (`cc-bmc-helix-sa`) | official_page_identifying_saudi_operations (… | official_careers_channel_confirmed | **correct_then_approve** | evidence_urls: before=stale JobDetail/46406 link, after=https://jobs.bmc.com/ (general portal) + retain local… |
| 33 | Mirai (`cc-mirai-games`) | official_saudi_office_address | official_careers_channel_confirmed | **approve_unchanged** | — |
| 34 | Amazon (incl. AWS) (`cc-amazon-sa`) | official_saudi_office_address (well-document… | not_verified | **correct_then_approve** | evidence_urls: before=Bayt aggregator only, after=add https://www.amazon.jobs/en/search?loc_query=Saudi+Arabi… |
| 35 | CoorB (`cc-coorb-sa`) | current_official_job_in_saudi (stale) | unavailable | **hold_manual_review** | Official careers URL now 404s; previously-cited live Riyadh roles cannot be reconfirmed. Evidence checked: di… |
| 36 | Sulava MEA (`cc-sulava-mea`) | current_official_job_in_saudi | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 37 | Jeddah Airports Company (`cc-jeddah-airports`) | official_saudi_legal_entity | official_careers_channel_confirmed | **approve_unchanged** | — |
| 38 | NCR Atleos (`cc-ncr-atleos-sa`) | current_official_job_in_saudi (hub-level not… | official_careers_channel_confirmed | **approve_unchanged** | — |
| 39 | Ninja (`cc-ninja-sa`) | unresolved | not_verified | **hold_manual_review** | No first-party evidence exists anywhere in the record. Official domain blocked this pass. Evidence checked: a… |
| 40 | Bupa Arabia (`cc-bupa-arabia`) | current_official_job_in_saudi | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 41 | Wipro (`cc-wipro-sa`) | current_official_job_in_saudi (hub-level not… | official_careers_channel_confirmed | **approve_unchanged** | — |
| 42 | Nahdi Medical Company (`cc-nahdi-medical`) | unresolved | not_verified | **hold_manual_review** | Staged domain does not resolve at all. Evidence checked: nahdi.com.sa (DNS failure), nahdi.sa (resolves, serv… |
| 43 | Alnafitha IT (`cc-alnafitha-it`) | official_saudi_office_address | official_careers_channel_confirmed | **correct_then_approve** | evidence_urls: before=stale specific M365 job link, after=https://alnafitha.zohorecruit.com/jobs/Careers (gen… |
| 44 | Perfect Vision (`cc-perfect-vision`) | official_saudi_office_confirmed | official_careers_channel_confirmed | **approve_unchanged** | — |
| 45 | Zakat, Tax and Customs Auth… (`cc-zatca`) | saudi_government_authority_evidence | official_careers_channel_confirmed | **approve_unchanged** | — |
| 46 | Atmaal (`cc-atmaal`) | official_saudi_legal_entity | official_careers_channel_confirmed | **approve_unchanged** | — |
| 47 | KUN Sports (`cc-kun-sports`) | official_saudi_office_confirmed | official_careers_channel_confirmed | **approve_unchanged** | — |
| 48 | neoleap (`cc-neoleap`) | official_saudi_legal_entity | official_careers_channel_confirmed | **correct_then_approve** | official_careers_url: before=not_found, after=https://iafkkf.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience… |
| 49 | SJ Group (Surbana Jurong) (`cc-sj-group`) | current_official_job_in_saudi_via_thirdparty… | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 50 | SIHAMCO (`cc-sihamco`) | official_saudi_office_confirmed | official_careers_channel_confirmed | **approve_unchanged** | — |
| 51 | Azeus Systems Limited (`cc-azeus-systems`) | dedicated_saudi_careers_subpage | official_careers_channel_confirmed | **approve_unchanged** | — |
| 52 | Aloula Aviation (`cc-aloula-aviation`) | official_saudi_office_confirmed (King Fahad … | official_careers_channel_confirmed | **correct_then_approve** | researcher_notes: append that direct fetch confirms mukamalah.com is Aloula Aviation's genuine official domai… |
| 53 | Al-Othman Holding Company (`cc-al-othman-holding`) | official_saudi_office_confirmed | official_careers_channel_confirmed | **approve_unchanged** | — |
| 54 | HALA (`cc-hala`) | official_saudi_office_confirmed | official_careers_channel_confirmed | **approve_unchanged** | — |
| 55 | Cognizant (`cc-cognizant`) | official_saudi_office_confirmed (dedicated M… | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 56 | Azadea Group (`cc-azadea-group`) | official_saudi_office_confirmed (portal expl… | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 57 | Riyad Bank (`cc-riyad-bank`) | official_saudi_legal_entity (Tadawul-listed … | official_careers_channel_confirmed | **correct_then_approve** | researcher_notes: append that careers.riyadbank.com timed out (DNS) and the Talentera link redirects to a non… |
| 58 | dentsu (`cc-dentsu`) | official_saudi_office_confirmed (dedicated r… | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 59 | NextEra (NextEra Tech) (`cc-nextera-tech`) | official_saudi_legal_entity (Aramco Digital/… | official_careers_channel_confirmed | **approve_unchanged** | — |
| 60 | SHEBA JOY (`cc-sheba-joy`) | official_saudi_office_confirmed (Riyadh offi… | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 61 | Haji Husein Alireza & Co. L… (`cc-haji-husein-alireza`) | official_saudi_office_confirmed | active_with_confirmed_saudi_jobs | **correct_then_approve** | ats_provider: before=unknown, after=Talentera; current_open_jobs_detected: before=unknown, after=yes; careers… |
| 62 | Jeddah Central Development … (`cc-jeddah-central-dev`) | official_saudi_office_confirmed (PIF-owned, … | official_careers_channel_confirmed | **correct_then_approve** | official_careers_url: before=https://careers.jcd.com.sa/, after=https://www.jeddahcentral.com/en/careers; ats… |
| 63 | Intelmatix (`cc-intelmatix`) | official_saudi_office_confirmed | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 64 | Ericsson (`cc-ericsson`) | official_saudi_office_confirmed (Riyadh-filt… | official_careers_channel_confirmed | **approve_unchanged** | — |
| 65 | Akkodis (`cc-akkodis`) | current_official_job_explicitly_in_saudi (Me… | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 66 | MIS (Al-Moammar Information… (`cc-mis-al-moammar`) | official_saudi_legal_entity (Tadawul-listed) | official_careers_channel_confirmed | **approve_unchanged** | — |
| 67 | Albawani (Al Bawani Co. Ltd… (`cc-albawani`) | official_saudi_legal_entity | official_careers_channel_confirmed | **approve_unchanged** | — |
| 68 | SLB (formerly Schlumberger) (`cc-slb`) | dedicated_early_careers_hub_mentions_saudi_a… | not_verified (downgraded -- neither f… | **correct_then_approve** | official_careers_url: before=https://apply.slb.com/careers/*/multi_location_saudi_arabia (INVALID -- literal … |
| 69 | Tamkeen Technologies (`cc-tamkeen-technologies`) | official_saudi_office_confirmed | official_careers_channel_confirmed | **approve_unchanged** | — |
| 70 | SAP (`cc-sap`) | official_saudi_office_confirmed (dedicated S… | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 71 | Searce (`cc-searce`) | official_page_lists_riyadh_as_active_office | official_careers_channel_confirmed | **approve_unchanged** | — |
| 72 | SEDCO Holding (`cc-sedco-holding`) | official_saudi_office_confirmed | official_careers_channel_confirmed | **approve_unchanged** | — |
| 73 | 2P Perfect Presentation (`cc-2p-perfect-presentation`) | official_saudi_legal_entity (Tadawul-listed,… | not_verified | **hold_manual_review** | Reason: internal contradiction between careers_page_status and official_careers_url fields; only third-party … |
| 74 | MinIO (`cc-minio`) | current_official_job_explicitly_in_saudi (Ri… | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 75 | AtkinsRéalis (`cc-atkinsrealis`) | official_saudi_office_confirmed (dedicated S… | official_careers_channel_confirmed | **approve_unchanged** | — |
| 76 | GT Medical (`cc-gt-medical`) | official_saudi_office_confirmed | official_careers_channel_confirmed | **approve_unchanged** | — |
| 77 | Snap Inc. (`cc-snap-inc`) | official_saudi_office_confirmed (Riyadh expl… | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 78 | Tata Consultancy Services (`cc-tcs`) | official_saudi_office_confirmed (women's inn… | official_careers_channel_confirmed | **approve_unchanged** | — |
| 79 | Salesforce (`cc-salesforce`) | official_saudi_office_confirmed (specific re… | not_verified (downgraded -- staleness… | **correct_then_approve** | current_open_jobs_detected: before=yes, after=unknown; careers_page_status: before=active_with_open_jobs, aft… |
| 80 | Noon (Noon Academy) (`cc-noon-academy`) | official_saudi_legal_entity (founded and hea… | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 81 | KBR (`cc-kbr`) | no_first_party_evidence_this_pass (only thir… | not_verified | **hold_manual_review** | Reason: highest-stakes row in the batch because it reuses an existing cross-market canonical ID with NO first… |
| 82 | Remat Al-Riyadh Development… (`cc-remat-al-riyadh`) | official_saudi_legal_entity (municipal-linke… | recruitment_email_only (unconfirmed -… | **hold_manual_review** | Reason: the row's own careers_page_status claims a recruitment-email channel exists, but no actual email addr… |
| 83 | Luma AI (`cc-luma-ai`) | official_saudi_office_confirmed (new Riyadh … | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 84 | Democrance (`cc-democrance`) | saudi_regulator_evidence (SAMA approval) plu… | active_with_confirmed_saudi_jobs | **approve_unchanged** | — |
| 85 | Apple (`cc-apple`) | official_saudi_office_confirmed (Apple Retai… | active_with_confirmed_saudi_jobs | **correct_then_approve** | target_city: before=Jeddah/Riyadh (multi-city), after=Country-wide; researcher_notes: append that this audit … |

## 4. Exact corrections proposed (17 `correct_then_approve` rows, full detail)

These are documented, not applied — a future "apply corrections" pass would mechanically edit these exact fields in `saudi-promotion-staging.csv` before any of it is merged into `saudi-arabia.csv`.

- **Accenture** (`cc-accenture-sa`): careers_page_status: before=implied active_with_open_jobs, after=careers_page_found (hub only); researcher_notes: add that live listings require navigating to the Workday sub-portal, not visible on the stored URL itself
- **Alpaca** (`cc-alpaca-ksa`): careers_or_ats evidence: before=Lead Product Manager - Saudi (job 5850031004), after=Brokerage Operations Manager - Saudi (Remote-EMEA); downgrade remote-eligibility claim from Saudi-specific to EMEA-regional-unclear
- **UXBERT Labs** (`cc-uxbert-labs`): current_open_jobs_detected: before=unknown, after=no; careers_page_status: before=(implied active_with_open_jobs), after=active_no_open_jobs; replace 14 open Riyadh roles claim with office/address confirmed, currently zero open roles
- **Lenovo** (`cc-lenovo-sa`): evidence_urls: before=dead JobDetail link, after=https://jobs.lenovo.com/ (general search portal, confirmed live); downgrade from active-job claim to careers_page_found pending fresh listing
- **Devsinc** (`cc-devsinc-sa`): target_city: before=Riyadh, after=Al Khobar; careers_page_status/current_open_jobs_detected: before=(implied active/yes), after=active_no_open_jobs/no (board is Pakistan-only); replace Riyadh job claim with confirmed Al Khobar office, zero current KSA listings
- **BCG Platinion** (`cc-bcg-platinion-sa`): evidence_urls: before=stale job-56326 link, after=https://careers.bcg.com/global/en/search-jobs?keywords=Riyadh (or equivalent live search); downgrade to official_careers_channel_confirmed pending fresh listing
- **BMC Helix** (`cc-bmc-helix-sa`): evidence_urls: before=stale JobDetail/46406 link, after=https://jobs.bmc.com/ (general portal) + retain localization press release; downgrade to official_careers_channel_confirmed
- **Amazon (incl. AWS)** (`cc-amazon-sa`): evidence_urls: before=Bayt aggregator only, after=add https://www.amazon.jobs/en/search?loc_query=Saudi+Arabia as the first-party evidence URL
- **Alnafitha IT** (`cc-alnafitha-it`): evidence_urls: before=stale specific M365 job link, after=https://alnafitha.zohorecruit.com/jobs/Careers (general tenant listing page); downgrade to official_careers_channel_confirmed pending fresh listing
- **neoleap** (`cc-neoleap`): official_careers_url: before=not_found, after=https://iafkkf.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001; ats_provider: before=unknown, after=Oracle Cloud HCM; careers_page_status: before=careers_page_found, after=official_careers_channel_confirmed
- **Aloula Aviation** (`cc-aloula-aviation`): researcher_notes: append that direct fetch confirms mukamalah.com is Aloula Aviation's genuine official domain, not a mismatch -- resolves prior domain-transition caution. Official recruitment email careers@aloula.com also found on-page.
- **Riyad Bank** (`cc-riyad-bank`): researcher_notes: append that careers.riyadbank.com timed out (DNS) and the Talentera link redirects to a non-standard plain-HTTP port-8001 endpoint -- plausible but not independently content-verified this pass; re-check before final promotion.
- **Haji Husein Alireza & Co. Ltd.** (`cc-haji-husein-alireza`): ats_provider: before=unknown, after=Talentera; current_open_jobs_detected: before=unknown, after=yes; careers_page_status: before=careers_page_found, after=active_with_open_jobs
- **Jeddah Central Development Company (JCDC)** (`cc-jeddah-central-dev`): official_careers_url: before=https://careers.jcd.com.sa/, after=https://www.jeddahcentral.com/en/careers; ats_provider: before=unknown, after=SAP SuccessFactors; public_jobs_endpoint_or_feed: before=https://careers.jcd.com.sa/, after=https://career-sa20.hr.cloud.sap/career?company=jeddahcent
- **SLB (formerly Schlumberger)** (`cc-slb`): official_careers_url: before=https://apply.slb.com/careers/*/multi_location_saudi_arabia (INVALID -- literal unresolved wildcard), after=https://careers.slb.com/job-listing (real, fetchable if JS-rendered hub page); careers_page_status: before=careers_page_found, after=not_verified
- **Salesforce** (`cc-salesforce`): current_open_jobs_detected: before=yes, after=unknown; careers_page_status: before=active_with_open_jobs, after=official_careers_channel_confirmed; researcher_notes: recommend citing Salesforce's stable Saudi-filtered search URL instead of a specific req ID for any future promotion.
- **Apple** (`cc-apple`): target_city: before=Jeddah/Riyadh (multi-city), after=Country-wide; researcher_notes: append that this audit pass confirms 11 live Apple Retail roles via the Jeddah-filtered search, but all list their actual location as Various Locations within Saudi Arabia (not Jeddah-specific) and are explicitly restricted to Saudi and GCC Nationals -- this eligibility restriction should be surfaced in any user-facing match logic.

## 5. Holds and resolution requirements (12 `hold_manual_review` rows, full detail)

None of these are rejected — each is a real, identifiable company where a specific piece of evidence is missing, contradictory, or newly broken (link rot since the original research date). Each entry states what was checked, what's missing, and the exact action needed.

- **iGate** (`cc-igate-sa`): Domain does not resolve on two independent attempts. Evidence checked: original careers URL. Missing: any resolving domain for a real distinct Saudi entity. Action: human search for correct live domain, or reclassify insufficient_evidence.
- **InnovationTeam** (`cc-innovationteam`): Prior claim of a live AI Team Lead Riyadh posting could not be reconfirmed. Evidence checked: direct fetch of careers page. Missing: specific current job or city-level confirmation. Action: re-check or downgrade to insufficient_evidence.
- **Cohere** (`cc-cohere`): Prior claim of a live Country Manager - Saudi Arabia role directly contradicted by official office list excluding Saudi Arabia. Evidence checked: cohere.com/careers (contradicts), Ashby board (inconclusive). Missing: first-party confirmation. Action: human should check Ashby board directly in a browser (JS-rendered) before promoting or rejecting.
- **Innovaccer** (`cc-innovaccer`): Official careers page contradicts claimed Saudi presence; only third-party aggregator evidence exists. Evidence checked: official careers page (contradicts). Missing: first-party Saudi confirmation. Action: verify whether Innovaccer Analytics KSA is a real distinct registered entity, or downgrade to insufficient_evidence.
- **Naphora Games Group** (`cc-naphora`): Prior claim not independently reconfirmed -- only generic homepage snippet retrievable. Evidence checked: naphora.com/careers (partial/inconclusive). Missing: direct confirmation of actual jobs listing. Action: manual browser re-check.
- **SiFi** (`cc-sifi`): The official_careers_url now 404s. Evidence checked: direct fetch. Missing: working current careers/ATS link. Action: search for SiFi's current careers URL before promotion.
- **CoorB** (`cc-coorb-sa`): Official careers URL now 404s; previously-cited live Riyadh roles cannot be reconfirmed. Evidence checked: direct fetch. Missing: working current careers link. Action: search for CoorB's current careers page/ATS before promotion.
- **Ninja** (`cc-ninja-sa`): No first-party evidence exists anywhere in the record. Official domain blocked this pass. Evidence checked: ananinja.com (blocked), buildsaudi.co and bayt.com (both third-party). Missing: first-party company page or careers URL. Action: retry official domain later, or downgrade to insufficient_evidence.
- **Nahdi Medical Company** (`cc-nahdi-medical`): Staged domain does not resolve at all. Evidence checked: nahdi.com.sa (DNS failure), nahdi.sa (resolves, server error). Missing: confirmed working official domain. Action: human should verify whether nahdi.sa is the correct current domain; do not carry forward nahdi.com.sa as-is.
- **2P Perfect Presentation** (`cc-2p-perfect-presentation`): Reason: internal contradiction between careers_page_status and official_careers_url fields; only third-party evidence exists for any careers claim. Evidence checked: 2p.com.sa homepage (no careers link found), Wazaef Saudi aggregator, Yahoo Finance ticker page. Action needed: a human should browse 2p.com.sa's full navigation/footer for an actual careers page, or confirm via Tadawul filing/IR page.
- **KBR** (`cc-kbr`): Reason: highest-stakes row in the batch because it reuses an existing cross-market canonical ID with NO first-party confirmation at all -- only aggregator mirrors. Evidence checked: kbr.com/en/careers (403, both passes), Glassdoor and dejobs.org mirrors (real, but third-party). Action needed: a human must get a direct browser view of kbr.com's careers/Saudi Arabia section (or an official KBR press release/LinkedIn company page corroboration) before this reuses the cc-kbr id in production.
- **Remat Al-Riyadh Development Co.** (`cc-remat-al-riyadh`): Reason: the row's own careers_page_status claims a recruitment-email channel exists, but no actual email address is recorded in any field, and this audit's own re-fetch failed with a connection error. Evidence checked: remat.sa (ECONNRESET this pass), bestplacestoworkfor.org profile (confirms the award but not a specific recruitment address). Action needed: a human must browse remat.sa directly to find and record the actual recruitment email address before this can be treated as recruitment_email_only rather than unavailable.

## 6. Duplicate / alias / parent-subsidiary findings

Re-checked every special case the resume/audit brief named explicitly:

- **HUMAIN vs. UAE's "Humai"** — CONFIRMED NOT related. Independently re-verified: HUMAIN (`humain.ai`) is the Saudi PIF-owned AI company; `cc-humai` is a distinct, pre-existing UAE registry row. No conflation found. (HUMAIN itself is not in the 85-row staging file — it sits in `manual-review-queue.csv` from the original discovery pass because its own careers/ATS URL was never confirmed; this audit did not re-open that queue.)
- **Noon – Education for Everyone / Noon Academy vs. Noon.com** — RE-VERIFIED, DISAMBIGUATION HOLDS. Direct fetch of `careers.learnatnoon.com` confirms explicit "started in Riyadh in 2013" founding language, 20M+ learners, hybrid schools — an EdTech company, definitively not the e-commerce marketplace. Staged as `cc-noon-academy`, `approve_unchanged`.
- **Amazon vs. Amazon Web Services** — one entity, one row (`cc-amazon-sa`). Confirmed this is a genuinely distinct `(canonical_company_id, target_country)` pair from the existing `cc-amazon-uae` row (different target_country) — not a duplicate, consistent with repo convention. Flagged `correct_then_approve` only because the sole evidence URL on file was a Bayt aggregator link, not first-party; a first-party `amazon.jobs` search URL was added as a correction.
- **QuantumBlack vs. McKinsey & Company** — QuantumBlack is not in the 85-row staging file at all; it was already resolved in the prior discovery pass as `duplicate_or_alias` of the already-present `cc-mckinsey` row (McKinsey's own careers site runs QuantumBlack's Riyadh postings). Nothing in this audit contradicts that.
- **BCG Platinion vs. Boston Consulting Group** — re-verified as a genuinely distinct branded technology-consulting division with its own live Riyadh listings (10 confirmed in the original pass), kept as its own row per the existing KPMG/EY precedent for branded regional divisions. `correct_then_approve` only for a stale specific job-ID link.
- **Saudi Air Navigation Services vs. any other "SANS"** — re-checked for conflation with the unrelated US SANS Institute (cybersecurity training org, same acronym coincidentally). No conflation found; different acronym source entirely. `approve_unchanged`.
- **Saudi AZM vs. the PIF national workforce-training initiative also branded "azm"** — re-confirmed no conflation; Saudi AZM's registered address (Riyadh) and ATS tenant (`azmtalent.recruitee.com`) are distinct from the unrelated `pif.gov.sa/azm` government program. `approve_unchanged`.
- **Fakeeh Care Group vs. its individual hospitals** — kept as a single group-level row (`cc-fakeeh-care-group`), consistent with how other Saudi hospital groups (HMG/Dr. Sulaiman Al Habib) are modeled elsewhere in the registry. Open risk flagged for a human: if a future pass considers adding "Dr. Soliman Fakeeh Hospital Jeddah/Riyadh" as a separate row, it must be checked against this existing group-level row first to avoid double-counting the same legal entity under two IDs.
- **Red Sea Global and its hotel/property subsidiaries; Qiddiya and its subsidiaries** — neither batch fork found any of the 85 staged rows to actually be an undisclosed subsidiary of these two giga-projects; both remain flagged as a general caution for any future hospitality-brand additions (mirroring the Qatar pass's Minor Hotels/Accor precedent), not an active defect in this batch.
- **KBR and its Saudi joint venture** — see Section 5 (hold). The row reuses the exact same `cc-kbr` id as the existing verified Qatar row (repo convention explicitly allows this since `(id, target_country)` stays unique), but has zero first-party evidence — only Glassdoor/dejobs.org mirrors. This is flagged as the single highest-risk item in the entire audit precisely because it would reuse a cross-market canonical ID without first-party backing.
- **Tata Consultancy Services and other multinational multi-market IDs** — TCS was staged under a new market-neutral id `cc-tcs`, while the existing Qatar row uses the long form `cc-tata-consultancy-services-qatar`. This spelling inconsistency across markets is not a duplicate ((id,country) uniqueness holds) but remains open for a human ID-convention decision — same open item already flagged in the prior pass's `duplicate-and-alias-review.csv`, re-confirmed here rather than resolved.
- **SLB** — same pattern as TCS (market-neutral `cc-slb` vs. existing `cc-slb-qatar`), re-confirmed as not a duplicate. Separately, SLB was found to have a genuinely broken/invalid `official_careers_url` (a literal unresolved wildcard `*` in the path) — see Section 4 correction.
- **Accenture Middle East** — re-verified: `cc-accenture-sa` follows the same `-qatar`/`-uae` suffix convention already established by the existing `cc-accenture-qatar` row. `correct_then_approve` only because the stored URL is a navigation hub, not a page with visible listings itself.
- **Scale AI, ElevenLabs, Cohere, DataRobot** (international-remote-heavy companies) — audited individually, not as a group:
  - Scale AI is not in the 85-row staging file (it was already correctly held at `insufficient_evidence` in the prior pass since it only has Qatar-specific evidence, not Saudi).
  - ElevenLabs: re-verified, evidence strengthened (6 distinct Saudi-relevant roles found vs. 2 originally cited). `approve_unchanged`.
  - Cohere: re-verified and contradicted — the company's own official careers page lists only Toronto/NY/London/SF/Montreal/Paris/Seoul, excluding Saudi Arabia entirely. Held for manual review (Section 5).
  - DataRobot: re-verified, holds up — exact "Remote Saudi Arabia" location tag reconfirmed on 2 roles via direct fetch. `approve_unchanged`.
- **Recruitment agencies appearing as direct employers** — none of the 85 staged rows were found to actually be a recruitment/staffing agency mistakenly staged as a direct employer (that miscategorization was already correctly filtered out into `source_catalog_candidate` in the prior discovery pass for Avensys Consulting, Scout Global, SmartChoice International GCC, and Jobgether — none of those four are in the 85-row staging file).

## 7. Remote-eligibility findings

Only a handful of the 85 rows carry a remote-eligibility classification (most are on-site/office-based):

| Company | Original claim | Audit finding | Reclassified as |
|---|---|---|---|
| DataRobot | Saudi-specifically-eligible | RE-CONFIRMED — exact "Remote Saudi Arabia" tag on 2 roles, official Workday ATS | Saudi-specifically-eligible (unchanged) |
| ElevenLabs | Saudi-specifically-eligible | RE-CONFIRMED and strengthened (6 roles, not 2) | Saudi-specifically-eligible (unchanged) |
| RIME | Saudi-listed-as-allowed-location | RE-CONFIRMED ("Riyadh/Remote" tag) | Saudi-listed-as-allowed-location (unchanged) |
| Alpaca | Saudi-specifically-eligible (claimed) | DOWNGRADED — the specific claimed Saudi-tagged role does not currently exist; the only live Saudi-relevant listing found is tagged "Remote - EMEA," a broad region, not Saudi-specific | Middle-East-GCC-remote-unclear |
| Cohere | Saudi-specifically-eligible (claimed "Country Manager - Saudi Arabia") | CONTRADICTED — official office list excludes Saudi Arabia entirely | held for manual review, not reclassified as remote-eligible pending a browser re-check of the JS-rendered Ashby board |

No staged row was found to be a generic worldwide-remote role mislabeled as Saudi-eligible without any Saudi-specific tag at all — the one real problem case (Alpaca) still had some Saudi-adjacent tag, just a weaker regional one than originally claimed.

## 8. Suspicious, unsafe, or insufficient-source findings

- **iGate** (`cc-igate-sa`): the staged domain does not resolve at all (DNS failure on two independent attempts), and there is a real identity-confusion risk with the globally-known IGATE Corporation (a US IT firm absorbed into Capgemini in 2015, unrelated to any small Saudi entity of the same name). Held for manual review — this is the closest thing to a "possible wrong entity entirely" finding in the batch.
- **KBR**: see Sections 5 and 6 — zero first-party evidence for a row that would reuse an existing cross-market canonical ID. Held.
- **Ninja**: zero first-party evidence anywhere in the record (both original evidence URLs are third-party mirrors), and the official domain was blocked (403) on both the original and this audit's fetch attempt. Held.
- **2P Perfect Presentation**: an internal data-quality contradiction was found — the staged row claims `careers_page_status=careers_page_found` while `official_careers_url=not_found` simultaneously. No careers link was found anywhere on the homepage on direct re-fetch. Held.
- **Remat Al-Riyadh Development Co.**: the staged row claims `careers_page_status=recruitment_email_only` but no actual email address is recorded in any field — an unfalsifiable claim as currently written. Held.
- No staged employer was found to be an outright scam, a fake listing, or a company that doesn't exist at all — every hold is either a broken/missing evidence channel for a real company, or (iGate/KBR) enough ambiguity/thinness of evidence to warrant a human check before promotion.

## 9. Complete source audit table (16 sources)

Full per-field detail (robots.txt raw findings, anti-bot notes, evidence URLs) is in `audit-findings-sources.csv`.

| Source | Domain | Category | Saudi coverage | Employer identity | Robots.txt / AI-bot findings | Final status | Changed this pass |
|---|---|---|---|---|---|---|---|
| Jadarat National Employment Pla… | jadarat.sa | official_government… | real_saudi_specific | unknown | HTTP 403 on robots.txt itself, re-confirmed this pass | **manual_review_only** | no -- re-confirmed identical |
| Taqat Employment Support Program | taqat.sa | official_government… | real_saudi_specific_l… | unknown | connection reset (ECONNRESET) on robots.txt fetch | **discovery_only** | no -- newly attempted, consistent with superseded… |
| HRDF main site | hrdf.org.sa | government_program_… | real_saudi_specific | not_appli… | User-agent: * / Allow: / -- fully open, no AI-bot blocks | **discovery_only** | no (status unchanged) but robots.txt now positive… |
| PIF portfolio-companies page | pif.gov.sa | government_investme… | real_saudi_specific | yes_when_… | HTTP 403 on robots.txt itself, re-confirmed | **manual_review_only** | no -- re-confirmed identical |
| Saudi Exchange (Tadawul) Listed… | saudiexchange.sa | stock_exchange_list… | real_saudi_specific | yes_when_… | HTTP 403 on robots.txt itself, re-confirmed | **manual_review_only** | no -- re-confirmed identical |
| Jeddah Chamber of Commerce & In… | jcci.org.sa | chamber_of_commerce… | real_saudi_specific_j… | partial | User-agent: * / Disallow: -- fully open, no AI-bot blocks | **discovery_only** | no (status unchanged) but robots.txt now positive… |
| BluePages Business Directory | bluepages.com.sa | general_business_di… | real_saudi_specific_f… | yes | User-agent: * / Allow: / -- fully open, no AI-bot blocks | **approved_for_automated_ingestion (UPGRADED, for company-dir…** | yes -- upgraded from discovery_only after confirm… |
| Mihnati.com | mihnati.com | job_board | real_saudi_specific_7… | yes | User-agent: * disallows /hiring/, /people/, /ar/, plus /page/, /symbo… | **manual_review_only** | yes -- STRENGTHENED finding: prior pass only flag… |
| Wadhefa.com | wadhefa.com | job_board | real_saudi_specific | yes | User-agent: *, crawl-delay 30, disallows /list_featured_jobs/, /resum… | **manual_review_only** | no -- re-confirmed identical, plus newly noted /r… |
| Tanqeeb Saudi Arabia | saudi.tanqeeb.com | job_board | real_saudi_specific_c… | unknown | empty response on robots.txt fetch, re-confirmed | **manual_review_only** | no -- re-confirmed identical (still unreachable v… |
| GulfTalent Saudi Arabia (dedica… | gulftalent.com | job_board | real_saudi_specific | yes | EXPLICIT block list: ClaudeBot, anthropic-ai, GPTBot, CCBot, AI2Bot, … | **manual_review_only** | yes -- CONFIRMED AND STRENGTHENED: re-fetch verif… |
| NADIA Global | nadiaglobal.sa | recruitment_agency | real_saudi_specific | no | standard WordPress robots.txt (Disallow: /wp-admin/ etc.), no AI-bot … | **manual_review_only** | yes -- DOMAIN CORRECTION: https://www.nadiaglobal… |
| Avensys Consulting | aven-sys.com | recruitment_agency | real_saudi_specific_r… | no | standard WordPress robots.txt, no AI-bot block | **manual_review_only** | no -- re-confirmed, no material change |
| Scout Global | scout-global.com | recruitment_agency | not_confirmed_generic | no | User-agent: * / Disallow: -- fully open, no AI-bot block | **discovery_only** | no -- re-confirmed identical; still no Saudi-spec… |
| SmartChoice International GCC | smartchoice-international.com | recruitment_agency | real_saudi_specific_r… | no | User-agent: * / Allow: / Disallow: /api/; blocks PetalBot; references… | **manual_review_only** | yes -- new finding: site explicitly publishes an … |
| Jobgether | jobgether.com | remote_job_board | real_saudi_category_p… | yes | Allow: /, 2s crawl-delay, explicitly declares search=yes ai-input=yes… | **approved_for_automated_ingestion (UPGRADED, technical+polic…** | yes -- MAJOR UPGRADE: prior pass only saw none ob… |

**Two genuine upgrades found**: BluePages (company-directory data, fully open robots.txt, no login) and Jobgether (a live, explicitly AI-permitted structured JSON API at `/astroapi/ai/jobs.json` with real job fields and disclosed employer names — not found by the prior pass, which only saw "none observed on fetch"). Jobgether's upgrade carries an open caveat: the default API call returned zero Saudi Arabia listings (10 US/India jobs) — the query-parameter mechanism to reach the Saudi-specific subset was not identified this pass, so the *access method* is approved but Saudi *coverage* through it is not yet confirmed.

**GulfTalent's ClaudeBot block was independently re-confirmed and found broader than previously characterized**: re-fetching `gulftalent.com/robots.txt` directly this pass found ClaudeBot, `anthropic-ai`, GPTBot, CCBot, AI2Bot, Google-Extended, and ~15 more named AI/LLM crawlers all explicitly disallowed, while `ChatGPT-User`/`OAI-SearchBot`/`PerplexityBot` are explicitly *allowed* — this is a deliberate, targeted policy choice, not a blanket bot block, and it hard-blocks this project's Claude-based tooling specifically. Cannot be approved for automated ingestion under any circumstance while this robots.txt stands.

**One domain correction found**: NADIA Global's recorded URL (`https://www.nadiaglobal.sa/`) fails DNS resolution; the working domain is the bare `https://nadiaglobal.sa/` (no `www`).

**Mihnati's risk was strengthened, not just reconfirmed**: the prior pass only flagged the `/ar/` robots.txt disallow; this pass's direct re-fetch found `/hiring/` and `/people/` are *also* disallowed — and those read as far more likely to be the actual job-listing/employer-profile paths than `/ar/`, making the case for `manual_review_only` stronger.

**Government/regulator domains (Jadarat, PIF, Saudi Exchange) all re-confirmed identical HTTP 403 on both the homepage and robots.txt itself** on independent re-fetch — consistent, not a fluke of the original pass.

None of the 16 sources were found to be unsafe, a scam, or a source that should be rejected outright (`rejected_unsafe`: 0, `blocked_or_restricted`: 0 in the final tally).

## 10. Complete 61-email audit (reference to machine-generated CSV)

Full per-email detail (all 62 rows including the duplicate) is in `audit-findings-emails.csv`, following the exact schema requested: `raw_email, normalized_email, apparent_company, first_party_evidence_found, evidence_type, final_status, changed_from_prior_pass, evidence_urls, notes`.

**Highlights from the re-audit:**
- **`klc.hr@alkafaa.com` (Al Kafaa Limited Co.) — RE-VERIFIED, HELD UP.** Direct re-fetch of `https://alkafaa.com/careers-page/` confirmed the `mailto:klc.hr@alkafaa.com` link is still live on a Sales Executive posting. Status unchanged: `official_recruitment_email_verified`. This remains the only email in the entire 61-address set with genuine first-party evidence.
- **`recruiting.ksa@mcmermott.com` — strengthened, unchanged status.** Fresh fetch of `mcmermott.com` returned `ENOTFOUND` (the domain does not resolve via DNS at all) — stronger evidence than the prior pass had that this is not a live channel. Still not silently attributed to McDermott International without proof. Status unchanged: `domain_mismatch_or_suspicious`.
- **`catcosa@catcosa.com` — RECLASSIFIED (upgraded to a stronger warning).** Fresh fetch returned a TLS certificate mismatch (the certificate presented is for `*.sucuri.net`, not `catcosa.com`) — a genuine new technical red flag not caught in the prior pass. Moved from `company_identity_unresolved` → `domain_mismatch_or_suspicious`.
- **Dr. Sulaiman Al Habib pair** (`talent.acquisition@` vs. `hr.phc@`) and **Saudi German Hospitals Group pair** (`jobs@sghgroup.net` vs. `career.dmm@sghgroup.net`) — both pairs re-fetched and confirmed to sit at an **identical, equal evidence tier** (both reproduced the same connection failure/403 on re-fetch); no differentiation between the two addresses in either pair is possible with current evidence.
- **`info@ramclinics.com`** — the identical SSL handshake failure from the prior pass was reproduced exactly on re-fetch, confirming this is a genuine, reproducible access gap rather than a one-off fetch glitch.
- **Data-quality flag (no status change)**: `cv@tafear.com` has `official_domain_confirmed=yes` on file, but the only evidence cited is a LinkedIn company page, not an actually-fetched company domain — flagged for a future pass to downgrade that specific field to `partial`.
- **Weak-Saudi-nexus flag (no status change)**: `careers@dnata.com` — dnata is primarily a UAE/Emirates-Group ground-handling operator; Saudi presence was already marked unclear and remains unconfirmed on re-check. No better-fitting status exists in the taxonomy, but a human promoting any part of this list should deprioritize it.
- Every free-mail address (6 of 62: `hr.qrm@hotmail.com`, `job.s6@hotmail.com`, `shababwatansa@gmail.com`, `recruitment.amjad@gmail.com`, `jobrydlaw@gmail.com`, `hiringnow.ksa@gmail.com`) was re-confirmed to correctly remain unverified — none were promoted.
- Every individual-employee-style mailbox (`s.alwadi@nhc.sa`, `i.atassi@artar.com.sa`, `oalkhunaizi@darwaemaar.com`, `ymohammed@innovest.com.sa`) and every `info@`/marketing mailbox was re-confirmed to correctly stay out of the recruitment-verified bucket.
- The exact duplicate (`al.alshaikh@bonyan.sa`, appearing twice in the original 62-entry list) is confirmed still counted once, with the second occurrence recorded as its own `duplicate` row, not silently dropped.

**Re-audit status counts (62 rows, reconciled programmatically against the original 62-row file — see Section 12 validation)**: `third_party_or_free_mail_unverified`=46, `domain_mismatch_or_suspicious`=6 (+1 vs. prior pass), `company_identity_unresolved`=4 (−1 vs. prior pass, the Catcosa reclassification), `official_general_contact_not_recruitment`=4, `official_recruitment_email_verified`=1, `duplicate`=1, `rejected_unsafe`=0.

No email was sent, no SMTP probing was performed, no typo corrections were guessed, and no personal LinkedIn URLs were stored during this re-audit.

## 11. Verified recruitment-email count

**1** — unchanged from the prior pass: `klc.hr@alkafaa.com` (Al Kafaa Limited Co.), re-verified with a fresh direct fetch this pass.

## 12. Employer decision totals (programmatically reconciled)

Reconciled with the same quote-aware CSV parser (`csv.cjs`) used throughout this project, cross-checking every `canonical_company_id` in the audit findings against every id in `saudi-promotion-staging.csv`:

| Decision | Count |
|---|---|
| `approve_unchanged` | 56 |
| `correct_then_approve` | 17 |
| `hold_manual_review` | 12 |
| `move_to_source_catalog` | 0 |
| `duplicate_or_alias` | 0 |
| `geo_ineligible` | 0 |
| `reject_unsafe_or_invalid` | 0 |
| **Total** | **85** |

Validation confirmed: all 85 `canonical_company_id` values in `saudi-promotion-staging.csv` appear in the audit findings exactly once (0 missing, 0 extra, 0 internal duplicates within the audit data itself).

## 13. Revised promotable-employer count

**73** (`approve_unchanged` 56 + `correct_then_approve` 17). The 12 `hold_manual_review` rows are explicitly **not** counted as promotable until their specific evidence gap is resolved by a human (see Section 5 for the exact action needed on each).

## 14. Expected `saudi-arabia.csv` total after eventual promotion

**116** (43 existing baseline rows + 73 promotable rows). This does not include the 12 held rows, which would need to clear manual review first and be counted separately in a future pass.

## 15. Expected master-registry total after eventual promotion

**508** (435 existing baseline rows + 73 promotable rows), matching the same +73 delta as `saudi-arabia.csv` since every promoted Saudi row is mirrored into the master registry.

## 16. Proposed source-catalog additions

Per Section 9's final statuses, if/when a human applies corrections:
- **`approved_for_automated_ingestion`** (2): BluePages Business Directory (company-directory data only, not job vacancies), Jobgether (structured JSON API access method approved; Saudi-specific coverage through that API still needs the correct query parameters identified before relying on it).
- **`manual_review_only`** (10): Jadarat, PIF portfolio directory, Saudi Exchange/Tadawul directory, Mihnati, Wadhefa, Tanqeeb, GulfTalent, NADIA Global (with the domain correction applied), Avensys Consulting, SmartChoice International GCC.
- **`discovery_only`** (4): Taqat (legacy, superseded by Jadarat), HRDF (informational only, no listings), Jeddah Chamber of Commerce/JCCI (links out to BluePages rather than listing jobs itself), Scout Global (no confirmed Saudi coverage).
- **`blocked_or_restricted` / `rejected_unsafe`**: 0 each — no source was found unsafe or fully blocked with no discovery value.

None of these are being written into the production `source-expansion/source-catalog.csv` in this pass — this is the proposed disposition for a future promotion step.

## 17. Validation checklist and results

All checks below were run programmatically with the quote-aware `csv.cjs` RFC4180 parser (not naive comma-splitting), against the actual files on disk in this working tree.

| Check | Result |
|---|---|
| Exactly 85 staged employer decisions | PASS — 85 rows, 1 decision each |
| No lost or double-counted employer candidate | PASS — 0 missing, 0 extra vs. `saudi-promotion-staging.csv`'s 85 ids |
| No duplicate staged canonical IDs | PASS — 0 duplicates (re-confirmed; unchanged from the original staging pass) |
| No duplicate `(canonical ID, Saudi Arabia)` pair vs. existing 435-row master registry | PASS — 0 collisions (re-confirmed) |
| Exactly 61 unique HR emails / 62 total rows with 1 status each | PASS — 62 rows, statuses sum to 62 |
| Al Kafaa re-verification | PASS — held up on independent re-fetch |
| No email promoted without first-party evidence | PASS — only 1 of 62 rows is `official_recruitment_email_verified`, with a direct `mailto:` citation |
| No free-mail address promoted | PASS — 0 of the 6 free-mail rows are verified |
| Exactly 16 source decisions, 1 each | PASS — 16 rows, statuses sum to 16 |
| No source approved for automated ingestion without both technical + policy evidence | PASS — the 2 approvals (BluePages, Jobgether) both have confirmed-open robots.txt and no AI-bot block found; GulfTalent explicitly stays `manual_review_only` because of its confirmed ClaudeBot block |
| No personal `linkedin.com/in/` URL in any new or existing artifact | PASS — re-grepped the entire pilot directory; the only match is a prose reference in `reconciliation-report.md` describing the *prior* fix, not a stored URL |
| No third-party aggregator stored as an official careers URL in the audit findings' proposed corrections | PASS — every `after=` value in the 17 corrections is either an official domain or an explicit removal of the aggregator-only citation (Amazon) |
| No unsupported active-job claim left unflagged | PASS — every stale/404 specific job link (Lenovo, BCG Platinion, BMC Helix, Alnafitha IT, Salesforce) was downgraded to a channel-confirmed-only status rather than left claiming an active job |
| No generic remote job mislabeled Saudi-eligible | PASS — Alpaca's overclaim was caught and downgraded (Section 7) |
| Valid CSV quoting and column counts | PASS — all 3 new audit-findings CSVs parse cleanly with the quote-aware parser |
| Production files byte-for-byte unchanged | PASS — `git diff --stat main --` empty for `saudi-arabia.csv`, `master-company-registry.csv`, `source-expansion/source-catalog.csv`, `international-remote.csv`, `lebanon.csv`, `uae.csv`, `qatar.csv`, `kuwait.csv` |
| `AGENTS.md` unchanged and unstaged | PASS — `git diff main -- AGENTS.md` empty |
| No secrets, tokens, or temp files added to the repo | PASS — all working files were created under the session scratchpad directory outside the repo; only the final `docs/job-source-discovery/pilots/saudi-expansion/` artifacts were written into the repo |
| No paid-service or Apify calls | PASS — only WebFetch/WebSearch were used, consistent with the original pass |
| `git status --short` shows only the untracked pilot directory | PASS |

## 18. Files created or modified

**Created (new, this audit pass only):**
- `docs/job-source-discovery/pilots/saudi-expansion/human-quality-audit-report.md` (this file)
- `docs/job-source-discovery/pilots/saudi-expansion/audit-findings-employers.csv` (85 rows)
- `docs/job-source-discovery/pilots/saudi-expansion/audit-findings-sources.csv` (16 rows)
- `docs/job-source-discovery/pilots/saudi-expansion/audit-findings-emails.csv` (62 rows)

**Modified:** none. Every artifact from the prior discovery pass (`saudi-promotion-staging.csv`, `supplied-hr-email-audit.csv`, `discovered-job-sources.csv`, `supplied-linkedin-leads.csv`, `manual-review-queue.csv`, `rejected-candidates.csv`, `duplicate-and-alias-review.csv`, `discovered-employer-candidates.csv`, `search-query-matrix.csv`, `baseline-assessment.md`, `reconciliation-report.md`, `saudi-promotion-staging-manifest.csv`) is untouched — corrections are documented in the new audit-findings files and this report, not yet applied, consistent with the verdict naming (`READY_TO_APPLY_CORRECTIONS`, not `READY_FOR_COMMIT`).

**Production files:** none touched. `saudi-arabia.csv`, `master-company-registry.csv`, `source-expansion/source-catalog.csv`, `international-remote.csv`, `lebanon.csv`, `uae.csv`, `qatar.csv`, `kuwait.csv`, and `AGENTS.md` all remain byte-for-byte identical to `main` (confirmed via `git diff --stat`/`git diff`).

## 19. Confirmation

- No `git add`, `git commit`, `git push`, merge, or pull request was run.
- Nothing was promoted into any production CSV.
- Nothing was staged in git.
- All 12 prior-pass research artifacts remain exactly as they were before this audit began.

## 20. Final verdict

**READY_TO_APPLY_CORRECTIONS**

The audit found no fabrications, no invented careers URLs, no invented Saudi offices, no invented active vacancies, and no invented remote eligibility — every defect found (stale links, one wrong city, one nationality restriction, one invalid wildcard URL, two contradicted claims, one unresolved domain, one under-cited multi-market row) is a concrete, correctable, or clearly-scoped-for-human-review item. 73 of 85 staged employers are promotable as-is or after a documented mechanical correction; 12 need a specific, named piece of missing evidence before they can be promoted. The 16 sources and 61 emails are each fully reconciled with a single final decision. A future pass can mechanically apply the 17 documented corrections to `saudi-promotion-staging.csv`, resolve or drop the 12 holds, and only then proceed to an actual production promotion/commit step.
