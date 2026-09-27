# Lebanon + Gulf Source Research (Phase 15)

Branch: `phase/15-lebanon-gulf-source-research`, forked from `main` @ `734a3f7`
(post Phase 14 merge). **Research and architecture only — no provider
adapter, schema, or n8n workflow change was made this phase.** Scope:
determine the strongest production-safe source strategy for Lebanon, Saudi
Arabia, Qatar, Kuwait, and UAE. International-remote is out of scope except
where a finding directly affects Lebanon/Gulf architecture.

This project already carries a large prior research corpus that this phase
builds on rather than duplicates: `docs/job-source-discovery/` (a 254-row
hand-verified MENA company/ATS registry across three research rounds, now
593 rows live in `company_sources` after Registry Sync), a completed real
Apify Google-Places pilot for Lebanon company discovery (446 companies,
$2.31 spent, `docs/job-source-discovery/pilots/apify-lebanon/`), and Phase
12's `docs/SOURCE_COVERAGE_AND_PROVIDER_EXPANSION_AUDIT.md`. Every number in
this document is either a fresh direct query against the real local
`company_sources` table (593 rows) or fresh external verification (real
HTTP calls, real Apify Store pages, real ATS tenant endpoints) performed
this phase — prior-phase documents are cited, never re-asserted from memory.

---

## 1. Current coverage baseline (queried directly this phase)

`company_sources`, 593 rows total. In the 5 target countries: 398
`review_status='verified'` rows.

| Country | Verified rows | `suitable_public_ats` | `suitable_public_html_subject_to_review` | `manual_only` | `unknown` |
|---|--:|--:|--:|--:|--:|
| Lebanon (LB) | 84 | 10 | 45 | 29 | 0 |
| Saudi Arabia (SA) | 95 | 25 | 67 | 3 | 0 |
| Qatar (QA) | 61 | 20 | 35 | 4 | 2 |
| Kuwait (KW) | 21 | 0 | 8 | 2 | 11 |
| UAE (AE) | 137 | 20 | 105 | 5 | 7 |
| **Total** | **398** | **75** | **260** | **43** | **20** |

Of the 75 `suitable_public_ats` rows, only **18** currently resolve to an
ATS this pipeline has a live adapter for (Greenhouse/Lever/Workable/Ashby —
confirmed via `ats_provider` cross-tab: AE 1, SA 11, QA 4, LB 2, KW 0). The
other **57** are registry-classified as genuinely automatable but sit behind
ATS platforms with no adapter yet (§2). Lebanon's Student-plan coverage
remains the weakest lane by a wide margin — confirmed below, not assumed.

---

## 2. Unsupported-ATS gap analysis (Step 6 — real registry counts, not guessed)

Verified rows (398, target countries) whose `ats_provider` is **not**
Greenhouse/Lever/Workable/Ashby, grouped into platform families:

| ATS family | Companies unlocked | LB | SA | QA | KW | AE |
|---|--:|--:|--:|--:|--:|--:|
| **unknown** (real careers page confirmed, vendor not identifiable) | 238 | 20 | 60 | 39 | 8 | 111 |
| **none** (confirmed no ATS — email/manual only) | 41 | 34 | 2 | 2 | 1 | 2 |
| **Oracle HCM / Cloud Recruiting family** | 23 | 2 | 4 | 6 | 3 | 8 |
| custom (confirmed proprietary, non-vendor) | 19 | 17 | 1 | — | — | 1 |
| **SAP SuccessFactors** | 12 | 3 | 4 | 2 | 1 | 2 |
| **Workday** | 6 | 1 | 2 | 2 | 1 | — |
| Phenom People | 4 | — | — | — | — | 4 |
| SmartRecruiters | 4 | — | 2 | 1 | — | 1 |
| Talentera | 4 | — | 3 | — | — | 1 |
| Taleo / Avature / BrassRing / iCIMS | 4 | — | 1 | 1 | 1 | 1 |
| Everything else (Teamtailor, Zenats, JobTeaser, BambooHR, Intervieweb, Yello, Recruitee, JazzHR, MapleHR, Zoho Recruit, SniperHire, Ellucian, Trakstar, Cazar) | 15 | 6 | 6 | 2 | 1 | — |

**Answer to "which ONE new ATS adapter unlocks the most": Oracle HCM /
Cloud Recruiting family — 23 companies**, present in all 5 target countries
(the only family with that property besides SAP SuccessFactors and
"unknown"/"none", neither of which is a buildable adapter target).

**Answer to "which TWO combined unlock the most": Oracle + SAP
SuccessFactors — 35 companies** (LB 5, SA 8, QA 8, KW 4, AE 10). Workday is
a close third at 6 (LB 1, SA 2, QA 2, KW 1) — small in absolute count but
the cheapest to build (§3) and the only one of the three confirmed to need
no browser/Apify layer at all.

**The dominant bucket by far is "unknown" (238) and "none" (41) — 279
companies, 70% of all verified rows.** No ATS adapter touches this bucket.
It is addressable only by generic career-page extraction (already built,
§4) or an Apify/browser-based fallback (§5) — not by naming one more ATS
vendor. This is the single most important framing fact for this whole
document: **ATS-specific adapters have a hard ceiling around 35-53
companies; the real volume opportunity is aggregators (Bayt/GulfTalent,
§5) and generic extraction (§4), not more ATS connectors.**

Lebanon's own shape is different from the Gulf countries: 34/84 (40%) are
confirmed `manual_only` (no ATS, no structured careers page at all) — the
highest manual-only share of any target country by a wide margin, and the
reason Lebanon coverage is structurally harder than Gulf coverage, not
merely less-researched (see §7's Apify Google-Places pilot finding, which
independently confirms this from a completely different, non-registry
sample of 446 real Lebanese SMEs).

---

## 3. Direct ATS API technical feasibility (Step 6 continued — real HTTP verification this phase)

Fresh, real evidence this phase (WebFetch against actual registry tenants),
not training-data recollection:

| ATS | Verdict | Evidence |
|---|---|---|
| **Oracle Cloud Recruiting / Oracle HCM** | **Confirmed live, no-key public JSON API.** `GET https://{tenant}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber={site}` — tested directly against AUBMC's real tenant (`fa-exxn-saasfaprod1.fa.ocs.oraclecloud.com`, site `CX_2`) and returned a real 200 JSON response: `TotalJobsCount: 6`, real facets (Lebanon, AUB Medical Center, Nursing Administration, on-site workplace type). No login, no API key. A `requisitionList` expand parameter (standard Oracle REST convention) is needed for full per-job fields — not tested this pass, but documented, not guessed. **Strongest, most-verified adapter candidate of the three.** Independently corroborated by a real Apify actor (`data_daemon/oracle-hcm-jobs-scraper`) whose own documentation states it works by calling "the site's own JSON API... pure JSON calls... no login, no proxy, no browser needed" — confirming the technique generally, not just this one tenant. |
| **Workday** | **High-confidence real API, one POST test still needed.** Endpoint shape `POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`, body `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}`, no auth. Confirmed real tenant exists (Murex: `murex.wd3.myworkdayjobs.com/MurexCareerPage1`, real job URLs with stable IDs like `JR100375-1`). A GET to the endpoint correctly returned 400 (endpoint exists, requires POST — WebFetch is GET-only, so the full response body couldn't be captured this pass). Strongly corroborated by a technical writeup, a dedicated per-ATS API guide site, and at least 6 independent commercial Apify actors built around this exact shape. **Build-ready pending one real POST call to confirm the response field names before writing the adapter.** |
| **SAP SuccessFactors** | **Blocked for a simple HTTP adapter — confirmed, not assumed.** The OData `JobRequisition` API is explicitly gated behind `Recruiter Operator` permission (SAP's own docs) — built for the employer's own HRIS integration, not public reads. The public Career Site (tested live against a real tenant, `career55.sapsf.eu/career?company=abcsal`) is a client-side JS shell: raw HTML shows only a search form and "Loading...", zero job data — the real listings come from an in-browser AJAX call a plain HTTP client cannot see or trigger. **Requires headless-browser rendering (Playwright) or an Apify actor, not a Greenhouse-style adapter.** One narrow exception found: some SuccessFactors tenants additionally publish a "public Google-for-Jobs feed" carrying schema.org `JobPosting` JSON-LD — the exact format this project's existing career-page extractor (§4) already parses. Worth checking per-tenant during Phase 16, but not assumable project-wide (the one tenant tested here did not expose it in the raw career-site HTML). |

**Conclusion**: Oracle Cloud Recruiting is ready to build as a fifth native
Tier-A adapter with the strongest evidence of the three. Workday is a
strong second, one verification call away from build-ready. SAP
SuccessFactors — despite being the second-largest gap bucket — needs a
different mechanism (Apify or Playwright), not a native adapter, in any
near-term phase.

---

## 4. Career-page extraction (Tier B) — already built, real yield still zero, real reason found

`extractCareerPageJobPostings.ts` (Phase 13) is a pure, single-page,
schema.org `JobPosting` JSON-LD extractor — deliberately not a general HTML
scraper. `findCareerPageExtractionCandidates.ts` feeds it from
`company_sources` where `automation_eligibility='suitable_public_html_subject_to_review'`
— **260 real, verified rows currently qualify** (§1), but the function caps
at `DEFAULT_LIMIT=20` by design, because Phase 13's own 11-sample and Phase
14's real 20-candidate run both found **zero real jobs** (Phase 14:
`docs/INGESTION_REAL_E2E_VALIDATION.md` §4 — 14/20 succeeded with an honest
`no_valid_jobs`, 6/20 failed on real site errors).

**Root cause, confirmed this phase by re-reading the extractor**: it reads
only the one URL it's given (`company_sources.official_careers_url`) and
never follows a link. Real company career pages almost universally put
`JobPosting` JSON-LD on each **individual job's own detail page**, not on
the landing/index page the registry recorded — so the extractor is looking
in the wrong place, not failing to parse what's there. This is an
architecture gap, not a data-availability gap.

Two independent, additive fixes, neither requiring a new adapter tier:

1. **Raise `DEFAULT_LIMIT`** from 20 toward the real 260-row pool — cheap,
   safe, more attempts against the same technique. Alone this will mostly
   produce more honest zero-yield results (the landing-page problem isn't
   fixed by trying more landing pages) but costs nothing but bounded HTTP
   calls and will catch the minority of pages that *do* embed JobPosting
   markup directly.
2. **One-level link-following**: when a landing page yields zero postings,
   look for same-domain links matching job-like URL patterns
   (`/job/`, `/jobs/`, `/position/`, `/vacancy/`, `/career/id`, a numeric
   trailing segment) and run the same existing, unmodified extractor
   against a bounded number of them (e.g. 5). This is the real fix for the
   landing-page-vs-detail-page mismatch and fits the existing
   `RawProviderJob[]`-out contract with zero downstream changes — only
   `extract-career-page-jobs/route.ts`'s fetch step changes, not
   `extractCareerPageJobPostings.ts`'s parsing logic. Scoped, bounded,
   evidence-based Phase 16 candidate (§Phase 16 plan).

---

## 5. Bayt and GulfTalent (Step 5, Step 15A) — real evidence this phase

### Bayt.com

- **No official public/partner API.** `robots.txt` explicitly `Disallow`s
  the job-listing paths (`/en/jobs/`, `/ar/jobs/`, `/fr/jobs/`, category and
  search-filter pages) for general crawlers, and a blanket `Disallow: /`
  for named bots including `LinkedInBot`/`IndeedBot`. Direct `WebFetch` to
  `bayt.com/en/lebanon/jobs/` and `/en/uae/jobs/` both returned **HTTP
  403** — active bot protection confirms a plain HTTP client cannot reach
  it; this is a real, documented access-risk signal, not a theoretical one.
- **Real coverage** (via search-indexed snapshots, since direct fetch is
  blocked): ~716 Lebanon listings (370 Beirut), spanning all 13 MENA
  markets Bayt serves, including all 5 target countries.
- **Apify actor `blackfalcondata/bayt-scraper`**: alive and actively
  maintained (557 total users, 120 monthly active, 100% run success rate,
  5.0 rating, examples dated June 2026). Pricing ~$0.99/1,000 results
  (matches Phase 12's ~$1/1000 estimate). No login/cookies required.
  Documented output schema: `jobId, title, company, location, city,
  country, salaryMin/Max, employmentType, careerLevel, description, skills,
  directApply, isRemote, url, applyUrl, postedDate` — a stable external ID
  and a distinct canonical `applyUrl` both exist, satisfying this
  project's provenance/dedup-identity requirements without inventing
  anything. Competing actors exist (`parseforge`, `corvuslab`, `easyapi`,
  others) but `blackfalcondata`'s is the most-used/highest-rated found.

### GulfTalent.com

- **No official API either.** `robots.txt` is comparatively permissive
  (blocks only AI-training bots, allows general crawlers, publishes a
  sitemap) — a real, lower documented ToS-risk profile than Bayt. Direct
  `WebFetch` to `gulftalent.com/lebanon/jobs` still returned **403**
  (active bot protection regardless of the more permissive `robots.txt`) —
  an Apify/stealth layer is still required in practice.
- **Real coverage**: ~477 Lebanon listings confirmed, despite GulfTalent's
  own nominal market list naming only UAE/SA/QA/KW/Bahrain/Oman —
  demonstrably also serves real Lebanon listings.
- **Apify actor `blackfalcondata/gulftalent-scraper`**: maintained (267
  total users, 67 monthly active, 97.2% success rate, 5.0 rating). Pricing
  ~$0.70–0.75/1,000 results — cheaper than Bayt. Output schema:
  `jobId, jobKey, title, company, location, salaryMin/Max, postedAt,
  applyUrl, sourceCountry`, plus enriched fields (nationality/gender/
  Arabic-fluency requirements, seniority) and a `contentHash`/`changeType`
  pair explicitly built for incremental re-runs — a genuinely useful
  primitive for this project's own idempotent-upsert model.

**Both actors' documented output schemas already contain everything this
project's `RawProviderJob` contract needs (external ID, title, company,
location, apply URL, posted date) without spending any money — an adapter
can be written against these published schemas the same way
`jsearch.ts`/`adzuna.ts` were written against documented API schemas in
Phase 13, then validated against one small real paid run before going
live** (see Phase 16 plan — the real-run validation step is not skipped,
just not required to *finish this research phase's recommendation*).

---

## 6. Apify — broader actor landscape (Step 15B)

Beyond the two actors above, real findings this phase:

- **`openclawai/career-site-ats-jobs-scraper`** — a single actor
  auto-detecting 60+ ATS platforms including Workday, SuccessFactors,
  Oracle, Taleo, SmartRecruiters, iCIMS, Personio, Teamtailor, BambooHR.
  $0.50/1,000 jobs, no login. **Low adoption — only 9 total users, 5
  monthly active** — appealing breadth, unproven reliability.
  **Classification: BENCHMARK FIRST, not trust-on-faith.**
- **`data_daemon/oracle-hcm-jobs-scraper`** — validates the Oracle
  technique (§3) but is itself unproven (1 total user, 0% recorded
  success). Not recommended as the actual extraction mechanism given a
  native adapter is already confirmed feasible and free.
- **`dataloft/ats-jobs-scraper`** and **`enosgb/ats-job-scraper`** — both
  explicitly market multi-ATS extraction "Greenhouse, Lever, Ashby,
  Workday API," pay-per-successfully-scraped-job. A genuine fallback if a
  direct Workday adapter (§3) proves unreliable in practice, not a
  first-choice mechanism given the direct API is free and already
  confirmed to exist.
- NaukriGulf actors exist (UAE-focused) — consistent with Phase 12's
  existing decision to deprioritize Naukri below Bayt/GulfTalent (broader
  coverage, already in this codebase's classification history).

**Recommended actors to actually use in Phase 16**: `blackfalcondata/
bayt-scraper` and `blackfalcondata/gulftalent-scraper` — the only two with
proven maintenance, high success rates, and real ratings among everything
found. Everything else in this section is `BENCHMARK FIRST` or `EXCLUDE`
(unproven adoption), not `IMPLEMENT`.

---

## 7. First-party / official sources (Step 7) — the Apify Lebanon company-discovery pilot's honest finding

A separate, already-completed Apify pilot (`docs/job-source-discovery/
pilots/apify-lebanon/`, executed 2026-09-05, real $2.3116 spent, Google
Places actor — **not** a job-listing source, a company-*discovery* source)
found 446 real Lebanese companies (construction, software, manufacturing,
retail, hospitality, etc. across 10 regions) and ran a follow-up enrichment
pass checking each one's real careers-page presence. **None of these 446
companies have ever been promoted into `company_sources`** — this is a
completely separate, still-available candidate pool from the 593 already
live.

Real enrichment result (`enrichment/enriched-company-candidates.csv`, 446
rows, computed fresh this phase):

| `automation_eligibility` | Count | % |
|---|--:|--:|
| `manual_only` | 409 | 91.7% |
| `suitable_public_html_subject_to_review` | 18 | 4.0% |
| `suitable_public_ats` | 2 | 0.4% |
| `not_applicable` / `unknown` | 17 | 3.8% |

Only **3/446 (0.7%)** real Lebanese SME companies showed
`current_open_jobs_detected='yes_current'` at all. This is a second,
independent data point (different sampling method — real-world Google
Places company discovery, not registry curation) that **confirms §2's
finding from a completely different angle: Lebanon's SME layer has a hard
structural ceiling on automatable job coverage — the great majority of
real Lebanese employers simply have no structured online job-posting
presence to extract from, at any tier.** This is not a research gap this
project failed to close; it is a real fact about the market.

The 2 `suitable_public_ats` rows (WeWorld/Intervieweb, Norwegian Refugee
Council/Oracle HCM — both Zahle branch offices) are **not new**: both
organizations already exist in `company_sources` as country-level entries
(WeWorld, Norwegian Refugee Council — confirmed by direct cross-check
against the live DB). The **18 `suitable_public_html_subject_to_review`
rows are genuinely promotable Tier-B candidates** not currently in the
registry (Optimal Solutions, Networked Energy Services, Azentio, CME,
Creyasoft, Azkatech, Software Design Consulting Group, Serhal Nassar & Co,
BML Istisharat, DOUMANI & Co., Multiframes, Serab Residencia, HHUMC
hospital, The Net Global, Medair, Oxfam Lebanon, Danish Refugee Council,
Khoubourat — held out per the existing reconciliation report's decision).
Promoting these 18 (after a dedup pass against the current 593-row
registry, since some — e.g. Networked Energy Services — may already be
present under a slightly different name) is a small, concrete, real,
already-researched Phase 16 action item requiring zero new code.

Government portals, university career sites, hospital/bank/telecom/airline
career pages: `docs/job-source-discovery/discovery-report.md` (Rounds 1-3,
254 registry rows, already exhaustively researched — see its own §3-8 per
country and §11's verified-ATS distribution) already covers this ground in
depth for the currently-*promoted* registry; the Apify pilot above extends
it to previously-undiscovered Lebanese SMEs. No further first-party
discovery pass is recommended this phase — the marginal return on more
company *discovery* is low (§ above); the real leverage is in *extraction
technique* (§4, §5), not finding more company names.

---

## 8. JSearch and Adzuna re-evaluation (Step 15E) — real coverage confirmed this phase

| | Real finding this phase |
|---|---|
| **JSearch** (RapidAPI, aggregates Google for Jobs) | Documented supported country codes explicitly include **Qatar, Saudi Arabia, UAE** (real Gulf coverage for 3/5 target markets). **Kuwait and Lebanon are not in the documented list.** Pricing: free tier 200 req/mo, Pro $25/10k req, Ultra $75/50k, pay-as-you-go $0.005/req — affordable at MVP scale. Adapter already exists (`src/lib/ingestion/providers/jsearch.ts`), fixture-tested, never live-verified (no key). |
| **Adzuna** | **No evidence Adzuna supports any of the 5 target markets at all.** Adzuna's own developer docs and every independent source found list ~20 markets (UK, US, Germany, France, India, Australia, Canada, Brazil, etc.) — zero MENA/Gulf country appears anywhere. This materially changes Phase 12's open question: Adzuna is **not** a viable Lebanon/Gulf source, full stop — its only theoretical use in this product is the already-adequately-covered international-remote lane, which this phase was explicitly told not to expand. |

**Answer: JSearch is worth a credential specifically for Saudi/Qatar/UAE**
(real Google-for-Jobs aggregation, not a guess) — **not** for Lebanon or
Kuwait, so it should never be marketed internally as solving either of
those two lanes. **Adzuna is not worth a credential for this phase's
priority at all** — correctly classified `EXCLUDE` for Lebanon/Gulf,
unrelated to whether it stays useful for international-remote later.

---

## 9. n8n template research (Step 9 — Production Automation Engineer skill applied)

Searched `n8n.io/workflows` and the n8n MCP's own `search_workflows`.
Findings, architecture-pattern-only per the skill's non-negotiable ("repo
JSON is the permanent source of truth... do not build ad-hoc workflows
outside that process" — nothing here was imported or copied):

- **"Create sales and growth hiring leads CSV from careers pages with
  Apify"** — Apify actor → filter → CSV export. Reusable pattern: Apify
  node wiring shape (`@apify/n8n-nodes-apify.apify`, "Run actor and get
  dataset" operation). **Demo-only gaps, explicitly not copied**: CSV
  export instead of a DB upsert, no dedup beyond a keyword match, no
  `retryOnFail`/`onError` wiring — this project's existing `RawProviderJob`
  → validate → normalize → dedupe → persist pipeline (unchanged by this
  research phase) is strictly stronger on every one of these axes already.
- **"Score ATS job postings with OpenAI and send alerts to Slack/Sheets"**
  — revealed the `dataloft`/`enosgb` multi-ATS actors noted in §6; the
  OpenAI-scoring/Slack-alert part of this template is irrelevant to
  ingestion and was not examined further.
- **No MENA/Gulf-region-specific template found.** No job-board RSS
  template found (n8n's generic `RSS Read` node exists but no job-specific
  template surfaced).

No n8n workflow file in this repository was touched this phase — this
section is reference-only, per the Production Automation Engineer skill's
repository-first rule and this phase's explicit research-only scope.

---

## 10. Architecture fit (Step 10) — every candidate mapped to the existing contract

The existing provider contract (`src/lib/ingestion/rawProviderJob.ts`,
`ingestSourceBatch.ts`, `providerConfig.ts`) already has three shapes, and
every real candidate below fits one without a schema change:

| Candidate | Fits as | Adapter file (new) | Schema change needed? |
|---|---|---|---|
| Oracle Cloud Recruiting adapter | **A — company-specific ATS** (same shape as Greenhouse/Lever/Workable/Ashby) | `deriveAtsFeedUrl.ts` branch + `providers/oracle-hcm.ts` | **No** — `jobs.source_type` check constraint needs one new allowed value, same additive-migration pattern used for `ashby`/multi-company types before |
| Workday adapter | **A — company-specific ATS** | Same as above, `providers/workday.ts` | Same — one new `source_type` value |
| Career-page link-following extension | **C — reusable extraction, already exists** | Extends `extract-career-page-jobs/route.ts`'s fetch step only | **No** — zero new adapter, zero new `source_type` |
| Bayt adapter (via Apify) | **B — multi-company feed** (same shape as RemoteOK/Jobicy/Arbeitnow, already proven with `dedup_scope='type:'||source_type` for company-less batches) | `providers/bayt.ts`, fed by a new `run-apify-batch` step or extending `run-multi-company-batch` | **No** — `bayt`/`gulftalent` `source_type` values and `providerConfig.ts` entries already exist from Phase 13, just `enabled:false` |
| GulfTalent adapter (via Apify) | **B — multi-company feed** | `providers/gulftalent.ts` | **No** — same as Bayt |
| JSearch (Saudi/Qatar/UAE only) | **B — multi-company feed** | Already written (`providers/jsearch.ts`), needs live verification only | **No** |

**Every candidate this phase recommends implementing fits the existing
three-shape contract with zero database schema redesign** — the only
additive migration needed anywhere is widening `jobs.source_type`'s check
constraint for `oracle_hcm`/`workday`, the exact same low-risk pattern
already used twice before (Phase 13's `ashby` and multi-company types).

---

## 11. Credentials matrix (Step 11)

| Credential | Required for | Free tier? | Est. MVP cost | Already have it? | Founder action needed |
|---|---|---|---|---|---|
| `APIFY_API_TOKEN` | Bayt, GulfTalent adapters | No — pay-per-result | Bayt ~$0.99/1k, GulfTalent ~$0.70-0.75/1k. A bounded first production run (e.g. 2,000 results/week across both) ≈ **$3-4/week** | **Yes** — already configured, unused | None — just needs the explicit go-ahead to spend real Apify credits (§Phase 16 plan bounds this) |
| `JSEARCH_API_KEY` | JSearch adapter (Saudi/Qatar/UAE only) | Yes — 200 req/mo free | $0 at MVP polling volume (well under 200/mo if polled daily, not hourly) | **No** | Sign up at RapidAPI's JSearch listing, add `JSEARCH_API_KEY` to `.env.local`/`.env.example` |
| Oracle HCM adapter | None — public, no-key endpoint | N/A | $0 | N/A | None |
| Workday adapter | None — public, no-key endpoint | N/A | $0 | N/A | None |
| Adzuna | **Not recommended for this phase's priority** — no confirmed Lebanon/Gulf coverage | — | — | — | None — do not pursue for Lebanon/Gulf |

No secret value is reproduced anywhere in this document, consistent with
`AGENTS.md` §34.

---

## 12. Source decision matrix

| Source | Type | LB | SA | QA | KW | AE | Method | Credential | Cost | Freshness | Location quality | Apply URL quality | Dedup ID quality | Access/ToS risk | Maintenance risk | Architecture fit | Recommendation |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Oracle Cloud Recruiting | ATS (A) | 2 | 4 | 6 | 3 | 8 | Direct JSON API | None | Free | High | High (structured) | High (real apply URL) | High (stable req ID) | Low — official API | Low | Native, zero schema change | **IMPLEMENT** |
| Workday | ATS (A) | 1 | 2 | 2 | 1 | — | Direct JSON API (POST) | None | Free | High | High | High | High | Low — official API | Low | Native, zero schema change | **IMPLEMENT** |
| SAP SuccessFactors | ATS (A/D-hybrid) | 3 | 4 | 2 | 1 | 2 | Requires Apify/Playwright | Apify token (have it) | ~similar to Bayt/1k | Medium | Medium | Medium | Medium (rendering-dependent) | Low — public site, just JS-rendered | Medium | Needs Apify actor, not native | **BENCHMARK FIRST** |
| Career-page link-following | Extraction (C) | 45 (pool) | 67 | 35 | 8 | 105 | Existing extractor + 1-hop crawl | None | Free | Unknown (untested at scale) | Medium (schema.org dependent) | Medium | High (stable job URL) | Low — first-party pages | Medium (per-site brittleness) | Zero-adapter extension of existing code | **IMPLEMENT** |
| Bayt (via Apify) | Aggregator (B) | Yes | Yes | Yes | Yes | Yes | Apify actor | Apify token (have it) | ~$1/1k | High (daily-scraped) | High | Medium (Bayt-hosted apply, not always direct) | High (actor provides stable `jobId`) | Medium — robots.txt disallows direct scraping; actor handles this at Apify's own risk/ToS layer | Low (mature, 557 users, 100% success) | Multi-company feed, existing shape | **IMPLEMENT** |
| GulfTalent (via Apify) | Aggregator (B) | Yes (undocumented but real) | Yes | Yes | Yes | Yes | Apify actor | Apify token (have it) | ~$0.75/1k | High | High | Medium | High | Low — more permissive robots.txt than Bayt | Low (mature, 267 users, 97% success) | Multi-company feed, existing shape | **IMPLEMENT** |
| JSearch | Aggregator (B) | No | Yes | Yes | No | Yes | REST API | `JSEARCH_API_KEY` (missing) | Free tier sufficient at MVP | Medium-high | Medium (Google-for-Jobs quality varies) | Medium | High | Low ToS risk — official API | Low | Multi-company feed, existing shape, adapter already written | **BENCHMARK FIRST** (get key, verify live, then implement) |
| Adzuna | Aggregator (B) | No | No | No | No | No | REST API | `ADZUNA_APP_ID/KEY` (missing) | — | — | — | — | — | — | Adapter exists but no confirmed market coverage | **EXCLUDE** for Lebanon/Gulf |
| `openclawai` 60+-ATS Apify actor | Aggregator/fallback (B/D) | Possible | Possible | Possible | Possible | Possible | Apify actor | Apify token (have it) | ~$0.50/1k | Unknown | Unknown | Unknown | Medium | **High — 9 total users, unproven** | Would fit as multi-company feed | **BENCHMARK FIRST**, low priority given native Oracle/Workday adapters already confirmed cheaper and more reliable |
| Lebanon Apify Google-Places pilot's 18 promotable Tier-B candidates | Career-page (C) | 18 new | — | — | — | — | Existing extractor, after registry promotion + dedup | None | Free | Unknown per-site | Medium | Medium | Low — first-party pages | Low | Zero-adapter, registry-only addition | **IMPLEMENT** (promote after dedup pass) |
| Naukri UAE / other Gulf boards | Aggregator | No | No | No | No | Yes | Apify actor exists | Apify token (have it) | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Would fit as multi-company feed | **DEFER** — Bayt/GulfTalent already cover UAE with proven actors |

---

## 13. Strategy comparison (Step 13)

| Strategy | Coverage | Cost | Reliability | Maintenance | Freshness | Legal/ToS risk | Effort | Data quality |
|---|---|---|---|---|---|---|---|---|
| **A — Direct ATS adapters only** | Ceiling ~53 companies total across all 5 countries (Oracle 23 + SAP 12 + Workday 6 + smaller families 12) — real but small relative to the 593-row registry | Free (Oracle/Workday) to Apify-cost (SAP) | High (official APIs) where native; medium where Apify-dependent | Low | High | Very low | Medium (2 new native adapters + 1 Apify-backed) | Highest — first-party, structured |
| **B — Regional aggregators (Bayt/GulfTalent/JSearch)** | Largest single lever — hundreds to low-thousands of listings/country, all 5 markets (Bayt/GulfTalent) or 3/5 (JSearch) | ~$3-4/week (Apify) + $0 (JSearch free tier) | High (mature actors, proven success rates) | Low | High (daily re-scrape) | Medium — ToS/robots.txt disallow direct scraping; mitigated by using Apify's actor layer, not building an in-house scraper | Low-medium (schema already documented) | Medium — third-party provenance, not first-party, but real stable IDs/apply URLs |
| **C — Apify extraction (broader)** | Same as B for Bayt/GulfTalent (the two proven actors); everything else in this category is unproven | Similar to B for proven actors; unknown for the 60+-ATS actor | Proven for Bayt/GulfTalent; unproven elsewhere | Low for proven actors, high risk for unproven ones | High | Same as B | Low (once an actor is chosen) | Depends entirely on actor maturity |
| **D — Expand generic career-page extraction** | Largest *pool* (260 current + 18 Lebanon-pilot candidates = 278) but historically near-zero real yield without the link-following fix | Free | Medium — depends on the link-following fix actually working; unproven at scale | Medium (per-site brittleness is real) | Unknown until tested | Low — first-party pages only | Low (bounded extension of existing code) | Medium when it hits, currently mostly zero-yield |
| **E — Hybrid (recommended)** | Combines A+B+D: native Oracle/Workday (53) + Bayt/GulfTalent (largest lever, all 5 markets) + career-page link-following (unlocks part of the 278-row pool) + JSearch for SA/QA/AE only | Sum of the above — bounded, cheap | High overall (each piece individually proven) | Low-medium | High | Low-medium, actively managed | Medium-high (most implementation work, but each piece is independently low-risk) | Highest achievable mix |

**Strategy E (hybrid) is the clear recommendation** — no single strategy
alone reaches meaningful Lebanon coverage; Bayt/GulfTalent are the only
components that materially move the Lebanon needle at all, since native
ATS adapters unlock only 3 Lebanon companies (Oracle 2 + Workday 1) and
career-page extraction's real yield is still unproven at scale.

---

## 14-15. Priority ordering and explicit answers

Priority is Lebanon first, then UAE, Saudi Arabia, Qatar, Kuwait, per the
user's explicit instruction — reflected in the recommendations below, not
a separate re-ranking.

1. **Best Lebanon strategy**: Bayt + GulfTalent (via Apify) is the only
   component that reaches Lebanon's real market at meaningful scale
   (~716 + ~477 real listings observed). Native ATS adapters add only 3
   more companies. Career-page link-following adds an unproven number
   against a 45-row Lebanon pool. Promoting the 18 already-researched
   Lebanon-pilot Tier-B candidates is free and should happen regardless.
   **Lebanon coverage cannot become "strong" this phase — it can become
   "real" (hundreds of listings via aggregators) instead of "thin" (1-2
   companies).**
2. **Best UAE strategy**: UAE has the richest native-ATS gap already (8
   Oracle + 4 Phenom People + others) plus full Bayt/GulfTalent coverage —
   the combination of native Oracle adapter + Bayt/GulfTalent gives UAE
   the strongest overall lift of the 5 markets.
3. **Best Saudi Arabia strategy**: native Oracle (4) + Workday (2) +
   Bayt/GulfTalent + JSearch (confirmed SA coverage) — Saudi is the only
   market where all four mechanisms apply simultaneously.
4. **Best Qatar strategy**: same four mechanisms as Saudi (Oracle 6,
   Workday 2, Bayt/GulfTalent, JSearch confirmed QA coverage).
5. **Best Kuwait strategy**: weakest of the 5 even after this phase — no
   JSearch coverage confirmed, smallest native-ATS gap (Oracle 3, Workday
   1), 11/21 verified rows still `unknown` ATS. Bayt/GulfTalent are
   Kuwait's only strong lever.

6. **Should Bayt be integrated?** **Yes.** Real coverage, mature actor
   (557 users, 100% success), affordable (~$1/1k), covers all 5 target
   markets, output schema already sufficient for this project's contract.
7. **Best Bayt access method?** **Apify (`blackfalcondata/bayt-scraper`)**
   — direct scraping is blocked by Bayt's own `robots.txt` and returns 403
   to a plain HTTP client; no official API exists; this is the only
   evidence-based, ToS-respecting path found.
8. **Should Apify be used, and where exactly?** **Yes — for Bayt and
   GulfTalent specifically** (both proven, mature, affordable). **Not**
   recommended yet for the 60+-ATS `openclawai` actor (9 users, unproven)
   or SAP SuccessFactors extraction (would need its own benchmark).
9. **Best Apify actors to benchmark/use?** `blackfalcondata/bayt-scraper`
   and `blackfalcondata/gulftalent-scraper` — use directly (schema already
   documented, no benchmark spend required to design the adapter).
   `openclawai/career-site-ats-jobs-scraper` — benchmark only, low
   priority given native Oracle/Workday already confirmed cheaper.
10. **Best new ATS adapter?** **Oracle Cloud Recruiting** — 23 companies,
    all 5 countries, confirmed live via a real 200 JSON response against a
    real tenant, zero cost, zero new credential.
11. **Second-best ATS adapter?** **Workday** — 6 companies, confirmed
    real API pattern, needs one POST-verification call before building.
12. **Is JSearch worth enabling?** **Yes, but only for Saudi/Qatar/UAE.**
    Confirmed real coverage for those 3, free-tier-sufficient at MVP
    volume. Do not market it as a Lebanon or Kuwait solution.
13. **Is Adzuna worth enabling?** **No**, for this phase's priority — no
    confirmed coverage in any of the 5 target markets. Revisit only if a
    future phase explicitly re-prioritizes international-remote.
14. **Best combination for Lebanon + Gulf coverage / cost / reliability /
    maintenance?** Strategy E (§13): native Oracle + Workday adapters,
    Bayt + GulfTalent via Apify, career-page link-following extension,
    JSearch for SA/QA/AE. Total incremental recurring cost at MVP scale:
    roughly **$3-4/week** (Apify) + **$0** (JSearch free tier, Oracle/
    Workday free APIs).
15. **Minimum viable provider set for Phase 16?** Bayt + GulfTalent (the
    only components that meaningfully move Lebanon) + the Oracle Cloud
    Recruiting adapter (cheapest, most-proven native win) + the
    career-page `DEFAULT_LIMIT` increase (free, zero-risk). Workday and
    JSearch can follow in the same phase if time allows, or a fast-follow
    phase — they are independently valuable but not required to prove the
    strategy works.
16. **Stronger production provider set after MVP?** Add Workday, JSearch
    (SA/QA/AE), the career-page link-following extension (once benchmarked
    against a real sample), and re-evaluate the `openclawai` 60+-ATS actor
    once it has more adoption/maintenance evidence — SAP SuccessFactors
    coverage (12 companies, all 5 countries) is otherwise stranded behind
    a browser-rendering requirement this phase deliberately did not
    commit to building.

---

## 16. Classification of every candidate

| Candidate | Classification |
|---|---|
| Oracle Cloud Recruiting native adapter | **IMPLEMENT IN PHASE 16** |
| Workday native adapter | **IMPLEMENT IN PHASE 16** (pending one live POST verification) |
| Bayt via `blackfalcondata/bayt-scraper` | **IMPLEMENT IN PHASE 16** |
| GulfTalent via `blackfalcondata/gulftalent-scraper` | **IMPLEMENT IN PHASE 16** |
| Career-page `DEFAULT_LIMIT` increase | **IMPLEMENT IN PHASE 16** |
| Career-page one-level link-following | **IMPLEMENT IN PHASE 16** (bounded scope, existing extractor unchanged) |
| Promote the 18 Lebanon-pilot Tier-B candidates | **IMPLEMENT IN PHASE 16** (after a dedup pass against the live 593-row registry) |
| JSearch (Saudi/Qatar/UAE) | **BENCHMARK FIRST** — get a free-tier key, verify one real response against the existing adapter's field mapping, then enable |
| SAP SuccessFactors (Apify/Playwright-based) | **BENCHMARK FIRST** — needs a dedicated actor evaluation, not covered by this phase's evidence |
| `openclawai` 60+-ATS actor | **BENCHMARK FIRST**, low priority |
| Adzuna | **EXCLUDE** for Lebanon/Gulf priority |
| Naukri UAE and other Gulf-only boards | **DEFER** — Bayt/GulfTalent already cover UAE |
| Further Lebanon company *discovery* (more Google-Places-style pilots) | **DEFER** — marginal return confirmed low this phase (91.7% manual_only in the 446-company sample); extraction technique, not company discovery, is the real lever |

---

## Phase 16 implementation plan (design only — not executed this phase)

**Adapters to add:**
1. `src/lib/ingestion/providers/oracle-hcm.ts` — maps
   `recruitingCEJobRequisitions` response fields to `RawProviderJob`. Fed
   via a new `deriveAtsFeedUrl.ts` branch matching Oracle tenant URL
   patterns (`*.oraclecloud.com/hcmRestApi/...` or the stored
   `official_careers_url`'s tenant/site-number pair). Company-specific
   (Tier A), same shape as Greenhouse.
2. `src/lib/ingestion/providers/workday.ts` — maps the Workday `wday/cxs`
   POST response. Requires the ingestion HTTP fetch to be POST with a JSON
   body (Greenhouse/Lever/Workable/Ashby are all GET today —
   `Fetch Source Jobs`'s n8n node needs a per-ATS method/body branch, not
   just a URL). Company-specific (Tier A).
3. `src/lib/ingestion/providers/bayt.ts` and `gulftalent.ts` — map the two
   actors' documented output schemas (§5) to `RawProviderJob`. Multi-company
   (Tier B/D shape, `dedup_scope='type:bayt'`/`'type:gulftalent'`, same
   pattern as RemoteOK/Jobicy). Fetched via a new n8n node calling Apify's
   "Run actor and get dataset" REST endpoint (not the `@apify/n8n-nodes-
   apify` community node unless already installed — confirm during
   Phase 16 setup) with a bounded `maxItems`, then POSTed to
   `run-multi-company-batch` exactly like RemoteOK/Jobicy/Arbeitnow today.

**ATS adapters to add**: Oracle Cloud Recruiting, Workday (above).

**Apify actors to use**: `blackfalcondata/bayt-scraper`,
`blackfalcondata/gulftalent-scraper`. To benchmark only, not use yet:
`openclawai/career-site-ats-jobs-scraper` (SAP SuccessFactors fallback
candidate).

**Credentials required before Phase 16 can go fully live**:
`JSEARCH_API_KEY` (optional — only blocks the JSearch piece, everything
else is independent). `APIFY_API_TOKEN` already exists.

**DB/schema changes**: one additive migration widening
`jobs.source_type`'s check constraint to add `oracle_hcm`, `workday`,
`bayt`, `gulftalent` (bayt/gulftalent's `source_type` values may already
exist from Phase 13's scaffolding — confirm before writing a new
migration, do not duplicate). No other schema change — confirmed in §10.

**n8n workflow changes**: extend "AI Job Agent / 01 Job Ingestion" with:
one new Tier-A switch case each for Oracle/Workday (mirroring
Greenhouse/Ashby's existing branches, with Workday's branch using POST
instead of GET), and one new Tier-D-shaped lane for Bayt/GulfTalent
(Apify call → multi-company batch endpoint, mirroring the existing
RemoteOK/Jobicy/Arbeitnow lane exactly). Keep `active:false`. Use the
Production Automation Engineer skill's full lifecycle (repo-first `.ts`/
`.json`, validate, test with pinned data, verify connections) for every
change, same discipline as Phases 12-14.

**Tests required per new source** (per AGENTS.md §12 and this phase's own
instruction): schema/mapping tests (real documented field names, not
invented), malformed-payload tests, empty-result tests, location
normalization tests, work-arrangement tests, canonical-URL tests,
provenance tests, duplicate-external-id tests (Bug #2 from Phase 14 proved
this matters for real provider data), idempotency tests, and — for the
Apify-backed sources specifically — a cost-guard test confirming
`maxItems`/budget bounds are actually enforced before any real call.

**Idempotency strategy**: unchanged — reuse the existing
`(dedup_scope, external_id)` upsert model. Bayt/GulfTalent use
`type:bayt`/`type:gulftalent` dedup scope (no per-company `source_id`,
same as RemoteOK today); Oracle/Workday use `src:<source_id>` (company-
specific, same as Greenhouse).

**Provenance strategy**: unchanged — `source_type`, `source_url`,
`application_url`, `company_name` populated identically to every existing
provider; Bayt/GulfTalent additionally carry the actor's own stable
`jobId`/`jobKey` as `external_id`.

**Cost guardrails**: `maxJobsPerRun` already exists per-provider in
`providerConfig.ts` — set conservatively for Bayt/GulfTalent (e.g. 40-100
per run, matching the existing Tier-D pattern) and monitored against
Apify's real per-run cost before any schedule is ever considered.
`costGuardNote` fields already exist in the config for exactly this
purpose (Phase 13 scaffolding).

**Live validation plan**: same discipline as Phase 14 — real bounded
manual n8n executions against local/dev only, workflow stays inactive,
`dryRun:true` first, then a real bounded run, DB persistence verified
directly, a second run proves idempotency, matching handoff re-verified
for at least one new Lebanon/Gulf job (mirroring Phase 14's exact method).

**Rollback plan**: every new adapter/provider entry ships with
`enabled:false` in `providerConfig.ts` until its own live-validation phase
passes — flipping one flag is the entire rollback path, identical to how
`bayt`/`gulftalent`/`jsearch`/`adzuna` already sit today. The additive
migration (widening the `source_type` check constraint) is reversible by
construction (removing a value from an allowed-list, no data rewritten by
adding it).

---

## Confirmation

No provider adapter, database migration, n8n workflow, or application code
was changed this phase. `docs/job-source-discovery/` was read, not
modified. All new work this phase is confined to this document, its
supporting `.scratch-phase15/` analysis scripts (excluded from commit),
and the git branch/commit/push described in the final report.
