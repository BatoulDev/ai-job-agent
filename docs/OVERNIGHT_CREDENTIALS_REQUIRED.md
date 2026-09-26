# Overnight Build — Credentials Required

Phase 01 (location normalization) is a pure, dependency-free TypeScript function — no API key, OAuth credential, Supabase secret, or external account was needed to build or test it.

## n8n credential: "Ingestion Worker Secret" (Bearer Auth) — required before any real (non-`dryRun`) run of "AI Job Agent / 01 Job Ingestion"

- Env var: `INGESTION_WORKER_SECRET` (server-only; already generated and set in this machine's `.env.local` — value not recorded here, never commit it)
- Needed for: the `Call Ingestion Batch Endpoint` node in `n8n-workflows/ai-job-agent-01-job-ingestion.ts`/`.json` (Phase 04), which POSTs to `/api/internal/ingestion/run-batch`
- Why: the n8n MCP cannot create credentials — only list/bind them (`n8n-credentials-and-security-official` skill). The workflow was created with `newCredential('Ingestion Worker Secret')` as a placeholder; a human must create the actual credential once, in the n8n UI, of type **Bearer Auth**, with the token value set to this machine's `INGESTION_WORKER_SECRET` value (read it from `.env.local`, never re-type/regenerate it), then attach it to the `Call Ingestion Batch Endpoint` node. Until then, that node has no bound credential and any real (non-mocked) execution will fail auth against the internal endpoint with 401.
- Where to add it: n8n UI → Settings → Credentials → New → Bearer Auth → name it exactly `Ingestion Worker Secret` → paste the `INGESTION_WORKER_SECRET` value from `.env.local` → attach to the node.
- Validation to run once added: open the workflow (`http://localhost:5678/workflow/I8WYkMfYCKug5ky4`), confirm `dryRun: true` in `Workflow Configuration`, run the Manual Trigger, confirm the execution succeeds and `public.jobs` is unchanged (`select count(*) from jobs;` before/after) — mirrors the retired pilot's own dry-run instructions (`docs/job-ingestion-pilot.md` §9).
- Not blocking: the workflow is created **inactive** with no schedule, and was fully validated via `test_workflow` with pinned/mocked HTTP data (see `docs/OVERNIGHT_BUILD_PROGRESS.md` Phase 04) — this credential is only needed for a human-initiated real run, not for the build itself.

## Resolved: embeddings architecture decision (Phase 05) — user chose "new n8n workflow, reuse existing OpenAI credential"

The user was asked directly (this was a genuine cost-bearing decision, not something to guess) and chose: build a new n8n workflow that reuses the OpenAI credential already configured in this instance ("OpenAI account", the same one `cv-analysis-worker.ts` uses), rather than issuing a new key to the Next.js app or switching to Google Gemini. This is **no longer blocked on a missing provider credential** — it only needs the same one-time manual credential-attachment step every internal n8n workflow in this build has needed.

## n8n credential: "Matching Worker Secret" (Bearer Auth) — required before any real run of "AI Job Agent / 02 Job Matching"

- Env var: `MATCHING_WORKER_SECRET` (server-only; already generated and set in this machine's `.env.local` — value not recorded here, never commit it)
- Needed for: the `Prepare Embeddings` and `Save Embeddings` nodes in `n8n-workflows/ai-job-agent-02-job-matching.ts`/`.json`, which POST to `/api/internal/matching/prepare-embeddings` and `/api/internal/matching/save-embeddings`
- Why: same reason as `INGESTION_WORKER_SECRET` in Phase 04 — the n8n MCP cannot create credentials, only bind existing ones. A separate secret from `INGESTION_WORKER_SECRET` (least privilege — either can be rotated independently).
- Where to add it: n8n UI → Settings → Credentials → New → Bearer Auth → name it exactly `Matching Worker Secret` → paste the `MATCHING_WORKER_SECRET` value from `.env.local` → attach to both the `Prepare Embeddings` and `Save Embeddings` nodes.
- Also verify: the `Generate Embeddings` node's `openAiApi` credential is bound to the existing "OpenAI account" credential (should auto-bind since it's the only one of that type in this instance, but the workflow-creation response reported all three HTTP nodes need manual credential confirmation — open the workflow and check).
- Validation to run once added: open the workflow (`http://localhost:5678/workflow/7CEh04hBepZkLCKl`), run the Manual Trigger, confirm the execution succeeds; check `public.jobs`/`public.cv_analyses` for newly-populated `embedding`/`profile_embedding` columns on rows that previously had none.
- Not blocking: the workflow is created **inactive** with no schedule, and was fully validated via `test_workflow` with pinned/mocked HTTP and OpenAI responses (both the "has jobs to embed" and "nothing to embed" branches) — this credential is only needed for a human-initiated real run.

This file will gain one entry per credential a later phase is `BLOCKED_ON_CREDENTIAL` for, in this format:

```
## <PROVIDER_NAME>

- Env var: `EXACT_ENV_VAR_NAME`
- Needed for: <which phase / which adapter or workflow>
- Why: <what breaks or stays fixture-only without it>
- Where to add it: `.env.local` (never committed) for local dev; the hosted deployment's environment-variable settings for production
- Validation to run once added: <exact command(s)>
```

Anticipated (not yet blocking, listed here for visibility only — do not create these until the phase that needs them is actually reached):

- Job-board/provider API keys for Tier B ingestion sources (Phase 04) — exact providers not yet chosen; recorded once the provider research doc names them.
- Any Apify or structured-scraping provider token, if research recommends one over direct ATS APIs (Phase 04).
- An email-sending credential for the application-delivery flow (Phase 09) — must remain gated behind explicit per-message user approval regardless of whether it's configured.
- LLM provider key for rerank (Phase 06) — the embeddings entry above already confirmed no OpenAI key is reachable from the Next.js app; the same investigation applies here once Phase 06 starts.

None of the above blocks Phase 01 or the immediately following schema/eligibility work in Phase 02, which is pure logic over already-existing tables.
