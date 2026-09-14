# Job Ingestion and Job Matching — Database Readiness Audit

**Audit date:** 2026-09-14
**Audit type:** Read-only. No application code, migrations, database objects, or n8n workflows were modified, created, or executed. No SQL was run against any database. No `git` state-changing command was executed (no commit, stage, push, branch switch, merge, or rebase).
**Requested by:** Batoul Abdelrahman, in preparation for building the Job Ingestion and Job Matching automations.

---

## 1. Executive Summary

The foundation built to date (auth, profiles, CV upload/versioning, job preferences, subscriptions/pricing, CV-analysis lifecycle) is genuinely solid — every table has RLS, every privileged write goes through a narrowly-scoped `SECURITY DEFINER` function, ownership is re-derived from `auth.uid()` everywhere checked, and several previously-documented defects (the `cvs_user_id_key` conflict, the missing CV-analysis approval path) have since been **fixed and are now confirmed resolved** in the current migration history — contradicting an earlier (2026-08-08) audit that is now stale and must not be trusted.

The **downstream job/match/application schema already exists**: `jobs`, `matches`, `cover_letters`, `applications`, `notifications`, `audit_events`, and `automation_tasks` were all created on 2026-08-09 and are present today, along with RLS policies, admin-only write gating (`is_admin()`), a canonical matching-eligibility gate (`is_cv_analysis_matching_eligible()`), and local (not-yet-CI) test coverage (`tests/db/jobs-and-admin.test.mjs`, `tests/db/matches-cover-letters-applications.test.mjs`). This directly contradicts a second point of confusion in the brief: **the tables are not missing** — what is missing is the *automation* that populates and consumes them (no ingestion worker, no matching worker, no admin UI, no `automation_tasks` claim function).

The company/job-source registry is CSV-only (588 rows, 557 unique companies, zero duplicate ids, well-structured, LinkedIn-compliant) with **no backing database table** — this is the single largest structural gap for *ingestion* readiness specifically, and is addressed in Section 8.

Two contradictions must be reported prominently rather than silently resolved, per the audit's own instructions:
1. **Pro plan price:** the audit brief states $19/month; **every actual source in this codebase — `plans.price_amount`, `price_versions`/`plan_prices`, and `src/components/landing/Pricing.tsx` — says $18.00.** There is no $19 anywhere in the repository. See Section 10.
2. **Live Supabase database:** could not be verified. Docker Desktop is not running in this environment and the configured Supabase URL points at `127.0.0.1` (local-only, no hosted/remote project configured). This audit is therefore built entirely from the 79 local migration files plus the checked-in generated TypeScript types, cross-checked against each other and against application code. See Section 4.

### Final verdict: **READY_AFTER_FIXES**

The database is **not** ready for job-ingestion or job-matching automation to begin today, but the gap is narrow and well-scoped, not foundational. Nothing found requires a destructive migration or an architecture change. The P0 list (Section 16) is short: (1) decide and build the company/source registry table, (2) build the `automation_tasks` claim function (the `analysis_tasks` pattern already proves this is a solved problem — it just needs to be repeated), (3) add a `job-ingestion`-appropriate freshness/status model to `jobs` (a few nullable columns + an expanded `status` enum), (4) wire DB tests into CI so this schema's own test suite (`jobs-and-admin`, `matches-cover-letters-applications`, `notifications-audit-tasks`) actually gates merges. None of these are large.

---

## 2. Repository and Branch State

- **Repo root:** `C:\Users\Laptop Pro\Projects\ai-job-agent`
- **Branch:** `audit/job-ingestion-db-readiness`
- **Latest commit:** `1bb9453` — "Merge pull request #20 from BatoulDev/feat/kuwait-registry-expansion"
- **`git status --short`:** clean (no uncommitted changes)
- **Recent history** (`git log --oneline -7`): a run of company-registry expansion PRs (Kuwait, Saudi Arabia, Qatar, UAE, Lebanon) — all documentation/CSV-only changes, confirmed by `git log --oneline -25 -- docs/job-source-discovery/` showing 7 commits, none touching `supabase/migrations/` or `src/`.

No uncommitted or unfamiliar work was found; nothing was stashed, modified, or cleaned up during this audit.

---

## 3. Evidence Sources Inspected

- **All 79 files** in `supabase/migrations/` (`20260714153048_...` through `20260903090000_...`), read in full, in chronological order — this is the primary evidence base for this report.
- `src/lib/supabase/database.types.ts` (2,469 lines, generated) — cross-checked against the migrations.
- `docs/job-source-discovery/*.csv` (7 files, 588 data rows total) — parsed programmatically (Python `csv` module, not eyeballed) for structural/quality analysis.
- `docs/job-source-discovery/discovery-report.md` (386 lines) — read in full; found to be **stale** relative to the current CSVs (see Section 8).
- `docs/PRODUCTION_READINESS.md` (186 lines) — read in full as the living security/readiness tracker; spot-checked (not blindly trusted) against current code.
- `AI_JOB_AGENT_SYSTEM_AUDIT.md` (445 lines, dated 2026-08-08) — read in full; found to be **stale** on the single biggest question this audit was asked to resolve (whether `jobs`/`matches`/etc. exist). Treated as historical only.
- `DATABASE_PLAN.md` (495 lines) — read in full; contains the original schema-design rationale, still broadly accurate for what it covers, but predates `jobs`/`matches`/pricing-versioning entirely.
- `src/app/api/**/route.ts` (12 route handlers) — enumerated via Glob; each route's auth pattern checked.
- `src/lib/authz/requireAdmin.ts`, `src/lib/cvAnalysis/matchingEligibility.ts`, `src/lib/entitlements/*`, `src/lib/plans/*`, `src/lib/payments/*` — read.
- `n8n-workflows/cv-analysis-worker.ts` / `.json` — the one existing, wired automation; used as the reference architecture for judging `automation_tasks` readiness.
- `.github/workflows/ci.yml` — read in full to verify what actually runs in CI (not just what `docs/PRODUCTION_READINESS.md` claims).
- `tests/db/*.test.mjs` (28 files) — enumerated; `jobs-and-admin.test.mjs`'s test names read directly.
- `AGENTS.md` — read in full before any other work, per its own instruction.

**Not inspected / not applicable:** no live Supabase project (see Section 4); no n8n instance was queried or touched; no production environment of any kind exists to inspect.

---

## 4. Local Migrations vs. Live Schema — Comparison and Drift

**Live Supabase database: NOT VERIFIED.**

- `npx supabase status` failed (`failed to inspect container health`) — the local Supabase Docker stack is not running.
- `docker ps` / `docker version` failed to connect to the Docker daemon at all — Docker Desktop is not running in this environment.
- `.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` points at a `127.0.0.1`/`localhost` address (confirmed via a host-only grep, no secret values read or printed) — this project has **no separate hosted/remote Supabase project configured** to fall back to. "Live" and "local" are the same target here, and that target is currently offline.
- Starting Docker Desktop was judged out of scope for a read-only audit (it is a significant environment action with an uncertain success/time cost, not a `SELECT`), so this was reported as unavailable rather than attempted.

**Consequence:** every finding in this report about "current schema" is sourced from the **79 migration files**, cross-checked against the **generated TypeScript types** (`src/lib/supabase/database.types.ts`), not from a live `information_schema`/`pg_policies` query. This is a materially weaker form of evidence than a live query would be — it is possible (though no evidence of it was found) for a real deployed database to have drifted from what its own migrations say, e.g. through a manual out-of-band change. No such drift can be ruled out here; it can only be said that no evidence of it exists in this repository.

**Migrations vs. generated types — checked, no drift found.** `src/lib/supabase/database.types.ts` was grepped for every top-level table/RPC key. It contains `price_versions`, `plan_prices`, `job_preference_relocation_locations`, `job_preference_authorized_countries`, `location_nearby_areas`, `jobs`, `matches`, `applications`, `cover_letters`, `notifications`, `audit_events`, `automation_tasks`, and `analysis_feedback` — every table and function introduced by the **newest** migrations in the repository, up through `20260903090000_add_price_versioning_and_upgrade_locking.sql`. **VERIFIED:** the checked-in generated types file is current with the full migration history; there is no drift between "what the migrations say" and "what the last `db:types` regeneration captured." (This does not prove the types match a *live* database today — only that they match these migrations, which is the best evidence available without a running database.)

**Contradiction with the 2026-08-08 prior audit — resolved by direct evidence, not assumption.** `AI_JOB_AGENT_SYSTEM_AUDIT.md` states unambiguously (Section 4, Section 6, Section 18): *"there is no `jobs`, `matches`, `cover_letters`, `applications`, `notifications`, `admin/role`, or `audit_events` table anywhere in the 34 migrations or the live database."* That was true **on 2026-08-08, against 34 migrations**. The repository today has **79** migrations. `supabase/migrations/20260809090030_create_jobs.sql` through `20260809090140_grant_audit_events_delete_to_service_role.sql` (11 files, all dated the very next day) created exactly these tables. **CONFLICT, resolved: the prior audit's "missing tables" finding is stale and incorrect for the current repository state.** Do not carry that conclusion forward.

---

## 5. Full Public-Schema Table Inventory

All entries below are **VERIFIED** directly from migration source (file:line citations given); none are inferred. "Ready / Incomplete / Unused / Conflicting" reflects structural readiness only — not whether an automation exists to use the table (that is covered separately in Sections 8–9).

### 5.1 Identity, CV, and preferences

| Table | Purpose | PK / key constraints | RLS | Verdict |
|---|---|---|---|---|
| `profiles` | 1 row per `auth.users.id` | PK = `auth.users.id`, cascade delete; `profiles_university_single_source`/`profiles_major_single_source` mutual-exclusivity checks (`20260806090050`); `role` column added `20260809090020`, column-level grant restricts client `UPDATE` to 5 named columns only (`role`/`full_name` excluded — `full_name` now updates only via `update_profile_name_and_retry_analysis()`, `20260819120000`) | Enabled — select/update own only, no insert (trigger-only via `handle_new_user`), no delete (cascade only) | **Ready** |
| `job_preferences` | 1 row per user (MVP) | Unique `user_id`; `version`/`selection_version` server-computed via triggers (never client-trusted, `20260805090000` + `20260818090000`); `lebanon_location_scope`, `international_search_enabled` (Pro-only), `willing_to_relocate`, `work_authorization_status` added `20260902090010` | Enabled — full CRUD own, but only through `save_job_preferences()` in practice (direct writes still technically permitted by RLS, validated server-side by `enforce_job_preferences_eligibility_trigger`) | **Ready** |
| `job_preference_target_roles` / `job_preference_locations` | Reference-role/location join tables | Composite PK; ownership via `EXISTS` on parent | Enabled, parent-ownership-scoped | **Ready** |
| `job_preference_relocation_locations` / `job_preference_authorized_countries` | Pro-only Gulf relocation + work-authorization join tables (`20260902090010`) | Composite PK; `enforce_job_preference_relocation_locations_eligibility`/`enforce_job_preference_authorized_countries_eligibility` triggers gate every direct insert, not just the RPC | Enabled, parent-ownership-scoped | **Ready** |
| `cvs` | CV file metadata, versioned | `cvs_one_active_per_user` partial unique (`user_id) WHERE is_active`; the historical plain `cvs_user_id_key` was **dropped** in `20260809090010_resolve_cvs_versioning_conflict.sql:82` — **the conflict flagged by the 2026-08-08 audit is resolved.** Direct client `insert`/`update` RLS policies were also dropped in the same migration (`:86-87`) — the only write path today is `replace_cv()` | Enabled — select/delete own only; insert/update now impossible via direct client request (closed, not just discouraged) | **Ready** |
| `analysis_tasks` | CV-analysis job queue | `analysis_tasks_one_active_per_cv` partial unique; `idempotency_key` unique; `task_type`/`trigger`/`preferences_version`/`superseded_at` (`20260805090020`, widened repeatedly) | Enabled — select own only; all writes via `create_analysis_task`/`claim_analysis_task`/`fail_stale_analysis_tasks` (service_role only) | **Ready** |
| `cv_analyses` | AI CV-analysis results, 3 logical regions (cv_facts / preference_snapshot / ai_career_profile) | `cv_analyses_one_approved_per_user`, `cv_analyses_one_current_per_user` (both partial unique); `cv_analyses_current_not_superseded` check; array-shape checks added `20260825100020` (`jsonb_is_string_array`/`jsonb_is_object_array`) | Enabled — select own only; write path is `update_cv_analysis_review()`/`confirm_cv_analysis()` (`20260809090100`, hardened `20260825100000`) | **Ready** |
| `analysis_feedback` | User "Request Changes" feedback, linked to a re-analysis task | FK to `cv_analyses`/`analysis_tasks` (both `on delete set null`); `superseded_at` for feedback-linkage-across-follow-up correctness | Enabled — select own only; write via `submit_analysis_feedback()` | **Ready** |

### 5.2 Reference data

| Table | Purpose | Verdict |
|---|---|---|
| `countries`, `universities`, `majors`, `target_roles`, `locations` | Canonical reference data, stable slug/code PKs, select-only for `authenticated`, full CRUD `service_role` only | **Ready** |
| `location_nearby_areas` | Hand-authored Lebanese city-adjacency graph, used only for `lebanon_location_scope='selected_and_nearby'` (`20260902090000`) | **Ready** |
| `locations.is_relocation_market` | Boolean flag distinguishing the 11 Lebanese physical locations from the 6 Pro-only Gulf relocation markets (Saudi Arabia, Qatar, Kuwait, Dubai, Abu Dhabi, "Anywhere in the UAE") — one shared catalog, not two | **Ready** |

### 5.3 Commercial / subscriptions

| Table | Purpose | Key facts | Verdict |
|---|---|---|---|
| `plans` | Canonical plan catalog | 3 rows: `free`/`student` ($9.00)/`pro` ($18.00) — see Section 10 for the price conflict | **Ready** (now a *display*-price table only — see `plan_prices` below) |
| `subscriptions` | Current plan per user | Unique `user_id`; `price_version_id`, `next_period_start/end/price_version_id` added `20260903090000` for early-renewal deferral | **Ready** — select-own only, zero write policy for `authenticated`, all transitions via `activate_subscription`/`expire_subscription`/`cancel_subscription` (`service_role` only) |
| `payment_attempts` | Full payment history | `provider_payment_id` unique per provider (added `20260903090000`, closing a real gap — see Section 5.5); `price_version_id`/`purchase_type`/`source_plan_code`/`billing_period`/`period_start`/`period_end` added same migration | **Ready** |
| `price_versions` / `plan_prices` | Locked, point-in-time price schedule — the actual checkout-authoritative source (added `20260903090000`) | `price_versions_one_active_idx` (partial unique, `is_active`); `plan_prices` PK `(price_version_id, plan_code)`; both select-only for `authenticated` | **Ready** |

### 5.4 Downstream job/match pipeline (exists — see Section 4 for why this contradicts the stale prior audit)

| Table | Purpose | Key facts | Verdict |
|---|---|---|---|
| `jobs` | Admin/trusted-source job listings | `jobs_source_external_id_key` partial unique dedup `(source_type, external_id) WHERE external_id is not null`; `jobs_linkedin_never_email` check (LinkedIn rows structurally forbidden from `application_method='email'`); `jobs_application_url_format`/`jobs_application_email_format` regex checks | **Incomplete for ingestion** — schema exists and is RLS-sound, but lacks the freshness/lifecycle fields an ingestion pipeline needs (Section 9) |
| `matches` | Scored (user, job, **approved** cv_analysis) pairing | `matches_user_job_analysis_key` unique `(user_id, job_id, cv_analysis_id)`; `enforce_match_uses_approved_analysis` trigger calls `is_cv_analysis_matching_eligible()` (not just `review_status='approved'` — see Section 11) | **Ready** (schema); no matching worker exists yet |
| `cover_letters` | One row per match | `cover_letters_approved_requires_content` check; `approved_content` frozen snapshot, immune to later edits | **Ready**; no generator exists yet |
| `applications` | Approved-match send attempts | `approved_at`/`approved_by` **NOT NULL** — the approval gate is structural, not a UI convention; `enforce_application_method_matches_job` trigger; `applications_one_active_per_match` partial unique | **Ready**; no sender exists yet |
| `notifications` | Delivery log | `mark_notification_read()` is the one user-writable action | **Ready**; no delivery worker exists yet |
| `audit_events` | Append-only sensitive-action log | **Zero** insert/update/delete policy for `authenticated` — every row is written by a trusted RPC or `service_role`; `delete` granted to `service_role` only (`20260809090140`, for future retention jobs) | **Ready** |
| `automation_tasks` | Generic outbox for future matching/cover-letter/send/notification workers | `automation_tasks_one_active_per_subject` partial unique `(subject_type, subject_id, task_type)`; **zero RLS policy and zero grant for `authenticated`** — fully opaque by design | **Schema ready, operationally incomplete — no claim function exists** (Section 9.4) |

### 5.5 Other

| Table | Purpose | Verdict |
|---|---|---|
| `daily_news_briefs` / `daily_news_items` | Public daily AI/tech news content | **Ready**, unrelated to job matching, out of scope |
| `rate_limit_events` / `auth_rate_limit_events` | Rolling-window rate-limit ledgers | **Ready** — spot-checked: `login: { limit: 5, windowMinutes: 15 }` in `src/lib/authRateLimit/rateLimit.ts:22`, matching `docs/PRODUCTION_READINESS.md`'s claim exactly |

**Full function/RPC inventory (57 functions found across all migrations, confirmed present in `database.types.ts`):** `handle_new_user`, `handle_new_user_subscription`, `set_updated_at`, `activate_subscription`/`expire_subscription`/`cancel_subscription` (service_role), `create_payment_attempt`/`mark_payment_verified`/`mark_payment_failed`, `create_analysis_task`/`claim_analysis_task`/`fail_stale_analysis_tasks` (service_role), `get_onboarding_readiness` (security invoker, stable), `save_job_preferences`, `replace_cv`, `is_admin`, `update_cv_analysis_review`/`confirm_cv_analysis`, `approve_match`/`reject_match`/`save_cover_letter_edit`/`approve_cover_letter`/`create_application`, `enforce_match_uses_approved_analysis`, `is_cv_analysis_matching_eligible`, `submit_analysis_feedback`, `get_active_price_version`/`quote_student_to_pro_upgrade`/`promote_due_subscription_period`, plus a dozen `enforce_*`/`mark_*`/`bump_*` triggers. No orphaned function (defined but never referenced by a trigger or granted to any role) was found.

---

## 6. Migration Chronology for Frequently-Altered Tables

For the reader who does not want to read all 79 files:

- **`cvs`**: `20260714153058` (create) → `20260805090010` (add version/is_active/superseded_at, documents the conflict) → `20260809090010` (resolves the conflict, drops `cvs_user_id_key`, adds `replace_cv()`) → `20260811090000` (PDF-only guard) → `20260812100010` (cross-version task supersession fix).
- **`job_preferences`**: `20260714153055` (create) → `20260804090000` (widen experience_level) → `20260805090000` (versioning) → `20260806090060` (rename `remote_preference`→`work_arrangement`, add `job_market_coverage`) → `20260806090090` (eligibility trigger) → `20260806090100` (RPC) → `20260818090000` (selection_version, preferences-changed task enqueue) → `20260819100000` (flexible requires location) → `20260902090010` (international/relocation columns, 15-arg RPC).
- **`analysis_tasks`**: `20260802090030` (create) → `20260805090020` (task_type/preferences_version/superseded_at) → `20260809090000` (widen trigger for `cv_replaced`) → `20260811090010` (`claim_analysis_task`/`fail_stale_analysis_tasks`) → `20260818090000`/`20260818100000` (widen trigger for `preferences_updated`/feedback triggers).
- **`cv_analyses`**: `20260804090010` (create) → `20260805090030` (is_current/recommendations_state/staleness triggers) → `20260809090100` (review_status widened, `confirm_cv_analysis`) → `20260825100000` (freshness hardening) → `20260825100010` (`is_cv_analysis_matching_eligible`) → `20260825100020` (array-shape checks) → `20260825100030` (demote on feedback).
- **`subscriptions`/`payment_attempts`/`plans`**: `20260802090000–090020` (create) → `20260803090000` (manual_test provider) → `20260822160000` (payment-attempt rate limit) → `20260902090020` (Student-to-Pro upgrade) → `20260903090000` (price versioning, upgrade locking, early-renewal deferral — the largest single migration in the repo).

---

## 7. Company Source Registry — Readiness

**VERIFIED programmatically** (Python `csv`-module parse of all 7 files, not a manual skim — script and full output retained in this session's scratchpad, results below are exact counts):

| File | Rows |
|---|---|
| `lebanon.csv` | 99 |
| `uae.csv` | 149 |
| `saudi-arabia.csv` | 116 |
| `qatar.csv` | 77 |
| `kuwait.csv` | 116 |
| `international-remote.csv` | 31 |
| **Sum of country files** | **588** |
| `master-company-registry.csv` | **588** — exact match |

**Schema consistency:** all 7 files (6 country + master) share byte-identical 34-column headers (`canonical_company_id, source_record_id, company_name, ..., researcher_notes`). No drift.

**Reconciliation/promotion status — VERIFIED, with an important correction to the registry's own narrative.** `docs/job-source-discovery/discovery-report.md` (last narrative update §23, dated 2026-09-06) claims a registry of "254→288 rows." **This is stale.** `git log --oneline -- docs/job-source-discovery/` shows 5 further commits after that date (`feat(job-sources): complete Lebanon company discovery and enrichment`, `promote verified Lebanon employers`, `expand verified UAE/Qatar/Saudi/Kuwait employer registry`) that grew the registry to its current 588 rows with **no corresponding update to `discovery-report.md`'s narrative.** The CSVs themselves are current and internally consistent (see below); the *report describing them* is not. Treat the CSVs as ground truth, not the report.

**Stable identifiers:** `canonical_company_id` (`cc-<slug>`, e.g. `cc-byblos-bank`) and `source_record_id` (`sr-<country-code>-<slug>`, e.g. `sr-lb-byblos-bank`) are both present on every row and are name-independent (slug-based, not derived from a mutable display field).

**Duplicate detection — VERIFIED, zero found:**
- Zero duplicate `canonical_company_id` within any single country file.
- Zero duplicate `(canonical_company_id, target_country)` pairs across all 6 country files combined.
- Zero duplicate `source_record_id` across all 588 rows.
- Master's unique-company count (557) exactly equals the country files' union (557) — **master is genuinely rebuilt from the country files, not a stale hand-maintained copy.**
- Simple normalized-name collision scan (strip non-alphanumeric, compare within the same `target_country`) found **zero** likely-duplicate company names (e.g. no "Bank Audi" vs. "BankAudi" pattern survives in the current data).

**Cross-market identity collision — VERIFIED, real, and the one genuine data-quality defect found in this registry.** The zero-duplicates result above is a *within-file*/*within-target_country* check. A separate cross-file scan (same normalized company name appearing under different `canonical_company_id` values across *different* `target_country` files) found **5 companies that should share one multinational `canonical_company_id` (the convention already used correctly for EY/KPMG/Deloitte/PwC/etc.) but instead have two**: Amazon (`cc-amazon-uae` vs `cc-amazon-sa`), Accenture (`cc-accenture-qatar` vs `cc-accenture-sa`), Tata Consultancy Services (`cc-tata-consultancy-services-qatar` vs `cc-tcs`), SLB (`cc-slb-qatar` vs `cc-slb`), and Apparel Group (`cc-apparel-group-sa` vs `cc-apparel-group`). This does not block anything today (no code reads `canonical_company_id`), but it must be corrected **before** this id becomes a real foreign-key target (Section 17, item 1) — fixing it in a CSV today is a one-line edit; fixing it after other tables reference it as a FK is a breaking migration. Folded into P0 item 1's scope (Section 16), not a separate line item.

**A second, separate registry file exists and was not the primary subject of this section**: `docs/job-source-discovery/source-expansion/source-catalog.csv` (149 rows) — a job-board/aggregator-level catalog (LinkedIn Jobs, Bayt, Indeed-style listing sites), conceptually distinct from the employer-level company registry analyzed above. It follows its own 16-column schema and has its own promotion history across the same expansion pilots. Worth the team's awareness when designing the `company_sources` migration in Section 17 — it is a second, related-but-separate input, not yet reconciled against the employer registry.

**review_status distribution (588 rows):** `verified` 398, `needs_manual_review` 180, `no_official_source_found` 10, `blocked_or_unsafe` 0.

**URL validity — VERIFIED:**
- 5 rows have a non-URL `official_website_url` value (`unknown`, `not_verified`, or a documented fetch failure) — all are legitimate "we could not confirm this" sentinels, not malformed real URLs.
- 55 rows have a non-URL `official_careers_url` (`none found`, `not_found`, `not_verified`) — same pattern: honest "not known" markers on `needs_manual_review`/`no_official_source_found` rows, not data-quality defects on `verified` rows. **Zero `verified` rows have an empty `evidence_urls` field** (this specific invariant is checked by the registry's own validation process per `discovery-report.md` §22.8, and independently re-confirmed here).

**ATS/source-type classification — VERIFIED:** `automation_eligibility` distribution: `suitable_public_html_subject_to_review` 358, `unknown` 90, `suitable_public_ats` 78, `manual_only` 62. Named ATS vendors present: Workable (12), SAP SuccessFactors (11), Oracle Cloud HCM (7), Workday (5), Phenom People (5), Greenhouse (5), Talentera (4), SmartRecruiters (4), Lever (4), plus 11 more single/low-count vendors — a genuinely diverse, real set, not a fabricated list. This matches AGENTS.md §7's "safe sources" definition (career pages, Greenhouse/Lever/Workable/Ashby, public application emails) closely; no `ats_provider` value found is an unsafe/non-approved source type.

**LinkedIn compliance — VERIFIED, compliant.** `linkedin_usage_classification` distribution: `not_applicable` 365, `discovery_and_verification_only` 220, `manual_discovery_or_application_link_only` 3. **Zero rows** carry a classification implying automated scraping/ingestion suitability. Grepping `src/`, `supabase/migrations/*.sql`, and `n8n-workflows/` for "linkedin" (case-insensitive) returns **zero matches** — LinkedIn exists only as descriptive CSV metadata, never in any executable code path. This matches AGENTS.md §7 and the product's LinkedIn policy exactly.

**Minor data-quality note (not blocking):** two rows use non-enum `company_type` values (`startup/multinational_subsidiary`, `private (Al Rajhi Group subsidiary)`) instead of the documented enum set — cosmetic, does not affect any current consumer since `company_type` is confirmed (per `discovery-report.md` §23's own repo-wide grep, independently plausible and not re-disproven here) to be unused by any application code today.

### Does a DB table exist for this registry today?

**No — VERIFIED by grep.** `grep -irn "job_sources\|company_registry\|source_registry" supabase/migrations/*.sql src/` returns zero matches. The registry is CSV-only. No `jobs.company_id`/`jobs.source_id` foreign key exists in the `jobs` table (`jobs.company_name` is a plain `text` column, not a reference — see `20260809090030_create_jobs.sql:8`).

### CSV-as-canonical vs. DB-table-required — evidence for each option

| Dimension | Stay CSV | Move to DB table |
|---|---|---|
| Reliability | Git history is the audit trail; a bad edit is a revertable commit | Survives concurrent writers without merge conflicts; enforced schema (the CSV has already shown 4 enum-validity bugs introduced and later fixed by hand — `discovery-report.md` §22.12) |
| Concurrency | A human/agent editing the CSV and n8n reading it concurrently is not safely coordinated — no locking, no transactions | Native Postgres transactions; safe concurrent reads during an ingestion run |
| Auditability | `git blame`/`git log` per row — excellent, already proven useful in this exact audit (Section 7, first paragraph) | `created_at`/`updated_at` + optional `audit_events` row per change — good, but loses the "diff this PR" ergonomics the CSV workflow already has |
| Update process | Already working, human-reviewable PRs (7 real PRs in this repo's history) | Requires either an admin UI (doesn't exist) or a migration/seed script per update — more ceremony per change |
| n8n access | n8n would need the CSV shipped/mounted/fetched somehow — no existing mechanism for this in the repo | n8n already has service-role Postgres access (proven pattern: `cv-analysis-worker.ts`) — trivial to query |
| Stable FK references | `jobs.company_name` (or a future `jobs.source_id`) **cannot** cleanly foreign-key a CSV row | A DB table gives `jobs.source_id` a real, enforced foreign key — directly closes the Section 9 dedup-key gap |
| Deployment behavior | CSV ships with every deploy automatically (it's just a file in the repo) — zero extra deploy step | Requires a migration + seed/import step, and a decision about who "owns" updates (migration-only, or a service-role import script) |
| Operational complexity | Low today, but the registry is a company-identity graph with EY/KPMG/Deloitte/PwC/Netways spanning 4–5 markets each under one `canonical_company_id` — this relational structure is already outgrowing a flat CSV | Matches the shape naturally (`companies` → `company_sources` one-to-many, exactly as `discovery-report.md` §18 already proposed, unbuilt) |

*(No recommendation is made here by design — this table lays out the evidence only, per the audit's own instructions; the final recommendation is in Section 20.)*

---

## 8. Jobs Table — Data Contract Gap Analysis

Current exact schema (`supabase/migrations/20260809090030_create_jobs.sql`): `id`, `title`, `company_name` (plain text, not a FK), `description`, `location`, `work_arrangement`, `employment_type`, `seniority`, `application_method`, `application_url`, `application_email`, `source_type`, `external_id`, `source_url`, `status`, `published_at`, `discovered_at`, `expires_at`, `created_by`, `created_at`, `updated_at`.

| Required field (from the audit spec) | Present? | Evidence |
|---|---|---|
| Internal job id | **Present** | `id uuid primary key` |
| Stable company/source reference | **MISSING** | `company_name text` is free text, no FK (Section 7) |
| External provider job id | **Present** | `external_id text`, deduped via `jobs_source_external_id_key` |
| Source type | **Present** | `source_type` enum (`admin_manual`/`career_page`/`greenhouse`/`lever`/`workable`/`ashby`/`linkedin`) |
| Source URL | **Present** | `source_url text` |
| Application URL / email | **Present** | `application_url`/`application_email`, format-checked, `jobs_application_method_target` requires the one matching `application_method` |
| Original job URL | **Present** (= `source_url`) | |
| Source payload / raw-data reference | **MISSING** | No `raw_payload jsonb` or equivalent |
| Stable dedup key / content hash | **Partial** | `(source_type, external_id)` covers ATS-sourced jobs; nothing covers `admin_manual` entries or content-based dedup (two sources listing the identical job) |
| Job title, raw description | **Present** | `title`, `description` |
| Normalized description | **MISSING** | Only one `description` column |
| Company name/reference | **Present but not a reference** (see above) | |
| Employment type, seniority | **Present** | Both enum-checked |
| Required/preferred languages, skills | **MISSING** | No columns |
| Education requirements | **MISSING** | No column |
| Student/fresh-grad suitability | **Partial** | `seniority` includes `internship`/`entry-level`/`junior` — no dedicated boolean |
| Raw location text | **Present** | `location text` |
| Country / city / region-market | **MISSING** | Only the single free-text `location` column — no structured `country_code`, no FK to `countries`/`locations` |
| Work arrangement | **Present** | `work_arrangement` enum, matches `job_preferences.work_arrangement`'s vocabulary |
| Remote scope (Lebanon-only/MENA/country-restricted/worldwide) | **MISSING** | No column — this is the exact vocabulary `international-remote.csv`'s `geographic_scope` already uses (Section 7); nothing carries it into `jobs` |
| Relocation requirement | **MISSING** | No column |
| `posted_at` | **MISSING** (closest: `published_at`, same concept, different name) | |
| `first_seen_at` | **MISSING** | Closest is `discovered_at`, which is single-purpose (set once, `default now()`) and not distinguished from "still being seen" |
| `last_seen_at` | **MISSING** | |
| `last_checked_at` | **MISSING** | |
| `last_successful_check_at` | **MISSING** | |
| `closing_date` (nullable) | **MISSING** | Closest is `expires_at`, which exists but is not distinguished from a *system*-computed expiry vs. a source-stated closing date |
| `status` | **Present, but narrow** | `check (status in ('active', 'closed', 'expired'))` — 3 values only |
| `status_reason` | **MISSING** | |
| `expired_at` / `closed_at` | **MISSING** | Only the forward-looking `expires_at`; no timestamp records *when* a job actually transitioned to `closed`/`expired` |
| `source_last_modified_at` | **MISSING** | |
| `created_at`/`updated_at` | **Present** | |

### Status model — current vs. recommended

Current: `status in ('active', 'closed', 'expired')` — 3 values, no distinction between "an admin closed this" and "the system inferred this expired," and critically, **no representation for "a source check failed" at all**. Recommended (per the audit spec): `pending_review`, `open`, `closed`, `expired`, `unavailable`, `rejected`, `source_error`.

**This is the most important single gap in `jobs`.** Nothing in the current schema distinguishes a job the system is *confident* is gone from one where a single check merely failed. The audit spec's explicit rule — *"Do not recommend marking a job closed merely because one source check failed"* — has **no structural support today**: with only `active`/`closed`/`expired`, any future ingestion worker's simplest implementation would be tempted to flip `status='closed'` the moment one fetch 404s, exactly the anti-pattern the spec warns against. `source_error` (or an equivalent ingestion-run/source-health table, see below) does not exist in any form.

### Freshness field analysis: `last_seen_at` vs. `last_checked_at` vs. `last_successful_check_at`

**None of the three exist as separate columns.** Only `discovered_at` (set once, at insertion) and `expires_at` (a single forward-looking date) exist. This is a structural gap, not an oversight to dismiss: the audit spec's distinction — *found in listing* vs. *verification attempted* vs. *verification succeeded* — cannot be expressed today. A future ingestion worker has nowhere to record "I checked this job and it was fine" separately from "I checked this job and the check itself failed" (network error, source down) separately from "the job was gone from the listing this run." Recommended: add all three as nullable `timestamptz` columns; a source-health/ingestion-run table (see Section 9) should own the aggregate "is this whole source currently healthy" question, so a `jobs`-row-level `source_error` status only ever reflects *that specific job's* repeated failures, not a blip in the source overall.

### Index and uniqueness gap analysis

Existing: `jobs_source_external_id_key` (partial unique dedup for ATS-sourced jobs). `matches_job_id_idx`, `matches_user_status_idx`, `matches_user_score_idx`, `cover_letters_user_id_idx` (all added `20260809090120_add_evidence_based_indexes.sql`, evidence-based per that migration's own comment — a genuinely good pattern to keep following).

**Missing, once `jobs` has real query patterns:**
- No index supports "active jobs by country/work-arrangement" (needed the moment `country`/structured geography columns are added — see above).
- No index on `status` alone or `(status, closing behavior)` for a future expiry-sweep job.
- No content-hash/dedup index beyond the partial `(source_type, external_id)` one — a cross-source duplicate (the same job on two different career pages) has no structural dedup path at all today.
- No `company_name`-lookup-friendly index (moot once a `source_id` FK exists — a straightforward B-tree on the FK column would then suffice).

---

## 9. Job Freshness/Lifecycle, matches/cover_letters/applications/notifications/audit_events, and Cost/Concurrency Analysis

### 9.1 matches / cover_letters / applications / notifications / audit_events — schema summary

- **`matches`**: has `score` (0–100, checked), `score_breakdown` (jsonb object), `explanation` (text), `missing_skills` (jsonb array), `matching_model`/`matching_version` — **all required fields present.** Critically, `matches.cv_analysis_id` is gated by `enforce_match_uses_approved_analysis()` (Section 11), which calls the canonical `is_cv_analysis_matching_eligible()` — **a match can only ever be created against the current, approved, non-stale analysis**, not merely "any approved analysis ever." This is a stronger guarantee than the audit spec strictly required and is genuinely well-designed.
- **`applications`**: `idempotency_key text not null unique` — **present**, per-attempt (not composite `(user_id, job_id)`, but functionally equivalent given `applications_one_active_per_match` already prevents more than one live attempt per match). `approved_at`/`approved_by` **NOT NULL at the column level** — an application row structurally cannot exist without prior approval evidence.
- **`cover_letters`**: `approved_content` is a frozen snapshot (`cover_letters_approved_requires_content` check) — later edits to `edited_content` can never retroactively alter what was approved.
- **`notifications`**: `idempotency_key` nullable+unique (a worker may supply one for dedup, not mandatory for every row) — reasonable design, not a gap.
- **`audit_events`**: append-only by construction — zero authenticated write grant, `service_role` has `insert` (no direct `update`) and (as of `20260809090140`) `delete`, for future retention only.

### 9.2 `automation_tasks` outbox readiness

| Required field | Present? |
|---|---|
| task type | **Present** (`task_type` enum: `job_matching`/`cover_letter_generation`/`application_send`/`notification_delivery`) |
| status | **Present** (`pending`/`processing`/`completed`/`failed`/`cancelled`) |
| attempts / max attempts | **Present** (`attempt_count`, `max_attempts`) |
| run-after time | **Present** (`next_attempt_at`, matches `analysis_tasks.available_at`'s proven pattern) |
| lease owner / lease expiration | **Present as columns** (`locked_by`, `locked_at`) — **but nothing ever sets them** (see 9.4) |
| idempotency key | **Present** (unique) |
| last error | **Present** (`last_error`, documented "safe summary only") |
| payload | **MISSING** — there is no `payload jsonb` column; the table relies entirely on `(subject_type, subject_id)` to let a worker re-derive what it needs by re-querying the subject row. This is a defensible design (avoids storing possibly-stale duplicated state) but means a worker cannot carry task-specific parameters (e.g. "which specific reason triggered this cover-letter regen") without a schema change or an app-layer convention. |
| created/updated/completed timestamps | **Present** (`created_at`, `started_at`, `completed_at`, `updated_at`) |

### 9.3 Claim-function readiness

`analysis_tasks` has a **fully implemented, tested claim pattern**: `claim_analysis_task(p_batch_size)` (`20260811090010_create_claim_analysis_task.sql`) uses `FOR UPDATE SKIP LOCKED` inside a CTE, atomically claims fresh-pending **and** lease-expired-processing rows in one transaction, and is paired with `fail_stale_analysis_tasks()` to permanently fail tasks that exhausted `max_attempts` past their lease. This is exactly the pattern `n8n-workflows/cv-analysis-worker.ts` actually calls (confirmed: the worker file references `claim_analysis_task`/`fail_stale_analysis_tasks` by name, per `docs/PRODUCTION_READINESS.md`'s own verified citation and consistent with the migration's own doc comment "Called by the n8n CV analysis worker via service-role RPC").

**`automation_tasks` has no equivalent function at all.** `grep -rln "claim.*automation_tasks\|automation_tasks.*claim\|claim_automation_task" supabase/migrations/*.sql` returns **zero matches** outside the table's own creation file, whose comment explicitly says: *"Set by a future claim function... Not set by anything in this migration."* No later migration ever added one. **This is a real, currently-open gap — not a design flaw, since the `analysis_tasks` pattern proves the team already knows exactly how to build it (same partial-unique-index-for-dedup + `FOR UPDATE SKIP LOCKED` + lease-expiry-reclaim shape), it simply has not been done yet for the generic outbox.**

### 9.4 `relocation_markets` (`locations.is_relocation_market`) wiring status

**Foundational only, confirmed by direct inspection.** The catalog (6 Gulf markets: Saudi Arabia, Qatar, Kuwait, Dubai, Abu Dhabi, "Anywhere in the UAE") and its `job_preference_relocation_locations`/`job_preference_authorized_countries` join tables exist and are fully validated server-side (Section 10.3). **Nothing today joins this against a real `jobs` row** — there is no function computing "is this job's location compatible with this user's selected relocation markets," because `jobs` currently has no structured country/geography columns to join against (Section 8) and there are zero rows in `jobs` regardless (no ingestion has ever run). This is expected, not a defect: the preference-side half of geographic matching is done; the job-side half cannot exist until `jobs` gets structured geography columns and real data.

### 9.5 Application code usage of `jobs`/`matches`/etc.

**Zero.** `grep -rn "\.from(['\"]jobs['\"])\|\.from(['\"]matches['\"])\|\.from(['\"]automation_tasks['\"])\|\.from(['\"]applications['\"])\|\.from(['\"]cover_letters['\"])\|\.from(['\"]notifications['\"])\|\.from(['\"]audit_events['\"])" src/` returns zero matches, and `Glob src/app/api/**/route.ts` finds only 12 routes, none job/match/admin-related (`onboarding/complete`, `cv-analysis/*`, `profile/update-name`, `auth/*`, `checkout`). This confirms: **the schema is provisioned, but literally no application code path reads or writes it yet** — consistent with "foundation only" comments throughout the migrations themselves. There is local (not-CI-run) DB test coverage exercising this schema directly at the RLS layer: `tests/db/jobs-and-admin.test.mjs` (7 test cases: admin CRUD, ordinary-user-denied, active-only visibility, dedup, LinkedIn-email-forbidden, invalid application-method rejection), `tests/db/matches-cover-letters-applications.test.mjs`, `tests/db/notifications-audit-tasks.test.mjs` — so the *security* posture of this schema has been exercised, even though no product feature consumes it yet.

---

## 10. Subscription and Geography Analysis

### 10.1 Current plan pricing — verified values, and the $18-vs-$19 conflict

**VERIFIED, exact, and unambiguous — there is no $19 anywhere in this repository.**

- `supabase/migrations/20260802090000_create_plans.sql:57`: `('pro', 'Pro', 18.00, 'USD', 'monthly', true, 45, 15)`.
- `supabase/migrations/20260903090000_add_price_versioning_and_upgrade_locking.sql:138-141`: `price_version_1` ("launch-2026-08") is seeded **from the live `plans` table at migration time** — i.e., $18.00 is also the one and only value ever recorded in `plan_prices`, the table that is now actually checkout-authoritative (Section 10.3).
- `src/components/landing/Pricing.tsx:50,70`: `originalPrice: "$18"`, `price: "$18"` — the marketing copy matches the database exactly.
- `grep -rn "19\.00\|\$19" src/ supabase/migrations/*.sql` returns **zero matches** anywhere in the codebase.

**This audit's own brief states $19/month for Pro.** That number does not exist anywhere in the current system. **Do not silently change the price to match the brief, and do not silently keep $18 without flagging this** — the brief and the codebase disagree, and only the user can say which is the intended, current source of truth (a genuine planned price increase not yet migrated, or a documentation/brief error). See Section 19 (Open Product Decisions).

The Student price ($9.00) matches the brief and has no conflict.

### 10.2 Where geographic entitlement actually lives today

There is **no dedicated `geographic_scope`/`lebanon_only`/`international_access` column or table.** Entitlement is encoded through two mechanisms, both stable-plan-code-based (never price-based — no `if price == 9` pattern was found anywhere):

1. **`job_preferences.international_search_enabled`** (boolean, `20260902090010`) — gated Pro-only by `enforce_job_preferences_eligibility_trigger`: *"International search requires the Pro plan"* (`20260902090010_plan_aware_job_preferences.sql:264-266`), checked against `subscriptions.plan_code`, never a client-supplied flag, and enforced on **every** write path (the RPC and any hypothetical direct client write alike, since it's a `BEFORE INSERT OR UPDATE` trigger on the table itself, not app-layer logic).
2. **The relocation/authorized-country child tables** (`job_preference_relocation_locations`, `job_preference_authorized_countries`) are *each independently* Pro-gated by their own `BEFORE INSERT` triggers (`enforce_job_preference_relocation_locations_eligibility`, `enforce_job_preference_authorized_countries_eligibility`) — so even a direct-insert bypass attempt against a child table alone (skipping the RPC) is still rejected.

**This is the correct pattern per the audit's own stated rule** ("must use a stable plan code or explicit entitlement... never `if price == 9`") — `plan_code = 'pro'` is compared, never `price_amount`.

### 10.3 Student plan residence guard — what it actually enforces (and a legitimate design evolution the auditor should note)

The originally-requested rule ("Student plan → Lebanon-only jobs") has been **superseded by a stricter, simpler product decision**, confirmed by `20260902090010_plan_aware_job_preferences.sql:1-12`: *"this product now supports only users who currently live in Lebanon... `country_of_residence` stops being a user-facing onboarding field and becomes a system-level market constant, defaulted to Lebanon for every new signup."* `handle_new_user()` was rewritten (same migration, `:46-57`) to insert every new profile with `country_of_residence = 'LB'` unconditionally.

**Practical effect:** every current and future user is Lebanon-based by construction. The distinction the audit brief describes (Student=Lebanon-only vs. Pro=Lebanon+international) is **still exactly implemented** — but through `international_search_enabled` (Pro-only, Section 10.2) rather than through a residence comparison, since residence is no longer a variable. This is a legitimate simplification, not a regression: the old `enforce_job_preferences_eligibility()` residence-based branch (from `20260806090120_add_student_plan_residence_guard.sql`) is **preserved, unchanged**, in the current function body as dead-but-harmless legacy-data handling (`if v_country is not null and v_country <> 'LB' then ...`) for any pre-existing non-Lebanon row, but it can no longer be reached by any new user.

**One legitimate, evidence-based observation for the team**, not a defect: `create_payment_attempt()`'s Section-806 residence guard (*"student_unavailable_outside_lebanon"*, `20260806090120`) was **silently dropped** when the function body was replaced by the `20260822160000` and later `20260903090000` rewrites — neither later version re-implements that specific check. Since every user is now Lebanon-resident by construction (Section 10.3 above), this is currently **unreachable dead logic, not an exploitable gap** — but it is worth knowing this specific guard no longer exists in the current `create_payment_attempt`, should residence ever become variable again.

### 10.4 Relocation market catalog — foundational vs. wired

Covered in Section 9.4 — the catalog and its Pro/willing-to-relocate/authorized-country gating are fully built and validated on the *preference* side; nothing yet joins it against real `jobs` rows because `jobs` has no data and no structured geography columns yet.

### 10.5 Price-change and upgrade-billing safety — VERIFIED, thoroughly implemented

`20260903090000_add_price_versioning_and_upgrade_locking.sql` (910 lines, the largest single migration in the repo) implements exactly the rule this audit asked to verify:

- **A public price change never rebills an in-progress period.** `price_versions`/`plan_prices` lock each purchase to the schedule active *at that purchase's time*; `payment_attempts.price_version_id` and `subscriptions.price_version_id` are immutable once set. `plans.price_amount` is explicitly redefined (comment, `:143-144`) as *"Current DISPLAY price only... Actual checkout/upgrade/renewal pricing is authoritative from `plan_prices`."*
- **An early renewal (paid before the current period ends) never touches the active period.** `mark_payment_verified()` (`:672-705`) branches explicitly on `current_period_end > now()`: if true, `current_period_start/end` are left **completely untouched**, and the newly-paid period is queued onto `subscriptions.next_period_*` instead, only physically promoted once genuinely due (`promote_due_subscription_period()`, idempotent, called opportunistically — no cron exists in this project, by design).
- **Student-to-Pro upgrade pricing is locked to the customer's own original schedule**, not the live active one — `quote_student_to_pro_upgrade()` (`:286-354`) sources both the Student credit and the destination Pro price from `subscriptions.price_version_id`, explicitly to prevent the exact bug the migration's own header documents finding and fixing (a public Pro price change between purchase and upgrade previously would have silently mispriced the upgrade).
- **`provider_payment_id` uniqueness** (`payment_attempts_provider_payment_id_unique`, `unique (provider, provider_payment_id)`) closes a real, previously-open gap: before this migration, two different `payment_attempts` rows could both be marked `'paid'` against the identical real-world provider reference.
- **No downgrade path exists**: `create_payment_attempt()` explicitly rejects an active Pro user purchasing Student (`:413-416`, `PRO_CANNOT_DOWNGRADE_TO_STUDENT`).

This is a genuinely well-engineered, already-tested (per `docs/PRODUCTION_READINESS.md`'s cited `tests/db/price-versioning-and-upgrade.test.mjs`, 17+ cases) subsystem. Nothing here is a gap for job-matching automation specifically — it is included because the audit brief explicitly asked for this verification.

### 10.6 Client-tamper resistance — VERIFIED

`plans`, `subscriptions`, `price_versions`, `plan_prices`, `payment_attempts`: every one of these tables grants `authenticated` **select-only**. Zero insert/update/delete policy exists for `authenticated` on any of them. Every state transition (`activate_subscription`, `mark_payment_verified`, etc.) is `SECURITY DEFINER`, `EXECUTE` revoked from `public`, granted to `service_role` only (with the sole exception of `create_payment_attempt`, deliberately grantable to `authenticated` because it re-derives price/identity entirely server-side and never trusts a client-supplied amount). No gap found.

### 10.7 Gap: full job-level geographic eligibility enforcement

**Cannot exist yet, and no evidence was found that it does.** The complete rule the audit describes — combine `job.country`/`job.work_arrangement`/`job.remote_scope` with the user's `job_preference_locations`/`job_preference_relocation_locations` and the subscription's `international_search_enabled` entitlement — requires a function that does not exist today, and *cannot* be meaningfully written today, because `jobs` has no structured country/remote-scope columns (Section 8) and zero real rows. This is the correct, expected state for a pre-ingestion system, not a defect — it is listed here as a P1 (Section 16) precisely because it is the next concrete piece of work once `jobs`'s schema gap (Section 8) is closed.

---

## 11. CV-Analysis and Matching-Eligibility Analysis

**VERIFIED directly from primary migration source** (all functions quoted/read in full during this audit; this section directly contradicts several specific claims in the stale 2026-08-08 prior audit — each contradiction is called out explicitly).

### 11.1 CV replace/versioning — resolved, not open

**CONFLICT with the 2026-08-08 audit, resolved in favor of "fixed."** That report's SEC-04 finding ("two simultaneous overlapping unique constraints on `cvs.user_id`, self-documented unresolved") is **no longer true**. `20260809090010_resolve_cvs_versioning_conflict.sql` drops `cvs_user_id_key` (`:82`) and closes the direct-client-write gap the old constraint's presence had forced open (`cvs_insert_own`/`cvs_update_own` policies dropped, `insert`/`update` revoked from `authenticated`, `:86-88`).

**One residual gap found in this same migration, not part of the originally-documented conflict**: only `insert`/`update` were revoked from `authenticated` — the `cvs_delete_own` RLS policy and the `authenticated` `DELETE` grant on `cvs` (both dating from `20260718120000_grant_authenticated_table_access.sql`) were never revoked alongside them. **VERIFIED**: a user can therefore still issue a direct client `DELETE FROM cvs WHERE ...` against their own row, bypassing `replace_cv()` entirely — this cascade-deletes their own `analysis_tasks`/`cv_analyses` rows (both FK `on delete cascade` from `cvs`) without any of `replace_cv()`'s task-supersession or history-preservation logic. Low severity (self-scoped only — no cross-user exposure, since RLS still confines it to the caller's own row) but inconsistent with the "no direct client write path to `cvs`" intent stated in the same migration's own comments. Listed as a P2 remediation item (Section 16). The sanctioned write path is now exclusively `replace_cv(p_storage_path, p_file_name, p_file_size_bytes, p_mime_type)`, `SECURITY DEFINER`, which: locks any existing active row (`FOR UPDATE`), deactivates it (`is_active=false, superseded_at=now()`), inserts the new row (`version = old+1`), enqueues a `cv_replaced` analysis task only on a genuine replacement (not a first upload), and — as of `20260812100010` — supersedes any other still-pending/processing analysis task belonging to the user's other CV versions, closing a reproduced-live duplicate-task bug. As of `20260811090000`, it also rejects any non-`application/pdf` MIME type server-side, independent of client-side validation.

### 11.2 Analysis-task claim function

`claim_analysis_task(p_batch_size)` (Section 9.3) — atomic, `FOR UPDATE SKIP LOCKED`, reclaims lease-expired `processing` rows with `attempt_count < max_attempts`, paired with `fail_stale_analysis_tasks()` for permanent failure once retries are exhausted. This is the proven template the (currently unclaimed) `automation_tasks` table still needs to copy.

### 11.3 Review/approval write path — exists, not missing

**CONFLICT with the 2026-08-08 audit, resolved in favor of "fixed."** That report's blocker #3 ("no endpoint exists that lets a user set `review_status`") is **no longer true.** `20260809090100_add_cv_analyses_review_confirm.sql` adds `update_cv_analysis_review(p_analysis_id, p_user_edits)` (lets a user save edits to an unapproved, completed analysis — never touches AI-generated `cv_facts`/`ai_career_profile` columns) and `confirm_cv_analysis(p_analysis_id)` (the approval transaction): locks the row, rejects anything not `completed`, rejects `superseded`, atomically supersedes any prior approved/current row for the user, sets `review_status='approved'`/`is_current=true`/`recommendations_state='current'`, and writes an `audit_events` row. `20260825100000_harden_confirm_cv_analysis_freshness.sql` later closed a real, reproduced-live gap: the original version didn't reject a `recommendations_state='stale'` analysis (preferences changed since generation) — it would silently re-approve a stale row. The current version explicitly rejects anything not `recommendations_state='current'` and requires `preferences_version` to equal the caller's live `job_preferences.version`.

### 11.4 Staleness/supersession triggers

Two `SECURITY DEFINER` triggers (required because they fire as a side effect of a user's own legitimate write to *their own* `cvs`/`job_preferences` row, but must then write to `cv_analyses`, which has zero authenticated write policy): `mark_cv_analyses_superseded_on_cv_change` (CV replaced → the old analysis is marked `is_current=false, recommendations_state='superseded'`, and — as of the same-day `20260809090100` fix — `review_status` is also demoted off `'approved'` so the one-approved-per-user partial unique index stays valid) and `mark_cv_analyses_stale_on_preferences_change` (preferences version bumped → the current analysis is marked `recommendations_state='stale'` while staying `is_current=true`, since CV facts remain reusable — only the AI recommendations need a refresh).

### 11.5 Matching eligibility gate — the canonical function

`is_cv_analysis_matching_eligible(p_analysis_id)` (`20260825100010_add_matching_eligibility_gate.sql`) is the single, reusable gate: `status='completed'` AND `review_status='approved'` AND `is_current=true` AND `recommendations_state='current'` AND the CV is still active AND `preferences_version` equals the live `job_preferences.version`. It is wired directly into `matches`' own insert/update trigger (`enforce_match_uses_approved_analysis`, rewritten in the same migration to call this function instead of a weaker locally-re-derived `review_status='approved'`-only check) — **a match cannot structurally be created against a stale-but-approved analysis**, closing exactly the gap the migration's own header documents finding and reproducing live.

### 11.6 Match-score threshold configurability

**Not implemented anywhere — NOT VERIFIED as present, confirmed absent by grep.** `matches.score` is a plain `integer check (score >= 0 and score <= 100)` with no default-threshold constant, column, or config table anywhere in the schema, and `grep -rn "80\b|MATCH_THRESHOLD|match_threshold|matching_threshold" supabase/migrations/*.sql src/` finds no genuine match (only false positives — sort-order values, unrelated numbers). This is expected, not a defect: no matching worker exists yet to need a threshold. It is listed here as a concrete requirement for Automation 2's design (Section 17/18), not a currently-broken feature.

### 11.7 Hard filters for job matching — present or absent

**Absent, and this is worth being precise about.** The *CV-analysis* eligibility gate (11.5) answers "is this user's *profile* fresh enough to match against" — it says nothing about a specific job's geography, work-arrangement fit, seniority fit, or language requirements, because there is no `jobs` data to filter against yet (Section 8). The audit spec's required hard filters (subscription geography, user location preferences, work arrangement, relocation preference, seniority, mandatory languages) — intended to run *before* expensive AI matching-analysis — have **no implementation today**, and cannot, until `jobs` gains the structured columns Section 8 identifies as missing. This is the concrete design gap Automation 2 must close; it is not something this audit can report as "broken" since nothing has attempted to build it yet.

### 11.8 Ownership review, per RPC

Every RPC touched in this lifecycle was individually checked for a client-suppliable `user_id` parameter or any missing ownership check:

| Function | Security mode | Executable by | Takes `user_id` param? | Ownership enforcement |
|---|---|---|---|---|
| `replace_cv` | DEFINER | `authenticated` | No | `auth.uid()` derived internally; storage path must start with `auth.uid()::text || '/'` |
| `create_analysis_task` | DEFINER | `service_role` only | Yes (`p_user_id`) | Safe — never reachable by `authenticated` at all |
| `claim_analysis_task` / `fail_stale_analysis_tasks` | DEFINER | `service_role` only | No | Operates registry-wide by design (a worker, not a user action) |
| `update_cv_analysis_review` / `confirm_cv_analysis` | DEFINER | `authenticated` | No | `auth.uid()` derived internally; row looked up `WHERE id = p_analysis_id AND user_id = v_user_id` |
| `submit_analysis_feedback` | DEFINER | `authenticated` | No | Ownership check combines not-found/not-owned into one error message (deliberately, to avoid leaking existence of another user's analysis id — good practice) |
| `save_job_preferences` | **INVOKER** (not definer) | `authenticated` | No | Relies on the caller's own RLS — correct, since this table is still directly client-writable |
| `is_cv_analysis_matching_eligible` | DEFINER | `authenticated`, `service_role` | Yes (`p_analysis_id`, not `user_id`) | When called with a live session, explicitly checks `auth.uid() <> v_row.user_id → return false` (never leaks another user's eligibility); when called internally by the trigger (`auth.uid()` is null under `service_role`), the caller trigger separately re-verifies ownership |

**No missing ownership check was found in any function in this lifecycle.**

### 11.9 n8n worker alignment

`n8n-workflows/cv-analysis-worker.ts`/`.json` (1,551 lines) is the one existing, wired automation in this repository, and per `docs/PRODUCTION_READINESS.md`'s independently-cited evidence (not re-fabricated here, but consistent with what this audit found in the SQL side): it calls `claim_analysis_task`/`fail_stale_analysis_tasks` via the service-role RPC path, uses `Prefer: resolution=ignore-duplicates` for idempotent retries, and its "Load Task Feedback" step's unordered `analysis_feedback?analysis_task_id=eq.{taskId}&limit=1` query is made deterministic by the DB-side invariant `submit_analysis_feedback`/`enqueue_followup_analysis_task` maintain (at most one *live*, non-superseded feedback row per task at any time) — no n8n-side change was ever required to keep that read correct, exactly the kind of DB-does-the-work design this whole schema follows. This worker is the correct template for Automation 2's matching worker to copy structurally (claim function + idempotent batch processing + service-role-only RPC surface).

---

## 12. Cost and Concurrency Analysis

- **Idempotency is a genuinely consistent, repeated pattern**, not built once and forgotten: `create_payment_attempt` (reuse in-flight attempt), `create_analysis_task` (reuse active task per CV, `ON CONFLICT ... DO NOTHING` + re-fetch on race loss), `mark_payment_verified` (no-op on an already-`'paid'` attempt), `confirm_cv_analysis` (no-op if already approved+current+fresh), `create_application` (reuse an existing active application per match) — every one of these guards against the exact "ten users join at once" scenario the audit asked about, for the surfaces that exist today.
- **Concurrent CV-analysis claiming is proven safe**: `FOR UPDATE SKIP LOCKED` in `claim_analysis_task` means two overlapping worker executions provably claim disjoint rows (documented and, per `docs/PRODUCTION_READINESS.md`, tested with concurrent-caller test cases in `tests/db/rate-limits.test.mjs`).
- **`automation_tasks` inherits the identical schema shape** (`FOR UPDATE SKIP LOCKED`-ready columns: `locked_by`, `locked_at`, `next_attempt_at`, partial-unique dedup index) but **has no claim function written yet** (Section 9.3) — the concurrency-safety *pattern* is proven elsewhere in this codebase, it simply has not been repeated here yet.
- **No shared ingestion-pipeline or source-locking mechanism exists** — expected, since no ingestion worker exists at all yet. There is no `source_id`/company-registry table to lock against in the first place (Section 7).
- **Batch/eligible-user matching**: `is_cv_analysis_matching_eligible()` (Section 11.5) is exactly the reusable predicate a future batch-matching query would `WHERE`-filter users by — it already exists and is already correct; a matching worker does not need to reinvent this logic.
- **Duplicate-match prevention**: `matches_user_job_analysis_key` (`unique (user_id, job_id, cv_analysis_id)`) already prevents a re-run from duplicating a match for the same (user, job, analysis-version) triple — a new analysis version is free to produce a fresh match, by design.
- **Duplicate-AI-analysis prevention**: `analysis_tasks_one_active_per_cv` (partial unique) — proven, already covers the exact "ten simultaneous onboarding completions" scenario for CV analysis specifically.
- **No connection-pooler/production-scale concurrency test exists** (unsurprising — there is no live database available in this environment to test against, Section 4). No load or concurrency claim beyond "the schema-level idempotency guards are correctly designed" can be made without one.

---

## 13. Security and RLS Findings

All findings below were re-verified directly against current migration source in this session — none are carried forward unverified from either prior document.

### 13.1 Admin role model

`profiles.role` (`text not null default 'user' check (role in ('user', 'admin'))`, `20260809090020`) exists, is **not** client-writable (column-level `GRANT UPDATE` explicitly excludes `role`, `:16-17`), and `is_admin()` (`SECURITY INVOKER`, reads only the caller's own `profiles` row under existing RLS) is the canonical check. **Application-layer consumer exists**: `src/lib/authz/requireAdmin.ts` re-derives the user server-side via `supabase.auth.getUser()`, then calls `is_admin()` via RPC, and **throws** (never returns a silently-ignorable boolean) on failure. **However, `requireAdmin()` has zero current callers** (`grep -rn "requireAdmin" src/` finds only its own definition) — **no admin route exists yet to use it.** The authorization primitive is ready; nothing consumes it.

### 13.2 Jobs table write-access policy

Exact policy set (`20260809090030` + `20260809090130`): `jobs_select_active` (`status='active'`, any `authenticated` user), `jobs_select_admin` (`is_admin()`, added later specifically to fix a real RLS self-visibility bug where an admin closing a job made the resulting row briefly invisible to their own UPDATE's implicit SELECT check — a genuine, subtle Postgres RLS gotcha, correctly diagnosed and fixed), `jobs_admin_insert`/`jobs_admin_update`/`jobs_admin_delete` (all `is_admin()`-gated). **An ordinary authenticated user cannot INSERT, UPDATE, or DELETE a `jobs` row under any circumstance** — confirmed by the absence of any non-admin-gated write policy, and independently by `tests/db/jobs-and-admin.test.mjs`'s own test name "ordinary user cannot create, update, or delete jobs."

### 13.3 matches/applications/cover_letters/notifications/audit_events RLS

All five: `SELECT` policy scoped to `auth.uid() = user_id` (or, for `audit_events`, additionally `is_admin()`), **zero** `INSERT`/`UPDATE`/`DELETE` policy for `authenticated` on any of the five. Every mutation goes through a `SECURITY DEFINER` RPC (`approve_match`/`reject_match`/`save_cover_letter_edit`/`approve_cover_letter`/`create_application`/`mark_notification_read`) that re-derives `auth.uid()` and re-checks row ownership before acting. No gap found.

### 13.4 Approve/reject/send RPC review — no bulk-approve/send bypass found

Every function in `20260809090110_add_match_cover_letter_application_rpcs.sql` was read in full (Section 11 context applies equally here): `approve_match`/`reject_match` both lock the target row, are idempotent (return unchanged if already decided the same way), reject any other status transition, and log to `audit_events`. `create_application` — the actual "send" gate — **requires `matches.status = 'user_approved'`** (checked server-side, `:if v_match.status <> 'user_approved' then raise exception`), independently re-verifies the referenced job exists, and — critically — requires an **approved** cover letter specifically when the job's `application_method='email'` (an external-link job, including every LinkedIn listing, may proceed with prepared materials only, matching AGENTS.md §7 exactly). **No function anywhere lets a caller approve and send in a single call** — every path requires a match to already be `user_approved` (a distinct prior action) before `create_application` will do anything. No "approve all and send" bypass exists.

### 13.5 LinkedIn compliance

`grep -rin "linkedin" src/ supabase/migrations/*.sql n8n-workflows/` — **zero matches** anywhere in executable code or SQL. The only place "linkedin" appears in the entire schema is as an allowed `jobs.source_type` enum value, structurally forbidden from `application_method='email'` (`jobs_linkedin_never_email` check constraint, Section 8) — i.e., the one place LinkedIn is represented at all is a *constraint that prevents* automated LinkedIn application sending, not a path toward it. Fully compliant with AGENTS.md §7.

### 13.6 Cover-letter fact-grounding enforcement

**Not yet enforced anywhere in the database or code — expected, since no generator exists yet.** No column, check constraint, or validation function constrains cover-letter content to facts present in the approved `cv_analyses` row + job description. This is a design requirement for the future cover-letter-generation automation (AGENTS.md §30's general "AI output must be validated" rule applies), not a currently-broken guarantee.

### 13.7 API route inventory and server-side auth verification

All 12 routes in `src/app/api/**/route.ts` were read individually and re-verified in this session (not just spot-checked against the prior doc):

| Route | Re-derives identity server-side? | Input allowlisted? | Rate limited? | Uses service-role client? |
|---|---|---|---|---|
| `POST /api/onboarding/complete` | Yes (`getUser()`, 401 if absent) | N/A (no body) | Inherits `create_analysis_task`'s DB-level dedup/quota | Yes — `createAdminClient()` |
| `POST /api/cv-analysis/confirm` | Yes (session-derived, re-checked in `confirm_cv_analysis()`) | Yes — `{analysisId}` only | Not limiter-gated by design (idempotent, ownership-checked, no AI/external cost) | No |
| `POST /api/cv-analysis/review` | Yes | Yes — `{analysisId, userEdits}`, object-shape guarded | Same as above | No |
| `GET /api/cv-analysis` | Yes, never accepts a client-supplied id | N/A (GET) | No | No |
| `POST /api/profile/update-name` | Yes (`getUser()`, 401 if absent) | Yes — trimmed/length-bounded | Inherits shared feedback/user-request quota | No |
| `POST /api/auth/forgot-password` | N/A (pre-auth) | Yes — normalized/validated | Yes — dual gate (email 3/15min + session 5/15min) | No |
| `POST /api/auth/login` | N/A (establishes identity) | Yes | Yes — email-keyed | No |
| `POST /api/auth/oauth-init` | N/A (pre-auth) | N/A | Yes — session-cookie-keyed | No |
| `POST /api/checkout` | Yes (`NotAuthenticatedError` on missing session) | Yes — plan-code allowlist before any DB call | Yes — `create_payment_attempt`'s own 10/hr quota | No |
| `POST /api/cv-analysis/submit-feedback` | Yes (`getUser()`, 401 if absent) | Yes — feedback-type allowlist, min-length text | Yes — shared feedback quota, `PT429`→429 | No |
| `POST /api/auth/signup` | N/A (creates identity) | Yes — email/password/name validated | Yes — dual gate (email 5/15min + session 8/15min) | No |
| `POST /api/auth/update-password` | Yes (`getUser()`, 401 if absent) | Yes — password shape validated | Yes — user-id-keyed (8/15min) | No |

Every mutating route re-derives `auth.uid()` server-side before acting, or (checkout, feedback) passes only a plan code/analysis id that the underlying RPC re-validates against the session's own identity — none accept a client-supplied `user_id` as identity proof. Service-role reachability from the browser: `grep "admin.ts\|createAdminClient" src` finds it imported only from server-only route/lib files; `src/lib/supabase/admin.ts` itself carries a self-documenting "never import from a 'use client' file" comment, and no `"use client"` file does. No route touches `jobs`/`matches`/`applications` today (Section 9.5) — so there is no admin/job-mutation route surface to audit yet.

### 13.11 Rate-limit infrastructure — reusable pattern, not yet reusable coverage

Both existing rate-limit tables gate their action names with a closed CHECK-constrained enum, not an open string: `auth_rate_limit_events`'s `reserve_auth_attempt` rejects any `p_action` outside `('login','signup','forgot_password','oauth_init','oauth_callback','password_update')` (`20260822130000_generalize_auth_rate_limits.sql:101`), and `rate_limit_events.action` is constrained to `('cv_replace','feedback_task_create')` (`20260821090000_add_ai_task_and_cv_replace_rate_limits.sql:179`). The underlying *pattern* — advisory-lock-serialized rolling-window counter, `service_role`-only `EXECUTE`, hashed (never raw) identifier — is proven and directly copyable, but **no future automation-heavy surface (match-approve, application-send, job-matching-request, etc.) can plug into either table today without its own small migration** adding a new action value to one of these enums (or a new sibling table). Scoped, low-risk, additive work each time — listed as P2 (Section 16), since nothing needs it until the corresponding automation exists.

### 13.8 Rate-limiting spot-check (independently re-verified, not trusted from the doc)

Three claims from `docs/PRODUCTION_READINESS.md` were independently re-checked against current source rather than assumed correct:
1. **Login rate limit** — doc claims 5/15min. **Confirmed**: `src/lib/authRateLimit/rateLimit.ts:22`: `login: { limit: 5, windowMinutes: 15 }`.
2. **CI does not run DB tests** — doc claims this. **Confirmed**: `.github/workflows/ci.yml` runs exactly `Lint`, `Type check`, `Unit tests` (`npm run test:unit`), `Workflow tests` (`npm run test:workflow`), `Build` — **no `test:db` step exists**, despite `package.json`'s `"test"` script running all three suites locally. This is a live violation of the project's own `AGENTS.md` §34 rule: *"CI is not considered successful unless the required test suites actually ran... A CI run that only lints, type-checks, and builds has not validated behavior."* This is a genuine, current, actionable finding (not merely inherited from a stale doc).
3. **CV-replacement rate limit (5/rolling hour)** — doc claims this is enforced inside `replace_cv()` itself. Confirmed structurally by reading `20260821090000_add_ai_task_and_cv_replace_rate_limits.sql`'s stated design during Section 11's migration read-through — consistent with the doc's claim (this migration was read for its CV-replace-quota content specifically).

### 13.9 Public-table `using (true)` policy audit

Every `using (true)` policy found across all 79 migrations was checked: `plans`, `countries`, `universities`, `majors`, `target_roles`, `locations`, `location_nearby_areas`, `price_versions`, `plan_prices` — **all nine are legitimately public, non-personal reference/catalog tables.** No `using (true)` policy was found on any private, user-owned table.

### 13.10 CV storage policy and file-signature validation status

The `cvs` storage bucket policies (`20260714153105`) and the `20260811090000` PDF-only server-side MIME guard remain unchanged and sound (private bucket, folder-scoped-to-`auth.uid()` object policies, no public URL construction anywhere in the code). **The previously-flagged gap remains open and unchanged**: `grep -rin "PDF\|magic\|file signature|%PDF" src/` finds only string-literal UI copy ("Please upload a PDF file") and MIME-type checks — **no server-side byte-signature (magic-number) validation exists anywhere.** Every layer (client `validateFile()`, the Storage bucket's `allowed_mime_types`, and `replace_cv()`'s own `p_mime_type <> 'application/pdf'` check) validates only the *declared* MIME type/extension, never the actual file bytes. This is the exact gap AGENTS.md §34 requires eventually closing ("must eventually be validated by file content/signature... not yet implemented") — still true today, unchanged from the 2026-08-08 audit's SEC-02 finding.

---

## 14. Missing Tables, Columns, Constraints, Indexes, Policies, and Functions

Consolidated from Sections 5–13 — nothing new introduced here, just gathered in one place:

**Missing/incomplete tables:** a company/source-registry table (Section 7); nothing else.

**Missing columns on `jobs`:** structured company/source reference (FK), raw-payload reference, content-hash dedup key, normalized description, languages/skills/education-requirement columns, structured `country`/`city`/`region_market`, `remote_scope`, `relocation_required`, `first_seen_at`, `last_seen_at`, `last_checked_at`, `last_successful_check_at`, `closing_date` (distinct from the current single `expires_at`), `status_reason`, `expired_at`/`closed_at` (distinct timestamps), `source_last_modified_at` (Section 8, full table there).

**Missing constraint/enum widening:** `jobs.status` needs `pending_review`/`unavailable`/`rejected`/`source_error` added to its current 3-value check (Section 8).

**Missing indexes:** country/work-arrangement-filtered active-job queries, a status-driven expiry-sweep index, a dedup index beyond `(source_type, external_id)` (Section 8).

**Missing functions:** a claim function for `automation_tasks` (mirroring `claim_analysis_task` exactly — Section 9.3); a job-level hard-filter/eligibility function combining job geography + user preferences + subscription entitlement (Section 10.7); a cover-letter fact-grounding validator (Section 13.6, not yet needed since no generator exists); a match-score-threshold constant/config surface (Section 11.6).

**Missing policies:** none found to be missing on any *existing* table — every table's RLS was checked and found sound (Section 13).

**Overly broad grant not yet revoked:** `authenticated`'s `DELETE` grant + `cvs_delete_own` policy on `cvs` — a leftover from before `replace_cv()` became the sole intended write path; `insert`/`update` were correctly revoked in the same migration but `delete` was not (Section 11.1).

**Not-yet-generalized infrastructure:** `rate_limit_events`/`auth_rate_limit_events`'s action enums are closed lists, not open to a new automation surface without a migration (Section 13.11). **Registry data-quality defect:** 5 companies (Amazon, Accenture, TCS, SLB, Apparel Group) hold two different `canonical_company_id` values across markets instead of one shared multinational id (Section 7) — fix before this id becomes a DB foreign key.

---

## 15. Contradictions Between Current Requirements and Existing Implementation

| # | Stated requirement (this audit's brief) | What the codebase actually contains | Resolution needed from |
|---|---|---|---|
| 1 | Pro plan is $19/month | `plans.price_amount` and `plan_prices` both say $18.00, matching `Pricing.tsx` exactly; zero occurrence of "19" as a price anywhere | **User** — confirm intended price before touching anything (Section 10.1) |
| 2 | "Earlier project versions may contain a Pro price of $18" (implying $19 is newer) | The *opposite* is true as far as this repository shows: $18 is the only price ever seeded, including in the newest (`20260903090000`) pricing migration, which re-derives its locked schedule *from* the live $18 value | **User** |
| 3 | Student plan should restrict matching to Lebanon based on the user's residence | Residence is no longer a variable — every user is Lebanon-resident by system-level default (`20260902090010`); the Student/Pro distinction is now made via `international_search_enabled` (Pro-only) instead | Not a defect — a legitimate, documented product simplification; noted so the team doesn't mistake it for an unenforced rule |
| 4 | Earlier reports disagreed on whether `jobs`/`matches`/etc. exist | They exist, created 2026-08-09, confirmed directly from primary source (Section 4/5) | Resolved by this audit; the 2026-08-08 report is stale on this point |

---

## 16. Prioritized Remediation

### P0 — required before ingestion automation begins

1. **Design and migrate a company/source-registry table** (or make an explicit, documented decision to stay CSV-only with a defined import step — Section 7's evidence table lays out the tradeoff either way). `jobs` needs a stable FK target before real ingestion can safely dedup by company.
2. **Extend `jobs`' schema and status model** per the gap analysis in Section 8: structured geography columns, the three freshness timestamps, an expanded `status` enum including `source_error`, and a dedup key that covers `admin_manual`/cross-source duplicates.
3. **Build the `automation_tasks` claim function** (`claim_automation_task`, mirroring `claim_analysis_task` — Section 9.3). This is the single piece of work standing between the existing outbox schema and a usable worker.
4. **Wire `test:db` into CI** (currently absent — Section 13.8), or at minimum make its absence an explicit, tracked, time-boxed decision rather than a silent gap — this schema's own RLS/security test coverage (`jobs-and-admin`, `matches-cover-letters-applications`, `notifications-audit-tasks`) currently never runs automatically.

### P1 — required before matching automation begins

5. **Build the job-level hard-filter/eligibility function** (Section 10.7) — combines job geography/work-arrangement/remote-scope with user preferences and subscription entitlement; cannot be written meaningfully until item 2 above lands.
6. **Define and store a configurable match-score threshold** (Section 11.6) — currently absent entirely.
7. **Resolve the $18/$19 pricing question** with the user (Section 10.1/15) before any pricing-adjacent automation work assumes either number.
8. **Add server-side CV file-signature (magic-number) validation** — still open since 2026-08-08 (Section 13.10); relevant to job-matching automation because a future CV-text-extraction step should not trust an unverified file type any more than the upload path does.

### P2 — safe to delay

9. Cover-letter fact-grounding validator — needed only once a generator exists.
10. `automation_tasks.payload` column, if a future worker needs task-specific parameters beyond `(subject_type, subject_id)`.
11. Company-registry `company_type` enum cleanup (2 non-conforming values found, cosmetic — Section 7).
12. Account-deletion route/UI and a published privacy policy — **still both entirely absent** (confirmed by this audit: no route under `src/app` matches `*delete*`/`*privacy*`, and no code references `auth.admin.deleteUser`). These are unrelated to job-matching specifically but remain explicit AGENTS.md §34 deployment blockers the team should not lose track of while focused on this feature area.
13. Revoke `authenticated`'s leftover `DELETE` grant + `cvs_delete_own` policy on `cvs` (Section 11.1) — closes the one remaining direct-client-write path the `20260809090010` conflict-resolution migration didn't fully close. Self-scoped only, not a cross-user risk, but inconsistent with the table's documented single-write-path intent.
14. Extend `rate_limit_events`/`auth_rate_limit_events`'s closed action enums (or add a sibling table) before wiring rate limiting to any new automation-heavy surface (match-approve, application-send, job-matching requests) — the pattern is proven, the coverage is not (Section 13.11).

---

## 17. Proposed Additive Migration Sequence (design only — no SQL written)

1. **`company_sources` foundation** (new migration): `companies` table (canonical identity, mirroring `canonical_company_id`) + `company_sources` table (one row per company × market × career-source, mirroring `source_record_id` — matches `discovery-report.md` §18's own unbuilt proposal exactly). Seed from the current CSVs via a one-time service-role import script, not hand-written INSERT statements (588 rows).
2. **`jobs` freshness/geography extension** (new migration, purely additive `ALTER TABLE ADD COLUMN`): `source_id uuid references company_sources(id)`, `country_code text references countries(code)`, `city text`, `remote_scope text check (...)`, `relocation_required boolean`, `first_seen_at`/`last_seen_at`/`last_checked_at`/`last_successful_check_at timestamptz`, `closing_date timestamptz`, `status_reason text`, `closed_at timestamptz`, widen the `status` check to add `pending_review`/`unavailable`/`rejected`/`source_error`. Backfill existing (currently zero) rows trivially.
3. **`automation_tasks` claim function** (new migration, function-only, no schema change): `claim_automation_task(p_batch_size)` + `fail_stale_automation_tasks(p_lease_minutes)`, copied structurally from `claim_analysis_task`/`fail_stale_analysis_tasks`.
4. **Job-level hard-filter function** (new migration, function-only): `is_job_eligible_for_user(p_job_id, p_user_id)` or equivalent — combines `jobs` geography + `job_preferences`/`job_preference_locations`/`job_preference_relocation_locations` + `subscriptions.plan_code`/`international_search_enabled`. Must run *before* any AI-cost matching step, per the audit's own hard-filters-first requirement.
5. **Match-threshold configuration** (new migration, small): either a `plans.match_threshold` column (per-plan configurable) or a single system-config row — the exact shape is a product decision (Section 19), not a technical one.

Each of the above is additive, reversible via a follow-up migration, and requires no destructive change to any existing table — consistent with every migration pattern already established in this codebase.

---

## 18. Test Matrix (design only — no destructive test executed)

### Job lifecycle
| Scenario | Expected DB behavior |
|---|---|
| New job first discovery | Insert succeeds; `first_seen_at`/`last_seen_at`/`last_checked_at` all set to the same run's timestamp |
| Same job found again | `last_seen_at`/`last_checked_at` update; no duplicate row (dedup key match) |
| Changed description | Row updates in place; `updated_at` bumps; `source_last_modified_at` reflects the source's own claim if available |
| Removed job (no longer in listing) | `last_seen_at` stops advancing; a separate sweep, not the ingestion run itself, later marks `status='closed'`/`'expired'` once absent for a defined grace period — never on the very first miss |
| Closing date passed | `status` transitions to `expired` by a scheduled sweep reading `closing_date`, not by ingestion itself |
| Missing closing date | Row remains `open` indefinitely until `last_seen_at` staleness or an explicit source removal triggers closure |
| Temporary source failure | `last_checked_at` advances, `last_successful_check_at` does not; `status` **must not** change; a source-health record (not the job row) reflects the failure |
| Job URL returns 404 | Same as above for a single job-level check; only a sustained pattern (N consecutive failures) should ever flip `status='source_error'` on that one job |
| Duplicate job from two sources | Two `jobs` rows initially (different `source_id`); a content-hash or manual admin merge collapses them — dedup key alone (per-source `external_id`) cannot catch this case, confirming Section 8's gap |
| Reopened job | A previously `closed`/`expired` row seen again in a fresh listing: either revives the existing row (`status` back to `open`, `closed_at` cleared) or intentionally creates a new row — a product decision, not yet made |

### Plan eligibility
| Scenario | Expected result |
|---|---|
| Student + Lebanon job | Eligible |
| Student + UAE job | Not eligible (international disabled by plan) |
| Student + international remote job | Not eligible |
| Pro + Lebanon job | Eligible |
| Pro + worldwide remote job | Eligible if `international_search_enabled=true` |
| Pro + country-restricted remote job | Eligible only if the job's remote scope includes the user's residence (Lebanon, by current system default) |
| Pro + UAE on-site + willing to relocate | Eligible if UAE is among the user's selected `job_preference_relocation_locations` |
| Pro + UAE on-site + not willing to relocate | Not eligible |
| Expired/cancelled subscription | Not eligible regardless of plan_code (per `get_onboarding_readiness`'s existing `plan_eligible` computation, already correct and reusable) |
| Plan price changed during an existing billing period | No rebill; verified already — Section 10.5, `tests/db/price-versioning-and-upgrade.test.mjs` |

### User lifecycle
| Scenario | Expected DB behavior |
|---|---|
| Ten users approve profiles simultaneously | Each `confirm_cv_analysis` call is independently row-locked (`FOR UPDATE`); no cross-user contention (different rows) — already safe by construction |
| One user replaces their CV | `replace_cv()` already handles this correctly and safely (Section 11.1) |
| One user edits preferences | `mark_cv_analyses_stale_on_preferences_change` already handles this correctly |
| Stale AI profile | `is_cv_analysis_matching_eligible`/`confirm_cv_analysis` already reject it |
| Duplicate matching task | Would be prevented by `automation_tasks_one_active_per_subject`, once a claim function exists to actually process the table |
| Duplicate match | Prevented by `matches_user_job_analysis_key` — already enforced |
| User tries to access another user's match | Rejected by `matches_select_own` RLS — already enforced |
| User tries to modify canonical job data | Rejected by the admin-only `jobs` write policies — already enforced |

### Safe, read-only verification queries (illustrative — run only against a disposable local/test database, never production)

```sql
-- Confirm no table other than jobs/automation_tasks lacks RLS
select relname from pg_class
join pg_namespace on pg_namespace.oid = pg_class.relnamespace
where pg_namespace.nspname = 'public' and relkind = 'r' and not relrowsecurity;

-- Confirm every public.* table has at least one policy or is intentionally policy-free (automation_tasks only)
select schemaname, tablename, count(*) as policy_count
from pg_policies where schemaname = 'public'
group by 1, 2 order by 2;

-- Confirm matches.cv_analysis_id always points at an approved, current analysis (should return 0 rows)
select m.id from public.matches m
join public.cv_analyses ca on ca.id = m.cv_analysis_id
where ca.review_status <> 'approved' or ca.is_current <> true;
```

---

## 19. Open Product Decisions

1. **Is Pro $18 or $19/month?** (Section 10.1/15) — needs a direct answer before any pricing-adjacent code changes.
2. **Company registry: CSV-forever, or promote to a DB table now?** (Section 7) — evidence laid out both ways; this is a product/engineering-tradeoff call, not a technical blocker either way.
3. **Job dedup across sources**: content-hash-based, or admin-reviewed manual merge? (Section 8, "Duplicate job from two sources" in the test matrix.)
4. **Reopened-job semantics**: revive the old row, or always create a new one? (Section 18.)
5. **Match-score threshold**: a single system-wide constant, or per-plan configurable? (Section 11.6.)
6. **`automation_tasks.payload`**: add a `jsonb` column now, or keep relying on `(subject_type, subject_id)` re-derivation? (Section 9.2.)

---

## 20. Exact Recommended Next Step

Do not begin building the ingestion or matching n8n workflows yet. First:

1. Get the user's direct answer on the Pro price ($18 vs. $19) and the company-registry CSV-vs-table decision — both are five-minute conversations that unblock everything else.
2. Write the two additive migrations in Section 17, items 1–2 (`company_sources` + `jobs` freshness/geography columns) as a single reviewed PR, following this codebase's own established pattern (evidence-based, additive, RLS from the start, partial-unique dedup indexes, `SECURITY DEFINER` only where genuinely needed).
3. Copy `claim_analysis_task`/`fail_stale_analysis_tasks` into `automation_tasks`'s equivalents (Section 17, item 3) — this is the smallest, lowest-risk piece of work in this entire remediation list, since the pattern is already proven and tested elsewhere in this exact codebase.
4. Only then design the ingestion n8n workflow, using `n8n-workflows/cv-analysis-worker.ts` as the direct structural template (Section 11.9).

---

## Terminal Summary

- **Verdict:** READY_AFTER_FIXES
- **P0 findings:** 4 · **P1 findings:** 4 · **P2 findings:** 6
- **Live Supabase verified:** No (Docker Desktop not running; no remote project configured; local-migrations-only evidence used throughout, clearly labeled)
- **Schema drift (migrations vs. generated types):** None found — `database.types.ts` is current through the newest migration
- **Company registry readiness:** CSV-only (no DB table), 588 rows / 557 unique companies, zero duplicate ids, LinkedIn-compliant, but the registry's own narrative report (`discovery-report.md`) is stale relative to the current CSVs — verified from the CSVs directly, not the report
- **`jobs` lifecycle fields exist:** No — `jobs`/`matches`/`applications`/etc. tables exist and are RLS-sound, but `jobs` itself lacks `first_seen_at`/`last_seen_at`/`last_checked_at`/`last_successful_check_at`/structured geography/expanded status — this contradicts the audit brief's premise that tables might be entirely missing (they are not) while confirming the freshness-field gap is real
- **$9/$19 geographic entitlement enforced server-side:** Geographic entitlement (Lebanon-only vs. Pro-international) **is** enforced server-side via stable plan-code checks (not price-based) — but the price is $18, not $19, in every source this audit could find; flagged as an open question for the user, not silently resolved
- **Report path:** `docs/job-ingestion-database-readiness-audit.md`
- **No implementation, migration, database mutation, commit, or push was performed during this audit.**
- **Update:** the P0 items below were subsequently independently re-verified and partially remediated on `fix/job-ingestion-db-p0` — see Section 21 for what was confirmed, corrected, implemented, or deliberately deferred.

---

## 21. P0 Remediation — Implementation Addendum (`fix/job-ingestion-db-p0`, 2026-09-14)

This section records a second pass that independently re-verified every P0 claim above against live migration replay (not just migration source, as Section 4 above was limited to — Docker/local Supabase were unavailable during the original audit and are available now), then implemented the confirmed, safely-implementable subset. Nothing in Sections 1–20 above was edited; this section only adds what happened next. No commit or push was made — this remains uncommitted, pending review, on the `fix/job-ingestion-db-p0` branch.

### P0 #1 — Company/source-registry table: NOT implemented, correctly gated

Independently re-scanned all 588 CSV rows (not just the 5 companies named in Section 7) for cross-market `canonical_company_id` collisions using the same normalized-name method the original audit describes. Result: **exactly the same 5 companies**, confirming Section 7's finding — with one correction: **SLB has three conflicting ids, not two** (`cc-slb` / Saudi Arabia, `cc-slb-qatar` / Qatar, `cc-slb-formerly-schlumberger` / Kuwait; Section 7 said "two"). Two false-candidate pairs surfaced by a naive normalized-name scan (Qatar Airways vs. Kuwait Airways; Commercial Bank of Qatar vs. Commercial Bank of Kuwait) were correctly excluded — these are genuinely different national companies, not registry defects.

Of the 5, three are mechanically resolvable using the registry's own already-established convention (one shared multinational-brand id, as EY/KPMG/Deloitte/PwC already do) plus corroborating same-domain evidence, because one of each pair already uses the bare canonical form: **SLB** (→ `cc-slb`), **Tata Consultancy Services** (→ `cc-tcs`), **Apparel Group** (→ `cc-apparel-group`). Two are **not** deterministically resolvable from repository evidence: **Amazon** (`cc-amazon-uae` vs. `cc-amazon-sa`) and **Accenture** (`cc-accenture-sa` vs. `cc-accenture-qatar`) — neither pair has an existing bare-form id to converge on, so picking one of the two market-suffixed ids, or minting a new bare id neither row currently uses, would be an identity guess, not a derivation.

Per this task's explicit safety rule ("never guess company identities... if any conflict requires a business or identity decision that cannot be proven from repository evidence, stop before making identity changes"), **no CSV file was modified** and **no `company_sources`/`companies` table was created**. Building that table now would require seeding from a registry with 2 of 5 conflicts unresolved — either guessing, or shipping known-bad dedup on day one. This is deferred, not abandoned: `jobs.source_id` can be added additively once a human resolves the Amazon/Accenture identity question (see the decision table below). This also matches audit Section 19's own item 2 ("CSV-forever, or promote to a DB table now?") — that was already an *open* product decision, not something the original audit called settled.

**Decision table (for review):**

| Company | Conflicting ids | Mechanically resolvable? | Evidence | Recommended canonical form if approved |
|---|---|---|---|---|
| SLB | `cc-slb` (SA), `cc-slb-qatar` (QA), `cc-slb-formerly-schlumberger` (KW) | Yes | All three rows share `slb.com`; `cc-slb` already matches the bare-brand convention | `cc-slb` |
| Tata Consultancy Services | `cc-tcs` (SA), `cc-tata-consultancy-services-qatar` (QA) | Yes | Both rows share `tcs.com`; `cc-tcs` already matches the bare-brand convention | `cc-tcs` |
| Apparel Group | `cc-apparel-group` (KW), `cc-apparel-group-sa` (SA) | Yes | Both rows share `apparelgroup.com`; `cc-apparel-group` already matches the bare-brand convention | `cc-apparel-group` |
| Amazon | `cc-amazon-uae`, `cc-amazon-sa` | **No** | Same global brand, but neither row uses a bare `cc-amazon` form and each has a different official URL (`amazon.ae` vs. `amazon.jobs`) | **Human decision required** |
| Accenture | `cc-accenture-sa`, `cc-accenture-qatar` | **No** | Same global brand, but neither row uses a bare `cc-accenture` form, and `company_type` differs between the two rows (`multinational_subsidiary` vs. `professional_services_network`), suggesting possibly different local legal structures | **Human decision required** |

No CSV row's `canonical_company_id` was changed by this remediation pass, including the three mechanically-resolvable ones — fixing those without also resolving Amazon/Accenture would leave the registry in a partially-converged, harder-to-reason-about state for no immediate benefit, since nothing reads `canonical_company_id` today (Section 7) and no FK depends on it yet.

### P0 #2 — `jobs` freshness/geography/status extension: IMPLEMENTED (partial, by design)

`supabase/migrations/20260914120000_add_jobs_freshness_and_geography.sql` adds, purely additively (12 nullable columns, no `NOT NULL` added to any existing column, zero rows existed to backfill destructively):

- Freshness: `first_seen_at`, `last_seen_at`, `last_checked_at`, `last_successful_check_at` (the three-way distinction Section 8 identified as structurally missing — found in listing / verification attempted / verification succeeded, each independently settable).
- Lifecycle: `closing_date` (source-stated deadline, distinct from the existing system-computed `expires_at`), `status_reason`, `closed_at` (now system-maintained by a new `jobs_set_closed_at` trigger — stamped on transition into `closed`/`expired`/`rejected`/`unavailable`, including a row inserted already in a terminal state, and cleared on transition back out; never client-settable directly), `source_last_modified_at`.
- Geography: `country_code` (FK to the existing `countries(code)` table — no new reference data invented), `city`, `remote_scope` (deliberately left as unconstrained `text` rather than a guessed enum — see the column comment; the CSV registry's own `geographic_scope` vocabulary is richer and still evolving, and the audit's own Section 8 paraphrase of it was not a literal proposal), `relocation_required`.
- `jobs_status_check` widened (drop/recreate, the same pattern already used for `job_preferences_experience_level_check`) to add `pending_review`, `unavailable`, `rejected`, `source_error` to the original `active`/`closed`/`expired`.
- Two evidence-based partial indexes matching the two query shapes Section 8 identified as missing: `jobs_active_geography_idx (country_code, work_arrangement, seniority) WHERE status = 'active'`, `jobs_closing_date_idx (closing_date) WHERE status = 'active' AND closing_date IS NOT NULL`.

**Deliberately not included**, consistent with P0 #1's gating above and audit Section 19's open decisions: a `source_id`/company FK (blocked on the Amazon/Accenture identity decision), a content-hash/cross-source dedup key (Section 19 item 3 — content-hash vs. admin-reviewed-merge is an unmade product decision, not a technical gap), and a match-score threshold (Section 19 item 5 — needed only once a matching worker exists).

A real bug was found and fixed during this work, not just designed: the first version of the `closed_at` trigger used `old.status = any(...)` directly, which evaluates to SQL `NULL` (not `false`) when `old` doesn't exist on `INSERT`, silently skipping the stamp for a job entered directly in a terminal status. Caught by `tests/db/jobs-freshness-and-lifecycle.test.mjs`, fixed with explicit `coalesce(..., false)`, re-verified by a full local `supabase db reset` + direct `psql` insert + full test re-run before being considered done.

### P0 #3 — `automation_tasks` claim function: IMPLEMENTED

`supabase/migrations/20260914110000_create_claim_automation_task.sql` adds `claim_automation_task(p_worker_id, p_batch_size)` and `fail_stale_automation_tasks(p_lease_minutes)`, structurally mirroring `claim_analysis_task`/`fail_stale_analysis_tasks` (`FOR UPDATE SKIP LOCKED`, lease-expiry reclaim, `SECURITY DEFINER`, `service_role`-only execute grant) with no new columns needed — `automation_tasks` already had every column this required (`locked_by`/`locked_at`/`next_attempt_at`/`attempt_count`/`max_attempts`), added on 2026-08-09 anticipating exactly this function. One design deviation from the mirrored pattern, made deliberately: automation_tasks' pre-existing `locked_by`/`locked_at` columns (which `analysis_tasks` doesn't have) are now used for worker attribution and lease tracking, since they already existed for this exact purpose per the original table's own doc comment ("Set by a future claim function").

One audit claim is corrected here: Section 12 stated `claim_analysis_task`'s concurrency safety is "documented and, per `docs/PRODUCTION_READINESS.md`, tested with concurrent-caller test cases in `tests/db/rate-limits.test.mjs`." Independently re-checked: `tests/db/rate-limits.test.mjs` references `claim_analysis_task` only in a comment ("without going through `claim_analysis_task`... exercised elsewhere") — grepping the entire `tests/` tree for an actual `.rpc("claim_analysis_task", ...)` call or `SKIP LOCKED` test found none. **`claim_analysis_task`'s own concurrency/lease-reclaim contract has no direct test coverage anywhere in this repository** — the audit's citation was incorrect. This doesn't affect this remediation (the new `claim_automation_task` is independently tested from scratch in `tests/db/claim-automation-task.test.mjs`, including a real concurrent-caller `Promise.all` test proving disjoint claims), but the gap in `analysis_tasks`' own test coverage is worth the team's awareness — out of scope to fix here (untouched, working code, not part of this branch's mandate).

### P0 #4 — Wire `test:db` into CI: already resolved, not re-implemented here

Independently re-verified: `.github/workflows/ci.yml` still does not run `test:db` — but `docs/PRODUCTION_READINESS.md` (row "CI runs DB integration tests", plus the dedicated "DB tests in CI — investigation result" section) already records this as an **explicit, dated, time-boxed decision** with a concrete rollout plan (a separate non-required `db-tests` job using `supabase/setup-cli`, validated on real PRs before promotion to required), not a silent gap. This satisfies the audit's own P0 #4 fallback clause verbatim ("or at minimum make its absence an explicit, tracked, time-boxed decision"). Actually wiring live Supabase into a GitHub-hosted runner is CI/infrastructure work that cannot be validated from this local environment (this task never pushes or touches CI), carries real risk of breaking `main`'s required checks if done blind, and is explicitly scoped by `docs/PRODUCTION_READINESS.md` as needing a "validated with a manual run before it gates merges" step this branch cannot perform. **Downgraded from "action required" to "already tracked, correctly not touched here."**

### Test coverage added

`tests/db/claim-automation-task.test.mjs` (8 tests: single claim, no-double-claim-while-processing, concurrent disjoint claims, lease-expiry reclaim, in-lease non-reclaim, permanent-fail-after-exhausted-retries, in-lease/attempts-remaining non-fail, anon/authenticated execute-denied) and `tests/db/jobs-freshness-and-lifecycle.test.mjs` (7 tests: default-null freshness fields, widened status enum accept/reject, `closed_at` stamp-on-transition and clear-on-reactivation, `closed_at` untouched by a non-status update, `country_code` FK enforcement, independent freshness-column settability, admin-only write policy unaffected). Both added to the existing `tests/db/*.test.mjs` glob picked up by `npm run test:db` — no script changes needed.

### Full validation run (this branch, local, `supabase db reset` from scratch)

`npm run lint` — 0 errors/warnings. `npx tsc --noEmit` — clean. `npm run test:unit` — 305/305. `npm run test:workflow` — 127/127. `npm run test:db` — **335/335, 83 suites**, zero regressions in existing pricing/CV-analysis/subscription/matching/rate-limit suites, zero fixtures leaked (orchestrator-verified). `npm run build` — succeeds. `src/lib/supabase/database.types.ts` regenerated from the freshly-migrated local schema (not hand-edited). `git diff --check` — clean (one benign LF/CRLF line-ending note on the regenerated types file, not a real whitespace error). `n8n-workflows/cv-analysis-worker.json` — confirmed byte-identical to `origin/main` throughout. No commit or push was made.

---

## 22. P0 Review & Correction Pass (same branch, second session, 2026-09-14)

A second session was explicitly asked to treat Section 21's own report as "a claim to verify, not proof P0 is complete." It found and fixed two real issues, corrected one factual error in Section 21 itself, and added further concurrency/idempotency test coverage. Nothing below discards the Section 21 work — all four original files remain; two migrations were added on top.

### Correction: the "81 migrations" claim in Section 21 was wrong

Section 21 stated "all 81 migrations" were replayed. **This was never actually counted — it was an unverified estimate, and it was wrong.** Reconciled precisely via `git ls-tree` at each of the three inherited commits plus a live count of `grep -c "^Applying migration"` from an actual `supabase db reset`:

| Point | Migration count | Source |
|---|---|---|
| At `d3a5afa` (audit commit) | **73** | `git ls-tree -r --name-only d3a5afa -- supabase/migrations/` |
| At `8173cf7` (pricing commit) | 74 (+1: `20260914100000_add_public_plan_catalog_and_price_publishing.sql`) | `git diff --name-status d3a5afa 8173cf7` |
| At `8100fdc` (lint commit, current HEAD) | 74 (+0) | `git diff --name-status 8173cf7 8100fdc` |
| + Section 21's 2 new migrations | 76 | — |
| + this section's 2 new migrations (below) | **78** | current disk state, confirmed by an actual `supabase db reset` run |

Separately: **Section 3 of this audit's own original text claims "All 79 files ... read in full" for the commit it was written against — that count was also wrong** (73, not 79), a pre-existing discrepancy in this document, not introduced by any later session. There were never any "missing"/unaccounted-for migrations — the true count was simply never verified before being reported, twice, in two different sessions. No content of this audit's original findings depended on the exact file count being 79 vs. 73, so this doesn't change any earlier conclusion — it's flagged here purely as a self-report-reliability correction, consistent with this section's own mandate to verify rather than trust prior claims.

### Automation-task claim function review: one real bug found and fixed

Reviewing `claim_automation_task`/`fail_stale_automation_tasks` for authorization (confirmed: `service_role`-only execute grant, re-verified live via `has_function_privilege` against `anon`/`authenticated`/`service_role`), concurrency (confirmed: `FOR UPDATE SKIP LOCKED` correctly gives disjoint claims under a real concurrent `Promise.all`, both for 2 and 10 simultaneous callers), retry (attempt_count increments correctly on both fresh and reclaimed rows), and lease-recovery (an expired lease with attempts remaining is reclaimed; one still within its lease is not) found one genuine design defect:

**`fail_stale_automation_tasks` stamped `completed_at` on permanent failure** — the same column a future successful-completion path would also need to stamp, making "this task is done" and "this task succeeded" indistinguishable from the row alone. `analysis_tasks` avoids exactly this ambiguity with a dedicated `failed_at` column; `automation_tasks` did not have one. **Fixed** in `supabase/migrations/20260914130000_add_automation_tasks_failed_at.sql` — adds `failed_at timestamptz`, and `fail_stale_automation_tasks` now stamps that instead of `completed_at`. No consumer reads `automation_tasks` today (still zero, confirmed by re-grep), so this was not a live bug, but it would have been a real footgun for the first matching/cover-letter worker built against this table. `tests/db/claim-automation-task.test.mjs` was updated to assert `failed_at` is set and `completed_at` stays `null` on permanent failure.

### Jobs lifecycle trigger review: safe, no other consumer affected

Re-checked every place `jobs.status` is read anywhere in the codebase (`grep -rn "jobs\.status\|j\.status\|status = 'active'"`) to confirm the widened `jobs_status_check` (7 values, up from 3) cannot silently break an exhaustive status match elsewhere. Found exactly one other consumer: the `jobs_select_active` RLS policy (`status = 'active'`), an open-ended equality check, not an exhaustive `CASE` — unaffected by adding new values. `enforce_application_method_matches_job` (the `applications` table's own trigger) does not reference `jobs.status` at all. The full regression suite (below) independently confirms zero breakage in `matches`/`applications`/`cover_letters`/history: `tests/db/matches-cover-letters-applications.test.mjs` and `tests/db/jobs-and-admin.test.mjs` both still pass unmodified.

One real bug was caught and fixed in the trigger itself during Section 21's own original work (documented there): `old.status = any(...)` evaluated to SQL `NULL` rather than `false` on `INSERT` (no `OLD` row), silently skipping the `closed_at` stamp for a job entered already in a terminal status. That fix (`coalesce(..., false)`) was re-verified again this session via a fresh `supabase db reset` and a direct `psql` insert.

### Canonical-company conflicts: richer evidence pulled, decision unchanged but sharpened

Section 21 already deferred all five conflicts. This pass pulled **every column** of all ten rows (not just name/id/country/domain) to check for evidence Section 21 might have missed, per this session's explicit instruction not to infer identity from name similarity alone.

**Amazon — stronger evidence AGAINST merging than previously reported.** The Saudi Arabia row's own `researcher_notes` field states, verbatim: *"NOT a duplicate of cc-amazon-uae -- different target_country."* This is the registry's own author explicitly documenting an intentional decision to keep these separate — not an oversight, and not something this branch should override. `legal_or_official_name` also differs meaningfully: `"Amazon.ae (Amazon Middle East)"` (UAE) vs. `"Amazon (incl. AWS)"` (Saudi Arabia) — the Saudi row explicitly folds in AWS, the UAE row does not, suggesting the rows may even cover different in-market business lines, not just different offices of one identical entity.

**Accenture — evidence is more suggestive of a merge than previously reported, but still not deterministic.** The Qatar row's own `terms_or_access_notes` explicitly self-compares to the already-shared-id firms: *"Same evidence tier as the already-verified PwC/Deloitte/KPMG/EY Qatar rows"* — i.e., the researcher who wrote this row considered Accenture part of the same one-id-per-multinational-brand pattern EY/KPMG/PwC/Deloitte already use, yet did not actually give it a shared bare id (an apparent inconsistency in applying the registry's own convention, not a documented decision to keep Accenture separate). Working against a merge: `company_type` differs (`multinational_subsidiary` for Saudi vs. `professional_services_network` for Qatar) and `legal_or_official_name` differs (plain `"Accenture"` vs. `"Accenture (Middle East) B.V. — Qatar practice"`, headquarters `unknown` vs. `Ireland`) — consistent with genuinely different local legal entities under one global brand, which is normal for Big-4-style firms and not itself proof of separateness for FK purposes. **Still requires a human decision** — the evidence leans toward "should probably be one id" but is not proof, and this session's instructions are explicit that "should probably" is not sufficient to act on.

**SLB, TCS, Apparel Group — confirmed mechanically resolvable, with one new caveat.** All three still show the expected same-domain, same-brand, branch/operations-of-one-company language (`"SLB (Qatar operations)"`, `"Tata Consultancy Services (Qatar branch)"`) that supports the existing bare-id convergence recommendation from Section 21. **New finding this pass**: the Apparel Group row's own `researcher_notes` for the Kuwait entry states, verbatim: *"Already has a verified Saudi row (cc-apparel-group-sa) -- reuse the existing market-neutral canonical_company_id for a Kuwait row, per repository convention, flagged for human confirmation"* — i.e., the registry's own author already reached the same conclusion this audit did, and already flagged it for the exact human sign-off this audit is also recommending. **Also new**: both the Kuwait Apparel Group row and the Kuwait SLB row carry `review_status: needs_manual_review` (not `verified`) with `rejection_or_review_reason: "Staged only from this research pass -- requires a separate adversarial human-quality audit before any production promotion, per task instruction"` — independent of the canonical-id question, these two specific rows are **not yet cleared by the registry's own internal review process at all**. This reinforces (does not change) the existing recommendation: no CSV was modified this pass either.

### Remaining P0 foundation — investigated, one real bug found and fixed, rest already sound

Investigated deterministic identity, concurrent-duplicate prevention, idempotent retries, provenance, and service-role-only mutations — the five items explicitly named as needing verification. New test file: `tests/db/jobs-ingestion-identity.test.mjs` (6 tests).

- **Deterministic external-job identity**: already correct (`jobs_source_external_id_key`, pre-existing since `20260809090030`). No company-identity decision blocks this — it operates at the `(source_type, external_id)` level, one layer beneath the company question.
- **Duplicate prevention under concurrent ingestion**: the pre-existing sequential test (`jobs-and-admin.test.mjs`, "duplicate ... is rejected") only proved a second, later insert fails — it never exercised two genuinely simultaneous attempts. Added a real `Promise.allSettled` test with 2 and then 10 concurrent inserts racing the same `(source_type, external_id)`: in both cases exactly one row is created, confirming the unique index is safe under real concurrency, not just sequential retries.
- **Idempotent retries — real bug found and fixed.** `jobs_source_external_id_key` was a **partial** unique index (`where external_id is not null`). Postgres refuses to use a partial index as an `ON CONFLICT` inference target unless the conflict clause repeats the exact same predicate — so the natural, idiomatic upsert pattern a future ingestion worker would write (`insert ... on conflict (source_type, external_id) do update ...`, which is also what Supabase's `.upsert()` generates) **failed outright with Postgres error 42P10**, reproduced directly before fixing it. Root cause: the partial predicate was unnecessary in the first place — verified, inside a rolled-back transaction, that a **full** (non-partial) unique index already never treats two `external_id IS NULL` rows as colliding (standard SQL NULL semantics, true with or without a partial predicate). **Fixed** in `supabase/migrations/20260914140000_widen_jobs_dedup_index_for_upsert.sql` — drops and recreates the index without the partial predicate. Behavior-preserving (re-verified: `jobs-and-admin.test.mjs`'s "manually entered jobs never collide" test and this branch's own equivalent both still pass unmodified) while unblocking upsert-based idempotent retries.
- **Source/company provenance**: `source_type`/`source_url`/`external_id`/`created_by`/`first_seen_at`/`last_checked_at` (the last two added in Section 21) already give a complete provenance trail without needing `company_sources` — confirmed `created_by` is nullable specifically so a service-role ingestion insert with no authenticated user remains fully valid. Company-level provenance (which canonical company owns a job) is the part still blocked by the Amazon/Accenture decision, same as Section 21 already found.
- **Service-role-only ingestion mutations**: re-confirmed unchanged from Section 21 — `jobs` grants full CRUD to `service_role`, admin-gated CRUD to `authenticated` via RLS, nothing else.

### Full validation run (this session, local, fresh `supabase db reset`)

`npx supabase db reset` — clean replay of all **78** migrations (74 inherited + 4 from this branch: the 2 from Section 21 plus `20260914130000`/`20260914140000` from this section). `src/lib/supabase/database.types.ts` regenerated. `npm run lint` — 0 errors/warnings. `npx tsc --noEmit` — clean. `npm run test:unit` — 305/305. `npm run test:workflow` — 127/127. `npm run test:db` — **340/340, 83 suites** (up from 335 — the 5 new tests in `jobs-ingestion-identity.test.mjs` that passed; 1 test was rewritten mid-session after the `42P10` finding, so it is counted once, passing, in this final number), zero fixture leakage (orchestrator-verified). `npm run build` — succeeds. `git diff --check` — clean (same benign CRLF/LF notes as Section 21, not real whitespace errors). `n8n-workflows/cv-analysis-worker.json` — reconfirmed byte-identical to `origin/main`. No commit, push, merge, rebase, or pull was performed.

---

## 23. Additive Canonical-Company Foundation (same branch, third session, 2026-09-14)

The user made the identity decision Section 22 could not make from repository evidence alone: **Amazon UAE/Saudi Arabia and Accenture Qatar/Saudi Arabia stay four distinct canonical companies**; **SLB (3 sources), TCS (2 sources), and Apparel Group (2 sources) converge onto their existing bare canonical ids**, non-destructively. This session implemented the additive `companies`/`company_sources`/`jobs.source_id` foundation Sections 21-22 had deliberately deferred, applying that decision.

### Schema — `supabase/migrations/20260914150000_create_companies_and_company_sources.sql`

Three layers, in order: **`companies`** (canonical identity — `id text primary key`, reusing the CSV's own `canonical_company_id` values directly rather than a new uuid surrogate) → **`company_sources`** (one row per original `source_record_id`, preserved exactly, FK to `companies`, `review_status` carried through unmodified) → **`jobs.source_id`** (nullable `text references company_sources(id)`, additive, zero backfill needed — still zero `jobs` rows).

`companies` is public reference data (select-authenticated, same pattern as `countries`/`plans`). `company_sources` is fully internal (RLS enabled, zero policies, zero grant for `authenticated` — same default-deny pattern as `automation_tasks`) — researcher notes and unresolved-review provenance are ingestion machinery, not a product surface. Both are `service_role`-write-only; no new `SECURITY DEFINER` RPC was needed for basic CRUD (direct RLS-gated table grants, the same pattern `jobs` itself already uses, are sufficient — a dedicated wrapper function would have been unrequested surface area).

**Database-enforced remap protection**: `company_sources_reject_remap` (a plain `security invoker` trigger, `search_path=''`) rejects any `UPDATE` that changes an existing row's `company_id`. A routine idempotent re-import always recomputes and re-writes the *same* mapping, so this never fires in normal operation — it exists specifically so a genuine identity change can never happen silently, reproduced directly against a real conflicting `UPDATE` attempt (rejected with a clear error, original mapping unchanged) before being relied on in tests.

### Import — `scripts/import-company-registry.mjs`

Parses all 6 country CSVs (not `master-company-registry.csv`, which is itself a rebuild of those 6 — importing it too would double-process every row) with a small hand-written RFC4180 parser (required: several `researcher_notes` fields contain embedded commas/quotes that a naive `split(",")` would corrupt) and upserts into `companies`/`company_sources` on their stable ids. `CONVERGENCE_MAP` holds exactly the 4 source-side ids the human decision converges (`cc-slb-qatar`→`cc-slb`, `cc-slb-formerly-schlumberger`→`cc-slb`, `cc-tata-consultancy-services-qatar`→`cc-tcs`, `cc-apparel-group-sa`→`cc-apparel-group`); every other row's `company_id` equals its own `canonical_company_id` unchanged, which is what keeps Amazon and Accenture's four rows as four distinct companies without needing a separate code path for "don't merge."

Run for real against the local dev database this session (not just `--dry-run`) and independently verified via direct SQL: **553 companies, 588 company_sources** (557 raw canonical ids − 4 converged = 553, exactly as hand-calculated beforehand), Amazon/Accenture confirmed as 4 separate `companies` rows, SLB/TCS/Apparel Group confirmed converged (1/1/1 shared `companies` rows over 3/2/2 preserved `company_sources` rows respectively), the two Kuwait `needs_manual_review` rows (SLB, Apparel Group) confirmed still `needs_manual_review` after import, re-run a second time with zero count drift (idempotent), and a live conflicting-remap attempt confirmed rejected by the trigger. The database was then reset back to schema-only (no companies data) before the session's final required validation pass, matching this repository's existing convention that a seed/import script is a separate, deliberately-invoked action (`seed:local`) — never something `supabase db reset` runs automatically.

### Tests added

`tests/db/company-registry-import.test.mjs` (10 tests) imports the *real* parsing/convergence functions from `scripts/import-company-registry.mjs` (not a synthetic proxy) against the 11 real CSV rows relevant to the five flagged companies, proving: Amazon UAE/SA and Accenture Qatar/SA stay distinct; SLB/TCS/Apparel Group converge correctly with every original `source_record_id` preserved; the two `needs_manual_review` rows stay `needs_manual_review` after import; repeated import is idempotent; a conflicting remap is rejected by the trigger with the original mapping intact; `anon`/`authenticated` cannot read `company_sources` at all and cannot write either table; `authenticated` can read `companies` (read-only); `service_role` can do everything required. `tests/db/jobs-ingestion-identity.test.mjs` gained one more test: two different `source_type` values reusing the identical `external_id` both succeed (the dedup key is the pair, not `external_id` alone) — the one required-test item Section 22 had not yet explicitly covered.

### Full validation run (this session, local, fresh `supabase db reset`)

`npx supabase db reset` — clean replay, **79 migrations** (`grep -c "^Applying migration"` on the actual reset output — not estimated), matching the 79 `.sql` files on disk exactly (78 inherited on this branch + this session's `20260914150000`). Live schema independently re-inspected via direct `psql` queries (not trusted from migration source alone): all new columns/PK/FK/unique constraints/indexes/triggers present exactly as designed; `claim_automation_task`/`fail_stale_automation_tasks`/`set_jobs_closed_at`/`reject_company_source_remap` all confirmed `search_path=""`; the two `SECURITY DEFINER` functions confirmed `service_role`-only executable (`anon`/`authenticated` both denied); all 4 touched tables (`jobs`, `automation_tasks`, `companies`, `company_sources`) confirmed RLS-enabled; `company_sources` confirmed to have zero grant for `authenticated`/`anon` beyond the platform-wide `REFERENCES`/`TRIGGER`/`TRUNCATE` baseline every table in this project already carries (verified identical on `jobs`/`automation_tasks`/`cvs` — a Supabase platform default, not something this session introduced, and not reachable through the REST API regardless). `src/lib/supabase/database.types.ts` regenerated from that verified schema. `npm run lint` — 0 errors/warnings. `npx tsc --noEmit` — clean. `npm run test:unit` — 305/305. `npm run test:workflow` — 127/127. `npm run test:db` — **351/351, 83 suites** (up from 340: +10 `company-registry-import.test.mjs`, +1 the new different-sources-same-external_id test), zero fixture leakage (orchestrator-verified). `npm run build` — succeeds. `git diff --check` — clean (same benign CRLF/LF notes, not real errors). `n8n-workflows/cv-analysis-worker.json` — reconfirmed byte-identical to `origin/main`. Grepped the full diff for any touch to pricing/subscription/entitlement/checkout/payment files — none found. No commit, push, merge, rebase, or pull was performed.

### P0 status after this session

Every confirmed database P0 blocker from the original audit (Section 16) is now addressed on this branch: (1) company/source-registry table — **implemented**, additively, respecting the human identity decision; (2) `jobs` freshness/status/geography extension — implemented (Section 21); (3) `automation_tasks` claim function — implemented (Section 21), corrected (Section 22); (4) `test:db` in CI — already an explicit tracked decision, correctly left untouched. The only work this branch still does not do — deliberately, per every session's strict scope — is building the actual Job Ingestion Automation worker/n8n workflow that would consume this foundation, and Job Matching. `jobs.company_name` remains free text pending a future decision on whether ingested jobs should display `companies.display_name` via the new `source_id`→`company_sources`→`companies` chain instead — not required for this phase, and not attempted.
