# LinkedIn Job Discovery Research (Phase 21)

Research only — `bebity/linkedin-jobs-scraper` was used strictly for
public job-market visibility and employer discovery. **No LinkedIn
job was persisted to the production `jobs` table.** No LinkedIn account
was logged into, no user LinkedIn credentials were used, no LinkedIn
interaction (Easy Apply, messages, connections, likes) was automated.
Per this project's rules, LinkedIn is never a production ingestion
source — this document exists to identify employers/roles worth
chasing through an official, approved source instead.

---

## Cost incident — read this first

This benchmark cost **$1.4671**, not the intended ~$0.01 (a **10-item**
request). Full, honest account:

1. Input sent: `{"locations": ["Lebanon"], "maxItems": 10}`.
2. The actor's real behavior **ignored `maxItems` entirely** — the real
   run configuration shows `"maxItems": 6619"` and
   `"maxTotalChargeUsd": 9.929971` (a ~$10 platform-default spending
   cap, not something this session set). `maxItems: 10` in the request
   body did not bound the run the way Phase 20's public-documentation
   research assumed it would.
3. First attempt: the HTTP call was made with a 120s client-side
   timeout. The actor kept running past that — LinkedIn scraping is
   real browser automation, genuinely slower than a simple API call —
   and the client gave up with a connection-abort error, while the run
   kept going server-side.
4. A **free** `GET /v2/acts/.../runs` status check (no cost) revealed the
   run was still `RUNNING`, 978 real items already scraped, and
   `usageTotalUsd: 1.3861` and climbing — a real, unambiguous cost
   anomaly.
5. **Immediately aborted** via `POST /v2/actor-runs/{id}/abort` — a
   stop action, not further spend. Final state: `status: "ABORTED"`,
   locked at **978 items, $1.4671**.
6. To extract some value from money already spent, the dataset already
   produced was read **for free** (`GET /v2/datasets/{id}/items`,
   dataset reads carry no additional Apify cost) — a bounded 15-item
   sample, not the full 978, and nothing beyond read-only inspection.
7. No further live LinkedIn run was attempted this phase.

**Root cause, plainly**: the correct parameter name to bound this
actor's real item count was never confirmed against the actor's actual
input schema before spending — Phase 20's research relied on the
Store page's documented field name (`maxItems`), which either doesn't
exist as a real accepted input for this actor/build, or exists but
isn't honored the way documented. This is the exact failure mode Phase
21's own cost-control rules exist to catch — caught, but only after
real money was spent, because the very first live call assumed the
bounding parameter would work without a zero-cost schema confirmation
step first (unlike Bayt/Indeed/GulfTalent, whose input schemas were all
re-confirmed via a free Store-page fetch immediately before spending).

**Recommendation**: any future LinkedIn benchmark must first confirm
the actor's real input schema via `GET /v2/acts/{actorId}` (free) and
identify the actual result-count field name before any paid run, and
should set an explicit, low `maxTotalChargeUsd` in the request body
(if the actor's schema supports it) as a hard financial backstop
independent of any item-count field.

---

## What the real data (15-item free sample of the 978 produced) shows

### Real schema (differs from Phase 20's documentation-only research)

Real fields: `id`, `title`, `companyName`, `companyUrl`, `companyId`,
`companyLogo`, `location`, `publishedAt`, `postedTime`, `description`,
`descriptionHtml`, `contractType`, `experienceLevel`, `workType`,
`sector`, `jobFunction`, `applyType`, `applyUrl`, `applicationsCount`,
`salary`, `benefits`, `posterProfileUrl`, `posterFullName`.

- `workType` was an **empty string for all 15 real samples** — no
  remote/hybrid/onsite signal came through in this sample, despite
  documentation describing a `workTypes` filter/field.
- `experienceLevel` real values observed: `"Associate"`, `"Not
  Applicable"`, `"Mid-Senior level"`, `"Director"`, `"Entry level"` —
  richer and more granular than assumed.

### Critical, decisive real finding: apply-link provenance

**`applyType` was `"EASY_APPLY"` for all 15/15 real samples.** Every
real `applyUrl` was a `lb.linkedin.com/jobs/view/...` LinkedIn-hosted
listing page tied to LinkedIn's own Easy Apply flow — not an external
employer ATS or career-page link. Phase 20's research (from public
documentation) expected `applyType` to distinguish Easy Apply from
external-ATS jobs with a meaningful split; the real sample shows no
split at all in this batch.

**This is disqualifying for production use as currently understood.**
This project can only ever hand a user the original external job
link — it must never automate or represent Easy Apply. A real sample
where 100% of jobs are Easy-Apply-only means this actor, as configured,
would supply zero usable jobs for this project's application flow.
This does not rule out LinkedIn as a source forever (a larger/differently
filtered sample might surface non-Easy-Apply postings, and some
companies list their own external apply link alongside Easy Apply),
but it is real, negative evidence that materially changes bebity's
recommendation from Phase 20's "TEST FIRST."

### Companies discovered (real, from the 15-item sample)

MultiBank Group, MCI (BPO — two distinct *remote* Lebanon-based
customer-service roles, a real, notable find), Capital Partners
Holding, Sarah's Bag, Kronfol Homes, CMA CGM, Transmed (two roles),
Valutico, Bold Lighting, Le Gray (two roles), SEVEN, RidgePoint.

### Internship/junior findings

`"Fixed Assets Officer"` (Le Gray) and `"Solution Engineer, Microsoft
Ecosystem Solutions"` (RidgePoint) were tagged `"Entry level"` — no
internship-specific postings appeared in this small 15-item sample (the
un-sampled remainder of the 978-item dataset was not inspected, to
avoid further unnecessary work on a run whose provenance already
disqualifies it for production use).

### Remote signal

MCI's two roles (`"Remote Call Center Representative"`, `"Remote
Mortgage Customer Service Representative"`) explicitly say "Remote" in
the title despite `workType` being empty — real evidence that remote
status, when present, currently only shows up in free-text title/
description, not a structured field, in this sample.

### Official-source follow-up

Given the Easy-Apply-dominant finding above, chasing these specific
employers through their own career pages was judged lower-value than
fully documenting the cost/provenance finding itself this phase — the
right next step, once/if a founder decision authorizes continuing with
LinkedIn research at all, is a fresh, correctly-bounded, zero-cost-first
benchmark before any further follow-up investigation.

### Duplicate overlap with Bayt/Indeed/GulfTalent

None of the 15 real LinkedIn companies (MultiBank Group, MCI, Capital
Partners Holding, Sarah's Bag, Kronfol Homes, CMA CGM, Transmed,
Valutico, Bold Lighting, Le Gray, SEVEN, RidgePoint) appear among the 53
real jobs ingested from Bayt/GulfTalent/Indeed this phase — zero
observed overlap in this small sample.

---

## Cost

| | |
|---|---|
| Requested | 10 items |
| Actually produced (before abort) | 978 items |
| Actual cost | **$1.4671** |
| Free follow-up reads (run status check, dataset sample) | $0 |
| **Total LinkedIn spend this phase** | **$1.4671** |

---

## Revised recommendation (supersedes Phase 20's "TEST FIRST")

**HOLD, do not implement as a production source without further
research.** Two independent problems, not one:

1. **Cost control**: the documented bounding parameter did not work as
   expected against the real actor — any future attempt needs the
   input schema reconfirmed live (free) before spending, with an
   explicit `maxTotalChargeUsd` cap in the request itself.
2. **Apply-link provenance**: a real 15-item sample showed 100%
   Easy-Apply-only postings — the one property this project's
   application flow cannot use. Needs a larger, differently-configured
   sample (or a different LinkedIn actor from Phase 20's comparison,
   e.g. `curious_coder`) to determine whether this is representative or
   an artifact of this particular query.

This remains research-only, exactly as instructed — no LinkedIn scraper
was or will be wired into production ingestion this phase.
