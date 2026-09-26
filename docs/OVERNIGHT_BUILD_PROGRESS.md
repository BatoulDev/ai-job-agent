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

## Remaining phases (not yet started)

02 job-contract-eligibility · 03 ingestion-core · 04 ingestion-providers+n8n · 05 matching-embeddings · 06 matching-rerank · 07 match-delivery · 08 cover-letters · 09 application-delivery · 10 application-tracking · 11 e2e-hardening.
