# Overnight Build — Credentials Required

None yet. Phase 01 (location normalization) is a pure, dependency-free TypeScript function — no API key, OAuth credential, Supabase secret, or external account was needed to build or test it.

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
- Embeddings/LLM provider keys for matching and rerank (Phases 05–06) — likely already available via existing CV Analysis Worker credentials; to be confirmed by inspecting that worker's configuration before assuming a new key is needed.

None of the above blocks Phase 01 or the immediately following schema/eligibility work in Phase 02, which is pure logic over already-existing tables.
