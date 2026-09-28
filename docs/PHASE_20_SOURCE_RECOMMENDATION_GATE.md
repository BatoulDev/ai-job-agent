# Phase 20 — Source Recommendation Gate

Branch: `phase/20-lebanon-live-source-expansion`, forked from `main` @
`6f00277` (Phase 19 merged). This document is the repository-preserved
record of the Step 16 "Source Recommendation Gate" hard stop, originally
delivered as a published report and in chat. **Nothing described as
recommended below has been implemented.** No adapter was written or
changed, no `providerConfig.ts` change was made, no n8n node was added, no
provider was enabled, no database change was made, and **zero dollars were
spent / zero live paid Apify actor runs were made** while producing this
research. Everything past this gate waits on an explicit decision on which
candidates to benchmark and build.

All findings below are as originally researched and reported during Phase
20 — public Apify Store documentation, this project's own existing adapter
code, and public web research. Nothing here is invented or changed from
the original findings.

---

## Credential status (Step 1)

An Apify credential already exists in the local n8n instance — name
**"Apify Api Token"**, type **`httpHeaderAuth`**, id
`CwBlWkeaMpw64YNE`. This credential was **not** present at the end of
Phase 19 (Phase 19's audit explicitly found "No credential of any kind for
Apify exists in this workflow"), so it was created since.

A $0 verification call (`GET https://api.apify.com/v2/users/me` — a free,
read-only endpoint that only confirms token validity, does not run any
actor, and incurs no Apify cost) was attempted via a throwaway 2-node n8n
workflow (Manual Trigger → HTTP Request), bound to this credential. Before
the verification could run, binding the credential to the test node via
the n8n MCP's `setNodeCredential` operation was **blocked by Claude Code's
own local tool-permission classifier** — not by anything in this project's
code, n8n instance, or the credential itself. The scratch workflow was
archived immediately without ever making a live call.

**Status: unresolved.** This credential's real validity has not been
confirmed. Before any paid benchmark run, either:
1. the founder verifies it manually in the n8n UI, or
2. the founder grants permission for an automated $0 verification call.

---

## LinkedIn Jobs actor comparison

Public job discovery only — no LinkedIn account automation, no login, no
scraping of private profiles, no auto-apply, no automation of
connections/likes/messages. Four candidate actors were found and compared
on the Apify Store.

| | bebity | curious_coder | valig | thirdwatch |
|---|---|---|---|---|
| Actor ID | `bebity/linkedin-jobs-scraper` | `curious_coder/linkedin-jobs-scraper` | `valig/linkedin-jobs-scraper` | `thirdwatch/linkedin-jobs-scraper` |
| Pricing | Pay-per-event, from **$1.00/1k** results (+$5/mo free credit) | Pay-per-event, **~$1.00/1k** | Pay-per-event, **$0.28–0.40/1k** | Pay-per-result, **$8.00/1k** |
| Users / monthly active | 40,182 / 3,017 | 164,250 / 17,813 | 24,852 / 3,885 | 176 / 15 |
| Success rate / rating | 99.9% / 4.31★ | 99.7% / 4.59★ | 100% / 4.68★ | 92.5% / 3.75★ |
| Maturity | 3.9M+ runs since Feb 2023, actively maintained through LinkedIn's Aug 2026 filter changes | Large, active user base; adapted to Aug 2026 LinkedIn filter restrictions | Cheapest, high rating, but no maturity/update-date signal found | Small user base (176 total), weakest success rate |
| Location input | `locations` array — free-text geographic areas (supports country-level, e.g. "Lebanon") | `location` string + `geoId` (LinkedIn's own geo ID, more precise but requires lookup) | `location` string — docs say "city, state, or zip" (country-level unclear) | `location` string **+ dedicated `country` field** — cleanest explicit country filter |
| Internship/entry-level filter | Yes — `experienceLevels` array includes Internship through Director | Deprecated by LinkedIn Aug 2026 update; now converted to AI keyword search (less reliable) | `experienceLevel` field present, filter mechanism unclear | `experienceLevel` field present |
| Remote/onsite filter | Yes — `workTypes` (On-site/Remote/Hybrid) | Yes — `workRemoteAllowed` + `workplaceTypes` | Not clearly documented | `jobType` (unclear if distinct from work-arrangement) |
| Description field | Both plain text + HTML | Both plain text + HTML | Both plain text + HTML | Plain text + separate `skills` field |
| Apply URL provenance | **Best**: `applyUrl` + `applyType` distinguishes Easy Apply vs external employer ATS link | `applyUrl` exists, docs don't specify LinkedIn vs external | **Weak**: docs state apply URLs point to LinkedIn's own job-view page, not ATS | Docs explicitly note Easy Apply jobs point back to LinkedIn; others presumably external |
| Output richness | **42 fields** — richest (salary breakdown, company profile, recruiter fields via add-on) | ~15 fields, solid core set | ~13 fields, includes recruiter name/URL | ~15 fields, includes structured salary |
| Cost per 1k | $1.00 | ~$1.00 | $0.28–0.40 | $8.00 |

None document a Lebanon-specific test result — all figures are from each
actor's own Store page/docs, not a live call (no live call was made, per
phase constraints). Apply-URL provenance claims are as documented,
unverified against real output.

### bebity recommendation

**Strongest single actor: `bebity/linkedin-jobs-scraper`.** It's the most
mature (3.9M+ runs, survived LinkedIn's own filter changes with a
rebuild), has the richest output schema (42 fields, including a clean
Easy-Apply-vs-external `applyType`/`applyUrl` distinction — the best
provenance signal of the four), and supports both an `experienceLevels`
filter (covers Internship) and `workTypes` (covers Remote) natively —
both directly relevant to this project's entry-level/remote focus. Its
price ($1.00/1k) is mid-pack, not cheapest, but the data quality and
maintenance signal justify it over the $0.28–0.40/1k `valig` alternative,
whose docs indicate apply URLs point back to LinkedIn's own page rather
than the employer — a weaker provenance story.

**Verdict: TEST FIRST.**

### curious_coder LinkedIn fallback

**One actor vs. two: one (bebity) is sufficient to start.** It has no
Lebanon/Gulf-specific weakness — `locations` accepts free-text geographic
areas so both Lebanon and each Gulf country can be queried with the same
actor via separate runs/keywords. A second actor only earns its place if
a live benchmark shows bebity's Lebanon-specific results are thin (low
absolute job count for a small market) — in that case `curious_coder`
(largest user base, 164k users, still has
`workRemoteAllowed`/`workplaceTypes`) is the natural second candidate to
compare, not `valig` (weak provenance) or `thirdwatch` (weak
reliability, most expensive).

**Verdict: HOLD** — largest user base and cheap, but LinkedIn's Aug 2026
update degraded its experience-level filtering (now keyword-based, less
precise) and apply-URL provenance is undocumented. Reasonable fallback if
bebity underperforms on Lebanon volume.

### Other LinkedIn actors

- **valig/linkedin-jobs-scraper** — **HOLD, lean REJECT.** Cheapest and
  highest-rated, but its own docs say apply URLs point to LinkedIn's
  job-view page rather than the employer — worse provenance than the
  alternatives, and no clear internship/remote filter documentation.
- **thirdwatch/linkedin-jobs-scraper** — **REJECT.** Tiny user base (176
  total, 15 monthly active), worst success rate (92.5%), and by far the
  most expensive ($8/1k vs $0.28–1.00/1k for the others) — no advantage
  found to justify any of the three downsides.

---

## Gulf & Lebanon job boards (Apify) — Bayt and GulfTalent findings

Context: this project already has code-complete (but disabled,
`enabled:false`, never live-called) adapters for both actors —
`mapBaytJob()` / `mapGulfTalentJob()` in `src/lib/ingestion/providers/`.

### Bayt findings

**Actor**: `blackfalcondata/bayt-scraper`. Re-verified against its current
live Store page: **$0.99/1k** (unchanged), 564 users / 121 monthly active
users / 100% success rate (consistent with prior research).

**No breaking drift.** Documented input now includes: `query`, `country`
(13 MENA markets + `"INTERNATIONAL"`), `location`, `employmentType`,
`careerLevel`, `datePosted`, `searchMinSalary`, `easyApplyOnly`,
`searchRadiusKm`, `maxResults`, `compact` mode. Every field the current
adapter (`bayt.ts`) reads
(`jobId,title,company,location,city,country,employmentType,description,isRemote,url,applyUrl,postedDate,careerLevel`)
is still present in the real output schema — **no rename, no removal.**
New fields the adapter doesn't yet use: `salaryText/Min/Max/Currency`,
`directApply`, `companyUrl/Logo/Size`, `descriptionHtml/Markdown`,
`skills`, `extractedEmails/Phones/Urls[]`, `socialProfiles{}`,
`contentHash`, `scrapedAt`, `source`, plus incremental-mode
change-tracking fields. None of this is a must-fix; it's optional future
enrichment.

**Geography**: the actor's `country` input covers 13 MENA markets,
**including Lebanon** — the only Apify board actor confirmed able to
return Lebanon results by name.

**Verdict: TEST FIRST.** The only Apify board actor that can actually
return Lebanon results by name — carries the Lebanon-first goal more than
any other single candidate.

### GulfTalent findings

**Actor**: `blackfalcondata/gulftalent-scraper`. Pricing ~$0.70/1k, 270
users / 68 monthly active users / 97.2% success — matches prior research
closely.

**No breaking drift on required fields**, but two real findings:

1. **`country` input only accepts AE/SA/QA/KW/BH/OM — no Lebanon option.**
   GulfTalent is structurally Gulf-only; it cannot serve the Lebanon-first
   goal at all, only the Gulf tier. This re-scopes GulfTalent from
   "Lebanon + Gulf" to "Gulf tier only" in any implementation plan — Bayt,
   not GulfTalent, is what actually serves Lebanon.
2. The output schema pulled just now does **not** list `employmentType`
   or `seniority` among GulfTalent's fields (it lists
   `jobId,jobKey,title,location,company,salaryMin/Max/Currency,description,descriptionText/Html/Markdown,applyUrl,companyLogo,companyIndustry,postedAt,canonicalUrl,extractedEmails/Phones[]`).
   This doesn't break anything — `mapGulfTalentJob()` already treats both
   as optional/nullable — but it's worth flagging as **unconfirmed**
   rather than assuming `seniority` is definitely present; the live
   benchmark should settle it.

**Verdict: TEST FIRST — Gulf only.** Still worth testing for its Gulf
coverage, but re-scoped by this phase's finding: it does not serve
Lebanon.

### NaukriGulf

**Actor**: `memo23/naukrigulf-jobs-scraper`. $0.99/1k, 25 users / 7
monthly active users, 100% success.

Coverage: Dubai/Abu Dhabi/Sharjah/Riyadh/Jeddah/Dammam/Doha/Manama/Muscat/Kuwait
City/Cairo — **no Lebanon**. Apply link: `JdURL` = canonical Naukrigulf
detail URL (not the employer's own site — it's the job-board listing
page, same provenance model as Bayt/GulfTalent).

**Verdict: HOLD.** Gulf-only value, and low user count (25 total) is a
real reliability unknown next to Bayt/GulfTalent, which already cover the
same Gulf markets with more mature actors. No case for adding it
alongside two more mature alternatives yet.

---

## Broader aggregators & other candidates

Investigation-only pass — none run live.

### Indeed findings

**Actor**: `curious_coder/indeed-scraper`. **$0.10/1k**, 4,297 users / 248
monthly active users, **100% success rate**.

Country param exists (`us`,`uk`,`my` examples); Lebanon/Gulf coverage
**not confirmed** from docs alone. Apply-link provenance: `originalApplyUrl`
= direct employer/ATS link (good); `viewJobLink` = Indeed's own page.

**Verdict: TEST FIRST.** Cheapest, most-used, best success rate of
anything researched; provenance is real; the only open question is
whether Lebanon/Gulf search actually returns MENA results, which a tiny
bounded benchmark would settle cheaply.

### Google Jobs

**Actor**: `s-r/google-jobs-scraper`. $2.00+/1k, 3 users / 2 monthly
active users, 100% success (n too small to trust).

Country param exists, MENA undocumented. **Default apply link is Google's
own redirect**, not the original poster — `resolveApplyLinks` can unwrap
it to the real source, at extra cost/complexity.

**Verdict: REJECT for now.** 3 total users is not a track record; default
provenance is broken and only fixable with an extra resolve step this
project has never needed elsewhere. Revisit only if Bayt/Indeed/GulfTalent
prove insufficient for Gulf breadth.

### Mourjan

**Actor**: `muhammadafzal/mourjan-scraper`. ~$1.00/1k (start+item), 2
users / 1 monthly active user, 100% success (n too small).

`category:"jobs"` filter exists; Lebanon coverage **not confirmed**,
docs default-example is UAE. **No apply URL at all** — only
`contactPhone`, no employer link, no ATS link.

**Verdict: REJECT.** This project's `validateRawProviderJob` hard-rejects
any job missing `applicationUrl`/`applicationEmail`; an actor with no
apply-URL field structurally cannot pass validation regardless of
anything else. Also 2 total users is unverified-tooling territory.

### Wellfound

**Actor**: `memo23/wellfound-jobs-scraper`. ~$1.09–1.99/1k (price doubles
after 2026-09-30), 412 users / 154 monthly active users, 98.3% success.

No MENA/Lebanon/Gulf location examples in docs; Wellfound skews
US/global-remote startups. Apply-link provenance ambiguous — `atsSource`
(greenhouse/lever) field suggests real ATS-backed postings exist, but the
actor's own docs don't confirm the returned `jobUrl` is the ATS link vs.
Wellfound's own apply flow.

**Verdict: HOLD.** Decent user base, but geography is the wrong fit for
"Lebanon-first," and unconfirmed apply-link provenance is disqualifying
until proven. Worth a look only for the "verified international remote"
Pro-tier lane, not Lebanon/Gulf core.

### Multi-site aggregators

E.g. `supermiojo/job-board-aggregator` (Remotive+Arbeitnow+Indeed):
~$2.00/1k, 1 user / 1 monthly active user, 100% success (n=1,
meaningless). Combines existing sources only — no MENA-specific value.
`source` field preserved per record; sample apply URL is a real
`indeed.com/viewjob?jk=...` link (provenance looks legitimate).

**Verdict: REJECT.** This project already ingests Arbeitnow directly
(Tier D) and would get Indeed more cheaply/directly via the actor above;
paying a markup to re-wrap sources already owned, from a 1-user actor,
adds cost and duplicate-risk for zero new coverage. Other "multi job
board" actors found (`flash_scraper/multi-jobboard-scraper`,
`kindred_llama/job-scraper`, `agentx/all-jobs-scraper` "42 platforms")
were surfaced by search only and not fetched in depth — the same
objection applies on its face, so no further spend was justified
researching them further.

---

## Lebanon sources outside Apify

Context: this project already ingests real jobs from Oracle Cloud
Recruiting's public REST API (confirmed live for AUBMC — American
University of Beirut Medical Center — and one Abu Dhabi hospital), has a
code-complete-but-unwired Workday adapter, and has generic support for
Greenhouse/Lever/Workable/Ashby career pages plus a generic career-page
HTML extraction fallback.

### 1. Lebanon job boards

| Source | robots.txt | Format | Scorecard |
|---|---|---|---|
| **jobs.com.lb** | Allows job-listing crawl (only disallows employer/jobseeker account areas) | No API/RSS found; would need HTML scraping of public listing pages, which robots.txt permits | **C** — scraping permitted but not a structured feed; no confirmed contact-email fallback |
| **jobsforlebanon.com** (WordPress) | Fully open except `/wp-admin/` | Checked `wp-json/wp/v2/types` — **no job/listing custom post type exposed** in REST API; jobs likely rendered via a non-API plugin | **C** — scraping permitted by robots.txt, but no structured API |
| **hirelebanese.com** | robots.txt returns 404 (no file = no explicit restriction, but not confirmed permissive either — unusual for a commercial site, verify manually before relying on this) | No API found; ASPX-based site (`searchresults.aspx`) | **C** — unconfirmed scraping legality, needs manual robots/ToS check before any implementation |
| **lebanon.tanqeeb.com** | Explicitly disallows `job_id` query-param URLs — i.e. **individual job detail pages are excluded from crawling** | N/A | **D** — robots.txt specifically blocks the exact pages needed |
| Bayt Lebanon pages, GulfTalent | Already covered by the existing Apify-actor adapters (bayt.ts/gulftalent.ts) — not re-researched here | — | (out of scope for this pass) |

**None of the Lebanon-only job boards found have a public API or feed.**
All either require scraping (permitted-by-robots-but-unstructured, or
outright disallowed) or are unconfirmed. No A-tier source in this
category.

### 2. University career portals

| University | Portal | Finding | Scorecard |
|---|---|---|---|
| **AUB** | `careers.aub.edu.lb` | URL redirect-looped (>10 redirects) when fetched directly — could not determine backing platform. Separate from AUBMC's already-confirmed Oracle HCM tenant (`fa-exxn-saasfaprod1...`); worth a manual check whether AUB-the-university shares that same Oracle tenant/site number or uses a different system — **not confirmed either way** | **B** (inferred possible Oracle HCM reuse, unconfirmed) — needs a direct manual probe, redirect loop blocked automated confirmation |
| **LAU** | Transitioning to **LAU JobTeaser** (`careerguidance.lau.edu.lb`) | JobTeaser is a third-party platform typically gated behind student/alumni login for job-seeker access; no public API found | **D** — login-gated, no safe public path found |
| USJ, Balamand, NDU, Haigazian, AUST, Lebanese University | Not checked this pass (token budget) | — | **unknown** |

### 3. Major employer ATS detection

| Employer | Careers URL | ATS detected | Scorecard |
|---|---|---|---|
| **Bank Audi** | `careers.bankaudi.com.lb` | Confirmed **custom-built** portal ("Developed by Born Interactive" in footer) — not Oracle/Workday/Greenhouse/Lever/Workable/Ashby/SuccessFactors/Taleo/SmartRecruiters/iCIMS | **D** — proprietary system, would need real scraping-feasibility check (not assessed) |
| **BLOM Bank** | blombank.com/careers pages | No ATS signature found; likely custom/static | **D** (unconfirmed, low priority) |
| **Byblos Bank** | byblosbank.com/bank-careers-lebanon | Not deeply checked | **unknown** |
| **Fransabank** | fransabank.com/careers | Not deeply checked | **unknown** |
| **Touch (telecom)** | `touch.com.lb/autoforms/portal/...` | "autoforms/portal" path naming suggests a custom/proprietary CMS module, not a recognized ATS | **D** (inferred, unconfirmed) |
| **Alfa (telecom)** | No official careers URL surfaced; only third-party aggregators (Glassdoor) indexed | No direct source found | **D** |
| **LAU Medical Center–Rizk Hospital** | `laumcrh.com/careers/current-job-listings` | Not checked for ATS signature | **unknown** |
| **Hotel Dieu de France, Clemenceau Medical Center** | Not found/checked this pass | — | **unknown** |

**Zero confirmed Oracle HCM / Workday / Greenhouse / Lever / Workable /
Ashby / SmartRecruiters / SuccessFactors matches** among the Lebanese
employers checked this pass — general web search for
`myworkdayjobs.com`/`greenhouse.io`/`lever.co` + Lebanese company names
returned only unrelated international results, no Lebanon hits. This is a
real negative finding, not an omission: Lebanese employers in
finance/telecom/healthcare appear to overwhelmingly run
custom/proprietary or unidentified career portals rather than known SaaS
ATSs, unlike the AUBMC pattern (Oracle) already confirmed in earlier
phases.

### 4. Other sources

Not reached this pass — embassy/NGO/UN job boards and tech-sector-specific
boards were not researched (budget). Flagged as open for a follow-up pass
if the founder wants deeper coverage there.

### Bottom line for the Lebanon-outside-Apify scorecard

**No new A-tier (safe, structured, implementable) Lebanon source was
found in this pass.** The one live, real, working Lebanon channel this
project already has (Oracle HCM via AUBMC) remains the only confirmed
A-tier non-Apify Lebanon source. Everything found here is B (AUB
university portal — needs manual redirect-loop workaround to confirm), C
(jobs.com.lb, jobsforlebanon.com — robots-permitted but requires real
HTML scraping, not implemented or assessed for scraping quality here), or
D (Tanqeeb, LAU/JobTeaser, Bank Audi, Touch, Alfa — blocked, gated, or
proprietary with no safe path). **Recommend do not implement any C/D
source without a dedicated scraping-feasibility + ToS review**, and
recommend a manual (non-automated) check of `careers.aub.edu.lb`'s actual
destination to resolve the B-tier AUB finding, since the redirect loop
prevented automated confirmation. Per this project's own rule (AGENTS.md
§7), C and D sources are not implementation candidates as-is.

---

## Recommended initial provider set

Pending approval — nothing here has been built.

**Core Lebanon**
- **Bayt** — only Apify board that returns Lebanon by name
- **Oracle HCM** — already live (AUBMC), unaffected by this phase

**Core Gulf**
- **Bayt** — also covers all 5 target Gulf markets
- **GulfTalent** — Gulf-only, re-scoped by this phase's finding

**LinkedIn Jobs actor**
- **bebity** — primary candidate
- **curious_coder** — fallback if Lebanon volume is thin

**Indeed actor**
- **curious_coder/indeed-scraper** — cheapest, most proven, real provenance

**International remote**
- No candidate cleared the bar yet — **Wellfound** is the only lead, held
  for a later pass

**Optional secondary**
- **NaukriGulf** — only if Bayt/GulfTalent prove thin on Gulf volume

### Direct answers to the founder's LinkedIn/coverage questions

- **Strongest LinkedIn actor?** bebity/linkedin-jobs-scraper — richest
  schema, clearest apply-link provenance, native internship/remote
  filters.
- **One actor or several?** Start with one (bebity). A second only earns
  its place if bebity's real Lebanon volume proves thin — curious_coder
  is the named fallback, not valig or thirdwatch.
- **Lebanon vs. Gulf strength?** No LinkedIn actor documents a
  Lebanon-specific weakness — all use free-text location input, so the
  same actor serves both geographies via separate queries.
- **Cost vs. quality balance?** bebity is mid-priced ($1.00/1k) against a
  $0.28–8.00/1k range, but wins on data richness and the one field this
  product can't compromise on: real apply-link provenance.
- **Overlap with Bayt/GulfTalent/Indeed?** Real, but not redundant —
  LinkedIn's professional-network postings and native experience-level
  tagging skew toward exactly the internship/junior/campus-recruiting
  roles this phase targets, a different lean than general job boards.
- **Best combination?** Bayt (Lebanon + Gulf board, strong provenance) +
  Indeed (breadth, cheapest, proven) + bebity LinkedIn
  (junior/internship-heavy postings) is complementary, not duplicative,
  coverage.

---

## Cost observations

- Bayt: $0.99/1k results. Per Phase 19's live-benchmark plan (Task C,
  50–100 items), estimated **~$0.05–0.10 per market run**.
- GulfTalent: ~$0.70–0.75/1k results, similarly **~$0.04–0.08 per market
  run** at 50–100 items (Gulf markets only — no Lebanon run possible).
- Indeed: $0.10/1k — cheapest candidate by an order of magnitude; a
  50–100 item bounded run costs a fraction of a cent to ~$0.01.
- bebity LinkedIn: $1.00/1k — a 50–100 item bounded run costs
  **~$0.05–0.10**.
- All four candidates' tiny first-run benchmarks (10-item caps per Step
  15's tiered cost-control discipline), run once each, stay well under
  $1 total combined.
- Rejected/held candidates (Google Jobs $2.00+/1k, Wellfound $1.09–1.99/1k
  rising, Mourjan ~$1.00/1k, multi-site aggregators ~$2.00/1k) were not
  benchmarked live — their rejection/hold status was reached from
  documentation and track-record signals alone, so no spend was incurred
  evaluating them.
- **Total spend this phase: $0.00.** No paid Apify actor call was made at
  any point while producing this research.

---

## Cross-provider deduplication risk

**Known architectural risk to flag now, not fix now:** this project's
de-duplication is scoped per provider (`dedup_scope = 'type:<provider>'`),
not by job content across providers. Adding Bayt + GulfTalent + Indeed +
LinkedIn in parallel raises real cross-provider duplicate-listing risk
(the same posting appearing as separate rows from two boards) that the
existing code does not resolve today. This is exactly what Step 27's
idempotency proof is for, once implementation is approved — noted here so
it's a known cost of adding more providers, not a surprise later. No
commercial plan rule was touched or needs to be.

---

## Explicit hard-stop / implementation recommendations

This is a **hard stop**, per the phase's own instructions. Nothing below
happened, and nothing below will happen until the founder decides which
candidates to move on:

- No adapter code written or changed.
- No `providerConfig.ts` change.
- No n8n node added or workflow touched.
- No provider flipped to `enabled:true`.
- No paid Apify actor run — **$0 spent**.
- No database change.
- No PR opened; no branch merged.

**Summary tally**: 4 candidates verdicted TEST FIRST (bebity LinkedIn,
Bayt, GulfTalent [Gulf-only], Indeed), 4 verdicted HOLD (curious_coder
LinkedIn, NaukriGulf, Wellfound, valig LinkedIn leaning reject), 4
verdicted REJECT (thirdwatch LinkedIn, Google Jobs, Mourjan, multi-site
aggregators), 1 already live and unaffected by this phase (Oracle HCM via
AUBMC).

**Awaiting explicit founder decision** on which of Bayt / GulfTalent /
bebity LinkedIn / Indeed (and at what tier caps) to run as the first
bounded, sub-$1 live benchmarks — or to override any verdict above —
before any implementation proceeds.
