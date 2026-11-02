# Implementation Changelog

Append-only record of implementation checkpoints. `docs/PRODUCTION_READINESS.md` is the authoritative source of truth for current verified status — this file records what happened, in order, for history.

---

## 2026-11-02 — Account deletion reauthentication + UI, privacy policy update, job-source email-vs-link investigation

### Founder-approved decisions acted on this session

- Account deletion is immediate after reauthentication + final confirmation — no 30-day wait.
- Password accounts require a fresh password re-entry; Google accounts require a fresh Google reauthentication. An existing session alone is never sufficient.
- Retain only legally-required payment/accounting records; minimize everything else; never invent a retention period.
- Request deletion from external AI providers where supported; accurately disclose retention limitations outside this app's control; never promise immediate external-vendor deletion.

### Features implemented (local, tested, NOT yet deployed)

1. **Session-freshness reauthentication gate** (`src/lib/account/sessionFreshness.ts`, new) — decodes the `iat` claim already on the session's own access token; a session is "fresh" within 5 minutes of (re-)issuance. No new reauth-token table.
2. **`POST /api/account/reauthenticate`** (new route) — password-account reauthentication: verifies the caller's own current password via `signInWithPassword` against their own session-derived email (never a client-supplied email), rate-limited and user-id-keyed.
3. **`account_reauth` rate-limit action** (`supabase/migrations/20261102090000_add_account_reauth_rate_limit.sql`) — extends the existing generalized auth-rate-limit infrastructure with one new allowed action, following the exact pattern of the existing `password_update` action.
4. **Google-account reauthentication** — `src/lib/authRateLimit/startGoogleOAuth.ts` gained optional `redirectTo`/`forceConsent` parameters so the existing login/signup OAuth flow can be reused, forcing Google's consent screen (`prompt=consent`) to prove a genuinely fresh sign-in rather than a silent session reuse. Default login/signup behavior is unchanged.
5. **`POST /api/account/delete`** (modified) — now requires the freshness check above before calling the existing, unchanged `deleteAccount()` cascade; signs the session out on success.
6. **`/settings/delete-account`** (new page + `DeleteAccountForm.tsx` client component) — branches the reauthentication step on the account's provider (password vs. Google), then a final step requiring both an explicit acknowledgement checkbox and typing `DELETE`, with loading/error/success states. Linked from a new "Danger zone" card on `/settings/profile`.
7. **Privacy Policy update** (`src/app/privacy/page.tsx`) — named the AI model provider as OpenAI specifically (previously generic), described immediate self-service deletion instead of only a contact-email request, and added a line on external-AI-provider retention being outside this app's control. Support-contact email remains a clearly-marked placeholder (not invented).

### Investigation findings (no code change required)

- **AI providers in actual use today**: OpenAI only (confirmed by reading `n8n-workflows/cv-analysis-worker.ts`, `ai-job-agent-02-job-matching.ts`, `ai-job-agent-03-cover-letter-generation.ts` — `gpt-4o` for CV analysis, `gpt-4o-mini` for rerank, `text-embedding-3-small` for embeddings, all via `api.openai.com`). No Anthropic or other provider call exists anywhere in this codebase. Historical docs mentioning "Anthropic and OpenAI" do not reflect current reality.
- **Job-source application emails**: every one of the 15 configured provider adapters (`src/lib/ingestion/providers/*.ts`) hardcodes `applicationEmail: null`. No admin-entry or career-page-extraction path populates one either. **No currently-ingestible source provides a verified employer application email — every job can only reach the database via `application_method = 'url'`, or be rejected.** The email-send pipeline (`buildApplicationEmailPayload`, `attemptSendApplicationEmail`) is real, tested, and schema-ready, but unreachable against live ingestion data today. Full source-by-source detail is in `docs/PRODUCTION_READINESS.md` Phase 4 and `src/lib/ingestion/providerConfig.ts`'s own inline documentation.
- **Email application sending**: unchanged since the 2026-10-27 Phase 3 session. `MockEmailTransport` remains the only transport implementation; no credential, flag, or code path exists that could cause a real external send. Per-application cover-letter approval is already enforced at the data layer.
- **Payment retention**: no real payment processor is integrated (`checkout.ts`/`whish/provider.ts` only; the latter throws on every real operation). The previously-proposed `payment_attempts.user_id` → `on delete set null` migration was NOT applied — the question is moot until a real processor exists.

### Files changed this session

**Created:**
- `supabase/migrations/20261102090000_add_account_reauth_rate_limit.sql`
- `src/lib/account/sessionFreshness.ts`
- `src/app/api/account/reauthenticate/route.ts`
- `src/app/settings/delete-account/page.tsx`
- `src/app/settings/delete-account/DeleteAccountForm.tsx`
- `tests/unit/session-freshness.test.mjs`
- `docs/IMPLEMENTATION_CHANGELOG.md` (this file)

**Modified:**
- `src/lib/authRateLimit/rateLimit.ts` — added `account_reauth` action + `account_reauth_user` policy.
- `src/lib/authRateLimit/startGoogleOAuth.ts` — added optional `redirectTo`/`forceConsent` parameters.
- `src/app/api/account/delete/route.ts` — added the session-freshness reauthentication gate and a sign-out on success.
- `src/app/settings/profile/page.tsx` — added a "Danger zone" link to `/settings/delete-account`.
- `src/app/privacy/page.tsx` — see "Privacy Policy update" above.
- `docs/ACCOUNT_DELETION_DESIGN.md` — appended the founder's 2026-11-02 decisions and implementation status; original 2026-08-24 design record preserved unchanged.
- `docs/PRODUCTION_READINESS.md` — added a "Phase 4" section; two older rows in the "unchanged this phase" historical table got a one-line forward pointer to Phase 4, their original text otherwise preserved.

**Pre-existing, unrelated working-tree changes** (present before this session started, on branch `audit/live-n8n-ingestion-readiness`, not touched or reviewed as part of this checkpoint): ingestion/matching-related modifications across `src/lib/ingestion/*`, `src/lib/matching/*`, `src/app/api/internal/*`, and their tests. Several other untracked files (`docs/WORKDAY_SUBPHASE_2C_INGESTION_PILOT_PLAN.md`, `docs/LINKEDIN_EXTERNAL_ID_CONVENTION.md`, `scripts/cleanup-remediation-fixtures.mjs`, `src/lib/matching/revalidateJobEligibility.ts`, etc.) were also already present and are likewise untouched.

### Database changes

- One new migration (`20261102090000_add_account_reauth_rate_limit.sql`), applied to the **local** Supabase instance only (via `supabase migration up --local`) to run the DB test suite. **NOT applied to any production database.** Reversible: a follow-up migration could drop the `account_reauth` value from the two check constraints and recreate the two functions without it; no data is written by this migration itself beyond the constraint/function definitions.
- No other schema changes. The `applications.approved_by`/`registry_sync_staging.resolved_by` FK proposal from 2026-08-24 remains proposed-only, not applied.

### Tests and results (this session, local machine)

- `npm run test:unit` — **1091/1091 passed** (includes 7 new tests in `tests/unit/session-freshness.test.mjs`).
- `npm run test:workflow` — **510/510 passed**.
- `npm run test:db` — **709/709 passed**, run against the local Supabase instance after applying the new migration; zero fixture leakage confirmed by the runner's own post-run verification. Includes the pre-existing `tests/db/account-deletion-cascade.test.mjs` and `tests/db/delete-account-route-logic.test.mjs`, unaffected by this session's changes.
- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors, 0 warnings.
- `npm run build` — succeeds; `/settings/delete-account` and `/api/account/reauthenticate` both compiled as expected.
- **NOT run**: Playwright E2E for the new delete-account flow (no test written yet for it this session). No GitHub-Actions-hosted CI run was observed or triggered this session.

### Known limitations / explicitly not done this session

- The new account-deletion UI is reachable in the local dev build but has not been deployed, has no E2E coverage, and has not received explicit founder sign-off to expose to real users.
- Privacy Policy is still a draft: placeholder support email, no legal review.
- No change was made to any n8n workflow (source or live) — the AI-provider finding is a read-only confirmation of what the existing workflows already do.
- No ingestion provider was enabled/disabled; the job-source email finding required no code change because the existing code already correctly rejects/routes every job without inventing an email.
