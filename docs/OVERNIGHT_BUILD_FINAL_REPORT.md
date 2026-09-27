# Overnight Build — Final Report

11 phases, one linear branch chain, `main` untouched throughout. This document is the single source of truth for what got built, what's real, what's deliberately mocked, and what a human needs to do next. `docs/OVERNIGHT_BUILD_PROGRESS.md` has the full narrative detail per phase; this is the summary a founder can act on without reading all of it.

## 1. Branches and commits

Every branch forked from the immediately-previous phase's validated HEAD. None merged into `main`. All pushed to `origin`.

| Phase | Branch | HEAD commit |
|---|---|---|
| 01 — Location normalization | `phase/01-location-normalization` | `e42239d` |
| 02 — Job contract + hard eligibility | `phase/02-job-contract-eligibility` | `0b2e68a` |
| 03 — Ingestion core | `phase/03-ingestion-core` | `08984a1` |
| 04 — Ingestion providers + n8n | `phase/04-ingestion-providers` | `357357f` |
| 05 — Matching embeddings | `phase/05-matching-embeddings` | `6e7e1ff` |
| 06 — Matching rerank | `phase/06-matching-rerank` | `ee7bbee` |
| 07 — Match delivery | `phase/07-match-delivery` | `dd03bd9` |
| 08 — Cover letters | `phase/08-cover-letters` | `0588e3e` (includes a quota-enforcement follow-up fix) |
| 09 — Application delivery | `phase/09-application-delivery` | `8889fc0` |
| 10 — Application tracking | `phase/10-application-tracking` | `858364f` |
| 11 — E2E hardening | `phase/11-e2e-hardening` | `2b96c1c` |

**Verified explicitly this session**: `git log --all --graph --oneline` shows a perfectly linear chain with no branch forking from `main` after Phase 01. `origin/main` sits at `dc8c2c1` — the same commit it was at before this build started — untouched by any phase. No `git merge` into `main` was ever run. No `--force` push was ever used. No `vercel deploy` or other production-deployment command was ever run.

**Nothing here is merged into `main`.** Every phase branch is sitting on `origin`, ready for review and a real PR, in order. Merge them in order (01 → 11) — later phases assume earlier ones' schema/code exist.

## 2. What each phase actually shipped

- **01-02**: Pure, dependency-free location normalization and job-eligibility logic. No external dependencies, no credentials needed.
- **03-04**: Ingestion core (validation, dedup, idempotent upsert) + Greenhouse/Lever/Workable provider adapters + the "AI Job Agent / 01 Job Ingestion" n8n workflow.
- **05-06**: Job/profile embeddings (OpenAI `text-embedding-3-small`, batched) + in-process cosine-similarity shortlisting + LLM rerank (`gpt-4o-mini`) producing scored, explained matches. The "AI Job Agent / 02 Job Matching" n8n workflow (two stages).
- **07 — Match delivery**: Quota-aware match surfacing (`surface_new_matches_for_user()`) and a **real RLS bug found and fixed**: `get_my_matches()` now safely shows a user their own match even after the underlying job goes non-active, which the naive RLS policy alone could not do. Wired the New Matches / Approved / Rejected dashboard tabs to real data with working Approve/Reject.
- **08 — Cover letters**: AI-drafted cover letters (same OpenAI-via-n8n architecture as matching) for approved matches, with an edit/approve UI. **Caught and fixed its own quota gap** before Phase 09 started: `cover_letter_limit` existed in the schema but was never enforced.
- **09 — Application delivery**: The full send pipeline downstream of the pre-existing `create_application()` approval gate — preview, atomic-claim send worker, audit trail, retry-via-new-row. **Real outbound email sending does not exist in this codebase** — see §4.
- **10 — Application tracking**: Manual self-reported outcome tracking (`interviewing`/`rejected`/`offer`/`withdrawn`), a manual "I applied" confirmation for external-link jobs. **No email/Gmail parsing exists** — see §4.
- **11 — E2E hardening**: Playwright installed for real; 6 real-browser tests click through every flow Phases 07-10 built.

## 3. Test counts (all passing, this session's final run)

| Suite | Command | Result |
|---|---|---|
| Unit | `npm run test:unit` | **529 / 529** |
| Database (real local Postgres) | `npm run test:db` | **533 / 533**, 83 suites, zero fixture leakage |
| Workflow (static n8n JSON analysis) | `npm run test:workflow` | **340 / 340** |
| E2E (real Chromium + real dev server + real local Supabase) | `npm run test:e2e` | **6 / 6** |
| Type check | `npx tsc --noEmit` | clean |
| Lint | `npm run lint` | clean |
| Production build | `npm run build` | succeeds |

`npm test` runs unit + workflow + DB (1402 tests) and does not include `test:e2e`, which needs a live local Supabase instance and a real browser and is invoked separately.

## 4. Real vs. mocked — read this before assuming anything works in production

| Capability | Status |
|---|---|
| Job ingestion (Greenhouse/Lever/Workable) | **Real code**, real HTTP calls to the ATS APIs — validated via `test_workflow` with pinned data, never run for real (no `Ingestion Worker Secret` attached yet). |
| Embeddings + rerank (matching) | **Real code**, real OpenAI calls via n8n — validated via `test_workflow` with pinned data + one live end-to-end smoke test per phase. Never run for real against production job/user data. |
| Cover-letter generation | **Real code**, real OpenAI calls via n8n — same validation story as matching. |
| Application **preview** (recipient/subject/body) | **100% real** — built from the user's actual approved cover letter and actual job data, no mocking. |
| Application **send** (email) | **Architecture is real; the last-mile network call is not.** `MockEmailTransport` is the only `EmailTransport` implementation in this codebase. No credential, no flag, no code path can cause a real email send. This was an explicit, repeated safety instruction this session — verified via a real DB test proving the mock is what actually gets called, and a live smoke test proving no network call occurs. |
| Application **send** (external link) | Never automated at all, by design — the user is handed the real apply link and confirms manually via `mark_application_sent()`. |
| Application outcome tracking | **100% manual, self-reported.** No email/Gmail integration exists. `application_outcomes.source` is hard-restricted to `'user_manual'` at the schema level. |
| Dashboard UI (Approve/Reject/cover-letter edit/application prepare-and-send/mark-as-sent/outcome-reporting) | **Verified with real browser clicks** in Phase 11 (Playwright), not just route/RPC tests. |
| Any n8n workflow created this session | **Inactive.** None was ever published/activated. Each needs a one-time manual credential-attachment step in the n8n UI before a human-initiated real run (see §6). |

**No real job application, email, or message was ever sent to any external company or person during this entire build.**

## 5. Database changes (all migrations, in order, all applied and tested locally)

New tables: none in 01-06 beyond what embeddings needed; `application_outcomes` (Phase 10).
New/changed columns: `matches.surfaced_at` (07); `applications` unaffected (09 built entirely on the pre-existing schema).
New RPCs: `surface_new_matches_for_user()`, `get_my_matches()` (07); `mark_application_sent()`, `report_application_outcome()` (10).
Fixed constraints: `audit_events.event_type` check constraint extended to allow `application_outcome_reported` (10).

Every migration was applied via `npx supabase migration up` against the real local instance and exercised by real DB tests before being committed. None has been applied anywhere but this local machine.

## 6. Exact founder actions needed next

In rough priority order:

1. **Review and merge the phase branches into `main`, in order (01 → 11).** Nothing is merged yet. Open PRs for each, or fast-forward merge locally — either way, review the diffs first.
2. **Critical: address the pre-existing Next.js security vulnerability** flagged during Phase 11 (`npm audit`) — an unauthenticated RCE in the installed Next.js 16.0.0-16.3.2 range (Windows-hosted servers; AVIF image optimization). This pre-dates this session and was correctly left alone (upgrading Next.js is its own regression-tested change, not a drive-by fix), but it is a genuine pre-launch blocker. Run `npm audit` for the current detail and plan a deliberate Next.js upgrade + regression pass.
3. **Attach the four `*_WORKER_SECRET` Bearer Auth credentials in the n8n UI** before any real (non-test) worker run — `Ingestion Worker Secret`, `Matching Worker Secret`, `Cover Letter Worker Secret`. Exact steps and validation commands are in `docs/OVERNIGHT_CREDENTIALS_REQUIRED.md`. (Application sending has no n8n workflow — see below.)
4. **Decide if/when to build a real email-sending integration** for Phase 09. Nothing will send until this is deliberately built and approved — see `docs/OVERNIGHT_CREDENTIALS_REQUIRED.md`'s entry for the exact extension point (`EmailTransport`).
5. **Decide if/when to build automated email/Gmail-based outcome detection** for Phase 10. Manual tracking is fully real today; automated detection is explicitly deferred, not started, per the instruction to never infer outcomes from weak evidence.
6. **Real job-board/provider API keys** for any Tier-B ingestion sources beyond Greenhouse/Lever/Workable, if desired (Phase 04 note, still applicable).
7. **Run `npm run test:e2e` yourself at least once** after merging, to confirm the real-browser suite still passes in your own environment (it needs a local Supabase instance running and downloads a Chromium binary on first `npx playwright install chromium`).
8. **Seed real job data and run the ingestion → matching → cover-letter pipeline for real**, once credentials are attached, against a small controlled set before opening this to real users.

## 7. What was explicitly NOT done (by design, not oversight)

- No real email was sent, no real job application was submitted, no real message went to any external party, at any point.
- No n8n workflow was published or activated.
- No production deployment of any kind.
- No automated outcome inference from email content — manual self-reporting only.
- No Next.js upgrade (flagged for the founder to do deliberately, see §6).

## 8. Session limitations, disclosed

- The Claude-in-Chrome browser extension was unavailable for the entire session (`tabs_context_mcp` failed every time it was tried, across three separate phases). Phase 11 closed the resulting verification gap using a separately-installed local Playwright browser instead of that extension.
- All "real" OpenAI-calling and ATS-calling code paths were validated via n8n's `test_workflow` with pinned/mocked data and, for the internal endpoints, live smoke tests against the real dev server and real database — never against a real OpenAI/ATS call, since that would have real cost and no explicit approval was sought for that spend during the build.
