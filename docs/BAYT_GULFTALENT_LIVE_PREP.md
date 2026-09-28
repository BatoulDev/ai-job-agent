# Bayt + GulfTalent Live Validation — Read-Only Preparation (Phase 19)

Branch: `phase/19-bayt-gulftalent-readonly-prep`, forked from `main` @
`f1e2a6b` (Phases 15-18 merged). **This phase is read-only preparation
only.** Zero Apify credits were spent. No live Bayt/GulfTalent actor was
run. Neither provider was enabled. No credential was created, bound, or
modified. No n8n workflow was activated or changed. Nothing was deployed.
No PR was opened.

Everything below was re-verified fresh against the real current repository
and the real live n8n instance this phase — nothing is carried over from
memory of earlier phases without being re-checked.

---

## 1. Current real repository state (re-verified, not assumed)

- `src/lib/ingestion/providers/bayt.ts` and `gulftalent.ts` exist, unchanged
  in shape since Phase 16, with one real addition this phase (§2).
- `providerConfig.ts`: `bayt.enabled === false`, `gulftalent.enabled ===
  false` — confirmed by direct read, not assumed.
- `getEnabledMultiCompanyFeedSources()`
  (`src/lib/ingestion/multiCompanyFeedUrls.ts`) hardcodes its iteration to
  `["remoteok", "jobicy", "arbeitnow"]` and its `buildFeedUrl()` switch
  returns `null` for every other `sourceType` in the `default` case —
  **Bayt/GulfTalent are structurally invisible to n8n's source-discovery
  endpoint (`/list-sources`) regardless of their `enabled` flag.**
- `runMultiCompanyIngestionBatch()` (`ingestSourceBatch.ts`) calls
  `isProviderEnabled(sourceType)` and returns
  `emptyResult("provider_not_enabled", ...)` — writing **zero rows** —
  before touching validation or the database, on every single call, live,
  never cached. This is real code, re-read this phase, not a
  characterization from an old report.
- The live n8n workflow "AI Job Agent / 01 Job Ingestion"
  (`I8WYkMfYCKug5ky4`), fetched fresh via `get_workflow_details` this
  phase: **`active: false`**, 49 nodes, no Bayt/GulfTalent node exists
  anywhere in it. `Extract Raw Jobs By Provider Type`'s switch has exactly
  3 real cases (`remoteok`/`jobicy`/`arbeitnow`) plus its fallback —
  confirmed by reading the live `parameters.rules.values` array directly,
  not the repo file.

## 2. What is already implemented

- `mapBaytJob()` / `mapGulfTalentJob()` — pure field-mapping functions,
  written from each actor's own published Store-page output schema
  (`docs/LEBANON_GULF_SOURCE_RESEARCH.md` §5), never exercised against a
  real call.
- **This phase's one real code change**: both raw-job interfaces gained a
  documented-but-previously-uncaptured field —
  `BaytRawJob.careerLevel` and `GulfTalentRawJob.seniority` — found during
  this phase's re-audit (Task A/B) by comparing the current adapters
  against the actor documentation already saved in
  `docs/LEBANON_GULF_SOURCE_RESEARCH.md` §5, which explicitly lists a
  career-level/seniority field for both actors that neither adapter
  previously captured at all. **Not mapped to the canonical `seniority`
  enum** — see the Live Schema Validation Checklist (§4) for why.
- Provider-agnostic downstream: dedup, idempotent upsert, and stale-close
  (`persistValidatedJobs()`, shared with every other Tier A/D provider) —
  unchanged, already proven correct against real Workable duplicate data
  in Phase 14 (Bug #2) and against 7 real providers' idempotency in
  Phases 14/17. Bayt/GulfTalent will use this exact same code path with
  zero special-casing once enabled.
- Matching/eligibility handoff (`checkJobEligibility()`,
  `shortlistJobsForUser()`) — provider-agnostic by construction, already
  proven working end-to-end for real Tier A/D jobs in Phases 14/17. No
  Bayt/GulfTalent-specific code exists or is needed here.

## 3. What is not yet live

- Zero real HTTP calls have ever been made to either Apify actor from
  this codebase.
- No Apify actor-run node exists in the n8n workflow.
- No credential of any kind for Apify exists in this workflow (the
  `APIFY_API_TOKEN` env var is confirmed present in this project's local
  environment from the earlier company-discovery pilot, but no n8n
  credential object references it for job-listing extraction).
- Both providers' real output schema remains unverified — every field
  name in `bayt.ts`/`gulftalent.ts` is still "documented, not observed."

---

## Task A — Field-by-field adapter audit

### `mapBaytJob()` (`providers/bayt.ts`)

| Canonical field | Source | Behavior |
|---|---|---|
| `externalId` | directly sourced (`raw.jobId`) | Nullable → empty string when absent; `validateRawProviderJob` then rejects `missing_external_id` |
| `companyName` | directly sourced (`raw.company`, trimmed) | Nullable → `null`; `validateMultiCompanyProviderJob` rejects `missing_company_name` |
| `title` | directly sourced (`raw.title`) | Nullable → `null`; rejected `missing_title` |
| `description` | directly sourced, normalized deterministically (`stripHtml()`) | Nullable source → empty string; rejected `missing_description` |
| `rawLocation` | normalized deterministically — prefers `raw.location`; falls back to `[city, country].join(", ")` | Nullable → `null` when none of the 3 fields present. **Never inferred beyond joining what's given.** |
| `country_code` / `city` / `work_arrangement` | **not set by the adapter at all** — derived downstream by `normalizeLocation(rawLocation, providerWorkArrangement)` | Nullable, fails closed on any ambiguous/unrecognized text (verified this phase against real Arabic-script input in Phase 17, applies identically here) |
| `providerWorkArrangement` | directly sourced, normalized deterministically (`raw.isRemote === true ? "remote" : null`) | Nullable → `null`. **`isRemote: false` and `isRemote` absent both map to the same `null`, not `"onsite"`** — an explicit false-ish value is deliberately not treated as "confirmed onsite," since the actor's schema doesn't distinguish "not remote" from "workplace unstated." |
| `employmentType` | directly sourced, normalized deterministically via a fixed map (`"Full Time"→"full-time"`, etc.) | Nullable → `null`; an unrecognized string also → `null`, never guessed |
| `seniority` | **always `null`** | `raw.careerLevel` is now captured (§2) but not mapped — real value vocabulary unknown |
| `publishedAt` | directly sourced (`raw.postedDate`) | Nullable → `null`, passed through verbatim (no date parsing/validation in the adapter itself) |
| `applicationUrl` | directly sourced — prefers `raw.applyUrl`, falls back to `raw.url` | Nullable → `null`; rejected `missing_application_target` if both `applicationUrl` and `applicationEmail` are absent |
| `applicationEmail` | **always `null`** — the actor's schema has no email field | N/A |
| `sourceListingUrl` | directly sourced (`raw.url`) | Nullable → `null` |
| `dedup_scope` | **not set by the adapter** — `source_id` is always `null` for multi-company feeds, so the DB's generated column resolves to `'type:bayt'` for every job from this provider | Not nullable — deterministic |

### `mapGulfTalentJob()` (`providers/gulftalent.ts`)

| Canonical field | Source | Behavior |
|---|---|---|
| `externalId` | directly sourced — prefers `raw.jobId`, falls back to `raw.jobKey` | Nullable → empty string when both absent; rejected `missing_external_id` |
| `companyName` | directly sourced (`raw.company`, trimmed) | Nullable → `null`; rejected `missing_company_name` |
| `title` | directly sourced | Nullable → `null`; rejected `missing_title` |
| `description` | directly sourced, normalized deterministically (`stripHtml()`) | Nullable → empty string; rejected `missing_description` |
| `rawLocation` | directly sourced (`raw.location`, trimmed) — **no city/country fallback join** (the actor's schema, per research, returns one combined location string, unlike Bayt's separate fields) | Nullable → `null` |
| `country_code` / `city` / `work_arrangement` | not set by the adapter — derived downstream by `normalizeLocation()`, identical mechanism to Bayt | Nullable, fails closed |
| `providerWorkArrangement` | **always `null`** — the actor's documented schema has no remote/work-arrangement field at all | N/A — never inferred from `title`/`description` text (explicitly tested this phase, §Task F) |
| `employmentType` | directly sourced, same fixed map as Bayt | Nullable → `null` |
| `seniority` | **always `null`** | `raw.seniority` is now captured (§2) but not mapped — same reasoning as Bayt's `careerLevel` |
| `publishedAt` | directly sourced (`raw.postedAt`) | Nullable → `null`, passed through verbatim |
| `applicationUrl` | directly sourced (`raw.applyUrl`) — **no secondary `url` field exists in this actor's schema** (unlike Bayt) | Nullable → `null`; rejected `missing_application_target` if absent |
| `applicationEmail` | always `null` | N/A |
| `sourceListingUrl` | directly sourced (`raw.applyUrl`, same value as `applicationUrl` — the actor's schema has no separate listing-page URL distinct from the apply link) | Nullable → `null` |
| `dedup_scope` | same mechanism as Bayt → `'type:gulftalent'` | Deterministic |

**Summary of nullable-when-absent fields for both**: `rawLocation`,
`providerWorkArrangement`, `employmentType`, `seniority` (always),
`publishedAt`, `applicationUrl`/`sourceListingUrl`. **Never inferred**:
location, work arrangement, seniority — confirmed by direct code reading
and by the new tests in §Task F.

---

## Task B — Live Schema Validation Checklist

To be run during the next phase's live benchmark, one line per real field
this adapter currently trusts blind:

- [ ] **Bayt**: confirm `jobId` is present and stable across re-runs of the
      same job (idempotency depends on this).
- [ ] **Bayt**: confirm `company`, `title`, `description` are non-empty for
      a representative sample (validation will otherwise silently reject
      real jobs).
- [ ] **Bayt**: confirm `location`/`city`/`country` field names and
      formatting match what `buildRawLocation()` expects — inspect at
      least one Lebanon, one Saudi, one UAE, one Qatar, one Kuwait result.
- [ ] **Bayt**: confirm `applyUrl`/`url` resolve to real, live, fetchable
      pages (apply-URL audit, same discipline as Phase 17 §4).
- [ ] **Bayt**: inspect real `careerLevel` values — decide whether a safe,
      evidence-based mapping to this project's `seniority` enum is
      possible, or whether it should stay unmapped.
- [ ] **Bayt**: confirm `isRemote`'s real semantics (does `false` mean
      "confirmed onsite" or "not specified"? — currently treated as the
      latter, conservatively).
- [ ] **GulfTalent**: confirm `jobId`/`jobKey` stability and which one is
      actually populated in practice.
- [ ] **GulfTalent**: confirm `location` field's real format (single
      combined string, per research — verify this holds for all 5 target
      markets, not just the ones sampled during research).
- [ ] **GulfTalent**: confirm whether a work-arrangement/remote signal
      exists anywhere in the real response that research missed — if so,
      a mapping can be added; if genuinely absent (as documented),
      `providerWorkArrangement` correctly stays `null` forever for this
      provider.
- [ ] **GulfTalent**: inspect real `seniority` values, same decision as
      Bayt's `careerLevel`.
- [ ] **Both**: confirm no field name has silently changed since the
      actors' Store pages were read in Phase 15 (a real risk — these are
      third-party-maintained scrapers, not a stable first-party API).
- [ ] **Both**: confirm a genuine duplicate `external_id` within one real
      batch is handled correctly by the existing shared de-dup logic
      (Bug #2 fix, Phase 14) — this is architecturally proven already
      (shared code path with RemoteOK/Jobicy/Arbeitnow/Workable), but a
      real observation during the live run should still be logged.

**What counts as schema drift**: any of the above fields missing entirely
from a real response, present under a different name, or holding a
structurally different shape (e.g. `location` becoming an object instead
of a string) than what `bayt.ts`/`gulftalent.ts` currently assume.

**What must be fixed before activation**: any drift affecting
`externalId`, `title`, `description`, `companyName`, or
`applicationUrl`/`applyUrl` (the fields `validateRawProviderJob`/
`validateMultiCompanyProviderJob` actually enforce) — a drift here means
real jobs would be silently rejected or, worse, mis-mapped. Drift in
`seniority`/`careerLevel` is lower priority — the field already safely
defaults to unmapped.

---

## Task C — Live benchmark plan (design only, not executed)

| | Bayt | GulfTalent |
|---|---|---|
| Actor | `blackfalcondata/bayt-scraper` | `blackfalcondata/gulftalent-scraper` |
| Proposed `maxItems` | 50-100 | 50-100 |
| Target geography | Run once per market where feasible: Lebanon, Saudi Arabia, UAE, Qatar, Kuwait — or one combined run with a location filter per the actor's real input schema (to be confirmed against its real input fields at run time) | Same |
| Expected cost guard | ~$0.99/1k results × (50-100)/1000 ≈ **$0.05-0.10 per market run** (well under $1 total even across all 5 markets) | ~$0.70-0.75/1k × same bound ≈ **$0.04-0.08 per market run** |
| Timeout guard | Apify actor run timeout set explicitly (a reasonable default, e.g. 5-10 minutes, not unbounded) | Same |
| Stop conditions | Stop immediately if: cost exceeds the pre-approved ceiling; the actor returns 0 items; the actor errors; a single run's item count is wildly inconsistent with research (e.g. 10x more/fewer than the ~716/~477 real listings observed in Phase 15 research) | Same |
| Required fields to inspect | Every field in Task A's tables, for a representative sample (not just item 1) | Same |
| Schema drift definition | See Task B | Same |
| Must-fix-before-activation | See Task B | Same |

**This plan is not executed in this phase.** No actor was called, no
`maxItems` was actually set anywhere live, no cost was incurred.

---

## Task D — Provider activation guard

**Confirmed**: `providerConfig.ts` has `bayt.enabled === false` and
`gulftalent.enabled === false` — re-verified by direct read this phase,
unchanged since Phase 16.

**Existing guard, confirmed real and working (not assumed)** — two
independent layers, both re-read this phase:

1. **Discovery layer**: `getEnabledMultiCompanyFeedSources()` cannot
   surface Bayt/GulfTalent even if `enabled` were flipped to `true` — its
   provider iteration is hardcoded to `["remoteok", "jobicy",
   "arbeitnow"]` and its URL-builder has no case for either (Apify actor
   runs need a fundamentally different HTTP shape than a plain GET, so
   there was never a URL to construct here in the first place).
2. **Persistence layer**: `runMultiCompanyIngestionBatch()` calls
   `isProviderEnabled(sourceType)` live, on every call, and returns
   `provider_not_enabled` with zero writes if disabled — even for a
   hand-crafted request that bypassed discovery entirely.

**Smallest safe addition made this phase** (a test guard, not new
production code — the existing guard was already sufficient):
`tests/db/ingest-multi-company-batch.test.mjs` gained two new, explicitly
named tests (`"Bayt is rejected before any write..."`,
`"GulfTalent is rejected before any write..."`) proving the persistence-
layer guard by name for these two specific providers, rather than relying
only on the existing generic `jsearch` example. `enabled: true` was never
set anywhere.

---

## Task E — n8n workflow preparation

Inspected the live workflow fresh this phase (§1) — confirmed no
Bayt/GulfTalent node exists, `active: false`, no new credential referenced
anywhere. **No node was added this phase.**

**Why not**: adding real HTTP Request nodes for an Apify actor call
requires a credential reference (even an unbound placeholder name) and a
concrete input-body shape — and that exact shape depends on fields (the
real Apify actor's accepted input parameters, e.g. location filters) that
have never been confirmed against live documentation with the same rigor
as everything else in this project. Building the nodes now, before the
live benchmark confirms the real input/output contract, risks having to
rebuild them next phase anyway — the Production Automation Engineer
skill's "make the smallest safe change" and "avoid unnecessary changes"
principles both favor designing the structure on paper now and building
it once, correctly, next phase.

**How Bayt/GulfTalent will enter the existing modular flow, once live
(design, not built)**:

Mirrors the existing Tier D pattern exactly — a new branch parallel to
RemoteOK/Jobicy/Arbeitnow inside the same `Extract Raw Jobs By Provider
Type` switch, or (more likely, since an Apify actor call is structurally
different from a plain GET) a new small sub-branch before that switch:

```
Split Out Multi-Company Sources
  → Loop Multi-Company Sources (Rate Limited)     [existing, unchanged]
    → [NEW] Call Apify Actor (bayt / gulftalent)  — HTTP Request node,
         POST https://api.apify.com/v2/acts/{actorId}/run-sync-get-dataset-items?token={credential}
         body: { <real input fields, confirmed next phase>, maxItems: 50-100 }
         onError: continueErrorOutput → Build Multi-Company Failure Result [existing]
    → [NEW] Extract Bayt/GulfTalent Jobs — Set node, rawJobs: {{ $json }}
         (the endpoint returns a bare array like RemoteOK's, or an
         object — confirmed next phase; if bare array, may need an
         Aggregate node mirroring Aggregate Lever Jobs's Phase 14 fix)
    → Call Multi-Company Batch Endpoint             [existing, unchanged —
         same endpoint every other Tier D provider already uses]
```

Credential: a new n8n credential (name only, e.g. `"Apify API Token"`,
type `httpBearerAuth` or `httpQueryAuth` depending on Apify's real auth
convention — to be confirmed, not guessed) would need to be created
**manually in the n8n UI** by the founder, per this project's established
convention (the n8n MCP cannot create credentials) — not done this phase.

**If the workflow already contained the correct nodes/paths, they would
not have been rebuilt** — it does not, so there was nothing to preserve
here; this section is a design for next phase, not a workflow change.

---

## Task F — Tests added this phase (fixture-based only, no live calls)

`tests/unit/ingestion-providers.test.mjs` (+10 tests) and
`tests/db/ingest-multi-company-batch.test.mjs` (+2 tests):

- Canonical mapping (already existed, re-verified passing).
- Missing location → `null`, never guessed (both providers).
- Missing work arrangement → `null` (Bayt: `isRemote` absent; GulfTalent:
  always, including when title text says "Remote" — proves no text-based
  inference happens).
- Missing application URL → `null`, correctly rejected by validation
  (both providers).
- Malformed/empty payload (`{}`) → never throws, produces an all-null
  shape, correctly rejected (`missing_company_name`, the multi-company
  validator's first check).
- Duplicate external IDs — not re-tested per-provider at the DB layer
  (§Task B explains why: the guard means Bayt/GulfTalent cannot reach the
  persistence layer while disabled, and the underlying de-dup fix lives in
  the shared `persistValidatedJobs()` core already proven against real
  Workable duplicate data in Phase 14 — provider-agnostic by
  construction, no new risk here).
- Arabic location text / Gulf-Lebanon location normalization — not
  duplicated per-provider; both adapters pass `rawLocation` straight to
  the shared, already-tested `normalizeLocation()` (Phase 17 proved this
  fails closed on real Arabic-script text generically, for any provider).
- Provider disabled state — both discovery-layer (existing) and
  persistence-layer (new, named) guards covered.

All new tests pass (§Validation).

---

## Task G — Matching handoff preparation

No change needed, none made. Once real Bayt/GulfTalent jobs are persisted
via the existing, unchanged `persistValidatedJobs()` → `jobs` table path,
they flow through the exact same, already-proven eligibility chain as
every other provider:

- `checkJobEligibility()` reads `country_code`/`work_arrangement`/
  `remote_scope`/`locationConfidence` off the stored row — it has no
  provider-specific logic and needs none added.
- Student Lebanon / Pro Lebanon / Pro Gulf with relocation / Pro Gulf
  without relocation / international remote — all proven working against
  real Tier A/D data in Phases 14 and 17 (`docs/
  LEBANON_GULF_INGESTION_VALIDATION.md` §7). Bayt/GulfTalent jobs with
  correctly-resolved location/work-arrangement data will be handled
  identically, automatically, with zero new code.
- **Real risk to watch for next phase**: if Bayt/GulfTalent's real
  `rawLocation` text doesn't normalize cleanly (e.g. Arabic-heavy real
  listings, unusual city/country formatting), jobs may land in
  `pending_review` or fail eligibility the same honest way Oracle's
  Lebanon jobs did in Phase 17 (missing work-arrangement data) — not a
  bug, the same fail-closed behavior proven correct throughout this
  build. Confirm this is watched for and does not need a rule change.

No commercial plan rule was touched or needs to be.

---

## Task H — this document

You're reading it.

---

## Validation actually run this phase (no external paid calls)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run test:unit` | **646/646** (10 new) |
| `npm run test:workflow` | 360/360 (unchanged — no n8n workflow file touched) |
| `npm run test:db` | **544/544** (2 new; excludes nothing external-paid — this project's DB tests only ever touch the real local Postgres, never a real Apify/third-party call) |
| `npm run build` | succeeds |

No test in this suite calls Apify, Bayt, or GulfTalent for real, at any
point — confirmed by design (every Bayt/GulfTalent test in this repo is a
pure fixture-based unit test or a persistence-layer guard test that
returns before any HTTP call would occur).

## Explicit confirmations

- **Bayt `enabled`: `false`** — unchanged this phase.
- **GulfTalent `enabled`: `false`** — unchanged this phase.
- **Zero live Apify Bayt/GulfTalent runs were made this phase.**
- **Zero Apify credits were spent this phase.**
- No credential was created, bound, or modified.
- No token, real or placeholder, was written anywhere in this repository.
- The n8n workflow was inspected (read-only) and remains `active: false`,
  unmodified.
- No PR was opened; no branch was merged.

## Exact remaining action once the Apify token is provided

1. Create the Apify credential manually in the n8n UI (founder-only step —
   the n8n MCP cannot create credentials).
2. Run the bounded benchmark exactly as designed in Task C (50-100 items
   per actor, cost ceiling under $1 total).
3. Walk the Live Schema Validation Checklist (Task B) against the real
   output; fix any drift found in `bayt.ts`/`gulftalent.ts`.
4. Build the real n8n nodes per Task E's design, using the now-confirmed
   real input/output shapes (not the placeholder design above).
5. Flip `providerConfig.ts`'s `enabled: true` for whichever provider(s)
   passed validation.
6. Run the same real-execution + idempotency + apply-URL + matching-
   handoff validation this build used for every other provider (Phases
   14/17's methodology) before considering either provider production-
   ready.
