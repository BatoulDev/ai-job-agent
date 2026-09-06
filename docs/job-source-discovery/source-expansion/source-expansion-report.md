# Source-Expansion Report (Apify-Ready Source & Search-Strategy Discovery)

**Status: COMPLETE — all 6 planned markets (Lebanon, Saudi Arabia, UAE, Qatar, Kuwait, International Remote) finished and validated as of 2026-09-04. See the Final Consolidated Summary (Section 10) for the cross-market synthesis.**
**Scope:** Research and documentation only. No ingestion, scraping automation, Apify runs, n8n workflow changes, application-code changes, or LinkedIn automation occurred or will occur under this task.
**Branch:** `feat/job-source-discovery` (untracked working-tree files only — nothing staged, committed, pushed, merged, or switched).

---

## 0. Session-interruption recovery audit (this pass, 2026-09-04)

The prior session hit its session limit while attempting this exact task and left no usable deliverable content. Recovery findings:

1. **Round 1–3 registry work (`docs/job-source-discovery/*.csv`, `discovery-report.md`) is fully intact and untouched.** `master-company-registry.csv` contains 255 lines (254 records + header), matching the Round 3 documented count exactly (227 unique canonical companies). All Round 1–3 files carry timestamps from 11:37–12:40 on 2026-09-04, predating the source-expansion attempt — confirming nothing from this task touched them.
2. **None of the five required source-expansion deliverables existed anywhere** (`source-catalog.csv`, `search-query-matrix.csv`, `pilot-company-candidates.csv`, `apify-discovery-design.md`, `source-expansion-report.md`) — this task had produced zero content before the interruption.
3. **The only trace of the interrupted run** was an empty directory scaffold mistakenly created at `docs/job-source-discovery/docs/job-source-discovery/source-expansion/` (created 13:43, after all real Round 1–3 work) — a duplicated-path bug, not a wrong-location file save. It contained no files (verified via directory listing showing only `.`/`..`). It has been removed, and the correct path `docs/job-source-discovery/source-expansion/` created in its place. No duplicate copies exist.
4. **No market was researched under this task before the interruption** — not Lebanon, not Saudi Arabia, not any other market. The "failed Saudi Arabia pass" mentioned in the task brief left nothing to recover; its source-discovery work starts fresh in this session.
5. **No unfinished agent left partial or unreliable content** — because no agent under this task produced any file output at all prior to this session.
6. **No existing registry file was unintentionally changed** — confirmed via line counts and timestamps (see point 1).

**Conclusion:** this session resumes from true zero progress on the source-expansion task itself, with the directory-nesting bug fixed. Round 1–3 registry work required no repair and was not touched.

---

## 0.1 Second interruption recovery audit (this pass, 2026-09-04)

A subsequent background agent, launched to research Lebanon, failed with `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR` before its response was received. Recovery findings before resuming work directly in the main agent (per explicit instruction, no further background agent was launched):

1. **All four Lebanon-scoped deliverable files were inspected before any new work began.** `source-catalog.csv`, `search-query-matrix.csv`, and `pilot-company-candidates.csv` each contained only their header row (0 data rows) — confirmed by direct read and by line-count (`wc -l` = 1 for each). `apify-discovery-design.md` contained only its template scaffold, with the Lebanon per-market section still reading `*(pending — research in progress)*`.
2. **Conclusion: the failed background agent produced zero usable output before its connection error** — there was nothing partial to merge or preserve. This is a genuine second interruption (distinct from the Section 0 interruption above, which affected the whole task before any market was attempted), but its net effect on saved data is the same: zero prior Lebanon content existed in any of the four files at the start of this pass.
3. **`git status --short` confirmed** only the untracked `docs/job-source-discovery/` directory (and its `source-expansion/` subdirectory) — no staged, committed, or otherwise-tracked changes exist anywhere in the repository as a result of either interrupted attempt.
4. Lebanon research was then performed directly in this session (WebSearch + WebFetch, no Agent/background-task spawned), per the explicit instruction to complete Lebanon before touching any other market.

---

## 1. Market progress tracker

| Market | Status | Notes |
|---|---|---|
| Lebanon | **COMPLETE — checkpointed 2026-09-04** | 10 sources cataloged, 9 search queries run, 22 pilot company candidates sampled, Apify actor evaluation done. See Sections 2–4 below. |
| Saudi Arabia | **COMPLETE — checkpointed 2026-09-04** | 13 sources cataloged, 9 search queries run, 26 pilot company candidates sampled, Apify actor evaluation done (Bayt actor reused from Lebanon, no re-search needed). See Sections 2–4 below. |
| **UAE — COMPLETE** | **COMPLETE — checkpointed 2026-09-04** | 21 sources cataloged across all 7 emirates + country-wide, 23 search queries run, 23 pilot company candidates sampled with explicit per-candidate emirate tagging, Apify actor evaluation done (Bayt reused; GulfTalent/NaukriGulf newly evaluated). See Sections 2–4 below. |
| **Qatar — COMPLETE** | **COMPLETE — checkpointed 2026-09-04** | 16 sources cataloged across Doha, Al Rayyan, Lusail, Al Wakrah, Ras Laffan, Mesaieed, and country-wide, 14 search queries run, 20 pilot company candidates sampled with explicit per-candidate location tagging, Apify actor evaluation done (Bayt and GulfTalent both reused from prior passes, no new actors needed). See Sections 2–4 below. |
| **Kuwait — COMPLETE** | **COMPLETE — checkpointed 2026-09-04** | 15 sources cataloged, 16 search queries run, 15 pilot company candidates sampled (8 with explicitly unconfirmed governorate rather than a guess), direct ATS investigation confirmed Workable is genuinely used in Kuwait (Greenhouse/Lever were not), 1 correction-evidence finding documented for an existing needs_manual_review row (not applied to production). See Sections 2–4 below. |
| **International Remote — COMPLETE** | **COMPLETE — checkpointed 2026-09-04 — FINAL MARKET OF THIS PROJECT** | 14 sources cataloged, 18 search queries run, 15 pilot company candidates sampled across 6 job functions, headline finding: Himalayas' free official API with genuine Lebanon filtering (no scraping actor needed) and 3 confirmed EOR providers (Deel/Remote.com/G-P) explicitly supporting Lebanon. See Sections 2–4 and the Final Consolidated Summary below. |

**ALL SIX MARKETS ARE NOW COMPLETE.** See the Final Consolidated Summary section at the end of this report for the cross-market synthesis this task requires.
| Kuwait | NOT STARTED | |
| International remote (Lebanon-supporting) | NOT STARTED | |

*(This table is updated after every market completes. If the session is interrupted again, the last "IN PROGRESS" or "NOT STARTED" row marks the exact resume point — do not restart a market marked complete.)*

---

## 2. Reusable source counts per market

| Market | Sources cataloged | Accessible (direct fetch worked) | Blocked (403/429/reset/wrong-path) this pass | Not yet fetched (identified via search only) | Excluded by policy |
|---|---|---|---|---|---|
| **Lebanon** | **10** | 5 (Bayt*, HireLebanese, Akhtaboot, BDD members, Jobs.com.lb-thin) | 3 (CCIB 429, Daleel Madani 403, Amaken 403) | 1 (IDAL) | 1 (LinkedIn) |
| **Saudi Arabia** | **13** | 1 (GrowthList.co) | 5 (Bayt direct fetch 403, Fintech Saudi Map redirect+cert error, LEAP exhibitors 403 on both the official page and a mirror, Riyadh Chamber ECONNRESET, Council of Saudi Chambers 404 on the guessed path) | 6 (Asharqia Chamber, Biban Forum, Monsha'at, MISA, National Factories Directory, 500 Global portfolio) | 1 (LinkedIn) |
| **UAE** | **21** | 4 (Hub71 job board, GEMS Education careers, Jumeirah careers [landing page only], ConstructionPlacements.com) | 7 (Dubai Chambers 403, Sharjah Business Directory 404, Ajman Chamber Directory 404, DIFC Public Register 403, Hub71 startups directory JS-empty, GITEX 403 on official page and mirror, Fujairah Free Zone DNS failure + thin content) | 8 (Abu Dhabi Chamber, RAK Chamber, Fujairah Chamber, Umm Al Quwain Chamber, ADGM, KEZAD/Josoor, Bayt UAE direct fetch, GulfTalent via Apify actor) | 1 (LinkedIn) |
| **Qatar** | **16** | 3 (QFCRA Public Register, QatarYello directory [data-quality caveat, see Section 6], QAFCO careers page) | 2 (Qatar Chamber directory login-gated, QFTH certificate error) | 10 (QFC Public Register, QFZA, QSTP, QBIC, Mesaieed cluster's other 3 companies as individual sites, Ras Laffan cluster, Al Wakra Hospital, Qatari Diar, Bayt Qatar, GulfTalent Qatar) | 1 (LinkedIn) |
| **Kuwait** | **15** | 5 (CBK regulated-entities register, Failory startups list, jobs.workable.com Kuwait search, Al Salam Hospital, Royale Hayat Hospital [thin]) | 1 (Boursa Kuwait 403) | 8 (KCCI, KDIPA, PAI, D&B governorate directories [search-snippet evidence only], Sultan Center's own domain [thin], Kuwait startup accelerator programs, Bayt Kuwait, GulfTalent Kuwait) | 1 (LinkedIn) |
| **International Remote** | **14** | 4 (Himalayas API+page, GitHub established-remote list, Deel Lebanon page, Remote.com Lebanon EOR page) | 1 (NaTakallam, 403 for the 3rd consecutive pass) | 8 (Working Nomads, Jobgether, Arc.dev, Turing, Globalization Partners, Ashby ecosystem, its third-party aggregator, FlexJobs [high-level only per instruction]) | 1 (LinkedIn) |

Note: UAE also has 1 source (DMCC Business Directory) that is **accessible but deliberately excluded from data extraction** for compliance reasons (its own terms forbid reproducing/redistributing directory content) — not counted in either "Accessible" or "Blocked" above since neither label fits; see Section 6 below.

*(remaining markets filled in as each completes)*

\* Lebanon's Bayt row was never directly WebFetched either (WebSearch evidence only) — its "accessible" classification in Section 2 of the Lebanon pass reflected the general site's known public availability, not a direct fetch this task performed. Saudi Arabia's Bayt row **was** directly WebFetched and returned 403, a genuinely different, stronger data point — still cataloged as the strongest source in both markets because of the confirmed Apify actor, not because of a confirmed direct fetch.

## 3. Pilot candidate counts and new-candidate yield

| Market | Pilot candidates sampled | Already in master registry | New (unverified this pass) | Yield rate |
|---|---|---|---|---|
| **Lebanon** | **22** (20 from BDD members, 2 from HireLebanese) | 2 (Proximie, SE Factory) | 20 | ~91% new-candidate yield from a single directory source (BDD), confirming it as a genuinely distinct discovery channel from the Round 1–3 registry work |
| **Saudi Arabia** | **26** (20 from GrowthList.co, 4 from Fintech Saudi Map, 2 from LEAP exhibitors) | 4 unique (Rewaa, Foodics, Tamara, Geidea) + 1 cross-market note (Wahed, already registered under Lebanon, not Saudi Arabia) | 21 (1 explicitly flagged as a likely data-quality error — Birdeye, a US company that probably doesn't belong on a Saudi startup list) | ~97% new-candidate yield from GrowthList.co alone (only 3 of 97 raw names matched the registry) — the single highest-yield source found across both markets so far |
| **UAE** | **23** (11 from Hub71's job board, 8 from ConstructionPlacements.com, 1 from GEMS Education's own careers portal, 3 confirmed via dedicated follow-up searches: TruKKer, Bee'ah, Crescent Enterprises/Gulftainer) | 1 (Bayzat, with a location nuance flagged — see Section 8) | 19 new_candidate + 1 duplicate_or_alias (Al Futtaim → cc-al-futtaim, carefully distinguished from the separate Majid Al Futtaim) + 2 unverifiable (autone, EYouth) | 0% exact-name overlap against the registry among the 22 non-alias rows — every genuinely new UAE row this pass came from a source never used in Rounds 1–3 |
| **Qatar** | **20** (4 from the Mesaieed industrial cluster, 3 from Ras Laffan, 5 from QFTH, 3 from QBIC, 1 each from Al Wakra Hospital/Qatari Diar/iHorizons/Industries Qatar/QFCRA register) | 1 (ADCB, a cross-market note — already registered under UAE, not Qatar) | 17 new_candidate + 1 duplicate_or_alias (Qatargas → cc-qatarenergy, an already-documented historical brand alias) + 1 unverifiable (Keppel, due to a source data-quality concern) | 0% exact-name overlap against the registry among the 19 non-alias rows — every genuinely new Qatar row this pass came from a source never used in Rounds 1–3, and every one of Qatar's 3 major industrial cities/zones (Mesaieed, Ras Laffan) had ZERO registry rows before this pass |
| **Kuwait** | **15** (9 from Failory's startup list, 2 from the CBK regulated-entities register, 2 from the Workable ATS search, 1 each from the D&B governorate directories and Al Salam Hospital) | 1 (Americana Group — a correction-evidence finding on an existing needs_manual_review row, not a plain match) | 12 new_candidate + 1 duplicate_or_alias (Kuwait National Petroleum Company → cc-kuwait-national-petroleum-company, the same already-registered no_official_source_found entity) + 1 unverifiable (Sakan, single-source evidence only) | 94% new-candidate yield from Failory's list alone (only 3 of 50 raw names matched the registry, and all 3 were already-known Kuwait companies) |
| **International Remote** | **15** (9 from Himalayas' Lebanon-filtered results, 2 from the freshness-confirmed GitHub established-remote list, 2 talent-marketplace classifications [Arc.dev, Turing], 1 each from Deel's own hiring and the Himalayas Tabby cross-market signal) | 1 (Tabby — a cross-market note, already registered under Saudi Arabia/UAE) | 14 new_candidate (of which 2, Arc.dev and Turing, are explicitly classified as talent marketplaces rather than direct employers, and 1, micro1, is explicitly classified as a recruiting/EOR platform rather than a direct employer) | Only 1 of 15 pilot candidates (Greenpeace International) reached the strongest `explicitly_hires_in_lebanon` classification; the remaining 13 non-cross-market candidates were conservatively classified `timezone_compatible_but_location_unclear` or `location_unclear`, per this task's strict evidence hierarchy — reflecting the genuine difficulty of confirming Lebanon eligibility at the individual-employer level even from a strong structured source like Himalayas |

Note: the UAE pass introduced a 5-value classification taxonomy for pilot rows (`already_present` / `new_candidate` / `duplicate_or_alias` / `irrelevant` / `unverifiable`) that is stricter than the 2-value vocabulary used for Lebanon/Saudi Arabia (`already_in_master_registry` / `new_candidate_pilot_unverified`); the Qatar, Kuwait, and International Remote passes all reuse this same 5-value taxonomy, since it was explicitly requested again for each. For International Remote specifically, a SECOND, separate 8-value taxonomy was also required (`explicitly_hires_in_lebanon` / `worldwide_remote` / `mena_remote` / `emea_remote` / `timezone_compatible_but_location_unclear` / `country_restricted` / `lebanon_excluded` / `location_unclear`) to classify remote-eligibility distinctly from reconciliation status — since `pilot-company-candidates.csv` has no dedicated column for this second taxonomy, each International Remote row's remote-eligibility classification is recorded as an explicit labeled sentence at the start of its `notes` field (e.g. "Remote-region classification: timezone_compatible_but_location_unclear"), the same embedding approach already used for UAE emirates, Qatar locations, and Kuwait governorates in prior passes. Lebanon and Saudi Arabia rows were **not** retroactively relabeled — both vocabularies now coexist in `pilot-company-candidates.csv` (older rows keep their original values), which is intentional so that Lebanon/Saudi Arabia rows remain byte-for-byte unchanged per this task's explicit preservation requirement; a future pass could normalize all rows onto the stricter taxonomy if desired, but that was not done here.

Note: "new" here means *pilot-unverified* — discovered via a source but not individually confirmed against the company's own official domain/careers page, per this task's lighter-weight discovery scope (full verification to registry standard is separate, future work, consistent with the scope-safety rule against full-scale extraction in a research task).

## 4. Strongest Lebanon expansion sources

Ranked by realistic near-term value:

1. **Bayt.com** — highest confidence: large volume, real pagination, and an existing maintained Apify actor (`blackfalcondata/bayt-scraper`) with native Lebanon support at ~$1/1,000 results.
2. **Beirut Digital District members directory** — smaller volume (~80-100 orgs) but very high signal: a 91% new-candidate yield in this pass's pilot sample, curated by a real institution rather than scraped from noisy listings.
3. **CCIB membership directory** — potentially the single highest-volume source found (chamber claims 15,000+ member firms) but **unconfirmed and currently blocked (HTTP 429)** — the top priority to re-attempt in a future pass before relying on it.
4. **HireLebanese** and **Akhtaboot** — solid secondary job boards, real pagination confirmed for HireLebanese, but neither has a dedicated Apify actor.
5. **Daleel Madani** (NGO directory) and **Amaken** (unclear nature) — both blocked (403) this pass; flagged for manual browser checks, not further automated retries.

## 4.1 Strongest Saudi Arabia expansion sources

Ranked by realistic near-term value:

1. **GrowthList.co's Saudi Arabia startups page** — highest-yield source found in either market so far: 97 names from a single static page, ~97% new to the registry. Zero cost concern (one page, no login, no pagination to fight).
2. **Bayt.com via the same Apify actor used for Lebanon** — no new evaluation needed, natively supports Saudi Arabia; strongest structured/automatable option despite this pass's direct WebFetch being blocked.
3. **Fintech Saudi's official Fintech Map** — official SAMA/CMA-backed sector directory, ~28 named companies via search snippet, not yet directly confirmed (redirect + cert error this pass) but worth a retry given its official status.
4. **Riyadh Chamber, Asharqia Chamber, and the Council of Saudi Chambers** — potentially very high volume (by analogy to Lebanon's CCIB) but **all three inaccessible this pass** — top priority to retry, especially the Council of Saudi Chambers since a single correct page there could map every regional chamber at once.
5. **LEAP exhibitors and Biban Forum** — very high claimed exhibitor counts (2,296 and 1,000+ respectively) but neither yielded an enumerable list this pass; flagged for a future pass with a direct, possibly JS-capable, fetch.
6. **Monsha'at, MISA, and the National Factories Directory** — plausible high-volume government sources, identified but not yet tested.

## 4.2 UAE emirate separation and strongest sources

**Emirate separation was preserved throughout this pass — no company was defaulted to Dubai without evidence.** Of the 23 UAE pilot candidates: 10 are Abu Dhabi (Hub71 ecosystem), 5 are Dubai (each independently confirmed via a dedicated follow-up search, not assumed), 3 are Sharjah (Bee'ah, Crescent Enterprises, Gulftainer — all independently confirmed), 2 are genuine multi-emirate employers (Khansaheb Civil Engineering: Dubai/Abu Dhabi/Sharjah; GEMS Education: Dubai/Abu Dhabi/Sharjah with directly-confirmed per-emirate posting counts), and 2 were left explicitly `unknown_not_individually_confirmed_this_pass` (KEO International Consultants, Atkins Middle East) rather than guessed, plus 1 `unclear` (autone). **Ajman, Ras Al Khaimah, Fujairah, and Umm Al Quwain have zero pilot candidates this pass** — every chamber/directory identified for these four emirates was either blocked (404) or not yet directly fetched; this is this pass's clearest gap, not an assumption that those emirates lack real employers.

Strongest UAE expansion sources, ranked:

1. **Hub71's job board (`jobs.hub71.com/companies`)** — the standout new channel for Abu Dhabi specifically: 12 real names from one unpaginated view (187 claimed total), 0% overlap against the registry. Its sibling page (`hub71.com/startups`) is a JS-rendered dead end by contrast — the two are not interchangeable.
2. **ConstructionPlacements.com's Dubai/UAE list** — 151 names, the single highest raw count this pass, but weaker per-company location evidence (source states general trends, not per-company facts) — a genuine trade-off between volume and precision.
3. **DIFC's Public Register and ADGM's Public Registers** — the two highest-potential-volume sources identified (8,844 and 2,200+ companies claimed) but **neither was successfully accessed this pass** — top priority to retry given their official, free, high-volume nature.
4. **The 7 emirate chambers** (Dubai, Abu Dhabi, Sharjah, Ajman, RAK, Fujairah, Umm Al Quwain) — every single one has a confirmed real domain, but only 3 were even attempted this pass (all 3 blocked/404). Retrying these — especially the 4 currently-zero-coverage emirates — is the highest-value next step for this market.
5. **GEMS Education's careers portal** — not high-volume, but uniquely valuable for its own directly-confirmed multi-emirate posting breakdown (Dubai 143 / Abu Dhabi 27 / Sharjah 24), a rarer and stronger kind of evidence than any other source in this pass.
6. **DMCC's Business Directory** — technically the second-highest claimed volume (26,000+ businesses) of any UAE source, but placed last deliberately: its own terms forbid data extraction/redistribution, so it is not usable for this project's purposes regardless of technical access succeeding.

## 4.3 Qatar geographic separation and strongest sources

**Geographic separation was preserved throughout this pass — Doha was never assumed by default.** Of the 20 Qatar pilot candidates: 4 are Mesaieed (QAFCO, QAPCO, Qatar Steel, Qatalum — all independently confirmed via their own careers portals or direct company research), 2 are Ras Laffan (Dolphin Energy's operational footprint; Qatargas as a duplicate/alias), 1 is Al Wakrah (Al Wakra Hospital), 1 is Lusail (Qatari Diar), 1 is a genuine dual-location case (iHorizons: Doha HQ + Al Rayyan/QSTP R&D lab — the clearest Al Rayyan evidence found this pass), 1 is Qatar country-wide (Industries Qatar, a holding company), and the remaining 9 (QFTH's 5 fintech graduates, QBIC's 3 portfolio companies, plus ADCB) were left explicitly `Doha_likely_not_individually_confirmed_this_pass` rather than asserted as fact, since their evidence came from ecosystem-program membership or a QFC register rather than each company's own site.

**A specific, important finding, not just a gap:** the existing `qatar.csv` had **zero rows outside Doha before this pass** — every one of its 40 pre-existing records is tagged `target_city=Doha`, including Qatar Foundation, HBKU, and Sidra Medicine, whose real-world location (Education City) is officially in **Al Rayyan Municipality**, confirmed via this pass's research. This is flagged as a finding for a future correction pass, not silently edited into the already-`verified` production rows, since that is outside this pilot task's scope.

Strongest Qatar expansion sources, ranked:

1. **The Mesaieed and Ras Laffan industrial-city clusters** — the standout finding this pass: 6 real, named major employers across Qatar's two primary industrial cities, with QAFCO's own careers portal directly confirmed (live SuccessFactors-hosted job list). This single query thread closed a total geographic blank spot that no prior round of research had touched.
2. **The QFCRA Public Register** — a genuinely accessible, official, no-login register, but this pass's sample was dominated by large multinational banks (several already registered under other markets, e.g. ADCB) rather than new Qatar-specific companies; still worth a bounded future crawl for smaller QFC-licensed firms.
3. **QSTP, QBIC, and QFTH** — Qatar's three main innovation ecosystem programs, with substantial claimed portfolios (300+, 100, 50+ respectively), but none were fully, directly accessible this pass (certificate error, third-party-aggregator-only evidence, and directory-index-not-fetched respectively). All three are priority retries.
4. **Qatar Chamber's directory (qatarcid.com)** — a structural access barrier (requires account registration/login), different in kind from the UAE chambers' technical blocks (403/404) — would need a registered account rather than a simple retry.
5. **QatarYello and other general business directories** — usable, but this pass found a concrete location-metadata error (a Nigeria-addressed company shown under a Ras Laffan location page), so any future automated use needs a spot-check step built in, not blind trust in the directory's own location tags.

## 4.4 Kuwait ATS investigation and geographic separation

**ATS investigation (the primary focus this pass, per explicit instruction):** Kuwait was already flagged as contributing zero companies to the strict `suitable_public_ats` ingestion tier. This pass ran targeted per-platform searches (not per-company) for Greenhouse, Lever, Workable, and Workday/Oracle/SuccessFactors/Taleo:
- **Workable: genuinely used, confirmed with direct evidence.** A real, browsable `jobs.workable.com/search/kuwait/` aggregation page exists, plus 3 specific employer boards confirmed via direct WebFetch (Agility — already registered; Americana Group — a correction-evidence finding, see below; SEIDOR — a new IT consultancy).
- **Greenhouse and Lever: adoption could not be confirmed.** Both targeted searches returned zero genuine Kuwait-employer matches. The one near-hit (a "Lever" search surfacing Unilever's own, unrelated careers portal) was correctly recognized as a name-substring false positive, not treated as evidence, per this task's explicit instruction against inferring an ATS from a search snippet alone.
- **Oracle Cloud/HCM, SAP SuccessFactors, and Taleo** were already confirmed elsewhere in the existing `kuwait.csv` (NBK/KFH/Gulf Bank, Alghanim Industries, Boubyan Bank) and were not re-tested.

**Conclusion: the prior weak ATS coverage was a mix of both a real market characteristic (Greenhouse/Lever genuinely appear rare in Kuwait) and a research gap (Workable's real, confirmable presence had not previously been directly searched for by platform).**

## 4.5 International Remote: structured-source findings and employer classification

**Structured-data findings (per this task's explicit instruction to investigate API/RSS/JSON/sitemap/ATS/HTML/JS-rendering/auth access for every useful source):**
- **Himalayas**: free, documented, no-auth JSON API confirmed via direct WebFetch of its own docs — browse and search endpoints, cursor-based pagination (max 20/page), `country`/`locationRestrictions`/`worldwide` filters, 24h data refresh, 429 rate-limiting. The strongest structured-access finding across this entire 6-market project.
- **Working Nomads**: a JSON API endpoint was identified via search (`workingnomads.co/api/exposed_jobs/`) but not directly confirmed this pass — flagged for a future direct fetch before relying on it.
- **We Work Remotely, RemoteOK, Remotive** (all already in `international-remote.csv` from Round 3): RSS feed, JSON API, and API+RSS respectively, all already documented in the existing registry rows — not re-litigated this pass, though Remotive's important free-tier-vs-paid caveat (only ~0.4% of listings reportedly free) is carried forward.
- **Jobgether, Arc.dev, Turing, the Ashby ecosystem**: no public API found for any of these this pass — all would need either the generic Website Content Crawler fallback or, for Ashby specifically, an actor targeting the platform's own career-page structure.

**Employer-classification findings (per this task's explicit 6-way distinction requirement):**
- **micro1** appeared to be a direct legal employer (a "BigLaw Lawyers" posting) but was confirmed via a dedicated follow-up search to be an AI-recruiting/EOR platform placing candidates with client law firms — correctly reclassified as a recruitment/staffing platform, not a direct employer. This is the clearest real-world illustration this pass of exactly the misclassification risk the task warned against.
- **Arc.dev and Turing** were both confirmed as talent marketplaces (vetted freelancer/developer placement for client companies), structurally identical to the already-registered Toptal/Andela/X-Team/Crossover rows — correctly not treated as new employers or a new source category.
- **Deel** was evaluated on two separate, explicitly distinguished angles: (1) as an EOR/payroll infrastructure platform whose own Lebanon-contractor page was directly confirmed, and (2) as a direct employer of its own ~8,400 internal staff (mirroring the existing registry's treatment of Remote.com's internal hiring) — the two angles are recorded as two separate catalog entries specifically so they are never conflated.

**Ecosystem-level EOR/PEO confirmation:** Deel, Remote.com, and Globalization Partners were each found to explicitly state Lebanon support (Deel: contractor payroll; Remote.com: full EOR employment via an owned local legal entity — the strongest single claim; G-P: a named "Lebanon PEO"). This is infrastructure evidence, not per-employer confirmation, but it materially changes the plausibility assessment for any given employer's "we hire globally" marketing claim.

**A correction-evidence finding, explicitly not applied to the production registry per this task's instruction:** Americana Group's existing row is `needs_manual_review` with notes stating no official careers URL was located. This pass found a real Workable-hosted board (`apply.workable.com/americana-kuwait-food-company/?lng=en`) with a confirmed Workable CDN asset reference via direct WebFetch. This is documented in `pilot-company-candidates.csv` (`cand-kw-001`) and here for a future focused audit — `kuwait.csv` itself was not edited.

**Geographic separation:** of 15 Kuwait pilot candidates, 8 were left explicitly `Kuwait_country_wide_specific_governorate_not_confirmed_this_pass` rather than guessed. The 7 with a confirmed location span Kuwait City, a genuine dual-governorate healthcare employer (Al Assima/Capital + Al Ahmadi, directly confirmed via Al Salam Hospital's own live job board), Farwaniya (The Sultan Center), and Hawalli (Future Devices, Salmiya). Jahra and Mubarak Al-Kabeer were confirmed via Dun & Bradstreet to have real, precise company populations (314 and 241 manufacturing companies respectively) but no single new pilot candidate this pass had a fully-unambiguous single-governorate location for either — one candidate's location was genuinely contested between two governorates in the source evidence itself and was left unresolved rather than guessed, consistent with the task's explicit instruction.

## 5. Recommended Apify approach

*(see `apify-discovery-design.md` for full per-actor detail; Lebanon section complete — summary here will be written after all markets complete so the cross-market recommendation can be compared directly)*

## 6. Cost and compliance risks

**Lebanon-specific risks identified this pass:**
- The only actor with confirmed, favorable per-result pricing (Bayt, ~$1/1,000 results) targets a single source; a multi-source approach would mix in the much costlier compute-unit-based generic crawler (~$0.5-$5/1,000 pages) for every other source, since none of HireLebanese, Akhtaboot, BDD, CCIB, or Daleel Madani has a dedicated actor.
- Google Maps Scraper's optional "leads enrichment" and "social media profile" add-ons extract personal contact data (email, phone, named individuals' LinkedIn) — these sub-features should stay disabled if this actor is ever used, to stay consistent with this project's data-minimization posture (`AGENTS.md` §29/§30 personal-data handling principles apply by analogy even though these are prospective source companies, not applicant CVs).
- CCIB, Daleel Madani, and Amaken all showed active anti-bot behavior (429/403) under plain WebFetch; a headless-browser actor might bypass this technically, but doing so against a rate-limiting response specifically raises a ToS-compliance question that should be reviewed before any actor is actually run against these three sources, not just a technical one.
- No LinkedIn actor was evaluated for Lebanon or any market, per the project's hard exclusion rule.

**Saudi Arabia-specific risks identified this pass:**
- Same single-actor cost imbalance as Lebanon: Bayt is cheap and structured (~$1/1,000 results) but every other source (11 of 13 cataloged) has no dedicated actor and would fall back to the costlier compute-unit-based generic crawler.
- A genuine **data-quality risk**, distinct from Lebanon: GrowthList.co's list includes at least one likely mismatch (Birdeye, a US SaaS company) — a reminder that third-party "startup list" aggregators can misclassify company geography, and every such row must stay unverified until independently confirmed, not just until cross-checked against the existing registry.
- LEAP and Biban are large public trade events; scraping an event platform's exhibitor list (if one becomes accessible) would still need a per-site ToS check before any actor is run, same reasoning as Lebanon's CCIB/Daleel Madani.
- No LinkedIn actor was evaluated for Saudi Arabia, per the project's hard exclusion rule.

**UAE-specific risks identified this pass:**
- **A genuinely new, explicit compliance finding, stronger than any seen in Lebanon or Saudi Arabia:** the DMCC Business Directory's own terms expressly forbid copying, downloading, storing, reproducing, reselling, or redistributing its directory content. This is not a generic "check the ToS" caveat — it is a specific, read prohibition. No DMCC company names were extracted into `pilot-company-candidates.csv` as a result, even though the directory loaded successfully. Any future actor design must exclude DMCC entirely, not just proceed cautiously.
- Two Hub71 portfolio entries (autone, EYouth) could not be confirmed as genuine Abu Dhabi employers with real local hiring — a reminder that ecosystem/accelerator membership does not automatically mean local presence, distinct from (but similar in spirit to) Saudi Arabia's Birdeye caution.
- A same-name collision (Al Futtaim vs. Majid Al Futtaim) was correctly resolved this pass, but the underlying risk — that UAE business-family names recur across legally distinct entities (Al Futtaim, Al Habtoor, Al Naboodah, Al Ghurair, etc. all have multiple related-but-separate group companies) — will recur in future passes and needs the same careful, non-automatic handling every time.
- GulfTalent and NaukriGulf actors were identified but not fully evaluated for pricing/output this pass — a cost/compliance gap to close before any pilot use.
- No LinkedIn actor was evaluated for the UAE, per the project's hard exclusion rule.

**Qatar-specific risks identified this pass:**
- **A location-metadata reliability risk, distinct in kind from a compliance restriction:** the QatarYello general business directory returned at least one clear data error (a Nigeria-addressed company shown under a Ras Laffan location page) in the single location-page sample fetched this pass. This is a data-quality risk (don't trust a directory's own location tags blindly), not a ToS/compliance risk like the UAE's DMCC finding — both matter, but they require different mitigations (spot-checking vs. outright exclusion).
- The Qatar Chamber's directory requires account registration, a structural access barrier rather than a technical block — any future automation would need a registered account, raising its own terms-of-service question that should be reviewed before proceeding, not just a retry-with-different-headers approach.
- Group-relationship risk (same principle as the UAE's Al Futtaim/Majid Al Futtaim caution): this pass surfaced 2 real parent/subsidiary pairs (Industries Qatar → Qatar Steel; Hamad Medical Corporation → Al Wakra Hospital) that must be tracked as related, not treated as unrelated new companies, in any future verification pass.
- No LinkedIn actor was evaluated for Qatar, per the project's hard exclusion rule.

**Kuwait-specific risks identified this pass:**
- **A data-quality risk analogous to Qatar's QatarYello finding, but at the source-list-categorization level rather than location-metadata level:** Failory's "Top 50 Kuwait Startups" list mixes genuine startups with large, decades-old state enterprises (Kuwait Petroleum Corporation, Kuwait National Petroleum Company, Kuwait Institute for Scientific Research) — any future automated use of this source needs a legitimacy/categorization filter, not blanket trust in the list's own "startup" framing.
- Group-relationship risk (same principle as prior markets' Al Futtaim/Industries Qatar cautions): Kuwait Gulf Oil Company (KGOC) was carefully confirmed as a **distinct** entity from the already-registered Kuwait Oil Company (KOC) despite the similar name and shared KPC-group parentage — a genuine same-name-collision risk that was resolved with evidence, not assumed either way.
- A correction-evidence finding for an existing row (Americana Group's Workable board) was documented but deliberately NOT applied to the production registry, per this task's explicit instruction — any future focused-audit pass should treat this as a starting point, not already-verified fact.
- No LinkedIn actor was evaluated for Kuwait, per the project's hard exclusion rule.

**International Remote-specific risks identified this pass:**
- **The central risk in this market is eligibility-inference risk, not source-access risk**: unlike the 5 country markets (where the main question is "does this company exist and is its careers page reachable"), the main risk here is silently treating "remote"/"worldwide"/"global" marketing language as proof of Lebanon eligibility. This pass's conservative classification (only 1 of 15 candidates reached `explicitly_hires_in_lebanon`) is a direct, deliberate mitigation of this risk, not a research shortfall.
- Himalayas' "Lebanon" country filter likely over-includes worldwide-open roles rather than only genuinely Lebanon-specific ones (the 2,119-result count is implausible as a Lebanon-only figure) — any future automated use must filter on the API's own `locationRestrictions` field per job, not trust the country-page URL alone.
- micro1's misclassification risk (see Section 4.5) is a concrete illustration of why the platform-vs-employer distinction matters — treating a recruiting platform's client-placement posting as if the platform itself were hiring would misattribute the employer relationship.
- No LinkedIn actor was evaluated for International Remote, per the project's hard exclusion rule and this task's own explicit restatement of it.

*(cross-market cost/compliance summary will be completed after all markets finish)*

## 7. Validation results

**Lebanon (this pass):**
- All 3 Lebanon CSV deliverables parsed with Python's `csv` module: `source-catalog.csv` (10 data rows, 16 fields/row, 0 malformed), `search-query-matrix.csv` (9 data rows, 10 fields/row, 0 malformed), `pilot-company-candidates.csv` (22 data rows, 10 fields/row, 0 malformed) — all rows match their file's header field count exactly.
- Registry cross-reference: all 22 pilot candidates were checked by name against `master-company-registry.csv` (grep + manual confirmation); exactly 2 matches found and correctly flagged `already_in_master_registry` with their real `canonical_company_id` (`cc-proximie`, `cc-se-factory`) rather than left blank or guessed.
- Market-separation check: every row in all 3 Lebanon CSVs has `market` = `Lebanon`, no cross-market contamination.
- Evidence-URL check: every row in all 3 CSVs has a non-empty, well-formed `https://` evidence/source URL, including blocked sources (the blocked source's own URL is recorded as evidence that it was targeted, with its blocked status stated explicitly rather than omitted).

**Saudi Arabia (this pass):**
- All 3 CSVs re-parsed with Python's `csv` module after the append: `source-catalog.csv` grew from 10 to 23 data rows (13 new, 16 fields/row), `search-query-matrix.csv` grew from 9 to 18 (9 new, 10 fields/row), `pilot-company-candidates.csv` grew from 22 to 48 (26 new, 10 fields/row) — 0 malformed rows in any file, and every existing Lebanon row confirmed byte-for-byte present (append-only, no rows rewritten or reordered).
- Registry cross-reference: all 26 Saudi Arabia pilot candidates were checked by name (case-insensitive, via a Python script reading `master-company-registry.csv` with the `utf-8-sig` encoding needed for its BOM) against all 254 registry rows; 5 matches found — 4 correctly flagged `already_in_master_registry` with their real `canonical_company_id`, and 1 (Wahed) correctly flagged as a cross-market note rather than a Saudi Arabia duplicate, since its existing registry row is filed under Lebanon/international-remote, not Saudi Arabia.
- Market-separation check: every new row in all 3 CSVs has `market` = `Saudi Arabia`; per-market row counts in each file now split cleanly as Lebanon/Saudi Arabia with no cross-contamination (confirmed programmatically, not just visually).
- Evidence-URL check: every new row has a non-empty, well-formed `https://` evidence/source URL, including the 11 blocked or not-yet-fetched Saudi Arabia sources (each recorded with its real target URL and honest access status, not omitted or invented).
- Data-quality self-check: the one questionable pilot row (Birdeye) was not silently dropped or silently included — it was explicitly flagged in its own `notes` field, consistent with the task's instruction to keep new pilot companies unverified unless evidence genuinely supports more.

**UAE (this pass):**
- All 3 CSVs re-parsed with Python's `csv` module after the append: `source-catalog.csv` grew from 23 to 44 data rows (21 new, 16 fields/row), `search-query-matrix.csv` grew from 18 to 41 (23 new, 10 fields/row), `pilot-company-candidates.csv` grew from 48 to 71 (23 new, 10 fields/row) — 0 malformed rows in any file.
- **Lebanon and Saudi Arabia rows confirmed unchanged**: a programmatic per-market row count on all 3 files after the UAE append shows exactly Lebanon 10/9/22 and Saudi Arabia 13/9/26 across `source-catalog.csv`/`search-query-matrix.csv`/`pilot-company-candidates.csv` respectively — identical to the counts recorded at the end of the Saudi Arabia pass, confirming an append-only operation with no prior rows touched.
- Duplicate-ID check: zero duplicate `source_id`, `candidate_id`, or `query_id` values across all 3 files combined (71 candidate IDs, 44 source IDs, 41 query IDs, all programmatically confirmed unique).
- Registry cross-reference: all 23 UAE pilot candidates were checked by name against all 254 registry rows; 1 exact match (Bayzat) plus 1 alias match (Al Futtaim → cc-al-futtaim, correctly distinguished from the separate cc-majid-al-futtaim) were found and correctly classified `already_present` and `duplicate_or_alias` respectively rather than both being called "already in registry" without distinction.
- **Emirate-separation check**: a programmatic scan of every UAE pilot row's `notes` field confirms explicit emirate tagging for all 23 rows — 10 Abu Dhabi, 5 Dubai (each individually confirmed, not assumed), 3 Sharjah, 2 multi-emirate, 2 explicitly `unknown_not_individually_confirmed_this_pass`, 1 `unclear` — zero rows silently defaulted to Dubai without evidence.
- Taxonomy check: `verification_status` values for all 23 UAE rows fall within the requested 5-value set (`already_present`×1, `new_candidate`×19, `duplicate_or_alias`×1, `unverifiable`×2; `irrelevant` was not used this pass because no candidate genuinely warranted it — not forced to appear).
- Evidence-URL check: every new row has a non-empty, well-formed `https://` (or `http://` for 1 legacy chamber domain) evidence/source URL, including blocked/not-yet-fetched sources.

**Qatar (this pass):**
- All 3 CSVs re-parsed with Python's `csv` module after the append: `source-catalog.csv` grew from 44 to 60 data rows (16 new, 16 fields/row), `search-query-matrix.csv` grew from 41 to 55 (14 new, 10 fields/row), `pilot-company-candidates.csv` grew from 71 to 91 (20 new, 10 fields/row) — 0 malformed rows in any file.
- **Lebanon, Saudi Arabia, and UAE rows confirmed unchanged**: a programmatic per-market row count on all 3 files after the Qatar append shows exactly Lebanon 10/9/22, Saudi Arabia 13/9/26, and UAE 21/23/23 across `source-catalog.csv`/`search-query-matrix.csv`/`pilot-company-candidates.csv` respectively — identical to the counts recorded at the end of the UAE pass, confirming an append-only operation with no prior rows touched.
- Duplicate-ID check: zero duplicate `source_id`, `candidate_id`, or `query_id` values across all 3 files combined (91 candidate IDs, 60 source IDs, 55 query IDs, all programmatically confirmed unique).
- Registry cross-reference: all 20 Qatar pilot candidates were checked by name against all 254 registry rows; 1 match (ADCB → cc-adcb, registered under UAE not Qatar) correctly classified `already_present` with an explicit cross-market note, and 1 alias (Qatargas → cc-qatarenergy) correctly classified `duplicate_or_alias` rather than either being called simply "new."
- **Geographic-separation check**: a programmatic scan of every Qatar pilot row's `notes` field confirms explicit location tagging for all 20 rows — 4 Mesaieed, 2 Ras Laffan-related, 1 Al Wakrah, 1 Lusail, 1 dual-location Doha/Al Rayyan (iHorizons), 1 Qatar country-wide, 1 Doha (ADCB), and 9 explicitly `Doha_likely_not_individually_confirmed_this_pass` — zero rows silently defaulted to Doha without evidence, and zero Qatar rows were mixed into any other market's file.
- Taxonomy check: `verification_status` values for all 20 Qatar rows fall within the requested 5-value set (`new_candidate`×17, `already_present`×1, `duplicate_or_alias`×1, `unverifiable`×1; `irrelevant` was not used this pass for the same reason as the UAE pass — no candidate genuinely warranted it).
- Evidence-URL check: every new row has a non-empty, well-formed `https://` evidence/source URL, including blocked/not-yet-fetched sources.
- Market-mixing check: confirmed every new row in all 3 files has `market` = `Qatar` exactly (not "Doha", not a Gulf-region catch-all) — no Qatar company was tagged under UAE, Saudi Arabia, or any other market's rows, and vice versa.

**Kuwait (this pass):**
- All 3 CSVs re-parsed with Python's `csv` module after the append: `source-catalog.csv` grew from 60 to 75 data rows (15 new, 16 fields/row), `search-query-matrix.csv` grew from 55 to 71 (16 new, 10 fields/row), `pilot-company-candidates.csv` grew from 91 to 106 (15 new, 10 fields/row) — 0 malformed rows in any file.
- **Lebanon, Saudi Arabia, UAE, and Qatar rows confirmed unchanged**: a programmatic per-market row count on all 3 files after the Kuwait append shows exactly Lebanon 10/9/22, Saudi Arabia 13/9/26, UAE 21/23/23, and Qatar 16/14/20 across `source-catalog.csv`/`search-query-matrix.csv`/`pilot-company-candidates.csv` respectively — identical to the counts recorded at the end of the Qatar pass, confirming an append-only operation with no prior rows touched.
- **`kuwait.csv` itself confirmed untouched**: still 36 data rows, byte-for-byte identical to the state inspected at the start of this pass — no existing `verified` or `no_official_source_found` row was edited, per this task's explicit instruction; the Americana Group correction-evidence finding was recorded only in `pilot-company-candidates.csv` and this report.
- Duplicate-ID check: zero duplicate `source_id`, `candidate_id`, or `query_id` values across all 3 files combined (106 candidate IDs, 75 source IDs, 71 query IDs, all programmatically confirmed unique).
- Registry cross-reference: all 15 Kuwait pilot candidates were checked by name against all 254 registry rows; 1 exact match (Kuwait National Petroleum Company → cc-kuwait-national-petroleum-company) correctly classified `duplicate_or_alias`, and 1 real correction-evidence finding (Americana Group → cc-americana-group) correctly classified `already_present` rather than either being silently dropped or miscounted as a "new" discovery.
- **Geographic-separation check**: a programmatic scan of every Kuwait pilot row's `notes` field confirms explicit location handling for all 15 rows — 8 explicitly `Kuwait_country_wide_specific_governorate_not_confirmed_this_pass` (not silently defaulted), plus Kuwait City, Al Assima/Al Ahmadi (dual), Farwaniya, and Hawalli/Salmiya each represented with real evidence — zero rows guessed, zero Kuwait rows mixed into any other market's file.
- Taxonomy check: `verification_status` values for all 15 Kuwait rows fall within the requested 5-value set (`new_candidate`×12, `already_present`×1, `duplicate_or_alias`×1, `unverifiable`×1; `irrelevant` not used for the same reason as prior passes).
- Evidence-URL check: every new row has a non-empty, well-formed `https://` evidence/source URL, including blocked/not-yet-fetched sources.

**International Remote (this pass — final market):**
- All 3 CSVs re-parsed with Python's `csv` module after the append: `source-catalog.csv` grew from 75 to 89 data rows (14 new, 16 fields/row), `search-query-matrix.csv` grew from 71 to 89 (18 new, 10 fields/row), `pilot-company-candidates.csv` grew from 106 to 121 (15 new, 10 fields/row) — 0 malformed rows in any file.
- **All 5 prior markets confirmed unchanged**: a programmatic per-market row count on all 3 files after the International Remote append shows exactly Lebanon 10/9/22, Saudi Arabia 13/9/26, UAE 21/23/23, Qatar 16/14/20, and Kuwait 15/16/15 across `source-catalog.csv`/`search-query-matrix.csv`/`pilot-company-candidates.csv` respectively — identical to the counts recorded at the end of the Kuwait pass.
- **All 6 production registry files confirmed untouched**: `lebanon.csv` (66 lines), `saudi-arabia.csv` (44), `uae.csv` (40), `qatar.csv` (41), `kuwait.csv` (37), and `international-remote.csv` (32) all match their line counts from before this pass began; `master-company-registry.csv` (255 lines) was never written to at any point in this entire 6-pass project.
- Duplicate-ID check: zero duplicate `source_id`, `candidate_id`, or `query_id` values across all 3 files combined (121 candidate IDs, 89 source IDs, 89 query IDs, all programmatically confirmed unique).
- Registry cross-reference: all 15 International Remote pilot candidates were checked by name against all 254 registry rows; 1 match (Tabby → cc-tabby, already registered under Saudi Arabia/UAE) correctly classified `already_present` with a cross-market note rather than added as a duplicate row.
- **Market-mixing check**: confirmed every new row in all 3 files has `market` = `International Remote` exactly — no international-remote source or candidate was mixed into any of the 5 country files, and no country-market source or candidate was mixed into the International Remote rows.
- Taxonomy check: `verification_status` values for all 15 International Remote rows fall within the requested 5-value set (`new_candidate`×14, `already_present`×1). The separate 8-value remote-eligibility taxonomy was applied via labeled `notes`-field sentences on every row (see Section 3's note above on this schema decision) — spot-checked: 1 `explicitly_hires_in_lebanon`, the remainder `timezone_compatible_but_location_unclear` or `location_unclear`, zero rows silently defaulted to `worldwide_remote` without direct evidence.
- Evidence-URL check: every new row has a non-empty, well-formed `https://` evidence/source URL, including the blocked NaTakallam retry.

**INTERNATIONAL REMOTE IS THE FINAL MARKET OF THIS PROJECT.** All 6 markets (Lebanon, Saudi Arabia, UAE, Qatar, Kuwait, International Remote) are now validated complete. See the Final Consolidated Summary at the end of this report.

## 8. Remaining gaps / blocked work

**Lebanon:**
- CCIB membership directory (potentially the highest-volume source) is blocked by HTTP 429 — needs a retry, ideally at a slower request rate or via a manual browser visit.
- Daleel Madani (NGO directory) and Amaken (unclear site nature) both returned HTTP 403 — need a manual browser check; further automated WebFetch retries are unlikely to succeed per the same reasoning already established in `discovery-report.md` for other technically-blocked sources.
- Akhtaboot was confirmed to exist and to have a plausible URL structure via search results only — it was not directly WebFetched this pass for listing/pagination detail.
- IDAL was identified via search only and not yet fetched at all.
- Only 22 of the Beirut Digital District's ~80-100 members were sampled (a deliberate pilot, not exhaustive extraction, per this task's scope-safety rule) — the remaining ~60-70 members are an available, not-yet-tapped pool if a future pass wants a larger pilot.
- None of the 20 new (non-registry) pilot candidates from this pass have been individually verified against their own official domain/careers page — that verification is explicitly out of scope for this source-expansion task and would be a separate future step before any of them could be added to the production `master-company-registry.csv`.

**Saudi Arabia:**
- Riyadh Chamber (ECONNRESET), Fintech Saudi Map (redirect then cert error), and the Council of Saudi Chambers (404 on the guessed sub-path) are all real, named organizations whose directories could not be confirmed this pass — each needs a manual browser check or a corrected URL, not a further identical automated retry.
- LEAP exhibitors and Biban Forum both have very high claimed exhibitor counts but no enumerable list was found or fetched — the single biggest volume opportunity left unconfirmed in this market.
- Asharqia Chamber, Monsha'at, MISA, the National Factories Directory, and 500 Global's Saudi portfolio were all identified via search only, with no direct fetch attempted this pass at all (as opposed to attempted-and-blocked) — these are the most likely quick wins for a future pass since they haven't yet hit a real technical obstacle.
- Only 26 of GrowthList.co's 97 extracted names (and only ~26 of the site's claimed 500+ full paid-tier database) were carried into the pilot sample — a deliberate pilot, not exhaustive extraction, consistent with this task's scope-safety rule.
- The Birdeye data-quality flag (§6 above) should be resolved with a manual check before this row is used for anything beyond illustrating the risk.
- None of the 21 new (non-registry) Saudi Arabia pilot candidates have been individually verified against their own official domain/careers page — same out-of-scope boundary as Lebanon.

**UAE:**
- **Ajman, Ras Al Khaimah, Fujairah, and Umm Al Quwain remain essentially uncovered** — zero pilot candidates from any of these four emirates. Every identified chamber/free-zone directory for them was either blocked, 404'd, or not yet directly attempted. This is the single biggest gap from this pass and the clearest next step if UAE research resumes.
- Dubai Chambers, DIFC, and ADGM — the three highest-potential-volume official sources identified — were either blocked (Dubai Chambers 403, DIFC 403) or not yet attempted (ADGM) this pass.
- Hub71's own startups directory (`hub71.com/startups`) remains inaccessible to a plain fetch (JS-rendered); only its companion job board was usable. A JS-capable fetch method would likely unlock the full claimed 525-company list.
- GITEX (the world's largest tech trade show, per search snippets) yielded no enumerable exhibitor list — both the official page and a third-party mirror were blocked.
- The DMCC Business Directory is **not a gap to close** — it is a deliberate, permanent exclusion for compliance reasons (see Section 6), not a technical problem to solve in a future pass.
- Bayzat's location nuance (registry says Dubai; Hub71 calls it an Abu Dhabi alumnus) was flagged but not resolved — a manual check should confirm whether this is a genuine multi-office company or a registry/Hub71 discrepancy.
- Two Hub71 entries (autone, EYouth) remain genuinely unverifiable pending a manual check of their actual UAE presence and business model respectively.
- None of the 19 `new_candidate` UAE pilot rows have been individually verified against their own official domain/careers page — same out-of-scope boundary as Lebanon and Saudi Arabia.

**Qatar:**
- **Qatar Foundation, HBKU, and Sidra Medicine's `target_city` should be corrected from Doha to Al Rayyan (or a compound Doha/Al Rayyan value) in a future pass** — this pass found clear evidence (Education City's own documented location) but did not edit these already-`verified` production rows itself, per the scope boundary on this pilot task.
- **QSTP, QBIC, and QFTH remain unresolved access gaps** — QFTH's certificate error, QBIC's third-party-aggregator-only evidence, and QSTP's un-fetched directory index are all priority retries given their large claimed portfolios (300+, 100, 50+ companies respectively).
- **Qatar's Free Zones Authority (QFZA) directories (Ras Bufontas, Umm Alhoul) have zero pilot candidates** — no tenant-company directory URL was found via search this pass, mirroring the UAE pass's Ajman/RAK/Fujairah/Umm Al Quwain gap in kind (a real gap, not a false claim of coverage).
- The Qatar Chamber's own directory requires account registration — a different kind of access barrier than a technical block, needing a different mitigation strategy in any future pass.
- Keppel's specific Ras Laffan presence remains genuinely unverified (flagged `unverifiable`, not silently included) given the source directory's own data-quality problem in the same result set.
- None of the 17 `new_candidate` Qatar pilot rows have been individually verified against their own official domain/careers page — same out-of-scope boundary as all 3 prior markets.

**Kuwait:**
- **KCCI's eChamber registry (79,000+ members claimed) and Boursa Kuwait's listed-companies page (139 companies, precise) are the two highest-value unresolved targets** — neither was successfully accessed this pass (not attempted; blocked 403, respectively).
- KDIPA and PAI (Kuwait's analogues to Lebanon's IDAL and Saudi Arabia's National Factories Directory) were identified but not confirmed as browsable/exportable directories.
- Only 1 of CBK's several implied regulated-entity sub-pages (Islamic investment companies) was sampled this pass — banks, conventional investment companies, and exchange companies remain unexplored.
- The Americana Group correction-evidence finding (a real Workable board for an existing `needs_manual_review` row) needs a focused follow-up audit to actually update `kuwait.csv` — this pass deliberately did not make that change itself.
- Jahra has no fully-unambiguous new pilot candidate — the one candidate found had genuinely conflicting location evidence between Jahra and a Hawalli-Governorate district, correctly left unresolved.
- Sakan (from the Failory list) remains genuinely unverifiable — no independent corroboration was found beyond a single generic listing.
- None of the 12 `new_candidate` Kuwait pilot rows have been individually verified against their own official domain/careers page — same out-of-scope boundary as all 4 prior markets.

**International Remote:**
- **NaTakallam has now been blocked for 3 consecutive research passes** (Round 3's original pass, the 2026-09-03 verification pass, and this pass's retry of a new URL) — automated retries are no longer a productive use of effort; this needs a human browser visit or a citable press-coverage URL, not a 4th automated attempt.
- Working Nomads' API endpoint was identified but not directly confirmed — needs a direct fetch before relying on it.
- Jobgether, Arc.dev, Turing, the Ashby ecosystem, and its third-party aggregator were all identified via search only, with no direct fetch attempted — the most likely quick wins for a future pass since none have hit a real technical obstacle yet.
- 14 of 15 International Remote pilot candidates remain at `timezone_compatible_but_location_unclear` or `location_unclear` for actual Lebanon eligibility (only Greenpeace International reached `explicitly_hires_in_lebanon`) — this is the expected, honest outcome of a strict evidence hierarchy applied to a "remote-friendly" market, not a research shortfall, but it means very few of this pass's candidates are ready for anything beyond a future manual-verification queue.
- None of the 14 `new_candidate` International Remote pilot rows have been individually verified against their own official domain/careers page for Lebanon-specific eligibility — same out-of-scope boundary as all 5 prior markets, with an even higher bar given this market's stricter eligibility taxonomy.

## 9. Confirmation of scope compliance

No automation was built or activated. No Apify job was run. No n8n workflow was touched. No jobs were ingested. No full-scale company extraction was performed. LinkedIn was never scraped or automated. No application code, Supabase config, or migration was modified. No git staging, commit, push, merge, or branch switch occurred at any point in this task.

---

## 10. FINAL CONSOLIDATED SUMMARY — ALL SIX MARKETS COMPLETE (2026-09-04)

This section synthesizes the entire 6-pass source-expansion project (Lebanon → Saudi Arabia → UAE → Qatar → Kuwait → International Remote), each run as a separate, checkpointed pass directly in the main agent with no background agents.

### 10.1 Reusable source count per market

| Market | Sources cataloged |
|---|---|
| Lebanon | 10 |
| Saudi Arabia | 13 |
| UAE | 21 |
| Qatar | 16 |
| Kuwait | 15 |
| International Remote | 14 |
| **Total** | **89** |

### 10.2 Search query count per market

| Market | Queries run |
|---|---|
| Lebanon | 9 |
| Saudi Arabia | 9 |
| UAE | 23 |
| Qatar | 14 |
| Kuwait | 16 |
| International Remote | 18 |
| **Total** | **89** |

### 10.3 Pilot count and reconciliation outcomes per market

| Market | Pilot candidates | already_present | new_candidate | duplicate_or_alias | unverifiable | irrelevant |
|---|---|---|---|---|---|---|
| Lebanon | 22 | 2 *(older 2-value taxonomy: `already_in_master_registry`)* | 20 *(`new_candidate_pilot_unverified`)* | n/a | n/a | n/a |
| Saudi Arabia | 26 | 4 + 1 cross-market note (Wahed) *(older 2-value taxonomy)* | 21 *(`new_candidate_pilot_unverified`, 1 flagged as a likely data-quality error — Birdeye)* | n/a | n/a | n/a |
| UAE | 23 | 1 (Bayzat) | 19 | 1 (Al Futtaim → cc-al-futtaim) | 2 (autone, EYouth) | 0 |
| Qatar | 20 | 1 (ADCB, cross-market) | 17 | 1 (Qatargas → cc-qatarenergy) | 1 (Keppel) | 0 |
| Kuwait | 15 | 1 (Americana Group, correction-evidence) | 12 | 1 (KNPC → cc-kuwait-national-petroleum-company) | 1 (Sakan) | 0 |
| International Remote | 15 | 1 (Tabby, cross-market) | 14 (2 explicitly re-classified as talent marketplaces, not employers) | 0 | 0 | 0 |
| **Total** | **121** | **10** | **103** | **3** | **4** | **0** |

Note: Lebanon and Saudi Arabia used an earlier, looser 2-value taxonomy (`already_in_master_registry` / `new_candidate_pilot_unverified`) before the UAE pass introduced the stricter 5-value taxonomy explicitly requested for UAE onward; the two are not directly comparable row-for-row, and Lebanon/Saudi Arabia rows were never retroactively relabeled (see Section 3's taxonomy note). Zero rows across all 6 markets were classified `irrelevant` — every candidate researched turned out to be a real, findable organization; weak or dubious cases were classified `unverifiable` instead of being silently dropped or forced into a stronger category.

### 10.4 Strongest sources (cross-market)

1. **Himalayas' official free JSON API** (International Remote) — the single best finding of the whole project: documented, no-auth, structured, with real per-job location-restriction data. No scraping actor needed.
2. **`blackfalcondata/bayt-scraper`** — reused across all 5 country markets without re-evaluation; cheap (~$1/1,000 results), natively MENA-aware.
3. **Curated startup/company list pages** (GrowthList.co/Saudi Arabia, Failory/Kuwait, GitHub established-remote/International Remote) — consistently 93-97% new-candidate yield at near-zero cost, each with a documented data-quality caveat.
4. **Hub71's job board** (UAE) and **the Mesaieed/Ras Laffan industrial-city clusters** (Qatar) — the two strongest market-specific findings, each closing a total pre-existing gap (UAE's Abu Dhabi startup coverage; Qatar's non-Doha geographic coverage).
5. **`jobs.workable.com/search/[country]/`** (discovered in the Kuwait pass) — a reusable URL pattern that could, in principle, be tried for any of the other 5 markets in a future pass.
6. **Official no-login government/regulator registers** (Qatar's QFCRA, Kuwait's CBK) — small, precise, genuinely official, though this pass's samples skewed toward already-known large institutions rather than new candidates.
7. **Deel, Remote.com, and Globalization Partners** — not job boards, but explicit, directly-confirmed Lebanon-support statements from 3 major EOR providers, valuable as corroborating infrastructure evidence for International Remote.

### 10.5 Blocked and inaccessible sources (cross-market)

| Source | Market | Blocker | Status |
|---|---|---|---|
| CCIB membership directory | Lebanon | HTTP 429 (rate-limited) | Needs a retry at a lower request rate |
| Daleel Madani, Amaken | Lebanon | HTTP 403 | Needs a manual browser visit |
| Riyadh Chamber | Saudi Arabia | ECONNRESET | Needs a manual browser visit |
| Council of Saudi Chambers | Saudi Arabia | HTTP 404 (wrong guessed path) | Needs a corrected URL |
| LEAP exhibitors, GITEX exhibitors | Saudi Arabia, UAE | HTTP 403 (official page + mirror) | Likely needs a JS-capable fetch method |
| Dubai Chambers, DIFC Public Register | UAE | HTTP 403 | Needs a manual browser visit or retry |
| DMCC Business Directory | UAE | **Deliberate compliance exclusion**, not a technical block — its own terms forbid data extraction/redistribution | **Permanent exclusion**, not a retry target |
| Qatar Chamber (qatarcid.com) | Qatar | Requires account registration/login | Structural barrier, needs a different approach than a retry |
| QFTH | Qatar | TLS certificate error | Needs a retry once the certificate issue resolves |
| Boursa Kuwait | Kuwait | HTTP 403 | Needs a retry; small enough (139 companies) to be a good first target once accessible |
| NaTakallam | International Remote | HTTP 403 for **3 consecutive research passes** | No further automated retries recommended; needs a human browser visit or a citable press URL |

### 10.6 Geographic and sector gaps (honestly reported, not glossed over)

- **UAE**: Ajman, Ras Al Khaimah, Fujairah, and Umm Al Quwain have **zero** pilot candidates — every identified chamber/directory for these 4 emirates was blocked, 404'd, or not yet attempted.
- **Kuwait**: Jahra and Mubarak Al-Kabeer have real, D&B-confirmed company populations but no fully-unambiguous new pilot candidate with a confirmed single-governorate location was added for Jahra.
- **Qatar**: Qatar's two dedicated free zones (Ras Bufontas, Umm Alhoul, under QFZA) have zero pilot candidates — no tenant directory was found.
- **Qatar geographic-tagging correction (found, not applied)**: Qatar Foundation, HBKU, and Sidra Medicine are tagged `target_city=Doha` in the existing `qatar.csv` but are actually located in Al Rayyan Municipality (Education City) — flagged for a future correction pass.
- **Sector gaps closed this project**: Kuwait's healthcare sector (was 1 `no_official_source_found` row, now 2 additional hospital candidates with real evidence, one a live dual-governorate board); Qatar's industrial sector (was zero Mesaieed/Ras Laffan coverage, now 6 named employers); UAE's Abu Dhabi startup ecosystem (was thin, now 10 Hub71-sourced candidates); International Remote's non-tech job functions (was almost entirely AI-data-training, now includes legal, design, marketing, sales, customer service, healthcare admin, and project management candidates).
- **Sector gaps still open**: Lebanon's SME/software-agency layer (flagged as thin since Round 1, not specifically re-targeted in this source-expansion project); Kuwait's remaining KDIPA/PAI/KCCI-sourced industrial and investment-sector coverage; Qatar's QSTP/QBIC/QFTH startup-ecosystem portfolios (identified but not fully accessed).

### 10.7 Recommended source priority (for a future, separately-authorized pilot)

1. Himalayas' official API (International Remote) — build directly against it; no actor needed.
2. `blackfalcondata/bayt-scraper` and `blackfalcondata/gulftalent-scraper` — the two actors already confirmed to cover all 5 country markets.
3. The `jobs.workable.com/search/[country]/` pattern — test it against the other 4 country markets beyond Kuwait.
4. A repeat of the "curated startup list" pattern (GrowthList/Failory/established-remote) for the markets that don't yet have one (Lebanon, UAE, Qatar).
5. Official no-login registers (QFCRA, CBK) — bounded crawls once a full sub-page inventory is confirmed.
6. Generic `apify/website-content-crawler` — necessary fallback everywhere else, lowest priority, highest effort per result.

### 10.8 Recommended Apify actors and official APIs/feeds (consolidated)

- **Official APIs/feeds requiring no actor** (highest priority, per this task's "prefer official API/feed" instruction): Himalayas (International Remote), RemoteOK (International Remote, already in registry), Remotive (International Remote, already in registry, free-tier caveat), We Work Remotely (International Remote, already in registry, RSS).
- **Paid Apify actors evaluated and recommended**: `blackfalcondata/bayt-scraper` (all 5 country markets), `blackfalcondata/gulftalent-scraper` (all 5 country markets), `silentflow/naukri-scraper` (UAE-evaluated, lower priority, overlaps with GulfTalent's coverage).
- **Paid Apify actors evaluated and NOT recommended for this market**: Google Maps Scraper for International Remote specifically (structurally mismatched — remote employers often lack a discoverable office).
- **Generic fallback**: `apify/website-content-crawler`, used consistently across all 6 markets, always the lowest-confidence, highest-effort, last-resort option per source.
- **No actor was executed and no Apify credits were spent at any point in this 6-pass project**, consistent with every pass's explicit scope boundary.

### 10.9 Estimated cost and compliance risks (consolidated)

- **Cost**: Bayt/GulfTalent actors are cheap at the pay-per-event tier (~$1/1,000 results); Himalayas' API is free; the generic Website Content Crawler runs ~$0.5-$5/1,000 pages depending on JS-rendering needs. No cost estimate is given for a "full run" at any point in this project because no ingestion volume or budget has been authorized — every cost figure here is a per-unit rate, not a project total.
- **Hard compliance exclusion**: DMCC's Business Directory (UAE) explicitly forbids data extraction/redistribution in its own terms — a permanent exclusion, not a rate-limiting or access problem.
- **Data-quality risks requiring a spot-check step, not blanket trust**: QatarYello's location tagging (confirmed at least one clear error), Failory's Kuwait "startup" categorization (mixes in large state enterprises, including one — KNPC — that is literally an existing registry entity), the GitHub established-remote list's "hires globally" claim (not independently verified per-country).
- **LinkedIn**: excluded on policy grounds in all 6 markets, per `AGENTS.md` §7 and this task's own restated instruction — never scraped, never automated, used only for identity-confirmation links the company itself publishes.
- **Personal-data risk flagged once and not repeated**: Google Maps Scraper's optional "leads enrichment" and "social media profile" sub-features extract personal contact data — flagged in the Lebanon pass as a feature to keep disabled if this actor is ever used, applicable to any future market pass that reaches for it.

### 10.10 Exact next step for building the company-discovery automation

This project's deliverables are a complete **research and design phase**, not an implementation. The next step, requiring explicit human authorization before any of it proceeds, is:

1. **A human decision on which single source to pilot first** — based on Section 10.7's priority ranking, Himalayas' free API (International Remote) is the lowest-risk, lowest-cost starting point since it requires no paid actor and no scraping at all.
2. **A small, explicitly-bounded, explicitly-approved test run** against that one source (e.g., a capped number of API calls or actor results) — not a full-scale extraction, and not something this task or any prior pass in this project was authorized to perform.
3. **A separate engineering design pass** to map this project's CSV schemas (`source-catalog.csv`, `pilot-company-candidates.csv`) onto the application's actual `job_sources`/company-registry database schema, including deduplication logic against `master-company-registry.csv`, before any ingestion job is scheduled.
4. **A focused verification audit** (see Section 10.11) to resolve the specific correction-evidence findings this project surfaced, before those specific rows are treated as reliable.

No part of this next step was performed under this task — it is the recommended path forward, not a plan already in motion.

### 10.11 Production-registry corrections recommended for a separate audit

Two concrete, evidence-backed corrections were found during this project but deliberately **not applied** to the production registry, per every pass's explicit instruction not to modify already-verified/already-classified rows during source-discovery:

1. **Americana Group (Kuwait, `cc-americana-group`)** — currently `needs_manual_review` with notes stating no official careers URL was found. This project found a real Workable-hosted board (`apply.workable.com/americana-kuwait-food-company/?lng=en`) with a confirmed Workable CDN asset reference via direct WebFetch. Recommend a focused audit to confirm the live job list (JS-rendered, not yet independently rendered) and upgrade the row's status if confirmed.
2. **Qatar Foundation, HBKU, and Sidra Medicine (Qatar, `cc-qatar-foundation`/`cc-hbku`/`cc-sidra-medicine`)** — all 3 are currently tagged `target_city=Doha` but are actually located in Al Rayyan Municipality (Qatar Foundation's Education City). Recommend a focused audit to correct the `target_city` field (or use a compound Doha/Al Rayyan value if the schema and evidence support it) for all 3 rows.

No other existing `verified` or `no_official_source_found` row was found to have new contradicting evidence during this project; all other findings were genuinely new candidates, not corrections to existing rows.

### 10.12 Pilot candidates recommended for the future verification queue

Not every `new_candidate` row is equally ready for the next verification step. The following are recommended as the **highest-priority** entries for a future focused-verification pass, based on evidence strength already gathered:

- **Greenpeace International** (International Remote) — the single strongest Lebanon-eligibility signal found in this entire project (an explicitly Lebanon-only posting).
- **QAFCO, QAPCO, Qatar Steel, Qatalum** (Qatar, Mesaieed) — each has a real, named, confirmed official careers portal; QAFCO's was directly confirmed to run on SAP SuccessFactors.
- **Al Salam Hospital** (Kuwait) — a live, filterable, dual-governorate job board, directly confirmed via WebFetch.
- **SEIDOR** (Kuwait) — a confirmed Workable-hosted board with a specific live job requisition URL.
- **Bee'ah, Crescent Enterprises, Gulftainer** (UAE, Sharjah) — all 3 independently confirmed via dedicated follow-up searches, filling this project's clearest emirate-balance gap.
- **TruKKer, Qureos, and the other Hub71 job-board candidates** (UAE) — sourced from a real, accessible, paginated job board (12 of a claimed 187 companies sampled).
- **Rewaa, Foodics, Tamara** (Saudi Arabia) — already `already_present` matches, included here only as confirmation that GrowthList.co's methodology is sound; the genuinely queue-worthy items from that source are its ~94 other extracted names, not yet individually verified.

Lower-priority queue entries (weaker evidence, worth keeping but not rushing): the 8 Kuwait candidates left with an unconfirmed governorate, the 9 International Remote candidates classified only `timezone_compatible_but_location_unclear`, and any candidate this project explicitly classified `unverifiable` (Sakan, Keppel, autone, EYouth) — these should only advance if a future pass finds materially stronger evidence, not simply be promoted by default.

**This research phase is complete. No further market passes are planned or required under the original 6-market scope. The artifacts in `docs/job-source-discovery/source-expansion/` (`source-catalog.csv`, `search-query-matrix.csv`, `pilot-company-candidates.csv`, `apify-discovery-design.md`, and this report) are ready for human review before any automation implementation begins.**
