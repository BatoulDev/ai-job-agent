# Overnight Build — Credentials Required

Phase 01 (location normalization) is a pure, dependency-free TypeScript function — no API key, OAuth credential, Supabase secret, or external account was needed to build or test it.

## n8n credential: "Ingestion Worker Secret" (Bearer Auth) — required before any real (non-`dryRun`) run of "AI Job Agent / 01 Job Ingestion"

- Env var: `INGESTION_WORKER_SECRET` (server-only; already generated and set in this machine's `.env.local` — value not recorded here, never commit it)
- Needed for: `Call Ingestion Batch Endpoint` and `List Ingestion Sources` (Phase 04/12), plus three more nodes added in Phase 13's three-tier expansion — `Call Multi-Company Batch Endpoint`, `Call Extract Career Page Jobs Endpoint`, `Call Career Page Ingestion Batch Endpoint` — all in `n8n-workflows/ai-job-agent-01-job-ingestion.ts`/`.json`, all calling internal `/api/internal/ingestion/*` routes.
- Why: the n8n MCP cannot create credentials — only list/bind them (`n8n-credentials-and-security-official` skill). Every one of these nodes references the credential by the placeholder name `Ingestion Worker Secret`; **confirmed via `list_credentials` during Phase 13 that no credential of type `httpBearerAuth` exists in this n8n instance at all** — this is a real, still-open gap from Phase 04, not something Phase 13 introduced, but Phase 13 does widen its blast radius (5 nodes now depend on it instead of 2). A human must create the actual credential once, in the n8n UI, of type **Bearer Auth**, with the token value set to this machine's `INGESTION_WORKER_SECRET` value (read it from `.env.local`, never re-type/regenerate it), then attach it to all five nodes above. Until then, none of them have a bound credential and any real (non-mocked, non-pinned) execution will fail auth against the internal endpoints with 401.
- Where to add it: n8n UI → Settings → Credentials → New → Bearer Auth → name it exactly `Ingestion Worker Secret` → paste the `INGESTION_WORKER_SECRET` value from `.env.local` → attach to all five nodes listed above.
- Validation to run once added: open the workflow (`http://localhost:5678/workflow/I8WYkMfYCKug5ky4`), confirm `dryRun: true` in `Workflow Configuration`, run the Manual Trigger, confirm the execution succeeds and `public.jobs` is unchanged (`select count(*) from jobs;` before/after) — mirrors the retired pilot's own dry-run instructions (`docs/job-ingestion-pilot.md` §9).
- Not blocking: the workflow is created **inactive** with no schedule, and was fully validated via `test_workflow` with pinned/mocked HTTP data (see `docs/OVERNIGHT_BUILD_PROGRESS.md` Phase 04) — this credential is only needed for a human-initiated real run, not for the build itself.

## Resolved: embeddings architecture decision (Phase 05) — user chose "new n8n workflow, reuse existing OpenAI credential"

The user was asked directly (this was a genuine cost-bearing decision, not something to guess) and chose: build a new n8n workflow that reuses the OpenAI credential already configured in this instance ("OpenAI account", the same one `cv-analysis-worker.ts` uses), rather than issuing a new key to the Next.js app or switching to Google Gemini. This is **no longer blocked on a missing provider credential** — it only needs the same one-time manual credential-attachment step every internal n8n workflow in this build has needed.

## n8n credential: "Matching Worker Secret" (Bearer Auth) — required before any real run of "AI Job Agent / 02 Job Matching"

- Env var: `MATCHING_WORKER_SECRET` (server-only; already generated and set in this machine's `.env.local` — value not recorded here, never commit it)
- Needed for: **four** nodes total in `n8n-workflows/ai-job-agent-02-job-matching.ts`/`.json` — `Prepare Embeddings` and `Save Embeddings` (Phase 05), plus `Prepare Rerank` and `Save Rerank Result` (Phase 06, added in the same workflow's second stage) — which POST to `/api/internal/matching/{prepare-embeddings,save-embeddings,prepare-rerank,save-rerank-results}`.
- Why: same reason as `INGESTION_WORKER_SECRET` in Phase 04 — the n8n MCP cannot create credentials, only bind existing ones. A separate secret from `INGESTION_WORKER_SECRET` (least privilege — either can be rotated independently).
- Where to add it: n8n UI → Settings → Credentials → New → Bearer Auth → name it exactly `Matching Worker Secret` → paste the `MATCHING_WORKER_SECRET` value from `.env.local` → attach to all **four** nodes named above.
- Also verify: the `Generate Embeddings` node's (Phase 05) and the `Call OpenAI Chat` node's (Phase 06) `openAiApi` credential are both bound to the existing "OpenAI account" credential (should auto-bind since it's the only one of that type in this instance, but the workflow-creation/update responses reported every HTTP node needs manual credential confirmation — open the workflow and check all four).
- Validation to run once added: open the workflow (`http://localhost:5678/workflow/7CEh04hBepZkLCKl`), run the Manual Trigger, confirm the execution succeeds; check `public.jobs`/`public.cv_analyses` for newly-populated `embedding`/`profile_embedding` columns on rows that previously had none, and check `public.matches` for newly-scored rows.
- Not blocking: the workflow is created **inactive** with no schedule, and both stages were fully validated via `test_workflow` with pinned/mocked HTTP and OpenAI responses (embeddings: "has jobs to embed" and "nothing to embed"; rerank: "has candidates" with correct per-candidate vector/response mapping, and "no candidates") — this credential is only needed for a human-initiated real run.

## n8n credential: "Cover Letter Worker Secret" (Bearer Auth) — required before any real run of "AI Job Agent / 03 Cover Letter Generation"

- Env var: `COVER_LETTER_WORKER_SECRET` (server-only; already generated and set in this machine's `.env.local` — value not recorded here, never commit it)
- Needed for: the `Prepare Generation` and `Save Generation Result` nodes in `n8n-workflows/ai-job-agent-03-cover-letter-generation.ts`/`.json` (Phase 08), which POST to `/api/internal/cover-letters/{prepare-generation,save-generation}`.
- Why: same reason as every other `*_WORKER_SECRET` in this build — the n8n MCP cannot create credentials, only bind existing ones. A separate secret from `INGESTION_WORKER_SECRET`/`MATCHING_WORKER_SECRET` (least privilege).
- Where to add it: n8n UI → Settings → Credentials → New → Bearer Auth → name it exactly `Cover Letter Worker Secret` → paste the `COVER_LETTER_WORKER_SECRET` value from `.env.local` → attach to both nodes named above.
- Also verify: the `Call OpenAI Chat` node's `openAiApi` credential is bound to the existing "OpenAI account" credential (same one `cv-analysis-worker.ts` and the Phase 05/06 matching workflow already use).
- Validation to run once added: open the workflow (`http://localhost:5678/workflow/OmLtatSxRY4ErAxj`), run the Manual Trigger, confirm the execution succeeds; check `public.cover_letters` for newly-populated `generated_content` rows for previously-approved matches that had none.
- Not blocking: the workflow is created **inactive** with no schedule, and was fully validated via `test_workflow` with pinned/mocked OpenAI responses (both "has 1 candidate" — verified the candidate-to-response mapping survives the round trip via `get_execution` — and "no candidates", which short-circuits with zero unnecessary node executions) plus a live end-to-end smoke test against the real dev server and real local Postgres (unauthorized call rejected with 401; a real fixture candidate discovered, drafted, and persisted; a completed draft correctly excluded from the next discovery pass). This credential is only needed for a human-initiated real run.

## BLOCKED_ON_CREDENTIAL: real email provider for application sending (Phase 09) — not blocking, sending stays disabled tonight regardless

- Env var: none defined yet — no provider has been chosen.
- Needed for: `src/lib/applications/emailTransport.ts`'s `EmailTransport` interface has exactly one implementation right now (`MockEmailTransport`), which never makes a network call. `POST /api/internal/applications/send-pending-emails` always uses it.
- Why this is safe to leave unblocked: per explicit user instruction, real outbound application email sending must stay disabled tonight regardless of what's configured. Rather than build a real transport behind an env flag (which a misconfigured flag could accidentally enable), the real transport code simply does not exist in this codebase yet — a stronger guarantee than "disabled by default."
- Where to add it, when this is explicitly approved for a future phase: choose a transactional-email provider (e.g. Resend, SendGrid, AWS SES), add `EMAIL_PROVIDER_API_KEY` (server-only) to `.env.local`/`.env.example`, implement a second `EmailTransport` class calling that provider's API, and have the internal route choose it only behind an explicit, human-reviewed decision — never as an incidental side effect of unrelated work. `APPLICATION_WORKER_SECRET` (already generated, see below) does not need to change.
- Not blocking: `src/lib/applications/sendApplication.ts`'s full claim → build-payload → transport.send() → persist-outcome → audit-trail pipeline is fully built and tested (unit + DB + a live end-to-end smoke test against the real dev server and real local Postgres/Storage) using `MockEmailTransport` — the architecture is real and production-shaped; only the last-mile network call is deliberately absent.

## n8n credential: none needed for Phase 09

- Application sending intentionally has no n8n workflow (unlike ingestion/matching/cover-letters). There is no external rate-limited provider being orchestrated — the mock transport lives entirely inside the Next.js server, with no network call to manage retries/rate limits for. `POST /api/internal/applications/send-pending-emails` is callable directly (e.g. via `curl` with the `APPLICATION_WORKER_SECRET` Bearer token) by whoever needs to trigger a send-attempt pass, same as it would be from a future n8n workflow, a cron job, or a real background-job runner once a real provider exists.

## BLOCKED_ON_CREDENTIAL: Gmail API OAuth for automated outcome detection (Phase 10) — not blocking, manual tracking is the real feature tonight

- Env var: none defined yet — no OAuth client has been chosen/created.
- Needed for: an optional future extension to `public.application_outcomes` (`supabase/migrations/20260928100000_...sql`) that would suggest an outcome (interviewing/rejected/offer) by reading the user's inbox, instead of requiring the user to self-report.
- Why this is explicitly NOT built tonight, per direct product instruction: "any email/Gmail parsing must be optional and confidence-aware... do not infer application outcomes from weak evidence... keep uncertain events in manual-review/unknown state." `application_outcomes.source` currently only allows `'user_manual'` — there is no code path, credential, or schema value that could produce an inferred outcome. Manual self-reporting (`report_application_outcome()`) is the entire, real feature this phase ships.
- Where to add it, when this is explicitly approved for a future phase: a Gmail OAuth integration (read-only scope), a classifier producing a `confidence` score, a new allowed `source = 'email_detected'` value plus a `confidence` column on `application_outcomes`, and — critically — a UI that always shows low/medium-confidence detections as a suggestion the user must confirm, never as an assumed fact. Any detection below a deliberately-chosen confidence threshold must land in `'unknown'`, not a guessed status.

## BLOCKED_ON_CREDENTIAL: JSearch API key (Phase 12 source expansion)

- Env var: none defined yet — no key has been obtained.
- Needed for: a Tier C aggregator ingestion adapter covering Gulf/international job-board listings beyond direct-ATS coverage. Classified `BLOCKED_ON_CREDENTIAL` in `docs/SOURCE_COVERAGE_AND_PROVIDER_EXPANSION_AUDIT.md` §5/§6 — never invented, no placeholder key was ever added anywhere.
- Where to add it: obtain a key from RapidAPI's JSearch listing, add `JSEARCH_API_KEY` (server-only) to `.env.local`/`.env.example`, then wire it up behind the same evidence-based process (fixture tests, dry-run validation) as every other source.
- Not blocking: no code depends on this; the pipeline works today with zero JSearch integration. **Phase 13 update**: `src/lib/ingestion/providers/jsearch.ts` (`mapJSearchJob`) now exists, registered in `PROVIDER_ADAPTERS`, with fixture-based unit tests — but it is **NOT LIVE-VERIFIED** (see the file's own header comment). Field mapping follows JSearch's publicly documented schema, never exercised against a real call. `providerConfig.ts`'s `jsearch.enabled` stays `false` until a key exists and one real response has been checked against this file's field names.

## BLOCKED_ON_CREDENTIAL: Adzuna API credentials (Phase 12 source expansion)

- Env var: none defined yet — no App ID/key pair has been obtained.
- Needed for: same Tier C aggregator role as JSearch above, alternative/complementary coverage. Same classification and reasoning.
- Where to add it: register at Adzuna's developer portal, add `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` (server-only) to `.env.local`/`.env.example`, then wire it up behind the same evidence-based process.
- Not blocking: same as JSearch above. **Phase 13 update**: `src/lib/ingestion/providers/adzuna.ts` (`mapAdzunaJob`) exists and is registered, same NOT-LIVE-VERIFIED caveat as JSearch above — also confirm which target markets (Lebanon/Kuwait in particular) Adzuna actually supports once a key exists, since its country coverage was never confirmed this phase.

## Apify API token — already configured, currently unused (Phase 12 note, not a new blocker)

- Env var: `APIFY_API_TOKEN` — already present in `.env.local` (real, 46-char value) and now documented (name only, no value) in `.env.example`.
- Status: **not blocked on a credential** — the token exists. What's missing is an explicit, authorized, bounded benchmark run against the two real actors identified (`blackfalcondata/bayt-scraper`, `blackfalcondata/gulftalent-scraper`, ~$1/1000 results each) to measure cost/quality/freshness before either is wired into production ingestion. Zero Apify credits have been spent to date. **Phase 13 update**: unlike JSearch/Adzuna, no `mapBaytJob`/`mapGulfTalentJob` adapter was written — these Apify actors' real output field names have never been observed (zero runs to date), so writing a parser now would be inventing a schema, not reading one. `providerConfig.ts` lists `bayt`/`gulftalent` as `enabled: false` with this reasoning; the adapter should be written from a real benchmark run's actual output, not before. See `docs/PROVIDER_EXPANSION_IMPLEMENTATION.md` §"deferred providers" for the exact next step.

```
## <PROVIDER_NAME>

- Env var: `EXACT_ENV_VAR_NAME`
- Needed for: <which phase / which adapter or workflow>
- Why: <what breaks or stays fixture-only without it>
- Where to add it: `.env.local` (never committed) for local dev; the hosted deployment's environment-variable settings for production
- Validation to run once added: <exact command(s)>
```

Anticipated (not yet blocking, listed here for visibility only — do not create these until the phase that needs them is actually reached):

- An email-sending credential for the application-delivery flow (Phase 09) — must remain gated behind explicit per-message user approval regardless of whether it's configured.

(The former "Tier B ingestion source API keys, exact providers TBD" line above was superseded by Phase 12's concrete findings — see the two JSearch/Adzuna entries above and `docs/SOURCE_COVERAGE_AND_PROVIDER_EXPANSION_AUDIT.md`.)

None of the above blocks Phase 01 or the immediately following schema/eligibility work in Phase 02, which is pure logic over already-existing tables.
