# Overnight Build — Credentials Required

Phase 01 (location normalization) is a pure, dependency-free TypeScript function — no API key, OAuth credential, Supabase secret, or external account was needed to build or test it.

## n8n credential: "Ingestion Worker Secret" (Bearer Auth) — required before any real (non-`dryRun`) run of "AI Job Agent / 01 Job Ingestion"

- Env var: `INGESTION_WORKER_SECRET` (server-only; already generated and set in this machine's `.env.local` — value not recorded here, never commit it)
- Needed for: the `Call Ingestion Batch Endpoint` node in `n8n-workflows/ai-job-agent-01-job-ingestion.ts`/`.json` (Phase 04), which POSTs to `/api/internal/ingestion/run-batch`
- Why: the n8n MCP cannot create credentials — only list/bind them (`n8n-credentials-and-security-official` skill). The workflow was created with `newCredential('Ingestion Worker Secret')` as a placeholder; a human must create the actual credential once, in the n8n UI, of type **Bearer Auth**, with the token value set to this machine's `INGESTION_WORKER_SECRET` value (read it from `.env.local`, never re-type/regenerate it), then attach it to the `Call Ingestion Batch Endpoint` node. Until then, that node has no bound credential and any real (non-mocked) execution will fail auth against the internal endpoint with 401.
- Where to add it: n8n UI → Settings → Credentials → New → Bearer Auth → name it exactly `Ingestion Worker Secret` → paste the `INGESTION_WORKER_SECRET` value from `.env.local` → attach to the node.
- Validation to run once added: open the workflow (`http://localhost:5678/workflow/I8WYkMfYCKug5ky4`), confirm `dryRun: true` in `Workflow Configuration`, run the Manual Trigger, confirm the execution succeeds and `public.jobs` is unchanged (`select count(*) from jobs;` before/after) — mirrors the retired pilot's own dry-run instructions (`docs/job-ingestion-pilot.md` §9).
- Not blocking: the workflow is created **inactive** with no schedule, and was fully validated via `test_workflow` with pinned/mocked HTTP data (see `docs/OVERNIGHT_BUILD_PROGRESS.md` Phase 04) — this credential is only needed for a human-initiated real run, not for the build itself.

## Embeddings provider — `BLOCKED_ON_CREDENTIAL` for actually generating any real embedding (Phase 05)

- Env var: none yet — no name has been chosen because no provider has been chosen.
- Needed for: calling a real `EmbeddingGenerator` (the interface `src/lib/matching/embedJob.ts` and `embedProfile.ts` are built against) from either the Next.js app or a new n8n workflow.
- Why blocked, specifically: confirmed by grep that **no OpenAI (or any embeddings-provider) key is configured for the Next.js app** — `grep -c OPENAI .env.local` and `.env.example` both return 0. The only OpenAI access anywhere in this project is the n8n credential named "OpenAI account", used exclusively inside `cv-analysis-worker.ts`'s own HTTP node, not reachable from `src/`. Unlike every credential-free decision in Phases 01–04 (pure logic, or public ATS reads with zero cost), this is the build's first genuinely cost-bearing external dependency — every embedding call costs real money per job/profile, at a volume this session cannot responsibly estimate or approve on the user's behalf.
- What is and isn't built pending this: `src/lib/matching/{embeddingText,cosineSimilarity,embedJob,embedProfile,shortlist}.ts` are all complete, unit- and DB-tested (against a deterministic fake generator, no real API calls) — the entire pipeline works end-to-end except for the one function that actually calls a real embeddings API. Wiring a real provider in later is a single new `EmbeddingGenerator` implementation passed to `embedJobIfChanged`/`embedProfileIfEligible` — no other code changes.
- Open decision this session is **not** making unilaterally (needs the user): which provider/model (e.g. OpenAI `text-embedding-3-small` reusing the existing n8n OpenAI credential vs. Google's embedding model via the existing n8n Gemini credential vs. a new key issued directly to the Next.js app), and where the actual API call should live — inside a new n8n workflow (consistent with Phase 04's "n8n owns provider calls" pattern, and able to reuse the existing OpenAI/Gemini n8n credentials without issuing a new one) vs. a server-only key added directly to `.env.local`/production env for the Next.js app to call directly.
- Where to add it once decided: `.env.local` (never committed) for local dev if the Next.js app calls the provider directly; or bind the existing n8n "OpenAI account"/"Google Gemini(PaLM) Api account" credential to a new embedding-generation workflow if n8n should own the call instead.
- Validation to run once added: `node --test tests/db/matching-embeddings.test.mjs` continues to pass unmodified (it tests the orchestration, not the provider); additionally, manually embed one real fixture job and profile, confirm the returned vector's length matches the chosen model's dimensions, and confirm `embedding_content_hash` correctly skips a second identical call.

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
