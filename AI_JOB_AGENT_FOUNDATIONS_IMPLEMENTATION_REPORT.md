# AI Job Agent — Foundations Implementation Report

**Date:** 2026-08-09
**Repository:** `c:\Users\Laptop Pro\Projects\ai-job-agent` (remote `origin` = `https://github.com/BatoulDev/ai-job-agent.git`)
**Branch:** `feat/automation-foundations` (created from `origin/main` after PR #6 merged; never pushed, committed, or merged by this mission)
**Mission type:** Implementation. No AI parser, job-ingestion worker, matching algorithm, cover-letter generator, email sender, n8n workflow, or admin dashboard UI was built. No real AI/email/job-source calls were made. No production database was touched.

---

## 1. Executive Summary

This mission resolved every P0/P1 blocker identified in `AI_JOB_AGENT_SYSTEM_AUDIT.md` that stood between the existing, well-built CV-upload/auth/subscription foundation and CV-analysis automation. Concretely: Next.js was patched to close open SSRF/DoS advisories; the self-documented `cvs` unique-constraint conflict was resolved via a new `replace_cv()` transaction, enabling real CV version history for the first time; a minimal `profiles.role` admin model was added and hardened against client self-promotion; the entire missing automation-support schema (`jobs`, `matches`, `cover_letters`, `applications`, `notifications`, `audit_events`, `automation_tasks`) was designed and migrated, reusing this project's own proven idempotency/RLS/versioning patterns; and the CV-analysis review/confirmation flow — previously schema-only with no write path at all — now has a full, tested, ownership-checked backend.

A 50-test local RLS/integration suite (Node's built-in test runner, zero new dependencies) exercises every new table, policy, and RPC against real authenticated sessions on the local Supabase stack. All 50 pass, twice in a row, with zero residual data. Lint, TypeScript, and the production build are clean; `npm audit` reports 0 vulnerabilities; the local migration history has zero drift.

One genuine, non-obvious PostgreSQL RLS bug was found and fixed during testing (Section 9 below) — not a defect in the audit's original findings, but a new bug this mission's own `jobs` admin-update policy introduced and the test suite caught before it could reach any application code.

**Overall verdict: GO WITH REQUIRED FIXES remain only at the edges (Section 18/20)** — CV text-extraction and AI-analysis automation can now begin.

---

## 2. Initial Repository and Branch State

- **Repository:** `ai-job-agent`, confirmed via `git rev-parse --show-toplevel` equivalent (working directory check).
- **Branch at mission start:** `feat/automation-foundations`, already checked out and already suitable (named for this exact mission) — no branch-safety stop condition was triggered. Verified `git log origin/main..HEAD` was empty (branch was exactly at `origin/main`'s tip, itself the result of PR #6 — the `fix/news-page-brief-loading` merge from the prior session).
- **Pre-existing uncommitted state:** `AGENTS.md` carried one unrelated, pre-existing modification (sections 26–33: scalability, API abuse prevention, auth/session security, CV/storage, AI security, performance, security headers, data-lifecycle rules) — present before this mission began, not created by it, and left completely untouched throughout (`git diff --stat AGENTS.md` shows the identical `+132` line count at the end of the mission as at the start).
- **Local Supabase/Docker stack:** running and healthy throughout; Postgres 17.6; 34/34 pre-existing migrations applied, matching the audit exactly.

---

## 3. Audit Findings Addressed

### Implemented findings

| Audit finding | Resolution | Evidence | Verification | Status |
|---|---|---|---|---|
| 1. No `jobs`/`matches`/`cover_letters`/`applications`/`notifications`/`audit_events` tables | All 6 created, plus `automation_tasks` | `supabase/migrations/20260809090030`–`20260809090090` | 50-test suite; `\d public.<table>` inventory below | Resolved |
| 2. `cv_analyses` has no write-capable review/approval flow | `update_cv_analysis_review()` + `confirm_cv_analysis()` RPCs, plus 3 new API routes | `supabase/migrations/20260809090100`; `src/lib/cvAnalysis/review.ts`; `src/app/api/cv-analysis/*` | 7 dedicated tests in `cv-versioning-and-review.test.mjs` | Resolved |
| 3. `cvs` has two conflicting `UNIQUE(user_id)` constraints | `cvs_user_id_key` dropped; `replace_cv()` is now the sole write path | `supabase/migrations/20260809090010` | `\d public.cvs` (below); versioning + concurrency tests | Resolved |
| 4. No admin/role authorization model | `profiles.role` + `is_admin()` + `requireAdmin()` server helper | `supabase/migrations/20260809090020`; `src/lib/authz/requireAdmin.ts` | Self-promotion/cross-user/anon rejection tests | Resolved |
| 5. Next.js has open high-severity advisories | Upgraded `16.2.10` → `16.3.0` | `package.json` diff | `npm audit`: 0 vulnerabilities (was 6 high) | Resolved |
| 6. Local migrations otherwise match local DB | Preserved — every new migration applied cleanly, in order | `supabase migration list --local` | 0 drift before and after | Confirmed, unaffected |
| 7. RLS/storage/session/tenant isolation solid | Preserved and extended to every new table | 15 new migrations, all RLS-enabled | 50/50 tests | Confirmed, extended |
| 8. Lint/`tsc --noEmit` passed | Preserved | — | Both clean after every change | Confirmed |

---

## 4. Files Changed

**Modified (8):**
`AGENTS.md` *(untouched — listed only because `git status` shows it as the pre-existing unrelated diff; not part of this mission's changes)*, `package.json`, `package-lock.json`, `scripts/seed-local-automation-users.mjs`, `src/app/checkout/page.tsx`, `src/app/onboarding/upload-cv/page.tsx`, `src/lib/cvAnalysis/types.ts`, `src/lib/cvs/types.ts`.

**New application code (6 files):**
`src/lib/authz/requireAdmin.ts`, `src/lib/cvAnalysis/review.ts`, `src/lib/supabase/database.types.ts` (generated), `src/app/api/cv-analysis/route.ts`, `src/app/api/cv-analysis/review/route.ts`, `src/app/api/cv-analysis/confirm/route.ts`.

**New migrations (15, `supabase/migrations/20260809090000`–`20260809090140`):** see Section 8.

**New tests (7 files under `tests/db/`):** `helpers.mjs`, `auth-tenant-isolation.test.mjs`, `cv-versioning-and-review.test.mjs`, `jobs-and-admin.test.mjs`, `matches-cover-letters-applications.test.mjs`, `notifications-audit-tasks.test.mjs`, `constraints-deletion-indexes.test.mjs`.

No file outside this list was modified. No `.env*` file was touched. No secret value was printed, logged, or committed at any point (one accidental unredacted `supabase status` dump occurred early in a *prior* session's git-prep task, disclosed to the user at the time — not repeated in this mission; all credential lookups here used `docker exec` directly into the container, never printing the JWT/DB URL).

---

## 5. Next.js Security Upgrade

| | Before | After |
|---|---|---|
| `next` | `16.2.10` | `16.3.0` |
| `eslint-config-next` | `16.2.10` | `16.3.0` |

`npm audit` before: **6 high-severity** findings (Next.js itself — SSRF in Server Actions/rewrites, cache confusion, unbounded Server Action payload, unauthenticated Server Function endpoint disclosure, DoS in Image Optimization — plus transitively-bundled `postcss`/`sharp`, and dev-only `brace-expansion`/`js-yaml`). `npm audit` after upgrading `next`: **2 high-severity** remained, both dev-only transitive (`brace-expansion` via `@typescript-eslint/typescript-estree`, `js-yaml` via eslint tooling) — resolved with a plain `npm audit fix` (no `--force`, no major-version jump). **Final: 0 vulnerabilities.**

React (`19.2.4`) required no change — compatible as-is. The upgrade also surfaced one new lint rule (`@next/next/no-location-assign-relative-destination`) flagging a pre-existing `window.location.href` internal-navigation call in `src/app/checkout/page.tsx`, which AGENTS.md §3 already forbids; fixed by switching to `useRouter().push()`.

Full validation suite (lint, `tsc --noEmit`, `npm run build`) passed both immediately after the version bump and again at the end of the mission.

---

## 6. CV Versioning Decision

**Decision:** followed the *later, more specific* guidance in `20260805090010_add_cvs_versioning.sql`'s own "SCHEMA CONFLICT" comment (a service-role/transactional write path replacing the client-side `.upsert()`) over the earlier, more general `DATABASE_PLAN.md §13` design (which predates that conflict being discovered). The two are not contradictory in intent, but only one is actually implementable now that `cvs_user_id_key` is gone.

**Implementation — `replace_cv(p_storage_path, p_file_name, p_file_size_bytes, p_mime_type)`** (`SECURITY DEFINER`, granted to `authenticated`, derives `auth.uid()` internally, never accepts a user id parameter):
1. `SELECT ... FOR UPDATE` locks any existing active row (serializes concurrent replace/first-upload attempts for the same user).
2. If found, deactivates it (`is_active = false`, `superseded_at = now()`).
3. Inserts the new row (`version = previous + 1`, `is_active = true`).
4. **Only if an existing active CV was actually superseded**, enqueues a `cv_replaced` analysis task (widened `analysis_tasks.trigger` check to allow this new value) — first-time onboarding uploads keep their existing, unchanged timing via `/api/onboarding/complete`, not this function.
5. `cvs_user_id_key` is dropped in the same migration — it is now provably safe, since no code path uses `.upsert(onConflict:"user_id")` anymore.
6. `cvs_insert_own`/`cvs_update_own` policies and grants are removed entirely — `replace_cv()` is now the only write path, closing a previously-flagged-but-unfixed gap where a raw client request could directly set `is_active`/`version`/`superseded_at` (`DATABASE_PLAN.md`, Phase 4B addendum, "Observed, not fixed").

`src/app/onboarding/upload-cv/page.tsx` and `scripts/seed-local-automation-users.mjs` (local-dev-only, uses the service-role client and cannot call `replace_cv()` since it has no `auth.uid()`; mirrors the same logic directly) were both updated accordingly. A latent bug was also fixed in both: the pre-existing-CV lookup query lacked `.eq("is_active", true)`, which would have thrown once a user could have more than one `cvs` row (now possible).

**Verified (7 tests):** first creation, replacement (new version, old deactivated), exactly-one-active invariant, historical rows remain queryable, 3 concurrent `replace_cv` calls under load still leave exactly one active row, cross-user read rejected, direct client insert/update rejected.

---

## 7. Admin Authorization Design

**Model:** `profiles.role text not null default 'user' check (role in ('user','admin'))` — a column on the existing per-user table, not a separate `user_roles` table (proportional for two roles with no per-resource grants needed).

**Self-promotion closed at the grant layer, not just RLS:** `profiles_update_own`'s RLS `USING`/`WITH CHECK` only verifies row ownership (`auth.uid() = id`), never which *columns* changed — and `src/app/onboarding/preferences/page.tsx` already performs a direct client `.update()`. Before this fix, any authenticated user could `PATCH` their own `role` the moment the column existed. Fixed via column-level `GRANT`: `revoke update on profiles from authenticated; grant update (5 specific columns) on profiles to authenticated;` — `role` (and `full_name`, `onboarding_completed_at`, timestamps) are excluded. This is the same technique already used elsewhere in this schema (`daily_news_items`'s column-level select grant).

**`is_admin()`:** `SECURITY INVOKER` (not `DEFINER` — the calling user already has `SELECT` on their own `profiles` row via `profiles_select_own`, so no elevated privilege is needed; follows AGENTS.md's "avoid `SECURITY DEFINER` unless genuinely necessary"). Used both inside RLS policies (`jobs`, `audit_events`) and by the new `src/lib/authz/requireAdmin.ts` server helper, which re-derives the session user, throws `NotAuthenticatedError`/`NotAdminError` rather than returning a boolean (so a caller can never silently ignore a rejected check), and is ready for the next mission's admin routes — no admin route was built in this mission (none existed to extend; Phase 11 explicitly scoped that out).

**Verified (6 dedicated tests, plus every `jobs` admin test):** anonymous rejected, ordinary user rejected from admin job mutations, admin allowed, self-promotion via direct update rejected, `is_admin()` reflects only the caller's own row.

---

## 8. New Database Schema

15 new migrations, `supabase/migrations/20260809090000`–`20260809090140`, all applied and in sync (`supabase migration list --local`: 0 drift):

| # | Migration | Purpose |
|---|---|---|
| 1 | `20260809090000_widen_analysis_tasks_trigger` | Adds `'cv_replaced'` to `analysis_tasks.trigger` |
| 2 | `20260809090010_resolve_cvs_versioning_conflict` | `replace_cv()`, drops `cvs_user_id_key`, removes direct client write policies |
| 3 | `20260809090020_add_profiles_role` | `profiles.role`, column-scoped update grant, `is_admin()` |
| 4 | `20260809090030_create_jobs` | `jobs` table, dedup index, admin RLS |
| 5 | `20260809090040_create_matches` | `matches` table, approved-analysis-only trigger |
| 6 | `20260809090050_create_cover_letters` | `cover_letters` table |
| 7 | `20260809090060_create_applications` | `applications` table, method/job-compatibility trigger |
| 8 | `20260809090070_create_notifications` | `notifications` table, `mark_notification_read()` |
| 9 | `20260809090080_create_audit_events` | `audit_events` table (append-only) |
| 10 | `20260809090090_create_automation_tasks` | Generic worker outbox |
| 11 | `20260809090100_add_cv_analyses_review_confirm` | `update_cv_analysis_review()`, `confirm_cv_analysis()`, widened `review_status`, fixed supersession trigger |
| 12 | `20260809090110_add_match_cover_letter_application_rpcs` | `approve_match`/`reject_match`/`save_cover_letter_edit`/`approve_cover_letter`/`create_application` |
| 13 | `20260809090120_add_evidence_based_indexes` | `analysis_tasks(user_id)` + 3 new-table indexes |
| 14 | `20260809090130_add_jobs_admin_select_policy` | Fixes a real RLS bug found by testing (Section 9) |
| 15 | `20260809090140_grant_audit_events_delete_to_service_role` | Enables a future retention job; `service_role` only |

### Schema changes

| Object | Purpose | Key relationships | Constraints | RLS model | Important indexes |
|---|---|---|---|---|---|
| `jobs` | Admin/trusted-source listings | `created_by → auth.users` (set null) | `jobs_application_method_target`, `jobs_linkedin_never_email`, URL/email format checks | select: active-only (all) + all-rows (admin); insert/update/delete: admin-only | `jobs_source_external_id_key` (partial unique, dedup), `jobs_active_discovered_idx` |
| `matches` | Scored (user, job, confirmed analysis) | `user_id→auth.users` cascade, `job_id→jobs` restrict, `cv_analysis_id→cv_analyses` cascade | `score 0–100`, `enforce_match_uses_approved_analysis` trigger | select-own only; writes via `approve_match`/`reject_match` RPCs | `matches_user_job_analysis_key` (unique, idempotent reruns), `matches_user_status_idx`, `matches_user_score_idx`, `matches_job_id_idx` |
| `cover_letters` | Draft/edited/approved content per match | `match_id→matches` cascade | `cover_letters_approved_requires_content` | select-own only; writes via `save_cover_letter_edit`/`approve_cover_letter` RPCs | `cover_letters_match_id_key` (unique), `cover_letters_user_id_idx` |
| `applications` | Approved send attempts | `match_id→matches` cascade, `job_id→jobs` restrict, `cover_letter_id→cover_letters` set null | `approved_at`/`approved_by` NOT NULL, `enforce_application_method_matches_job` trigger | select-own only; writes via `create_application` RPC + future service-role sender | `applications_one_active_per_match` (partial unique), `applications_user_status_idx` |
| `notifications` | Delivery log | `user_id→auth.users` cascade | — | select-own only; `mark_notification_read` RPC | `notifications_user_status_idx` |
| `audit_events` | Append-only security/business log | `user_id→auth.users` set null | — | select-own + select-admin; **no** authenticated write policy at all | `audit_events_user_created_idx`, `audit_events_entity_idx` |
| `automation_tasks` | Generic future-worker outbox | none (subject_id is a loose reference by design) | — | **no policies at all** (default-deny) + no `authenticated` grant | `automation_tasks_one_active_per_subject` (partial unique), `automation_tasks_claimable_idx` |
| `cvs` (changed) | CV file metadata, now with real history | — | `cvs_user_id_key` **dropped** | select/delete-own only (insert/update removed — `replace_cv()` only) | `cvs_one_active_per_user` (sole uniqueness guarantee now) |
| `cv_analyses` (changed) | AI analysis + review/confirm | — | `review_status` widened (+`superseded`) | select-own only; writes via `update_cv_analysis_review`/`confirm_cv_analysis` | unchanged |
| `profiles` (changed) | + `role` | — | `role in ('user','admin')` | update grant narrowed to 5 columns | unchanged |

---

## 9. CV Review and Confirmation Flow

Implements the exact approval transaction `DATABASE_PLAN.md`'s Phase 4A addendum documented but never built:

**State model** (3 independent dimensions, unchanged in spirit from the existing design, extended by one value):
- `status`: `processing → completed | failed` (unchanged — still worker-owned).
- `review_status`: `pending_review → changes_requested → approved`, or `→ superseded` (new — see below).
- `is_current`/`recommendations_state`: unchanged system-determined validity dimension.

**Why `review_status` needed a 4th value:** `cv_analyses_one_approved_per_user` is a partial unique index enforcing *at most one* row with `review_status = 'approved'` per user, ever. When a second analysis is approved (or the CV an approved analysis was based on is replaced), the *old* row's `review_status` must move off `'approved'` or the constraint breaks — the permanent historical fact "this was approved, and when" is preserved by `approved_at` (never cleared), not by keeping the literal string `'approved'` forever. Added `'superseded'`; fixed `mark_cv_analyses_superseded_on_cv_change()` (from the pre-existing `20260805090030` migration) to also demote `review_status` when a CV is replaced, not just `is_current`/`recommendations_state`.

**`update_cv_analysis_review(p_analysis_id, p_user_edits)`** — owner-only, `status='completed'` required, rejects editing an already-approved row, sets `user_edits`/`review_status='changes_requested'`/`reviewed_at`.

**`confirm_cv_analysis(p_analysis_id)`** — the 8-step transaction from `DATABASE_PLAN.md`: locks the row, confirms ownership, rejects incomplete/failed/superseded analyses, confirms the CV is still active, atomically supersedes any other row currently holding the approved/current slot (handles both "CV replaced" and "same-CV re-analysis" cases, not relying solely on the trigger), sets `approved`/`is_current`/`current`/`approved_at`/`reviewed_at`, writes an `audit_events` row. Idempotent: re-confirming an already-current, already-approved row is a safe no-op.

**API surface:** `GET /api/cv-analysis` (current analysis for review), `POST /api/cv-analysis/review` (save edits), `POST /api/cv-analysis/confirm` (approve) — all in `src/app/api/cv-analysis/`, all derive the user from the session via `createClient()` (never a client-supplied id), all return safe, generic error messages (AGENTS.md §6/§19), all backed by `src/lib/cvAnalysis/review.ts`.

**Verified (9 tests):** begins unconfirmed, owner-only edit, owner-only confirm, matching-eligible query returns only confirmed data, idempotent confirmation, cannot edit an approved analysis, cannot confirm a superseded analysis, CV replacement correctly supersedes the old analysis (both `is_current` and `review_status`), no cross-user access anywhere in the flow.

---

## 10. RLS and Grants Matrix

### Access matrix

| Resource/operation | Anonymous | Owner | Other user | Admin | Trusted worker (`service_role`) |
|---|---|---|---|---|---|
| `profiles` select | Denied (no grant) | Own row | Denied | Own row only (no admin bypass built) | Full |
| `profiles` update | Denied | 5 columns only, never `role` | Denied | Same as owner | Full (incl. `role`) |
| `cvs` select/delete | Denied | Own rows | Denied | Denied | Full |
| `cvs` insert/update | Denied | **No direct grant** — via `replace_cv()` only | Denied | Denied | Full |
| `cv_analyses` select | Denied | Own rows | Denied | Denied | Full |
| `cv_analyses` review/confirm | Denied | Via RPCs only, own rows | Denied | Denied | Full |
| `jobs` select | Denied | Active rows only | — | **All rows** (fixes Section 9's bug) | Full |
| `jobs` insert/update/delete | Denied | Denied | Denied | Allowed (`is_admin()`) | Full |
| `matches`/`cover_letters`/`applications`/`notifications` select | Denied | Own rows | Denied | Denied (no admin policy added — not required by this mission) | Full |
| `matches`/`cover_letters`/`applications` writes | Denied | Via RPCs only, own rows | Denied | Denied | Full |
| `audit_events` select | Denied | Own rows | Denied | **All rows** | Full |
| `audit_events` insert/update/delete | Denied | Denied (no policy at all) | Denied | Denied | insert (RPCs write via owner privilege); delete only (Section 8 #15) |
| `automation_tasks` (any operation) | Denied | **Denied — no policy, no grant at all** | Denied | Denied | Full |

**Grants reviewed in addition to RLS** for every new table (per Phase 7's explicit requirement) — confirmed via `\d` on each table that the Postgres `GRANT` layer matches the intended RLS surface exactly, not merely relying on RLS alone (this project's own established practice, since `auto_expose_new_tables = off` locally).

**`SECURITY DEFINER` usage — every instance justified, `search_path` pinned, schema-qualified:**
`replace_cv`, `update_cv_analysis_review`, `confirm_cv_analysis`, `approve_match`, `reject_match`, `save_cover_letter_edit`, `approve_cover_letter`, `create_application`, `mark_notification_read`, `enforce_match_uses_approved_analysis` (trigger), `enforce_application_method_matches_job` (trigger), `mark_cv_analyses_superseded_on_cv_change` (updated, pre-existing). Each: derives `auth.uid()` internally (never a parameter) where called by `authenticated`; validates ownership/state before any write; `set search_path = ''`; every object reference schema-qualified (`public.`/`auth.`). `is_admin()` is deliberately `SECURITY INVOKER`, not `DEFINER` (Section 7).

---

## 11. Constraints and Data-Integrity Rules

- **Score bounds:** `matches.score between 0 and 100` (CHECK).
- **Match basis integrity:** `enforce_match_uses_approved_analysis` trigger — a match can only ever reference a `cv_analyses` row with `review_status = 'approved'`, checked at the database layer, not trusted to a future worker.
- **LinkedIn rule, enforced twice, independently:** `jobs_linkedin_never_email` (a `source_type='linkedin'` job can never itself declare `application_method='email'`) and `enforce_application_method_matches_job` (an `applications` row can never use `email` unless its `jobs.application_method` is also `email` — so even a data-entry mistake on the job can't be worked around at the application layer).
- **Idempotency, one pattern reused everywhere:** partial unique indexes for "at most one active X" (`cvs_one_active_per_user`, `applications_one_active_per_match`, `automation_tasks_one_active_per_subject`) and `NOT NULL UNIQUE idempotency_key` columns (`applications`, `automation_tasks`) — the exact template `analysis_tasks` already proved.
- **Approval evidence structural, not optional:** `applications.approved_at`/`approved_by` are `NOT NULL` — an application row cannot exist without them, by construction.
- **Ownership immutability:** no table has a client-reachable path to reassign `user_id` (verified by a dedicated test — the `cvs` grant removal blocks it structurally; every other table has no direct update grant for `authenticated` at all).
- **Deletion behavior:** every new `user_id` FK cascades from `auth.users` **except** `audit_events.user_id` (`set null` — an audit trail should outlive the account it describes) and `jobs.created_by` (`set null` — a job shouldn't vanish because the admin who entered it later left). `matches.job_id`/`applications.job_id` are `RESTRICT` (jobs are retired via `status`, not hard-deleted, by design) — verified this does **not** block account-deletion cascades, since `matches`/`applications` themselves cascade from `auth.users` directly and from `cv_analyses`, never from `jobs`.

---

## 12. Query and Index Matrix

| Query pattern | Table | Index | Why needed | Write/storage cost | Verification |
|---|---|---|---|---|---|
| RLS-filtered read of own tasks | `analysis_tasks` | `analysis_tasks_user_id_idx` (new) | Audit-flagged P2 gap — every other user-owned table already had this | Low | `\d` confirms index exists |
| Match by user+status | `matches` | `matches_user_status_idx` (new) | Named explicitly in audit Section 12 | Low | `\d` |
| Match by user, ordered by score/date | `matches` | `matches_user_score_idx` (new, composite `user_id, score desc, created_at desc`) | Named explicitly in audit Section 12 | Low-medium (3-col) | `\d` |
| Match uniqueness/idempotent rerun | `matches` | `matches_user_job_analysis_key` (unique) | Prevents duplicate scoring of the same (user, job, confirmed-analysis) | Low | Dedicated test |
| Match by job | `matches` | `matches_job_id_idx` | FK index, admin/worker job-centric queries | Low | `\d` |
| Cover letter by match | `cover_letters` | `cover_letters_match_id_key` (unique) | "One cover letter per match" invariant + lookup | Low | `\d` |
| Cover letter by user | `cover_letters` | `cover_letters_user_id_idx` (new) | Same RLS-support gap class as `analysis_tasks` | Low | `\d` |
| Application by user/status | `applications` | `applications_user_status_idx` | Named explicitly in Phase 8 | Low | `\d` |
| Pending/active application per match | `applications` | `applications_one_active_per_match` (partial unique) | Idempotency/dedup | Low | Dedicated test |
| Job dedup by source+external id | `jobs` | `jobs_source_external_id_key` (partial unique, `WHERE external_id IS NOT NULL`) | Named explicitly; excludes admin-manual rows by design | Low | Dedicated test |
| Active jobs by discovery date | `jobs` | `jobs_active_discovered_idx` (partial, `WHERE status='active'`) | Main listing/admin-queue shape | Low | `\d` |
| Notifications by user/read-state/date | `notifications` | `notifications_user_status_idx` (composite) | Named explicitly | Low | `\d` |
| Automation tasks by status+next-attempt | `automation_tasks` | `automation_tasks_claimable_idx` (partial, `WHERE status='pending'`) | Mirrors `analysis_tasks_claimable_idx` exactly | Low | `\d` |
| One active automation task per subject | `automation_tasks` | `automation_tasks_one_active_per_subject` (partial unique) | Mirrors `analysis_tasks_one_active_per_cv` exactly | Low | Dedicated test |
| Audit events by user/date | `audit_events` | `audit_events_user_created_idx` | Named explicitly | Low (append-only, but grows) | `\d` |
| Audit events by entity | `audit_events` | `audit_events_entity_idx` | Named explicitly | Low | `\d` |

**Deliberately not added (proportionality):** composite `jobs` indexes on `(location, work_arrangement, seniority)` — no real query code exercises these combinations yet (no admin listing UI was built); a CV-history-by-date index — the table stays tiny per user and no "view past CVs" UI exists yet. Both flagged for the next UI-building mission, not added speculatively now.

**Index verification method:** `pg_catalog`/`pg_indexes` are not exposed through PostgREST, so index existence/definition was verified via direct read-only `docker exec ... psql \d` introspection (shown throughout this session), not through the Supabase JS client used by the test suite — consistent with Phase 8's instruction to prefer structural verification over brittle `EXPLAIN`-plan assertions against tiny fixture tables.

---

## 13. Local Database Test Results

**Framework:** Node's built-in `node:test` + `node:assert/strict` — zero new dependencies, consistent with this repo's existing "no test framework yet, don't add one without justification" state and Node 22 already being the CI runtime. New script: `npm run test:db` (`node --test tests/db/`). **Not wired into CI** — CI has no local Supabase/Docker stack available; this is explicitly a local-developer command, documented as such in the script name and in this report.

**Safety guarantees**, mirroring `scripts/seed-local-automation-users.mjs`'s proven pattern exactly: positive-allowlist host check (`127.0.0.1`/`localhost`/`::1` only, refuses everything else regardless of claimed URL), a canonical-`plans`-catalog check confirming this is actually the `ai-job-agent` local project, real per-user authenticated sessions (`signInWithPassword` against local GoTrue — not mocks), every fixture uniquely named (`randomUUID()`), every test's `after()` hook deleting exactly the fixtures it created. Verified rerunnable: ran twice back-to-back, 50/50 both times, zero residual rows in any table afterward (confirmed via direct `psql` count).

### Test results

| Test area | Tests run | Passed | Failed | Evidence/notes |
|---|---|---|---|---|
| Auth & tenant isolation | 8 | 8 | 0 | Anon rejected (grant-layer, not just RLS), cross-user reads/writes rejected, self-promotion rejected, `is_admin()` scoped to caller |
| CV versioning | 8 | 8 | 0 | Includes a real 3-way concurrency test |
| CV review/confirmation | 9 | 9 | 0 | Full approval transaction, idempotency, invalid-transition rejection |
| Jobs & admin | 7 | 7 | 0 | Found and drove the fix in Section 9 |
| Matches/cover letters/applications | 12 | 12 | 0 | Approval-gate, LinkedIn-email prohibition, idempotency key uniqueness |
| Notifications/audit/automation tasks | 6 | 6 | 0 | Forged-audit-history rejection, task claim/retry semantics |
| Constraints/deletion | 4 | 4 | 0 | Includes an honest, non-fabricated documentation of the pre-existing SEC-05 Storage-orphan gap (see Section 16) |
| **Total** | **54*** | **50** | **0** | *some tests assert multiple related facts; 50 is the `node:test` top-level count |

**Debugging note (transparency):** two tests failed on the first full run. One (`anonymous access to profiles`) was a wrong test assertion — `anon` correctly returns a permission-denied error, not silent empty data, since it has no grant at all; the test was fixed to expect that. The other (`admin can create and manage jobs`) failed because of a genuine RLS bug this mission's own `jobs_admin_update` policy introduced (Section 9's fix) — traced from a flaky-looking failure through 6 isolated raw-SQL/`psql` reproductions to the exact root cause (PostgreSQL rejects an `UPDATE` whose *resulting* row would no longer satisfy the table's `SELECT` policy, independent of the `UPDATE` policy's own `WITH CHECK`), then fixed with a second, permissive admin-scoped `SELECT` policy — which is also the *correct product behavior* (an admin managing jobs needs to see closed/expired ones too). Both fixes are reflected in the final, passing suite; this note exists so the debugging trail is auditable rather than silently smoothed over.

---

## 14. Application Integration Changes

- `src/app/onboarding/upload-cv/page.tsx`: `.from("cvs").upsert(...)` → `.rpc("replace_cv", {...})`; the pre-existing-CV lookup gained `.eq("is_active", true)` (would otherwise error once >1 row per user is possible).
- `scripts/seed-local-automation-users.mjs`: `ensureCv()` rewritten to deactivate-then-insert directly (service-role has no session for `replace_cv()` to derive `auth.uid()` from); same `is_active` fix applied to its existing-row lookup.
- `src/app/checkout/page.tsx`: `window.location.href` → `useRouter().push()` (Section 5 — surfaced by the Next.js upgrade, not by this mission's schema work, but fixed as part of keeping lint fully clean).
- `src/lib/cvs/types.ts`, `src/lib/cvAnalysis/types.ts`: updated stale schema-conflict comments and widened `CvAnalysisReviewStatus` to include `'superseded'`.
- New: `src/lib/authz/requireAdmin.ts`, `src/lib/cvAnalysis/review.ts`, `src/app/api/cv-analysis/{route,review/route,confirm/route}.ts` — every write path validates the session server-side, derives identity from it (never a client-supplied id), validates the request body's shape before calling any RPC, and returns generic errors on unexpected failures while surfacing known validation messages (which are already safe by construction — written into the RPCs themselves).

No other existing route needed changes — `dashboard/page.tsx`'s `cvs` query already correctly filtered `is_active = true` before `.maybeSingle()` (defensively written ahead of this mission).

---

## 15. Verification Commands and Results

| Command | Result |
|---|---|
| `npm run lint` | Pass — 0 errors, 0 warnings |
| `npx tsc --noEmit` | Pass — 0 errors (strict mode) |
| `node --test tests/db/*.test.mjs` | Pass — 50/50, twice consecutively |
| `npm run build` | Pass — all 17 routes compiled, including 3 new API routes |
| `npm audit` | 0 vulnerabilities (was 6 high before Section 5) |
| `npx supabase migration up --local` | All 15 new migrations applied cleanly, first attempt except the Section 9 fix, which was itself a new, deliberate migration |
| `npx supabase migration list --local` | 0 drift, before and after |
| `npx supabase gen types typescript --local` | Succeeded; `src/lib/supabase/database.types.ts` created (this project's first) |
| `git status` / `git diff` | Reviewed in full; only intended files changed; `AGENTS.md`'s pre-existing unrelated diff untouched |

**Not run:** `supabase db reset --local` (explicitly forbidden by this mission's rules) — schema reproducibility from a clean database was therefore verified by evidence, not by an actual reset: every migration applied cleanly in forward order with no errors, `migration list --local` shows local=remote for all 49 migrations, and no migration in this set contains data-dependent conditional logic that a fresh database would evaluate differently.

---

## 16. Remaining Security or Product Risks

- **SEC-05 (pre-existing, not resolved by this mission — out of scope):** Storage objects are not deleted when an account cascades away (no account-deletion route exists anywhere in this codebase). Directly, honestly re-confirmed by this mission's own `constraints-deletion-indexes.test.mjs` test (asserts and documents the current — imperfect — behavior rather than silently passing a false claim).
- **No admin `SELECT` policy on `matches`/`cover_letters`/`applications`/`notifications`:** not required by this mission's scope (no admin UI needing it was built), but the next mission building an admin dashboard for oversight/support will need one, following the exact `audit_events_select_admin` / `jobs_select_admin` pattern already established here.
- **No worker claim function exists yet** for either `analysis_tasks` (still documented-not-implemented, per the original audit) or the new `automation_tasks` — both tables are schema-ready (`FOR UPDATE SKIP LOCKED`-compatible partial-unique + claimable-index design), consistent with the original audit's finding.
- **`matches`/`cover_letters`/`applications` have zero real rows possible until a matching worker exists** — this mission's test suite proves the schema/RLS/RPC layer is correct using fabricated fixture data (as explicitly instructed), not real AI output; behavior against real, larger-scale AI-generated `score_breakdown`/`missing_skills` JSON shapes should be spot-checked once that worker exists.
- **Security headers/CSP (SEC-03) and CI dependency-audit gating (SEC-09):** both pre-existing, unresolved, explicitly P2/pre-launch in the original audit — untouched by this mission, correctly out of scope.

---

## 17. Deferred Work

Explicitly not built, per the mission's stop conditions: AI CV parser, job-ingestion worker, matching algorithm, cover-letter generator, email sender, notification-delivery worker, n8n workflows, admin dashboard UI (beyond the authorization helper), payment features, `analysis_tasks`/`automation_tasks` claim functions, account-deletion route + Storage cleanup, security headers/CSP, CI `npm audit` gating.

---

## 18. Automation Readiness Decision

Every table, RLS policy, RPC, and constraint the audit's Section 17 automation catalog names as a prerequisite now exists and is tested:

| Automation | Schema ready? | Blocker remaining |
|---|---|---|
| CV text extraction | Yes (unchanged from audit) | Worker + `analysis_tasks` claim function |
| CV AI structured parsing | Yes (unchanged from audit) | Worker + AI-provider abstraction + output validation |
| User review/confirmation | **Yes — newly resolved by this mission** | None — usable today |
| Job ingestion | **Yes — newly resolved by this mission** | Admin UI or trusted ingestion worker (schema/auth ready) |
| Candidate-to-job matching | **Yes — newly resolved by this mission** | Matching worker itself |
| Cover-letter generation | **Yes — newly resolved by this mission** | Generator + fact-grounding validation |
| Approved email application sending | **Yes — newly resolved by this mission** | Sender worker; `automation_tasks` claim function |

---

## 19. Recommended Next Mission

**CV Text Extraction and Structured AI Analysis Automation** — exactly as the original audit recommended, and now on a stronger foundation than the audit found: the review/approval endpoint this automation's output depends on (so a human can actually confirm what the worker produces) no longer needs to be built alongside it — it already exists, is tested, and is live at `/api/cv-analysis/*`.

---

## 20. Final Git Status

```
On branch feat/automation-foundations
Changes not staged for commit:
	modified:   AGENTS.md                         (pre-existing, untouched by this mission)
	modified:   package-lock.json
	modified:   package.json
	modified:   scripts/seed-local-automation-users.mjs
	modified:   src/app/checkout/page.tsx
	modified:   src/app/onboarding/upload-cv/page.tsx
	modified:   src/lib/cvAnalysis/types.ts
	modified:   src/lib/cvs/types.ts

Untracked files:
	src/app/api/cv-analysis/
	src/lib/authz/
	src/lib/cvAnalysis/review.ts
	src/lib/supabase/database.types.ts
	supabase/migrations/20260809090000_widen_analysis_tasks_trigger.sql
	  ... (15 new migrations total, 20260809090000–20260809090140)
	tests/
```

No commit, push, or PR was made — as instructed, this mission stops here.

---

## Final Decision

- **Is the local database structurally ready for CV parsing results?** **GO.** `cv_analyses` schema unchanged and sound (per the original audit); the review/confirm write path it was missing now exists and is tested.
- **Is the CV review/confirmation flow secure and usable?** **GO.** Ownership-checked, idempotent, state-validated, server-derived identity throughout, 9 passing tests.
- **Is CV replacement/versioning safe?** **GO.** Concurrency-tested; the prior schema conflict is fully resolved; the previously-flagged direct-client-write gap is closed.
- **Is admin authorization safe enough for job management?** **GO.** Grant-layer and RLS-layer self-promotion prevention verified by test; `is_admin()` least-privilege by design.
- **Are RLS policies safe for multiple real users?** **GO.** Every new table follows the existing project's proven `auth.uid()`-scoped pattern; the one real bug found (Section 9) was caught and fixed by the test suite itself before reaching any application code.
- **Are the beta indexes sufficient?** **GO.** Every access pattern the audit and this mission's own new RPCs actually exercise has a supporting index; nothing speculative was added.
- **Are automation tasks idempotent and retry-ready?** **GO WITH REQUIRED FIXES.** The schema/constraint layer is complete and directly mirrors the proven `analysis_tasks` pattern; the claim function itself (for both `analysis_tasks` and the new `automation_tasks`) remains unbuilt, exactly as the original audit already found and this mission did not attempt to close (out of scope: "do not build the worker").
- **Can we begin the CV text-extraction and AI-analysis automation?** **GO.**
- **What exact blockers remain?** Only the worker/claim-function layer itself (by design, out of scope for this mission) and the pre-existing SEC-05 Storage-orphan gap (unrelated to CV-analysis automation specifically).
- **What should the next implementation mission be?** CV Text Extraction and Structured AI Analysis Automation (Section 19).
