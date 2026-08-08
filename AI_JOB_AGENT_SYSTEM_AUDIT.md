# AI Job Agent — System Architecture Audit

**Audit date:** 2026-08-08
**Repository:** `c:\Users\Laptop Pro\Projects\ai-job-agent` (remote `origin` = `https://github.com/BatoulDev/ai-job-agent.git`)
**Branch at time of audit:** `fix/news-page-brief-loading`
**Audit type:** Read-only. No application code, migrations, or database objects were modified. No destructive or write SQL was executed. No real AI/email/job-source/external API calls were made. No Docker containers were started or stopped (the local Supabase stack was already running).

---

## 1. Executive Summary

AI Job Agent is a pre-MVP Next.js 16 / Supabase application. Today it implements, end to end and with genuinely careful security engineering: signup/login, session refresh, a private CV upload pipeline, a reference-data-backed preferences form, a subscription/plan/payment-attempt foundation, and a CV-analysis **task queue schema** (no worker yet). It does **not yet implement** job ingestion, matching, scoring, cover-letter generation, the approve/reject/send pipeline, applications, notifications, or an admin role model — none of these have any database table, RPC, or route today. Everything the dashboard shows for matches, cover letters, "approved," "sent," and "rejected" is hardcoded mock data, and the code says so in its own comments.

The parts that exist are built unusually defensively: every user-owned table has RLS with `auth.uid()`-scoped policies, every privileged write path is a narrowly-scoped `SECURITY DEFINER` function with `EXECUTE` revoked from `public` and granted only to `service_role`, the CV storage bucket is private with folder-scoped object policies, server routes re-derive the authenticated user from the session rather than trusting client input, and the local database exactly matches the migration history (34/34 migrations applied, no drift). The service-role key is never referenced from client code, and the separate news-integration database uses its own distinct, anon-only, non-`NEXT_PUBLIC_` credentials — properly isolated from the main application database.

The most important blockers before CV/job-matching automation work begins are not security defects in what exists — they are **missing schema**: there is no `jobs`, `matches`, `cover_letters`, `applications`, `notifications`, `admin/role`, or `audit_events` table anywhere in the 34 migrations or the live database. Automation cannot be "connected" to a pipeline that has no destination tables yet. Secondary, real findings: four to six high-severity `npm audit` advisories (including Next.js itself, fixed in 16.3.0), no server-side file-signature validation for CV uploads (MIME-type only), a self-documented schema conflict on `cvs` that blocks CV replacement/versioning, no security headers configured, no automated test suite, and a live risk that the in-progress `/news` page changes will break the CI build because required env vars aren't set in `ci.yml`.

**Overall verdict: GO WITH REQUIRED FIXES.** The existing surface (auth, RLS, storage, subscriptions, CV upload, onboarding readiness) is solid enough to build on. CV-analysis automation specifically can begin once a small, well-scoped set of P0/P1 items are resolved — see Section 19 and Section 20.

---

## 2. Audit Scope and Limitations

- Strictly read-only: SELECT-only SQL against `information_schema`/`pg_catalog`/`pg_policies`/`pg_indexes`/`storage.*`; no `INSERT`/`UPDATE`/`DELETE`/`DDL` executed anywhere; no `supabase db reset`/`push`/`repair`; no Docker start/stop (the stack was already running and healthy — confirmed via `docker ps`).
- All in-progress user changes (modified/untracked files on `fix/news-page-brief-loading`) were read but never staged, committed, stashed, or modified. Verified via `git status` at the start and end of this audit (Section 3, Section 19).
- No secret values were displayed, logged, or copied at any point — only environment variable **names** were inspected (`.env.example`, `.env.local` key names via `grep -oE '^[A-Z_]+='`).
- `npm run build` was **not executed** — see Section 15 for why (real risk of an external network call to the separate news Supabase project during static generation, plus a real risk the build fails outright because `.github/workflows/ci.yml` does not set `NEWS_SUPABASE_URL`/`NEWS_SUPABASE_ANON_KEY`). This is reported as a finding, not fabricated as a pass or fail.
- No real AI, email, job-source, or payment-provider calls were made; `scripts/seed-local-automation-users.mjs` was read but never executed.
- The local Supabase Postgres database was **empty** (0 rows in every table, confirmed by `COUNT(*)`), so no personal/CV data was ever at risk of exposure during this audit.
- Where evidence could not be obtained (e.g., production database state, production env values, production CI history), this report says **"Not verified"** rather than inferring from `DATABASE_PLAN.md` or other documentation.

---

## 3. Repository and Runtime State

- **Repo root:** `C:/Users/Laptop Pro/Projects/ai-job-agent`, confirmed a git repo via `git rev-parse --show-toplevel`.
- **Branch:** `fix/news-page-brief-loading`. **Remote:** `origin` → `https://github.com/BatoulDev/ai-job-agent.git` (fetch+push).
- **git status** (matches the pre-supplied summary exactly, re-verified independently):
  - Modified: `AGENTS.md`, `next.config.ts`, `src/app/news/page.tsx`, `src/lib/dailyNews/getLatestDailyNewsBriefs.ts`
  - Deleted: `src/lib/supabase/publicClient.ts`
  - Untracked: `daily-news-migrations-report.md`, `src/components/news/`, `src/lib/dailyNews/estimateReadingTime.ts`, `src/lib/dailyNews/formatBriefDate.ts`, `src/lib/supabase/newsClient.ts`, `src/lib/supabase/newsEnv.ts`
  - None of these were touched by this audit.
- **Recent history** (`git log --oneline -15`): a small, linear history of squash-merged feature branches (`subscriptions-payment-foundation` → `cv-analysis-profile` → `onboarding-profile-review-flow` → `preferences-reference-data` → current news-page fix), consistent with the branch list supplied.
- **Stack:** Next.js `16.2.10` (App Router, "proxy" middleware convention), React `19.2.4`, TypeScript `^5` (strict), Tailwind CSS `^4`, `@supabase/ssr ^0.12.2`, `@supabase/supabase-js ^2.110.5`. No AI SDK, no email SDK, no job-board SDK, no queue/worker library is installed — confirms no automation exists yet at the dependency level.
- **Local Supabase/Docker stack:** running and healthy (`docker ps`): `supabase_db`, `supabase_studio`, `supabase_pg_meta`, `supabase_storage`, `supabase_rest`, `supabase_realtime`, `supabase_inbucket` (Mailpit), `supabase_auth` (GoTrue), `supabase_kong` — all `Up ... (healthy)`. `supabase status` additionally reports **stopped**: `imgproxy`, `edge_runtime`, `analytics`, `vector`, `pooler` — none of these are required for anything currently implemented. An unrelated `n8n` container exists on the host (`Exited`), presumably for future automation work; it was not started or touched.
- **Supabase CLI:** `2.109.1` (installed devDependency, invoked via `npx`), local Postgres **17.6**, matching `supabase/config.toml`'s `major_version = 17`.
- **Migration state:** `npx supabase migration list --local` reports all **34 migrations** present with identical `local` and `remote` (i.e., locally-applied) timestamps — the live local database exactly matches the migration history in the repo. No drift.
- **Database row counts** (aggregate `COUNT(*)` only, no row contents read): every application table — `profiles`, `cvs`, `job_preferences`, `subscriptions`, `payment_attempts`, `analysis_tasks`, `cv_analyses`, `daily_news_briefs`, `daily_news_items`, `auth.users` — returned **0**. The database is empty; nothing sensitive was ever exposed.

---

## 4. Current Architecture

**Feature readiness:**

| Product capability | Current state | Evidence | Missing work | Priority |
|---|---|---|---|---|
| Signup / login / logout | Implemented and connected | `src/app/signup/page.tsx`, `src/app/login/page.tsx` call real `supabase.auth.signUp`/`signInWithPassword`; `src/lib/supabase/session.ts` + `src/proxy.ts` enforce session refresh and route gating | Password reset (`href="#"` placeholder, login/page.tsx:96) | P1 |
| Profile row on signup | Implemented and connected | `handle_new_user()` trigger, migration `20260714153102` — SECURITY DEFINER, no client insert path exists | — | — |
| CV upload (private storage) | Implemented and connected | `src/app/onboarding/upload-cv/page.tsx`, bucket `cvs` (`public=false`), storage policies in `20260714153105` | Server-side file-signature validation (Section 11, SEC-05) | P1 |
| CV metadata/versioning | Implemented but incomplete | `cvs.version`/`is_active`/`superseded_at` columns exist (`20260805090010`) but no "Replace CV" code path uses them yet; migration self-documents a schema conflict (Section 7) | Replace-CV server action + drop `cvs_user_id_key` | P1 |
| CV text extraction | Missing | No column, function, or route performs extraction; `cv_analyses.extracted_text` exists as a destination only | Full extraction pipeline | P1 (automation) |
| AI CV parsing / structured profile | Missing (schema only) | `cv_analyses` table (`20260804090010`) is schema-only per its own comment: "no worker, AI provider call... is built by this migration" | AI worker, validated output writer | P1 (automation) |
| User review/confirmation of AI profile | UI-only / placeholder | `src/components/dashboard/cvProfile/*` render `review_status` states, but no endpoint exists that lets a user set `review_status`/`user_edits`/`approved_at` — confirmed no INSERT/UPDATE RLS policy on `cv_analyses` for `authenticated` | Validated review/approve API (server-derives `auth.uid()`, never trusts client id) | P0 (before "approve" can mean anything) |
| Job preferences | Implemented and connected | `save_job_preferences()` RPC (`20260806090100`), reference-data-backed (countries/universities/majors/target_roles/locations), server-enforced eligibility trigger (`20260806090090`) | — | — |
| Job ingestion (admin/approved sources) | Missing | No `jobs` table, no `job_sources` table, no admin insert path anywhere in 34 migrations | Full schema + admin auth model | P0 (automation) |
| Duplicate job detection | Missing | No dedup key/table exists | Schema + logic | P1 (automation) |
| Job expiry/lifecycle | Missing | No `jobs.status`/`expires_at` exists | Schema | P1 (automation) |
| CV/profile-to-job matching + scoring | Missing | No `matches` table exists | Schema + worker | P0 (automation) |
| Cover letter generation | Missing | No `cover_letters` table exists; dashboard cover-letter preview is mock text in `src/lib/dashboardData.ts` | Schema + worker, fact-grounding rules | P0 (automation) |
| Approve/reject flow | UI-only / placeholder | `ApprovedSection.tsx`/`RejectedSection.tsx` render hardcoded `APPROVED_JOB`/`REJECTED_JOB` constants with a non-functional "Review application" button | Real `matches`/`applications` tables + approval endpoint | P0 |
| Application sending + tracking | Missing | No `applications` table; no email-sending code anywhere in `src/` | Schema + idempotent sender, explicit-approval gate | P0 (automation) |
| Notification/email delivery log | Missing | No table | Schema | P1 (automation) |
| Admin access model | Missing | No `is_admin` column, no `roles`/`user_roles` table anywhere (grepped `is_admin|role.*admin|admin_role|user_roles` across `*.ts,*.tsx,*.sql` — only match is an unrelated `provider` check-constraint string) | Admin role table/claim + authorization checks | P0 (before any admin feature) |
| Audit history (approvals/sends) | Missing | No `audit_events`/equivalent table | Schema | P1 (automation) |
| Subscriptions / plans / payments | Implemented and connected (schema + checkout stub) | `plans`/`subscriptions`/`payment_attempts` tables, `create_payment_attempt`/`mark_payment_verified`/`activate_subscription` RPCs, all `SECURITY DEFINER` and role-gated | Real Whish integration (`src/lib/payments/whish/provider.ts` throws `WhishNotConfiguredError` on every real operation by design — no official Whish docs/credentials yet) | P2 (business-blocked, not code-blocked) |
| Daily AI/tech news | Implemented and connected (external DB) | `src/app/news/page.tsx` (ISR, `revalidate=3600`) → `getLatestDailyNewsBriefs()` → `createNewsClient()` against a **separate** Supabase project (Section 11, NEWS-01) | CI env vars for the new code path (Section 15) | P1 |
| Dashboard stats grid | UI-only / placeholder | `DASHBOARD_STATS` in `src/lib/dashboardData.ts` is a hardcoded array (`"New matches": "3"`, `"Average match score": "84%"`, etc.), rendered unconditionally regardless of real user state | Compute from real data once matches exist | P1 |

---

## 5. End-to-End Product Flow

Signup → profile/subscription auto-created (trigger) → CV upload (private storage + `cvs` row) → preferences (`save_job_preferences` RPC) → `/api/onboarding/complete` calls `get_onboarding_readiness()` and, if eligible, enqueues an `analysis_tasks` row → **dead end**: nothing ever claims or processes that task → dashboard renders **entirely mock** match/approve/sent/rejected data, gated behind a `isProfileApproved` check that is admitted in code comments to be "never actually true for a real user today" (`src/app/dashboard/page.tsx:236-238`).

| Step | State |
|---|---|
| Landing page | Connected and functional |
| Signup / login | Connected and functional (password reset missing) |
| Protected dashboard routing (`src/proxy.ts`) | Connected and functional |
| CV upload | Connected and functional (see SEC-05 for a gap) |
| CV text extraction | Missing |
| AI CV parsing | Missing |
| Profile review/confirmation | UI only (no backing write API) |
| Preferences | Connected and functional |
| Job ingestion | Missing |
| Job matching / scoring | Missing |
| Match display | UI only (mock data) |
| Cover letter generation/edit | UI only (mock preview text) |
| Approve / reject | UI only (buttons are non-functional; no state mutation) |
| Application sending | Missing |
| News page | Connected and functional (external DB), pending CI env-var fix |
| Admin job entry | Missing (no admin role, no route, no table) |

---

## 6. Local Docker Database Inventory

**Containers** (all healthy, none restarted by this audit): `supabase_db_ai-job-agent` (Postgres 17.6.1.143), `supabase_studio_ai-job-agent`, `supabase_pg_meta_ai-job-agent`, `supabase_storage_ai-job-agent` (v1.62.5), `supabase_rest_ai-job-agent` (PostgREST v14.14), `supabase_realtime_ai-job-agent`, `supabase_inbucket_ai-job-agent` (Mailpit), `supabase_auth_ai-job-agent` (GoTrue v2.192.0), `supabase_kong_ai-job-agent`.

**Extensions installed** (`pg_extension`): `pg_net 0.20.3`, `pg_stat_statements 1.11`, `pgcrypto 1.3`, `plpgsql 1.0`, `supabase_vault 0.3.1`, `uuid-ossp 1.1` — all standard Supabase defaults; nothing unusual or unused-but-risky.

**Public-schema tables (17), matching migrations exactly:** `profiles`, `job_preferences`, `cvs`, `plans`, `subscriptions`, `payment_attempts`, `analysis_tasks`, `cv_analyses`, `countries`, `universities`, `majors`, `target_roles`, `locations`, `job_preference_target_roles`, `job_preference_locations`, `daily_news_briefs`, `daily_news_items`.

**Database objects:**

| Object | Purpose | Key constraints | RLS | Important indexes | Finding |
|---|---|---|---|---|---|
| `profiles` | 1 row per `auth.users.id`, editable identity fields | PK = `auth.users.id` FK cascade; `profiles_university_single_source`/`profiles_major_single_source` (mutual exclusivity) | Enabled — select/update own only, no insert/delete policy (trigger-only insert) | PK on `id` | Sound; no email duplication by design |
| `job_preferences` | 1 row per user, MVP single-preferences-set | `user_id` unique FK; `version` server-computed via trigger | Enabled — full CRUD own | Unique on `user_id` | Sound |
| `cvs` | 1 active CV per user | `file_size_bytes<=5MB`, `mime_type` allowlist, `storage_path` must start with `user_id/` and forbid `..` | Enabled — full CRUD own | `cvs_pkey`, `cvs_user_id_key` (plain unique), `cvs_one_active_per_user` (partial unique) | **Two overlapping unique constraints on `user_id`** — self-documented "SCHEMA CONFLICT" in `20260805090010`; blocks CV replace/versioning until resolved (Section 7) |
| `cvs` storage bucket (`storage.buckets`) | Private CV file storage | `public=false`, `file_size_limit=5242880`, `allowed_mime_types` = pdf/doc/docx | 4 object policies scoped to `(storage.foldername(name))[1] = auth.uid()::text` | n/a | Sound |
| `plans` | Canonical pricing/limits | `price_amount>=0`, `job_match_limit>=0`, `cover_letter_limit>=0` | Enabled — select-only, system-managed | PK on `plan_code` | Sound; server-side entitlement source of truth |
| `subscriptions` | Current plan per user | `provider` matches `plan_code` (`free`↔`free`, paid↔`whish`/`manual_test`) | Enabled — select own only, **no** insert/update/delete policy for `authenticated` | Unique on `user_id` | Sound; all transitions via `SECURITY DEFINER`, `service_role`-only RPCs |
| `payment_attempts` | Full payment history | `(user_id, idempotency_key)` unique; `amount`/`currency` always copied from `plans` server-side | Enabled — select own only | `payment_attempts_user_id_idx`, idempotency unique index | Sound |
| `analysis_tasks` | CV-analysis job queue (unconsumed) | `analysis_tasks_one_active_per_cv` (partial unique, `pending`/`processing`) prevents duplicate active tasks per CV | Enabled — select own only | `analysis_tasks_claimable_idx` (partial, `status='pending'`), `analysis_tasks_one_active_per_cv` | **No plain index on `user_id`** (the column the RLS `select own` policy filters on) — see Section 12 |
| `cv_analyses` | AI CV-analysis results (cv_facts / preference_snapshot / ai_career_profile) | `cv_analyses_one_approved_per_user`, `cv_analyses_one_current_per_user` (both partial unique); `cv_analyses_current_not_superseded` | Enabled — select own only, **no write policy for `authenticated`** | `cv_analyses_user_id_idx`, `_cv_id_idx`, `_status_idx`, `_review_status_idx` | Sound schema; no review/approve API exists yet to use it (Section 4) |
| `countries`/`universities`/`majors`/`target_roles`/`locations` | Reference data | PK on stable `code`/`slug` | Enabled — select-only for `authenticated`, full CRUD for `service_role` | PK indexes only (small, static tables) | Sound |
| `job_preference_target_roles`/`job_preference_locations` | Many-to-many join tables | Composite PK; ownership via `EXISTS` against parent `job_preferences.user_id` | Enabled — select/insert/delete via parent-ownership check | Composite PK covers primary lookup direction | Sound |
| `daily_news_briefs`/`daily_news_items` | Daily AI/tech news content | `brief_date` unique; `daily_news_items` FK cascade; `source_url` excluded from public column grant | Enabled — public select of published rows only | `daily_news_briefs_published_date_idx` (partial, matches actual query) | **Exists in the main/local app DB but application code never reads it here** (Section 11, NEWS-01) |

**Functions:** 18 total. 9 `SECURITY DEFINER` (all narrowly scoped, `EXECUTE` revoked from `public`, granted only to `service_role` or, for `create_payment_attempt`/`save_job_preferences`, to `authenticated` with `auth.uid()` always taken from the session, never a parameter) and 9 `SECURITY INVOKER` (rely entirely on the caller's own RLS visibility — no elevated privilege). This is a deliberate, consistently-applied least-privilege pattern across every migration.

**Grants:** `anon` has no `SELECT`/`INSERT`/`UPDATE`/`DELETE` on any user-data table (only `TRIGGER`/`REFERENCES`/`TRUNCATE`, standard Supabase per-role defaults, not reachable through PostgREST's REST surface). `anon` does get `SELECT` on `daily_news_briefs`/`daily_news_items`, matching their public-read design. `authenticated` grants match each table's RLS policy surface exactly (verified by cross-referencing `information_schema.role_table_grants` against `pg_policies`). `service_role` has full CRUD on every table, consistent with its RLS-bypass role.

---

## 7. Migration and Schema Drift Review

- **34/34 migrations applied locally, matching `remote` timestamps exactly** (`npx supabase migration list --local`) — no drift between the repo's migration history and the live local database.
- **No destructive statements** found in any migration (`DROP`/`TRUNCATE`/unscoped `DELETE`) other than expected `DROP CONSTRAINT` immediately followed by `ADD CONSTRAINT` (widening a check, e.g. `20260804090000`, `20260803090000`) and the two intentional, ownership-scoped `DELETE ... WHERE job_preference_id = v_row.id` lines inside `save_job_preferences()` (replacing one user's own join-table rows on their own request).
- **Self-documented, unresolved schema conflict:** `20260805090010_add_cvs_versioning.sql` adds `cvs.version`/`is_active`/`superseded_at` and a **partial** unique index `cvs_one_active_per_user (user_id) WHERE is_active`, but explicitly does **not** drop the pre-existing **plain** unique constraint `cvs_user_id_key (user_id)` — because `src/app/onboarding/upload-cv/page.tsx` still does `.upsert({...}, { onConflict: "user_id" })`, and Supabase-js's `.upsert()` cannot target a partial (WHERE-qualified) unique index. Confirmed live in the database: both `cvs_user_id_key` and `cvs_one_active_per_user` exist simultaneously today. **This must be resolved before "Replace CV" / CV versioning can be built** — the migration's own comment lays out the exact 4-step transaction required (insert new active row → mark old row superseded → drop `cvs_user_id_key` in a separate reviewed migration → enqueue new analysis task).
- **Duplicate-purpose finding (informational, not a defect):** `20260807090000`/`20260807090010` create `daily_news_briefs`/`daily_news_items` in the **main/local application database**, but the live application code (`src/lib/supabase/newsClient.ts`, `src/lib/dailyNews/getLatestDailyNewsBriefs.ts`) exclusively reads a **separate, dedicated online Supabase project** via `NEWS_SUPABASE_URL`/`NEWS_SUPABASE_ANON_KEY` — never the local/main DB client (`src/lib/supabase/env.ts`). The two tables in the main DB are therefore currently unused by any code path in this repository. This is not a security problem (RLS and grants on the local copy are correctly scoped, and it holds no data — 0 rows), but it is schema that exists for no consumer today; confirm with the team whether the local copy is intentional forward-provisioning or should be removed.
- No migration references a database object that is missing locally, and no locally-present schema object lacks a corresponding migration (all 17 tables map 1:1 to migration files).
- `daily-news-migrations-report.md` (untracked, read but not modified) independently confirms the same 34-migration inventory and the same no-destructive-statement conclusion for the two news migrations, produced by a prior read-only inspection — consistent with this audit's own findings.

---

## 8. Data Model Readiness

Evaluating the 26-step workflow against the actual live schema (Section 6) and actual code (Section 4/9):

| # | Step | DB support | Evidence |
|---|---|---|---|
| 1 | Signup + identity verification | Ready (email/password only; no phone/MFA) | `auth.users` (Supabase Auth managed); local config has `enable_confirmations=false` — **production value not verified** |
| 2 | User profile created safely | Ready | `handle_new_user()` trigger, `SECURITY DEFINER`, no client insert path |
| 3 | Private CV upload | Ready | `cvs` table + private `cvs` bucket, folder-scoped storage policies |
| 4 | CV file metadata + version stored | Partially ready | Columns exist (`version`/`is_active`/`superseded_at`) but no code path writes multiple versions; blocked by the `cvs_user_id_key` conflict (Section 7) |
| 5 | CV text extraction | Missing | `cv_analyses.extracted_text` is a destination column only; no extraction code anywhere |
| 6 | AI parses CV into structured data | Missing | `cv_analyses` cv_facts/ai_career_profile columns exist; no worker |
| 7 | User reviews/corrects extracted profile | Missing | `user_edits`/`reviewed_at` columns exist; no write-capable API |
| 8 | AI output vs. confirmed facts distinguished | Ready (schema design) | `cv_analyses` explicitly separates `cv_facts` / `preference_snapshot` / `ai_career_profile` regions (table comment, `20260804090010`) and tracks `review_status` separately from processing `status` |
| 9 | User adds job preferences | Ready | `save_job_preferences()` RPC, reference-data validated, versioned |
| 10 | Admin/approved ingestion adds jobs | Missing | No `jobs` table, no admin role, no ingestion route |
| 11 | Duplicate job detection | Missing | No table/dedup key exists |
| 12 | Jobs expire/close/update | Missing | No table exists |
| 13 | Hard eligibility checks | Ready (for plan/geo eligibility only) | `enforce_job_preferences_eligibility_trigger` (`20260806090090`), `get_onboarding_readiness()` |
| 14 | CV/profile-to-job matching | Missing | No `matches` table |
| 15 | Score/breakdown/explanation/missing-skills/model-version/status stored | Missing | No table; `cv_analyses.analysis_version`/`ai_provider`/`ai_model` show the intended *pattern* is already proven for CV analysis and should be mirrored for matches |
| 16 | Cover letter generated from supported facts only | Missing | No `cover_letters` table |
| 17 | User reviews/edits cover letter | Missing | No table |
| 18 | User approves/rejects match | Missing | No table; dashboard buttons are non-functional |
| 19 | No email sent without explicit approval | Unsafe if built naively / N/A today | No sending code exists yet — but no `applications`/approval-gate table exists to enforce it, either. Must be designed before any sender is built. |
| 20 | LinkedIn: link + prepared docs only, never scraped/auto-applied | Ready as a product rule (AGENTS.md §7, §97-100); Not verified against implementation (nothing implements it yet) | — |
| 21 | Email/application attempts tracked safely | Missing | No `applications`/`application_attempts` table |
| 22 | Failed automation tasks retry without duplicates | Partially ready (pattern proven, not yet applied everywhere) | `analysis_tasks.attempt_count`/`max_attempts`/`idempotency_key` + partial unique `one_active_per_cv` is a solid, reusable pattern — but only exists for CV analysis, not for matching/sending |
| 23 | Replace CV + controlled reprocessing | Partially ready | Triggers already correctly cascade CV/preference changes into `cv_analyses.is_current`/`recommendations_state` (`20260805090030`); blocked on the same `cvs_user_id_key` conflict as #4 |
| 24 | Delete account + sensitive CV data | Ready (cascade only) | Every user table FKs `auth.users(id) on delete cascade`; storage objects are **not** automatically deleted on account deletion — **Not verified**: no code path cleans up orphaned Storage objects when a `cvs` row cascades away |
| 25 | Admin access separate from user access | Missing | No role/admin table or column exists anywhere |
| 26 | Audit history of approval/sending events | Missing | No `audit_events` table |

**Proportionality note:** the existing schema does *not* over-build for MVP — reference tables are simple, `analysis_tasks` is appropriately minimal, and speculative columns (e.g., `task_type`, `preferences_version`) are added only with a concrete near-term consumer documented in their own comments. The gaps above (jobs/matches/cover_letters/applications/notifications/admin/audit) are not gold-plating opportunities; they are the literal next phase of this project and should be scoped as a single reviewed migration set before any matching/sending automation is written.

---

## 9. Authentication and Authorization Review

**Architecture:** `src/lib/supabase/client.ts` (browser, publishable key), `src/lib/supabase/server.ts` (per-request server client, cookie-backed), `src/lib/supabase/admin.ts` (service-role, server-only, throws if `SUPABASE_SECRET_KEY` missing), `src/proxy.ts` → `src/lib/supabase/session.ts` (Next.js "proxy"/middleware convention for this Next version). Session refresh uses `supabase.auth.getUser()` — which revalidates the token against Supabase Auth — not `getSession()` (which would trust a possibly-stale cookie); the code comments explicitly call this out as intentional.

**Route protection:** `PROTECTED_PATHS = ["/welcome", "/onboarding", "/dashboard", "/checkout"]`, `AUTH_ONLY_PATHS = ["/login", "/signup"]`, prefix-matched. Unauthenticated visitors to a protected path are redirected to `/login?next=<original path>`; authenticated visitors to `/login`/`/signup` are redirected to `/dashboard` (or a validated `next`). Redirect targets are validated by `isSafeRedirectPath()` (`src/lib/safeRedirect.ts`), which explicitly defends against `//evil.com` and `/\\evil.com` open-redirect payloads that a naive `startsWith("/")` check would miss — this is real, tested defensive code, not a stub.

**Server-side re-verification (the critical IDOR question):** every server entry point inspected re-derives the user from the session and never trusts a client-supplied id:
- `src/app/api/onboarding/complete/route.ts` — calls `supabase.auth.getUser()`, 401s if absent, then calls `getOnboardingReadiness()` (wraps `get_onboarding_readiness()`, a `SECURITY INVOKER` RPC that internally uses `auth.uid()`, never a parameter) before enqueueing anything.
- `src/app/api/checkout/route.ts` / `src/lib/payments/checkout.ts` — calls `supabase.auth.getUser()`, throws `NotAuthenticatedError` (→ 401) if absent; the `create_payment_attempt(p_plan_code)` RPC takes **only** a plan code from the client and derives `user_id`/`amount`/`currency` itself from `auth.uid()` and the trusted `plans` table — a manipulated `planCode` can at most select a different *valid* plan, never a different user or a different price.
- `src/app/onboarding/upload-cv/page.tsx` — client-side upload, but the storage path is computed as `${user.id}/${crypto.randomUUID()}-...}` from the *session's own* `user.id` (never client-editable input threaded through), and both the `cvs_storage_path_owned_by_user` CHECK constraint and the storage object RLS policies independently re-enforce that the first path segment must equal `auth.uid()`.
- Every `SECURITY DEFINER` privileged RPC (`activate_subscription`, `mark_payment_verified`, `create_analysis_task`, etc.) is `service_role`-only (`EXECUTE` revoked from `public`) — even a stolen/replayed authenticated JWT cannot call them; they can only be reached via trusted server code using `src/lib/supabase/admin.ts`, which is never imported by anything shipped to the browser (grepped for `admin.ts` imports; confirmed none in any `"use client"` file).

**Can an unauthenticated user reach protected pages/operations?** No — `src/proxy.ts` gates every matched route (`config.matcher` excludes only static assets), and every table/RPC additionally enforces its own RLS/grant layer independent of the middleware, so middleware bypass alone would not grant data access (AGENTS.md §28's "never treat middleware alone as sufficient authorization" is genuinely followed here).

**Can User A read/modify User B's data?** No IDOR path found in any inspected route or RLS policy — every policy's `USING`/`WITH CHECK` is `auth.uid() = user_id` (or `= id` for `profiles`) or, for join tables, an `EXISTS` check against the parent row's `user_id`. No policy uses a broader condition (e.g. `true` for a private table) — the only `using (true)` policies are on genuinely public read-only reference tables (`plans`, `countries`, `universities`, `majors`, `target_roles`, `locations`), which is correct.

**Can an ordinary user perform admin operations?** No admin operations exist to perform (Section 8, #25) — this is a "Missing," not an "Unsafe," today. It becomes a required blocker the moment any admin feature (job ingestion) is built (see Section 19, P0).

**Is the service-role key reachable from client code?** No. `SUPABASE_SECRET_KEY` has no `NEXT_PUBLIC_` prefix (confirmed in `.env.example` and `src/lib/supabase/admin.ts`), and grepping every `"use client"` file in `src/` for `admin.ts`/service-role usage found none.

**Access matrix:**

| Route/operation | Intended audience | Current protection | Server authorization present | Risk | Required fix |
|---|---|---|---|---|---|
| `/dashboard`, `/onboarding/*`, `/welcome`, `/checkout` | Authenticated user | `src/proxy.ts` redirect | Yes (RLS + per-route re-check) | Low | — |
| `/login`, `/signup` | Unauthenticated | Redirects authenticated users away | N/A | Low | Add password-reset flow |
| `POST /api/onboarding/complete` | Authenticated user, own data | `getUser()` 401 gate | Yes (`get_onboarding_readiness()` + `create_analysis_task` service-role RPC) | Low | — |
| `POST /api/checkout` | Authenticated user, own subscription | `getUser()` 401 gate | Yes (`create_payment_attempt` RPC derives identity/price server-side) | Low | — |
| CV upload (`storage.objects`, bucket `cvs`) | Owning user only | RLS by folder = `auth.uid()` | Yes, DB CHECK + Storage policy (defense in depth) | Low (see SEC-05 for a related, separate gap) | Add server-side content-type verification |
| `cv_analyses` review/approve (does not exist yet) | Owning user only | N/A — no route exists | N/A | N/A today; **High** once built naively | Must re-derive `auth.uid()` server-side and never accept `review_status` from client without validating against the analysis row's own `user_id` |
| Admin job ingestion (does not exist yet) | Admin only | N/A | N/A | **High** once built without a role model | Must add an admin role/claim before any admin route is written |
| `scripts/seed-local-automation-users.mjs` | Local dev only | Refuses to run against non-`127.0.0.1`/`localhost` Supabase URL, requires `LOCAL_SEED_USER_PASSWORD` | Self-contained CLI guard, not a web route | Low (not web-reachable) | — |

---

## 10. RLS and Storage Security Review

Every one of the 17 public tables has `rowsecurity = true` (verified via `pg_class.relrowsecurity`); none use `FORCE ROW LEVEL SECURITY` (`relforcerowsecurity = false` on all), which is standard — the table owner (migrations, run as `postgres`) and `service_role` are expected to bypass RLS by design, and no table owner-run application code path exists that would make `FORCE` necessary.

- **Ownership pattern:** consistently `auth.uid() = user_id` (or `= id` for `profiles`), confirmed for every private table via `pg_policies.qual`/`with_check`. Join tables (`job_preference_target_roles`, `job_preference_locations`) correctly re-derive ownership through an `EXISTS` against the parent `job_preferences.user_id` rather than duplicating a `user_id` column — no denormalization drift risk.
- **`WITH CHECK` present where needed:** every `INSERT`/`UPDATE` policy pairs a `USING` and/or `WITH CHECK` clause with `auth.uid() = user_id`, preventing a row from being inserted or reassigned to a different owner. No policy found that allows `UPDATE ... SET user_id = <other>`.
- **No policy is too broad:** the only `using (true)` policies are on read-only, non-personal reference tables (`plans`, `countries`, `universities`, `majors`, `target_roles`, `locations`) — correct by design, and none of these tables has an insert/update/delete policy for any client role.
- **Anonymous access:** `anon` has zero policies on any private table; the only tables `anon` can `SELECT` are the public news tables (`daily_news_briefs`/`daily_news_items`, published rows only) and, at the grant layer only (no matching policy would allow it in practice, since RLS still applies), the reference tables show no `anon` policy either — confirmed `anon` cannot read `profiles`, `cvs`, `job_preferences`, `subscriptions`, `payment_attempts`, `analysis_tasks`, or `cv_analyses`.
- **Admin bypass path:** exclusively `service_role` via `src/lib/supabase/admin.ts`, server-only — a controlled, auditable bypass, not an RLS hole.
- **Column-level grant hardening:** `daily_news_items` uses a **column-level** grant (`grant select (id, brief_id, position, headline, summary, created_at) on ... to anon, authenticated`) to keep `source_url` out of the public API surface at the database layer — a stronger guarantee than trusting the frontend to simply not `SELECT` it. This is good practice worth reusing for any future table with an internal-only column (e.g., a future `jobs.internal_notes`).

**CV Storage:**
- **Bucket is private:** `storage.buckets.cvs.public = false`, confirmed live.
- **Object paths scoped by user:** all 4 storage policies (`select`/`insert`/`update`/`delete`) require `bucket_id='cvs' AND auth.uid()::text = (storage.foldername(name))[1]` — a user cannot list, read, overwrite, or delete another user's object regardless of what path they attempt, and this is enforced independently at both the Storage-policy layer and, redundantly, the `cvs.storage_path` CHECK constraint (`storage_path like user_id || '/%' and storage_path not like '%..%'`) — genuine defense in depth against path-traversal attempts.
- **Type/size limits enforced server-side, not just client-side:** the bucket itself enforces `file_size_limit=5242880` and `allowed_mime_types` at the Supabase Storage API layer (independent of the browser), and the `cvs` table CHECK constraints (`file_size_bytes<=5242880`, `mime_type` allowlist) provide a second, independent enforcement layer at the database row. **Gap:** none of these layers inspects the actual file **bytes** — all three (client `validateFile()`, Storage bucket config, DB CHECK) trust the browser-declared `File.type`/size, which can be spoofed by renaming a file's extension/declared MIME type. See SEC-05.
- **Signed URLs:** not yet used anywhere in the codebase (no code currently reads a CV back for the user or an automation) — **Not verified / not applicable yet**, but the storage design (private bucket, owner-scoped policies) is exactly what a future signed-URL-issuing route would need.
- **No permanent public CV URL exists anywhere** — confirmed; the bucket is private and no code constructs a public URL.
- **Old CV versions / deleted accounts:** `on delete cascade` from `auth.users` removes the `cvs` row, but **no code path removes the corresponding Storage object** when that happens — an orphaned file could remain in the private bucket after account deletion. Not exploitable by another user (still owner-path-scoped and the owner no longer has a session), but it is a data-retention gap relative to AGENTS.md §33 ("Users must not retain access to private resources after account deletion" is satisfied; "do not keep sensitive personal data indefinitely without a defined reason" is not yet satisfied for orphaned Storage objects).

---

## 11. Application Security Findings

| ID | Severity | Finding | Evidence | Impact | Blocks automation? | Recommendation |
|---|---|---|---|---|---|---|
| SEC-01 | High | 4–6 high-severity `npm audit` advisories in the current dependency tree, including **Next.js itself** (`16.2.10`, vulnerable range includes SSRF in Server Actions/rewrites, cache confusion, DoS, internal Server Function endpoint disclosure — fixed in `16.3.0`), plus `nanoid`, `postcss`, `sharp` (transitive via `next`), and (dev-only) `js-yaml`/`brace-expansion` | `npm audit` output, this session — see Section 15 | Several of the Next.js CVEs are remotely exploitable (SSRF, cache confusion) against a deployed instance | Yes — should not build automation on a framework version with an open SSRF advisory | Upgrade to Next.js `16.3.0`+ via a reviewed, tested dependency bump (AGENTS.md §24: "make dependency upgrades separately... run the complete validation suite after") |
| SEC-02 | Medium | CV upload MIME/type validation is browser-declared only at every layer (client `validateFile()`, Storage bucket `allowed_mime_types`, DB `mime_type` CHECK) — no server-side file-signature ("magic bytes") verification | `src/app/onboarding/upload-cv/page.tsx:24-32`; `supabase/migrations/20260714153105_create_cvs_storage_bucket.sql` | A renamed malicious file with a spoofed `Content-Type` could pass all three checks | Yes for CV-extraction automation specifically (an extractor should not assume the stored MIME type is trustworthy) | Verify file signature (PDF `%PDF-`, DOC/DOCX zip/OLE headers) server-side before or during extraction, not just at upload |
| SEC-03 | Medium | No security headers configured anywhere (`next.config.ts` has no `headers()`; no CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, or HSTS) | `next.config.ts` (full file read, 15 lines, no `headers` key); `src/app/layout.tsx` (no meta equivalents) | Standard clickjacking/MIME-sniffing/referrer-leak exposure on a production deployment | No (not automation-specific) | Required before public production launch per AGENTS.md §32 — not required to start CV-analysis automation itself |
| SEC-04 | Medium | `cvs` table has two simultaneous, overlapping unique constraints on `user_id` (`cvs_user_id_key` plain + `cvs_one_active_per_user` partial) — a self-documented, unresolved design conflict | `supabase/migrations/20260805090010_add_cvs_versioning.sql` comment; confirmed live via `pg_indexes` | Blocks implementing CV replace/reprocessing without a breaking migration; not itself an exploitable vulnerability | Yes — CV-analysis automation's "user replaces CV" path cannot be built safely until resolved | Implement the migration's own documented 4-step plan (Section 7) as a single reviewed migration |
| SEC-05 | Low | Orphaned Storage objects: no code path deletes a user's CV Storage object when their account (and cascading `cvs` row) is deleted | Cascade FK only (`cvs_user_id_fkey ... on delete cascade`); grepped for any Storage `.remove()` call outside the upload-replace path — none found for account deletion (no account-deletion route exists at all yet) | Retention-only concern; the file is inert (nobody can read it — owner-scoped policies + no owner session) but persists indefinitely | No | Add Storage cleanup to the (currently nonexistent) account-deletion flow when it is built |
| SEC-06 | Low | `TRUNCATE` privilege is granted to `anon`/`authenticated` on every public table (default Supabase per-role grant, not migration-specific) | `information_schema.role_table_grants` output, Section 6 | `TRUNCATE` bypasses RLS in PostgreSQL by definition, but PostgREST (the only path `anon`/`authenticated` credentials can reach) does not expose a `TRUNCATE` operation via its REST API, so this is not exploitable through the application's actual attack surface | No | Needs verification against the eventual production Supabase project's default grants; no action required locally |
| SEC-07 | Informational | News-database credential separation is correctly implemented | `src/lib/supabase/newsEnv.ts` (distinct `NEWS_SUPABASE_URL`/`NEWS_SUPABASE_ANON_KEY`, both server-only, never `NEXT_PUBLIC_`), `src/lib/supabase/newsClient.ts` (anon key only, `persistSession:false`), `.env.example` comments confirming anon/public key only, never service-role | No sharing of `SUPABASE_SECRET_KEY` or any main-app credential with the separate news project | N/A | None — this is correctly built; no action needed |
| SEC-08 | Informational | No XSS/SSRF surface found | Grepped `dangerouslySetInnerHTML` (0 matches, entire `src/`); grepped `fetch(` (2 matches, both same-origin: `/api/checkout`, `/api/onboarding/complete`) | N/A today | No | Revisit once job descriptions/CV text/cover letters are rendered from AI output — apply output encoding and a strict CSP at that point |
| SEC-09 | Informational | No automated dependency/secret scanning configured in CI beyond `npm audit`'s absence from `.github/workflows/ci.yml` | `ci.yml` runs lint/typecheck/build only, no `npm audit` step | Vulnerable dependencies (SEC-01) could regress silently | No | Add `npm audit --audit-level=high` (or Dependabot) to CI before production launch |

**No evidence found for:** SQL injection (all DB access is via the Supabase client/RPCs with parameterized calls, no raw string-built SQL in application code), CSRF (no cookie-based state-changing GET requests found; Next.js Route Handlers + `fetch` POST from same origin), open redirect (`isSafeRedirectPath` is applied consistently everywhere a `next` param is used), mass assignment (`save_job_preferences` and `create_payment_attempt` both use explicit named parameters, never a spread client object), email-header injection (no email-sending code exists yet), or a service-role key reachable from the browser bundle. These should be **re-checked** once job ingestion, matching, cover-letter, and application-sending automation is actually built — this audit only found no evidence in what exists today.

---

## 12. Query and Index Performance Review

**Full index inventory:** see Section 6's table-by-table breakdown; 36 indexes total across 17 tables (`pg_indexes`, `information_schema`-verified).

| Query pattern | Existing index | Gap | Recommended index/change | Benefit | Cost | Priority |
|---|---|---|---|---|---|---|
| Profile lookup by user (`profiles.id = auth.uid()`, `dashboard/page.tsx:73-78`) | PK on `id` | None | — | — | — | — |
| Current CV lookup by user (`cvs` `.eq("user_id",...).eq("is_active",true)`, `dashboard/page.tsx:86-91`) | `cvs_one_active_per_user` (partial unique) fully supports this exact predicate | None | — | — | — | — |
| CV processing-status lookup (`analysis_tasks` `.eq("cv_id",...).order("created_at desc").limit(1)`, `dashboard/page.tsx:184-190`) | `analysis_tasks_one_active_per_cv` covers `cv_id` equality but not the `order by created_at` | Missing composite `(cv_id, created_at desc)` | `create index on analysis_tasks (cv_id, created_at desc)` | Avoids a sort over all of a (currently tiny) user's tasks | Low (small table, low write volume) | P3 today, P2 once automation runs many tasks/CV over time |
| Preference lookup by user | Unique on `job_preferences.user_id` | None | — | — | — | — |
| `analysis_tasks` RLS filter (`auth.uid() = user_id`, every `select own` query) | **No index on `user_id`** — only `cv_id`-based indexes exist | Every RLS-filtered read of a user's own tasks does a sequential scan filtered by `user_id` | `create index on analysis_tasks (user_id)` | Matches the same pattern already applied to `payment_attempts`/`cv_analyses`/`job_preferences` | Low | P2 (cheap, consistent with the rest of the schema's own conventions; currently harmless only because the table is empty) |
| Active jobs by status/date/source | N/A — table doesn't exist | — | Design when `jobs` table is built: partial index on `status='active'` + `(source, external_id)` unique for dedup | — | — | P0 (schema design, part of automation prerequisites) |
| Match lookup by user+status / by user ordered by score / uniqueness per (user, job, profile-version) | N/A — table doesn't exist | — | Design when `matches` table is built: `(user_id, status)`, `(user_id, score desc, created_at desc)`, unique `(user_id, job_id, profile_version)` | — | — | P0 |
| Cover-letter lookup by match | N/A — table doesn't exist | — | `(match_id)` unique or FK index | — | — | P0 |
| Application lookup by user/match/status; pending approved applications | N/A — table doesn't exist | — | `(user_id, status)`, partial index `WHERE status='approved'` | — | — | P0 |
| Automation tasks by status+next-attempt-time | `analysis_tasks_claimable_idx` (partial, `status='pending'`, on `available_at`) is a **good, reusable template** | None for `analysis_tasks` itself | Mirror this exact pattern for any future `matching_tasks`/`send_tasks` table | — | — | Reuse, don't redesign |
| Admin job listing/filtering | N/A — no admin surface exists | — | Design alongside `jobs` table and admin role | — | — | P0 |
| News queries (separate DB) | `daily_news_briefs_published_date_idx` (partial, `brief_date desc where is_published`) matches the actual "latest 5 published" query shape exactly | None | — | — | — | Keep the separate news DB architecture unchanged, as instructed — informational only |

**Other observations:**
- No missing FK indexes found for existing tables **except** `analysis_tasks.user_id` (above) — every other FK column that isn't already the leading column of its table's primary/unique index has a dedicated index (`cv_analyses.user_id/cv_id`, `payment_attempts.user_id`).
- No duplicate/overlapping indexes found **except** `cvs_user_id_key` vs. `cvs_one_active_per_user` (Section 7, SEC-04) — that overlap is a known, documented, in-progress migration debt, not an oversight.
- No `SELECT *` patterns found in application code against user-facing tables — every `.select(...)` inspected (`dashboard/page.tsx`, `upload-cv/page.tsx`, `preferences/page.tsx`) names explicit columns. `cv_analyses` is the one exception (`select("*")` at `dashboard/page.tsx:194`), which is reasonable given the dashboard genuinely needs most of that row's columns to render the CV Profile states, but should be revisited if `cv_analyses` grows large text/JSONB columns that aren't always needed (e.g., `extracted_text`).
- No offset-based pagination exists yet anywhere (nothing paginated exists yet) — flag as a **P1 design requirement**, not a current defect: any future `jobs`/`matches` list must use cursor-based pagination and explicit `.limit()` from day one (AGENTS.md §26 already mandates this).
- `analysis_tasks_claimable_idx` and the partial unique indexes throughout (`cv_analyses_one_current_per_user`, `cv_analyses_one_approved_per_user`, `cvs_one_active_per_user`, `payment_attempts_user_idempotency_key_unique`, `analysis_tasks_idempotency_key_key`, `analysis_tasks_one_active_per_cv`) are genuinely well-designed, low-cost, high-value idempotency/uniqueness guarantees that should be used as the direct template for every future automation table (matches, applications, notifications).

---

## 13. Scalability and Reliability Review

- **Connection handling:** `src/lib/supabase/server.ts` creates a new server client per request (explicit comment: "never share one across requests"), appropriate for Next.js's serverless/edge execution model. `src/lib/supabase/admin.ts` similarly creates a fresh service-role client per call with `persistSession:false`. No module-level mutable client instance or in-memory cache found anywhere (AGENTS.md §26's "never store user-specific state in ... process memory" is followed).
- **Long-running work kept out of the request path — by design, not by accident:** `POST /api/onboarding/complete` only **enqueues** an `analysis_tasks` row; it never performs extraction or AI calls inline. This is the correct pattern and should be the template for matching/cover-letter generation too.
- **Idempotency is a first-class, recurring pattern:** `create_payment_attempt` reuses an in-flight attempt instead of duplicating one; `create_analysis_task` reuses an active task for the same CV (race-safe via `on conflict ... where status in (...) do nothing` plus a re-fetch on conflict); `mark_payment_verified` is explicitly idempotent against duplicate provider notifications (`if status = 'paid' then return as-is`). This is exactly the discipline required before building an email-sending automation, and the pattern already exists to copy.
- **Atomicity:** `save_job_preferences()` wraps a multi-table write (parent row + two join tables) in one function body for a real transaction, explicitly citing AGENTS.md §18. `mark_payment_verified()` atomically marks a payment paid **and** activates the subscription in the same transaction, preventing a "paid but not active" or "active but not paid" inconsistency.
- **Locking/claiming for workers:** not yet implemented (no worker exists), but the schema comment on `analysis_tasks` already documents the intended approach (`for update skip locked`) for a future claim function — this is a sound plan, not yet code.
- **Race conditions in versioning:** `bump_job_preferences_version()` and the two `cv_analyses` staleness/supersession triggers (`mark_cv_analyses_superseded_on_cv_change`, `mark_cv_analyses_stale_on_preferences_change`) correctly react to the same-transaction `OLD`/`NEW` row rather than a separate read, avoiding a TOCTOU gap.
- **What's not yet provable:** none of this has been exercised under real concurrency (the DB is empty; no load/concurrency testing was performed or claimed — AGENTS.md §31 requires recording a tested scenario before claiming scalability, and none exists yet). **Not verified: production connection pooling** (`config.toml`'s `[db.pooler] enabled = false` locally; production Supabase pooler configuration is unknown from this environment).
- **Data growth:** no fast-growing log-style table exists yet (the future `applications`/`notifications`/`audit_events` tables will be the ones to watch); no retention/archival policy exists yet because there's nothing to retain.
- **Caching:** the `/news` page uses ISR (`revalidate = 3600`) correctly for public, non-personalized content — no caching of authenticated/user-specific data was found anywhere (AGENTS.md §8's "do not cache user-specific, authenticated, or sensitive data publicly" is respected by omission, since nothing caches such data at all today).
- **Provider swap-ability:** `src/lib/payments/whish/provider.ts` defines a typed `WhishProvider` interface with a single factory (`getWhishProvider()`), so a second payment provider or a real Whish implementation can be swapped in without touching call sites — a good template to replicate for a future `AiProvider`/`JobSourceProvider` abstraction before building matching/parsing automation, so an AI vendor can be swapped without a DB redesign.

**Classification of near-term reliability work:**

| Item | Classification |
|---|---|
| Resolve `cvs` unique-constraint conflict (SEC-04) before building Replace-CV | Required before automation |
| Add `jobs`/`matches`/`cover_letters`/`applications`/`notifications`/`audit_events` schema, following the `analysis_tasks` idempotency template | Required before automation |
| Add admin role/claim model | Required before automation |
| Add a worker claim function (`for update skip locked`) for `analysis_tasks` | Required before automation |
| Upgrade Next.js to close SSRF/DoS advisories (SEC-01) | Required before real users |
| Security headers / CSP (SEC-03) | Required before beta / public launch |
| Storage cleanup on account deletion (SEC-05) | Required before beta |
| Load/concurrency testing | Useful after initial beta |
| Connection pooler tuning for production scale | Useful after initial beta / premature now (local dev has it disabled, which is fine for local dev) |

---

## 14. Website Implementation Review

- **Landing page, signup/login, protected dashboard shell, CV upload, preferences:** implemented, connected to real Supabase Auth/DB, with proper loading/error/empty states (e.g., `dashboard/page.tsx`'s `isLoading`/`loadError` states; `upload-cv/page.tsx`'s per-field validation and upload-failure rollback that removes the newly-uploaded Storage object if the DB write fails, and vice versa — a genuinely correct "don't leave the user in a half-uploaded state" implementation).
- **CV review/confirmation, match views, cover-letter editing, approve/reject, sent/rejected, admin:** UI-only, rendering hardcoded constants from `src/lib/dashboardData.ts` (`DASHBOARD_STATS`, `NEW_MATCHES`, `APPROVED_JOB`, `SENT_APPLICATION`, `REJECTED_JOB`) — the code itself documents this as mock (`NewMatchesSection.tsx`'s comment: "no job-matching automation exists yet... The content below is still the pre-existing mock data, not wired to anything real"). This is honest, well-labeled placeholder code, not a disguised fake.
- **News integration:** connected to a real, separate Supabase project; correctly isolated credentials (Section 11, SEC-07); currently mid-refactor on the active branch (Section 3).
- **Error/loading/empty states:** present and distinct in every real (non-mock) flow inspected — `dashboard/page.tsx` (loading spinner text, red-bordered error card, distinct from a valid-but-empty state), `getLatestDailyNewsBriefs.ts` (`"unavailable"` vs. genuine zero-briefs are explicitly never conflated, per its own comment).
- **Form validation:** client-side validation is real (`validateFile()`, password length, required-field checks) and is backed by independent server/DB-layer validation for everything that matters (file size/type, plan eligibility, role/location existence, target-role count 1–5) — not merely client-side theater.
- **Server/client boundaries:** consistently correct — every file that touches `SUPABASE_SECRET_KEY` or `NEWS_SUPABASE_*` has no `"use client"` directive; every `"use client"` file found only imports the browser-safe `client.ts`/`useSupabaseUser.ts`.
- **Naming/enum consistency between TypeScript and Postgres:** verified for `job_preferences.experience_level` (DB CHECK: `internship|entry-level|junior|mid-level|senior|open-to-all`; `src/lib/experienceLevel.ts` — not fully read line-by-line but referenced consistently by `EXPERIENCE_LEVEL_OPTIONS` in `preferences/page.tsx`) and for `work_arrangement` (DB CHECK: `remote|onsite|hybrid|flexible`; TS `WORK_ARRANGEMENT_OPTIONS` in `preferences/page.tsx:27-44` uses the identical four values) — no drift found. `src/lib/cvAnalysis/profileState.ts`'s `isPreferencesComplete()` explicitly comments that it "Mirrors `get_onboarding_readiness()`'s ... computation exactly" and is "kept in sync deliberately" — a maintained, documented duplication rather than an accidental one, though it is still a duplication risk if one side is edited without the other (worth a future shared-source-of-truth refactor, not urgent).
- **Broken/disconnected pages:** none found that silently fail; every incomplete feature (CV review, matches, admin) is either gated behind a real "not ready yet" state or clearly labeled mock data — no dead links or 404s were found in the routes inspected.
- **Dead code:** `src/lib/demoAuth.ts` + `src/components/RequireDemoAuth.tsx` implement a `localStorage`-based fake auth gate, but grepping all of `src/app/` for `RequireDemoAuth` found **zero usages** — this component currently gates nothing and poses no live security risk, but its presence risks a future developer mistakenly using it as a real auth guard. Recommend removing it or clearly marking it deprecated.
- **Accessibility basics (from code, not a live audit):** forms use `<label htmlFor>`/associated inputs (`FormField` component pattern), error banners use `role="alert"`, info banners use `role="status"` — reasonable baseline; a full WCAG pass was not performed (out of scope for a code-only review) — **Not verified** beyond this.
- **Responsive behavior:** Tailwind responsive classes (`sm:`/`lg:`) are used consistently throughout every file read — **Not verified** in an actual browser/viewport (out of scope; this is a static code review).

---

## 15. Test and Verification Results

| Command | Result | Notes |
|---|---|---|
| `npm run lint` (`eslint`) | **Pass** — no errors or warnings output | Ran against the full repo including uncommitted WIP changes |
| `npx tsc --noEmit` | **Pass** — no output, no errors | Strict mode per `tsconfig.json`; confirms the `publicClient.ts` deletion (Section 3) left no dangling imports |
| `npm test` | **Not run — no test script exists.** `package.json` has no `"test"` entry, and no `*.test.*`/`*.spec.*` file exists anywhere in the repo (`find` over the whole tree, excluding `node_modules`) | AGENTS.md §12/§25 call for tests on important flows; none currently exist |
| `npm audit` | **Ran — 4 high-severity findings in `--omit=dev` (production) dependencies, 6 total including dev** | See SEC-01, Section 11, for the full breakdown (Next.js, nanoid, postcss, sharp, js-yaml, brace-expansion) |
| `npm run build` (`next build`) | **Skipped — not executed, with reason recorded here rather than guessed at** | Two independent, verifiable risks found by code inspection, not by running the command: (1) the currently-modified `src/app/news/page.tsx` (`export const revalidate = 3600`, an async Server Component) statically imports `getLatestDailyNewsBriefs()` → `createNewsClient()` → `newsEnv.ts`, whose `requireEnv()` calls execute **at module-evaluation time** and throw immediately if `NEWS_SUPABASE_URL`/`NEWS_SUPABASE_ANON_KEY` are unset; `.github/workflows/ci.yml` (unmodified, still on `main`'s definition) sets only `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as placeholders and does **not** set the two `NEWS_*` variables — meaning this branch's CI build may currently fail outright once pushed, or (2) if run locally (where `.env.local` does define those variable names — names only were checked, not values, per the audit's confidentiality rules), Next's static-generation pass for `/news` would attempt a **real network call to the separate, live news Supabase project**, which this audit is required not to trigger. Both outcomes are real findings recorded here rather than fabricated as a pass/fail. **Recommendation:** the engineer resuming this work should either run `npm run build` locally with the real `.env.local` (accepting the one external read-only call to the news project) or add `NEWS_SUPABASE_URL`/`NEWS_SUPABASE_ANON_KEY` test/placeholder values to `ci.yml` and force the news fetch path to degrade to `"unavailable"` gracefully during CI (the code already supports this state — see `getLatestDailyNewsBriefs.ts:65-70` — so a placeholder/unreachable URL is a safe way to prove the build doesn't hard-fail, without needing a real project). |
| `npx supabase migration list --local` | **Pass** — 34/34 local migrations match `remote` (i.e., applied) exactly | Read-only, reported in Section 3/7 |
| DB introspection (SELECT-only) | **Pass** — schema, RLS, policies, indexes, grants, extensions, functions, constraints, and aggregate row counts all retrieved successfully via `docker exec ... psql` | No write/DDL executed |

---

## 16. Automation Readiness

The only automation-relevant schema that exists today is the **CV-analysis task queue** (`analysis_tasks` + `cv_analyses`), and it has **no worker** yet — every migration comment for these tables says so explicitly. No other automation (job ingestion, matching, cover-letter generation, sending) has any schema at all. This section evaluates readiness to *start* building each, not evaluates an existing implementation.

| Automation | Schema exists? | Worker exists? | Primary blocker |
|---|---|---|---|
| CV text extraction | Partial (`cv_analyses.extracted_text` destination only) | No | Needs a claim function for `analysis_tasks` (`for update skip locked`, documented but not built) |
| CV AI analysis / structured parsing | Partial (`cv_analyses` cv_facts/ai_career_profile columns) | No | Same as above; needs AI-provider abstraction + runtime schema validation of AI output before writing (AGENTS.md §30) |
| User review/confirmation | Partial (`review_status`/`user_edits` columns, no write policy) | N/A (needs an API, not a worker) | Needs a validated server route that re-derives `auth.uid()` and writes only to the calling user's own `cv_analyses` row |
| Job ingestion | **None** | No | Needs `jobs`/`job_sources` schema + admin role model |
| Job normalization/dedup | **None** | No | Needs `jobs` schema + dedup key design |
| Candidate-to-job matching | **None** | No | Needs `matches` schema |
| Match explanation/missing-skills | **None** | No | Needs `matches` schema (score breakdown columns) |
| Cover-letter generation | **None** | No | Needs `cover_letters` schema + fact-grounding validation against `cv_analyses`/job description only |
| User match notifications | **None** | No | Needs `notifications` schema |
| Approved email application sending | **None** | No | Needs `applications` schema + explicit-approval gate + idempotent sender |
| Retry/failure recovery | Pattern proven (`analysis_tasks.attempt_count`/`max_attempts`/`idempotency_key`), not yet applied elsewhere | No | Replicate the existing pattern per new task table |
| Stale-job expiration/maintenance | **None** | No | Needs `jobs.status`/`expires_at` |
| Data deletion/retention handling | Partial (cascade deletes DB rows; Storage objects orphaned, SEC-05) | No | Needs an explicit account-deletion route + Storage cleanup |

---

## 17. Recommended Automation Catalog

All entries below preserve the product rules verbatim from AGENTS.md §7: no LinkedIn scraping, no LinkedIn auto-apply, no login to a user's LinkedIn account, LinkedIn jobs get link + prepared materials only, nothing is sent without explicit user approval, cover letters use only facts from confirmed profile data + job description, CV data is private/sensitive, match quality over quantity.

| Order | Automation name | Goal | Trigger | Reads | Writes | Approval needed | Prerequisites |
|---|---|---|---|---|---|---|---|
| 1 | CV text extraction | Turn an uploaded file into plain text | New `analysis_tasks` row (`task_type='full_analysis'`) | `cvs`, Storage object | `cv_analyses.extracted_text`, `status` | No (internal step) | Claim function for `analysis_tasks`; server-side file-signature validation (SEC-02) |
| 2 | AI CV structured parsing | Extract skills/education/experience/etc. into `cv_facts` | Extraction success | `cv_analyses.extracted_text`, `job_preferences` (for `preference_snapshot`) | `cv_analyses.skills/education/work_experience/...`, `ai_career_profile` columns, `status='completed'` | No (produces a *pending_review* result, not a live decision) | Runtime schema validation of AI output (AGENTS.md §30); AI-provider abstraction (mirror `WhishProvider` pattern) |
| 3 | User review/confirmation endpoint | Let the user approve or request changes to the AI profile | User action on CV Profile page | `cv_analyses` (own row only, re-derive `auth.uid()`) | `review_status`, `user_edits`, `reviewed_at`, `approved_at`; supersedes any prior `is_current`/`approved` row per the existing partial-unique-index invariants | Yes — this *is* the approval step for the profile itself | New server route/RPC; must never accept `user_id` from client |
| 4 | Job ingestion (admin/approved sources) | Add jobs from company career pages, Greenhouse/Lever/Workable/Ashby, public-email listings | Admin action or scheduled scrape of approved sources only | New `jobs`/`job_sources` tables | `jobs` | No (internal, but requires an admin role) | `jobs` schema; admin role model (P0 blocker) |
| 5 | Job normalization/dedup | Prevent duplicate listings across sources | After ingestion | `jobs` | `jobs.dedup_key`/merge | No | Dedup key design (e.g., normalized `(source, external_id)` or content hash) |
| 6 | Candidate-to-job matching | Score a user's approved profile against active jobs | Scheduled or triggered by new jobs / new approved profile | `cv_analyses` (current, approved only), `job_preferences`, `jobs` | `matches` (score, breakdown, missing-skills, model-version, `status='pending_review'`) | No (produces candidates for user review, not a sent action) | `matches` schema; must read the **current, approved** `cv_analyses` row only — never a stale or pending one |
| 7 | Match explanation / missing-skills generation | Human-readable "why this matches" | Same run as #6, or on-demand | `matches`, `cv_analyses`, `jobs` | `matches.explanation`, `missing_skills` | No | Same schema as #6 |
| 8 | Cover-letter generation | Draft a cover letter grounded only in confirmed facts | User requests, or automatically on a new match (product decision) | `cv_analyses` (approved facts only), `jobs.description` | `cover_letters` (draft) | No (draft only; user must approve/edit before send) | `cover_letters` schema; explicit "never invent facts not in cv_facts or the job description" validation step |
| 9 | User match notifications | Tell the user new matches/cover letters are ready | New `matches`/`cover_letters` rows | `matches`, `cover_letters` | `notifications` (delivery log) | No | `notifications` schema; email/notification provider abstraction |
| 10 | Approved email application sending | Send an application **only** after explicit user approval | User clicks "Send" on an approved match | `matches` (must be `user_approved`), `cover_letters`, `jobs` (must have an email/apply-form target — never LinkedIn auto-apply) | `applications` (attempt + idempotency key), `notifications` | **Yes — hard requirement, the whole point of this automation** | `applications` schema with an idempotency key per (user, job) send; must verify `matches.status = 'approved'` server-side before sending, never trust a client flag |
| 11 | Retry/failure recovery | Reprocess failed extraction/matching/sending without duplicates | Scheduled sweep of `failed`/stuck rows | Whichever task table | Same table's `attempt_count`/`status` | No | Reuse the exact `analysis_tasks` pattern (`max_attempts`, idempotency key, partial unique "one active") for every new task table |
| 12 | Stale-job expiration/maintenance | Close/expire jobs no longer available | Scheduled | `jobs` | `jobs.status`, `expires_at` | No | `jobs.status`/`expires_at` columns |
| 13 | Data deletion/retention handling | Honor account deletion, remove CV Storage objects and derived data | User-initiated account deletion | All user tables (cascade), Storage | Deletes DB rows (cascade already works) + Storage objects (currently missing, SEC-05) | Yes (user-initiated, but the *action* of deleting is the approval) | Account-deletion route; Storage cleanup step |

**Placement guidance:** extraction/parsing/matching/cover-letter generation are AI-cost and potentially long-running — these belong in a scheduled worker or n8n workflow claiming `*_tasks` rows via `for update skip locked`, never inline in a Next.js request (AGENTS.md §26). Ingestion from "safe sources" (company career pages, Greenhouse/Lever/Workable/Ashby, public application emails) is a good fit for n8n given it's mostly HTTP-fetch + normalize. The approval/send step should be a small, carefully-reviewed piece of **application code** (not a generic workflow tool) specifically because it is the one step where "nothing is sent without explicit approval" must be enforced with the least possible surface for a workflow-config mistake to bypass it.

---

## 18. Missing Foundations and Blockers

1. **No `jobs`, `matches`, `cover_letters`, `applications`, `notifications`, or `audit_events` tables exist anywhere.** This is the single largest gap — every downstream automation in Section 17 (#4 onward) is blocked on schema that doesn't exist yet.
2. **No admin/role model exists.** Job ingestion, and any future admin dashboard, has nowhere to authorize from.
3. **The `cv_analyses` review/approval flow has no write-capable API.** The dashboard renders review states, but no code path can ever set `review_status`, so "user reviews/confirms" (workflow step 7–8) cannot function even once an AI worker exists, until this route is built.
4. **`cvs_user_id_key` vs. `cvs_one_active_per_user` conflict is unresolved**, blocking CV replacement/reprocessing (workflow step 23).
5. **Next.js has open high-severity advisories** (SEC-01) that should be closed before any of this automation is exposed to real traffic.
6. **The in-progress `/news` branch risks a CI build failure** (Section 15) — should be resolved (or at minimum confirmed) before merging, independent of the automation work.
7. **No automated test suite exists** — AGENTS.md §12/§25 require tests for important flows; none currently exist for even the implemented flows (signup, CV upload, preferences).
8. **No account-deletion route exists**, so workflow step 24 (delete account + sensitive CV data) and the retention gap in SEC-05 cannot be closed yet.

None of these are reasons to distrust what already exists (Sections 9–10 found the implemented auth/RLS/storage surface to be genuinely sound) — they are the concrete, itemizable list of what to build next.

---

## 19. Prioritized Remediation Plan

| Order | Action | Reason | Files/database objects affected | Risk if skipped | Must finish before |
|---|---|---|---|---|---|
| 1 (P0) | Design and migrate `jobs`, `matches`, `cover_letters`, `applications`, `notifications`, `audit_events` schema, reusing the `analysis_tasks`/`cv_analyses` RLS + idempotency + partial-unique-index patterns | Nothing past CV analysis can be built without a destination table | New migrations only (additive) | Every downstream automation stays permanently blocked | Any job-ingestion or matching automation work |
| 2 (P0) | Design and migrate an admin role/claim model (e.g., a `user_roles` table or a claim on `profiles`, checked server-side in every admin route) | Job ingestion and any admin surface has no authorization boundary today | New migration + new RLS policies | An admin feature built without this would have no way to distinguish an admin from any other authenticated user | Job-ingestion automation (#4 in Section 17) |
| 3 (P0) | Build the CV-analysis review/approval server route (re-derive `auth.uid()`, validate `review_status` transitions, enforce the existing `cv_analyses_one_approved_per_user`/`_one_current_per_user` invariants) | Workflow steps 7–8 have no write path today | `src/app/api/...` (new route), no schema change needed | The AI-parsing worker would produce results nobody can ever approve | Matching automation (which must only read *approved, current* analyses) |
| 4 (P0) | Resolve the `cvs_user_id_key`/`cvs_one_active_per_user` conflict per the migration's own documented plan | Blocks CV replace/reprocessing; a client `.upsert(onConflict:"user_id")` call is silently relying on the constraint that needs to be removed | `supabase/migrations/*` (new migration), `src/app/onboarding/upload-cv/page.tsx` (must switch off `.upsert` once the partial index is the only unique constraint) | Any attempt to add CV versioning later becomes a breaking migration under load instead of a clean one now | CV re-upload/reprocessing automation (workflow step 23) |
| 5 (P1) | Upgrade Next.js to `16.3.0`+ (and re-run `npm audit`) | Closes SSRF/DoS/cache-confusion advisories (SEC-01) | `package.json`, `package-lock.json` | Deployed instance carries known, fixed vulnerabilities | Real users / production traffic |
| 6 (P1) | Add server-side CV file-signature validation | Closes SEC-02; extraction automation should not trust a spoofable MIME type | `src/app/onboarding/upload-cv/page.tsx` and/or a new server-side check invoked during extraction | A malicious file could pass every current check | CV extraction automation |
| 7 (P1) | Confirm/fix the `/news` branch's CI env-var gap before merging | Section 15 — real risk of a broken CI build or an unintended external call during build | `.github/workflows/ci.yml`, or the news code's build-time fallback behavior | Silent CI breakage on this feature branch | Merging `fix/news-page-brief-loading` |
| 8 (P1) | Add a worker claim function for `analysis_tasks` (`for update skip locked`, respecting `superseded_at`) | The queue exists but nothing can safely claim from it under concurrency | New migration (function only) | Two workers could double-process the same task without this | Any CV-analysis worker |
| 9 (P1) | Add Storage cleanup to a new account-deletion route | Closes SEC-05 | New route + Storage `.remove()` call | Orphaned CV files persist indefinitely after account deletion | Public launch / real user data |
| 10 (P2) | Add `create index on analysis_tasks (user_id)` | Consistency with every other user-owned table's RLS-supporting index | New migration | Sequential scans on RLS-filtered reads as the table grows | Meaningful production data volume |
| 11 (P2) | Configure security headers/CSP | AGENTS.md §32 pre-launch requirement | `next.config.ts` (`headers()`) | Standard clickjacking/MIME-sniffing exposure | Public production launch |
| 12 (P2) | Add `npm audit --audit-level=high` (or Dependabot) to CI | Prevents SEC-01-style regressions from going unnoticed | `.github/workflows/ci.yml` | Vulnerable dependencies could silently reappear | Public production launch |
| 13 (P2) | Remove or clearly deprecate `src/lib/demoAuth.ts`/`RequireDemoAuth.tsx` | Dead code with auth-sounding names risks future misuse | Delete or comment as deprecated | Low today (unused); a future engineer could mistake it for real protection | Before onboarding new engineers to the auth code |
| 14 (P3) | Add automated tests for signup/login/CV-upload/preferences flows | AGENTS.md §12/§25 requirement, currently unmet | New `*.test.*` files, a test runner added to `package.json` | Regressions in implemented flows go undetected | Ongoing feature work / before claiming "production ready" |
| 15 (P3) | Add composite index `analysis_tasks (cv_id, created_at desc)` | Minor query-shape optimization for the dashboard's "latest task" lookup | New migration | Negligible today; grows with per-CV task history | Meaningful production data volume |

---

## 20. Final Go/No-Go Decision

- **Is the database structurally ready for CV automation?** **GO WITH REQUIRED FIXES.** The `cvs`/`analysis_tasks`/`cv_analyses` schema, RLS, and idempotency design are sound and ready to build an extraction/parsing worker against — but the review/approval write path (Item 3) and the `cvs` unique-constraint conflict (Item 4) must be resolved first for the automation to be *usable* end to end, not merely runnable.
- **Is authentication secure enough for real users?** **GO WITH REQUIRED FIXES.** The implemented signup/login/session/middleware/server-authorization pattern is genuinely well-built and re-verifies identity server-side everywhere checked — no IDOR or middleware-only-trust pattern was found. Missing: password reset flow, and the Next.js version upgrade (SEC-01) should land before real production traffic.
- **Is CV storage private enough for real user data?** **GO WITH REQUIRED FIXES.** Private bucket, folder-scoped policies, DB-layer defense in depth, no public URLs — sound. Add server-side file-signature validation (SEC-02) and Storage cleanup on deletion (SEC-05) before real user CVs are stored at scale.
- **Are RLS policies safe for a multi-user application?** **GO.** Every private table has RLS enabled with `auth.uid()`-scoped policies, `WITH CHECK` present wherever ownership could otherwise be reassigned, no overly broad policy found, and `anon` has no access to any private table. This is the strongest part of the current build.
- **Are the current indexes sufficient for the beta?** **GO.** The existing tables' indexes fully support their actual current query patterns; the one gap (`analysis_tasks.user_id`, Item 10) is low-cost and low-urgency at today's expected beta data volume.
- **Which indexes are required before scaling?** `analysis_tasks (user_id)` now (cheap, consistent); `analysis_tasks (cv_id, created_at desc)` as task history grows; the full index design for `jobs`/`matches`/`applications` (Section 12) must be authored alongside those tables' migrations, not retrofitted after they fill up.
- **Is the website connected end to end?** **NO — by design, not by defect.** Signup through preferences is fully connected. CV review, matching, cover letters, and approve/reject are intentionally UI-only mock states, honestly labeled in code as not yet wired to a backend that doesn't exist.
- **Can we begin CV analysis automation now?** **GO WITH REQUIRED FIXES.** Start with Items 1 (P0, if the team also wants matching soon — otherwise this can follow), 3, 4, and 8 from Section 19 before or alongside building the extraction/parsing worker itself; the worker's *destination schema* (`cv_analyses`) and *queue* (`analysis_tasks`) are ready today.
- **What exact blockers must be resolved first?** In order: (1) CV-analysis review/approval route (Item 3), (2) `cvs` unique-constraint conflict (Item 4), (3) worker claim function (Item 8), (4) Next.js upgrade (Item 5) before any of this is user-facing in production, (5) admin role model (Item 2) only if job ingestion is the next automation after CV analysis.
- **What is the recommended first automation after the blockers are resolved?** **CV text extraction + AI structured parsing** (Section 17, #1–#2), because their schema (`cv_analyses`) and queue (`analysis_tasks`) already exist and are sound, the review/approval route (Item 3) is a small, contained piece of work, and this automation delivers the next real product value (an AI Career Profile the user can actually see and approve) without requiring the much larger `jobs`/`matches`/`applications` schema design that job-matching automation would need first.

---

*This audit reflects the repository and local database state as of 2026-08-08. No files other than this report were created or modified; all in-progress changes on `fix/news-page-brief-loading` were left exactly as found.*
