# Overnight Build Progress Log

Living log for the provider-first job-ingestion → matching → cover-letter → application-delivery build. Append one entry per completed phase; never rewrite a prior entry except to correct a factual error (note the correction inline, don't silently edit history).

Companion doc: `docs/OVERNIGHT_CREDENTIALS_REQUIRED.md` (every credential a later phase is blocked on).

---

## Session start — 2026-09-26

- Starting branch: `claude/eloquent-pascal-2neuec` (== `main` @ `dc8c2c1`, "Merge pull request #28 from BatoulDev/feat/provider-first-clean-architecture").
- Verified `feat/provider-first-clean-architecture` is **already merged** into `main` (identical diff, zero delta) — it is not a separate unmerged checkpoint to fork from. All phase branches fork from `main`.
- Existing relevant docs read before starting: `docs/PRODUCTION_READINESS.md`, `docs/job-ingestion-pilot.md`, `docs/job-ingestion-database-readiness-audit.md`, `docs/job-source-discovery/` (registry CSVs + `discovery-report.md`), `AGENTS.md` §34 guardrails. These already contain a large amount of ingestion/provider research — new research docs (`N8N_TEMPLATE_RESEARCH.md`, `JOB_PROVIDER_MATRIX.md`) are written to extend that record, not duplicate it, and only once actually produced.
- **Environment constraints discovered and worked around/documented, not silently bypassed:**
  - No `supabase` CLI available and no local Postgres running in this sandbox → no live `public.jobs` rows to query. Phase 01 fixtures use real location strings drawn from `docs/job-source-discovery/*.csv` (company/source registry, not job postings) plus synthetic edge cases, and this gap is recorded rather than papered over.
  - `node_modules` was not installed at session start (`npm run lint` / `npx tsc --noEmit` both failed on unrelated pre-existing files with module-not-found errors). Fixed with `npm ci` before running any validation — this was an environment setup gap, not a code defect.
  - `npm run build` fails at the page-data-collection step with `Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL` — this is `src/lib/supabase/env.ts` correctly fail-closing per AGENTS.md §21 (no insecure fallback), not a bug. No live Supabase project is reachable from this sandbox to supply real values, and none should be invented. Recorded as a standing limitation for every phase's "build" validation step below, not re-explained each time.

---

## Phase 01 — Location normalization

- **Branch**: `phase/01-location-normalization`, forked from `main` @ `dc8c2c1`.
- **Files added**:
  - `src/lib/ingestion/normalizeLocation.ts` — pure, deterministic `normalizeLocation()`. Input: raw location string + optional provider work-arrangement hint. Output: `rawLocation`, `countryCode` (ISO 3166-1 alpha-2, matches `public.countries.code`), `city`, `workArrangement` (matches `public.jobs.work_arrangement` check constraint: `remote | onsite | hybrid | flexible`), `remoteScope` (free-form, matches `public.jobs.remote_scope`'s intentionally-unconstrained design), `relocationSignal` (`true | false | null`), `locationConfidence` (`high | medium | low`). No DB access, no network, no AI. Also exports `isLowConfidenceLocation`, `isGccCountryCode`, `isMenaCountryCode` helpers for Phase 02's eligibility logic to reuse.
  - `tests/unit/normalize-location.test.mjs` — 27 tests covering: null/empty input, real registry-derived Lebanon/Saudi/Qatar/Kuwait/UAE city+country strings, work-arrangement detection (remote/hybrid/onsite/flexible, provider-hint precedence), remote-scope detection (worldwide/region:gcc/region:mena/country-scoped/no-scope), multi-region fail-closed behavior (never guesses a single country from ambiguous text), relocation-signal detection (positive/negative/unmentioned), and determinism (same input ⇒ deep-equal output).
- **Design decisions and why:**
  - Country/city dictionary is deliberately scoped to the product's five supported markets (Lebanon, Saudi Arabia, Qatar, Kuwait, UAE) plus a short list of high-frequency international-remote-scope countries (US/UK/Canada/Germany/India/France) — extending coverage later means adding dictionary rows, not touching calling code (AGENTS.md §16 maintainability guardrail).
  - Multiple distinct countries detected in one string (e.g. "Beirut, Dubai, or Riyadh") never collapses to a single guessed country — `countryCode`/`city` are `null` and confidence is `low`, so Phase 02's hard-eligibility logic fails closed on it rather than trusting a coin-flip pick.
  - A bare `"Remote"` with no scope signal is `medium` confidence (a real, partial signal), not `low` — reserving `low` for genuinely unrecognized/ambiguous text. This distinction matters for Phase 02, which is expected to treat `low` as "needs human review before matching," not `medium`.
- **Validation actually executed** (this session, after `npm ci` fixed the missing `node_modules`):
  - `npx eslint src/lib/ingestion/normalizeLocation.ts tests/unit/normalize-location.test.mjs` → clean.
  - `npm run lint` (whole repo) → clean.
  - `npx tsc --noEmit` (whole repo) → clean.
  - `npm run test:unit` → **332/332 passing** (27 new + all pre-existing unit tests, confirming no regression/collision).
  - `npm run build` → **not executed to completion** — fails at page-data collection on missing `NEXT_PUBLIC_SUPABASE_URL` (pre-existing environment limitation described above, unrelated to this phase's files, which are not yet imported anywhere in the app).
  - `npm run test:workflow` / `npm run test:db` → not run for this phase (no files touched under `n8n-workflows/` or the database; Phase 01 added a pure TS module and its unit test only).
- **Not done in this phase, by design**: no DB writes, no schema changes, no import of `normalizeLocation` into any route or worker yet (Phase 02/03 will consume it). No credentials were needed.
- **Ending commit**: recorded after commit below.

---

## Phase 02 — Job contract + hard eligibility

- **Branch**: `phase/02-job-contract-eligibility`, forked from `phase/01-location-normalization` @ `e42239d` (verified ancestor via `git merge-base --is-ancestor`). `main` untouched throughout, still at `dc8c2c1`.
- **Schema investigation first** (per AGENTS.md §17 — never code a significant feature without understanding the real data flow): read `supabase/migrations/20260809090030_create_jobs.sql`, `20260914120000_add_jobs_freshness_and_geography.sql`, `20260902090010_plan_aware_job_preferences.sql`, `20260902090000_add_relocation_market_catalog.sql`, `20260806090060_restructure_job_preferences_work_arrangement.sql`, and the generated `src/lib/supabase/database.types.ts` `jobs` Row type. Conclusion: **no new "job contract" type or migration is needed.** `public.jobs` already has every field the phase's task description asked for (`country_code`, `city`, `work_arrangement`, `remote_scope`, `relocation_required`, `application_email`, `application_method`, `application_url`, `source_id`, `source_type`, `source_url`, freshness/staleness timestamps). Inventing a parallel contract type would violate AGENTS.md §16 ("do not duplicate existing fields unnecessarily"). Same conclusion for entitlements: `public.plans` (`job_match_limit`, `cover_letter_limit`) and `job_preferences` (`job_market_coverage`, `international_search_enabled`, `willing_to_relocate`, `work_authorization_status`, `job_preference_relocation_locations`, `job_preference_authorized_countries`) already implement almost exactly the plan/relocation model this phase's task description asked for — confirmed quotas (free 1/1, student 25/8, pro 45/15) match AGENTS.md §6 exactly, no drift.
- **Files added**:
  - `src/lib/ingestion/jobEligibilityLocation.ts` — adapts a `public.jobs`-shaped row (`location`, `country_code`, `city`, `work_arrangement`, `remote_scope`) into the location shape eligibility needs. Trusts already-populated structured columns (curated/admin-entered rows); falls back to Phase 01's `normalizeLocation()` against the raw `location` text only when those are absent — one derivation path, not two sources of truth.
  - `src/lib/ingestion/checkJobEligibility.ts` — pure `checkJobEligibility()`: given a job's derived location + a user's `planCode`/`jobMarketCoverage`/`internationalSearchEnabled`/`willingToRelocate`/selected relocation-market country codes, returns `{ eligible, reason }`. No AI, no DB access — a deterministic gate that must run before the (future) embedding/rerank steps ever see a job.
  - `tests/unit/check-job-eligibility.test.mjs` — 29 tests across: fail-closed baseline (low confidence, unknown arrangement), Lebanon onsite/hybrid open to every plan, foreign onsite/hybrid gated step-by-step through the Pro relocation path (plan → international flag → willing-to-relocate → market actually selected), remote-scope Lebanon-inclusivity (worldwide/country:LB/region:mena eligible for Free; region:gcc and a single foreign country not, since Lebanon isn't GCC), and all four `job_market_coverage` tiers for Pro.
- **Design decisions and documented assumptions** (AGENTS.md §15/§17: "choose the conservative reversible implementation, document the assumption, continue"):
  - A Pro user who never explicitly set `job_market_coverage` (column stays null until they do) is treated identically to `remote_lebanon_applicants` — never silently upgraded to broader coverage they didn't ask for.
  - The `remote_worldwide` tier accepts a remote job whose scope names one specific non-MENA country (e.g. "Remote — US only") rather than hard-filtering it out. Rationale: that tier's own name and its position as the widest Pro option imply "show the widest net," with actual applicant-eligibility nuance left to the job description/match reasoning, not a hard gate. This is a genuine judgment call on ambiguous scope text, not a certainty — flagged here explicitly rather than presented as an obvious fact. A genuinely unresolvable scope (`null`) still fails closed even at this tier.
  - `work_authorization_status` (`needs_employer_support` / `already_authorized` / `unsure`) is deliberately **not** used as a hard-eligibility gate in this phase — it's informational for later cover-letter/application messaging (Phase 08/09), not a filter on which jobs a user is shown. Noted here in case a future phase's design assumes otherwise.
- **Tooling issue found and fixed (not a business-logic change):** these are the first two pure lib modules in the repo that (a) import a sibling module by a real (non-type-only) relative specifier and (b) are unit-tested by directly executing the `.ts` file via `node --test` (no bundler in that path). Node's ESM resolver requires an explicit, real extension for relative specifiers; `tsc` under `moduleResolution: "bundler"` normally rejects a literal `.ts` extension. Fixed by adding `"allowImportingTsExtensions": true` to `tsconfig.json` — the standard, narrowly-scoped TS option for exactly this case, valid only because `noEmit` is already `true` project-wide (already was, unchanged). This does not relax type-checking or strictness (AGENTS.md §2) — it only permits an additional, explicit import-specifier style; every existing extensionless relative import elsewhere in the repo continues to resolve exactly as before (re-verified: full `tsc --noEmit` and `npm run lint` clean after the change).
- **Validation actually executed:**
  - `node --test tests/unit/check-job-eligibility.test.mjs` → 29/29 passing.
  - `npm run lint` (whole repo) → clean.
  - `npx tsc --noEmit` (whole repo) → clean.
  - `npm run test:unit` → **361/361 passing** (29 new + all pre-existing, including Phase 01's 27 — no regressions).
  - `npm run build` → reaches the same pre-existing `NEXT_PUBLIC_SUPABASE_URL` gate as Phase 01 (this run stopped at a different route, `/api/auth/forgot-password`, confirming the failure is route-collection-order-dependent, not specific to any one route or to this phase's files) — same documented sandbox limitation (no live Supabase reachable), not a regression: TypeScript compilation itself (`Compiled successfully` / `Finished TypeScript`) passed before that unrelated step.
  - `npm run test:workflow` / `npm run test:db` → not run (no `n8n-workflows/` or database changes this phase).
- **Not done in this phase, by design**: no persistence/writes, no embeddings, no n8n workflow. `checkJobEligibility` is not yet wired into any route or worker — that starts in Phase 03.
- **Ending commit**: recorded after commit below.

---

## Remaining phases (not yet started)

02 job-contract-eligibility · 03 ingestion-core · 04 ingestion-providers+n8n · 05 matching-embeddings · 06 matching-rerank · 07 match-delivery · 08 cover-letters · 09 application-delivery · 10 application-tracking · 11 e2e-hardening.
