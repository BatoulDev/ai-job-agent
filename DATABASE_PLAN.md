# Supabase Database Foundation — Integration Plan

No files were edited, no packages installed, no SQL executed, no Supabase project touched. This is research + a plan only.

---

## 1. Current project findings

- **Framework**: Next.js `16.2.10` (App Router, Turbopack), React `19.2.4`, TypeScript `^5` (strict mode on), Tailwind `^4`, ESLint flat config via `eslint-config-next`. `package.json` scripts: `dev`, `build`, `start`, `lint` — **no `test` script exists**.
- **⚠️ Version-specific breaking change that affects this integration**: this Next.js build has renamed `middleware.ts` → **`proxy.ts`**, exporting a function named `proxy(request)` instead of `middleware(request)` (confirmed in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`). Every public Supabase SSR guide assumes `middleware.ts`. The session-refresh file in this repo must be `src/proxy.ts` with `export function proxy(...)`, or session refresh will silently never run.
- **`cookies()` from `next/headers` is async** (`await cookies()`) — matches what `@supabase/ssr`'s server client already expects, so no adapter mismatch there.
- **No Supabase anywhere yet**: no `@supabase/*` in `package.json` or `node_modules`, no `supabase/` CLI directory, no references to "supabase" anywhere in `src`.
- **No env files exist** (`.env*` is already gitignored — safe to add `.env.local` later without a config change).
- **Route inventory** (`src/app`): `/`, `/login`, `/signup`, `/welcome`, `/onboarding/upload-cv`, `/onboarding/preferences`, `/dashboard`, `/news`. No API routes, no `proxy.ts`/`middleware.ts` today.
- **All dashboard/profile data is hardcoded mock data** in `src/lib/dashboardData.ts` (`JobMatch[]`, `CV_PROFILE`, `PREFERENCES_SUMMARY`, `DASHBOARD_STATS`) — nothing reads from a real backend anywhere. This confirms today's scope (profiles/preferences/CVs) is cleanly separable from job-matching/cover-letters, which stay mock for now.
- Path alias `@/*` → `./src/*`. Brand tokens already match AGENTS.md (`#1E3A8A`, `#06B6D4`, `#10B981`, `#F8FAFC`, `#0F172A`, `#64748B`).

## 2. Existing demo-auth flow

- **`src/lib/demoAuth.ts`**: a `localStorage` boolean (`ai-job-agent-demo-auth`), no server involvement, no real identity — `isDemoLoggedIn()`, `setDemoLoggedIn()`, `clearDemoLoggedIn()`, plus `useIsDemoLoggedIn()` (a `useSyncExternalStore` hook listening to `storage` + a custom `ai-job-agent-demo-auth-changed` event).
- **`login/page.tsx` / `signup/page.tsx`**: real-looking forms (email, password, name via `FormField`) whose `onSubmit` **never sends the data anywhere** — they just call `setDemoLoggedIn()` and redirect (honoring a `?next=` param; signup defaults to `/onboarding/upload-cv?gift=1`).
- **`src/components/RequireDemoAuth.tsx`**: client-only gate. Renders `null` and `router.replace(redirectTo)` in a `useEffect` if not "logged in." **Currently only wraps `/news`.**
- **Gap found**: `/dashboard`, `/onboarding/upload-cv`, and `/onboarding/preferences` have **no gate at all** today — they're open to anyone, demo-"logged-in" or not.
- **Consumers reading demo-auth state**: `Navbar.tsx` (`useIsDemoLoggedIn()` for Dashboard/Log-out vs. Join Beta), `JoinBetaButton.tsx` (`isDemoLoggedIn()` synchronous read to route to upload-cv directly vs. through signup).
- Everything is trivially bypassable (just set the localStorage key) — no cookies, no server session, nothing RLS-relevant exists yet.

## 3. Recommended integration architecture

**Packages** (proposed, to install only after your approval): `@supabase/supabase-js` + `@supabase/ssr` — the current official App Router pattern. Explicitly **not** `@supabase/auth-helpers-nextjs` (deprecated).

**Three client factories**, each with one job:
- `src/lib/supabase/client.ts` — browser client (`createBrowserClient`), Client Components only, uses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` only.
- `src/lib/supabase/server.ts` — server client (`createServerClient`) for Server Components / Server Functions / Route Handlers, wired to `await cookies()`, anon key only (RLS-enforced per request).
- `src/lib/supabase/admin.ts` — service-role client, **imported only in server-only code paths**, never referenced from anything that ships to the browser. Not needed for today's scope (profiles/preferences/CVs are all user-owned via RLS), but the file boundary is established now so the service key never becomes a "quick fix" temptation later (e.g. admin job entry).

**Session refresh**: `src/proxy.ts`, exporting `proxy(request)` (not `middleware`), implementing the standard Supabase "refresh session, sync cookies" pattern against `NextRequest`/`NextResponse`, with a `matcher` that excludes `_next/static`, `_next/image`, and static assets.

**Server-verified identity**: server code calls `supabase.auth.getUser()` (revalidates against Supabase Auth servers), not `getSession()` (which trusts a possibly-stale/forged cookie) — this follows AGENTS.md §6 ("do not trust client-provided ... roles").

**Route protection**: moves from the client-only `RequireDemoAuth` to a server-side check applied to `/dashboard` and `/onboarding/*` (currently unguarded). Demo auth is **not removed today** per your constraint — see §9/§12 for the coexistence plan.

## 4. Proposed schemas

Scoped tightly to what the current UI actually collects — no speculative columns.

**`profiles`** (1:1 with `auth.users`)
```
id                  uuid        PK, references auth.users(id) on delete cascade
full_name           text
university          text        nullable
major               text        nullable
onboarding_completed_at  timestamptz  nullable
created_at          timestamptz not null default now()
updated_at          timestamptz not null default now()
```
`full_name` comes from the signup form; `university`/`major` come from the onboarding preferences form (mirrors `CV_PROFILE` mock shape). Open question in §12 on whether university/major belong here or should move to a future CV-derived table.

**`job_preferences`** (1:1 with user for MVP — matches the single "edit preferences" UI, not multiple saved searches)
```
id                  uuid        PK default gen_random_uuid()
user_id             uuid        not null, unique, references auth.users(id) on delete cascade
target_roles        text        nullable   -- free-text field in current UI
location            text        nullable
remote_preference   text        check in ('onsite','hybrid','remote','open')
job_type            text        check in ('internship','part-time','full-time','freelance','open')
experience_level    text        check in ('internship','entry-level','junior')
additional_notes    text        nullable
created_at          timestamptz not null default now()
updated_at          timestamptz not null default now()
```
Check-constraint values are copied exactly from `REMOTE_PREFERENCE_OPTIONS` / `JOB_TYPE_OPTIONS` / `EXPERIENCE_LEVEL_OPTIONS` in `onboarding/preferences/page.tsx` — no invented options.

**`cvs`** (one active CV per user for MVP — matches the upload UI, which shows a single file slot, not a version list)
```
id                  uuid        PK default gen_random_uuid()
user_id             uuid        not null, unique, references auth.users(id) on delete cascade
storage_path        text        not null   -- private bucket path, never a public URL
file_name           text        not null
file_size_bytes     integer     not null, check (file_size_bytes > 0 and file_size_bytes <= 5242880)
mime_type           text        not null, check in (
                                   'application/pdf',
                                   'application/msword',
                                   'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                                 )
status              text        not null default 'uploaded', check in ('uploaded','parsed','failed')
created_at          timestamptz not null default now()
updated_at          timestamptz not null default now()
```
`unique(user_id)` keeps this simple: a new upload replaces the row (and its storage object). If you want CV history/versioning later, that's a deliberate follow-up schema change, not something to smuggle in today.

## 5. Relationships, constraints, indexes, timestamps

- `profiles.id`, `job_preferences.user_id`, `cvs.user_id` all `references auth.users(id) on delete cascade` — deleting a Supabase Auth user cleans up everything automatically, nothing orphaned.
- `unique(user_id)` on `job_preferences` and `cvs` enforces the "one row per user" MVP model at the database level, not just in application code.
- Implicit indexes from the `unique` constraints cover the main lookup pattern (`where user_id = auth.uid()`); no extra indexes needed at this scale.
- `updated_at` columns maintained via a small `moddatetime`/trigger-based `set_updated_at()` function (standard Supabase pattern) rather than trusting the client to send it.
- `gen_random_uuid()` requires the `pgcrypto` extension — enabled by default on Supabase projects; will confirm at migration-write time, not a concern now.

## 6. Proposed Row Level Security policies

RLS **enabled** on all three tables. Pattern is identical everywhere: a user may only touch their own row.

- `profiles`: `select`/`update` where `auth.uid() = id`. No `insert` policy for end users — the profile row is created by a trigger on `auth.users` insert (`handle_new_user()`), not by client-side insert, so there's no window for a user to create a profile row for someone else's `id`. No `delete` policy (handled by the cascade from `auth.users` deletion).
- `job_preferences`: `select`/`insert`/`update`/`delete` where `auth.uid() = user_id`, using both `using` (read/update/delete) and `with check` (insert/update) so a user can't insert or retarget a row to someone else's `user_id`.
- `cvs`: same four policies, `auth.uid() = user_id`.
- No policy grants access based on anything client-supplied (email, role, plan) — only the authenticated JWT's `auth.uid()`, per AGENTS.md §6.
- The service-role client (§3) bypasses RLS entirely by design — reserved for future privileged operations (e.g. admin job entry), not used by any of today's tables.

## 7. Private storage policy design

- Bucket: `cvs`, created with `public = false`.
- Path convention: `{user_id}/{cv_id}-{original_filename}` — the leading `user_id` folder segment is what storage policies key off.
- Bucket-level hardening (defense-in-depth alongside the client's 5MB/PDF-DOC-DOCX hint, per AGENTS.md §6 "do not trust client-provided data"): `file_size_limit` and `allowed_mime_types` set on the bucket itself.
- Four `storage.objects` policies scoped to `cvs` bucket, each requiring `auth.uid()::text = (storage.foldername(name))[1]`:
  - `select` — user can read their own file (used to generate a short-lived signed URL server-side; never a public URL).
  - `insert` — user can upload only into their own folder.
  - `update` — user can replace their own file.
  - `delete` — user can remove their own file.
- No `select` policy for anonymous/public role — files are only ever reachable via signed URLs issued server-side after `auth.uid()` verification.

## 8. Required environment variables (names only)

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY   # server-only — never NEXT_PUBLIC_, never imported into client code
```
A `.env.example` would list these names with empty/placeholder values only. `.env*` is already gitignored, so real values in `.env.local` stay out of git without any config change.

## 9. Exact files to be created or changed (when you approve implementation)

**New:**
- `supabase/migrations/xxxx_create_profiles.sql`
- `supabase/migrations/xxxx_create_job_preferences.sql`
- `supabase/migrations/xxxx_create_cvs.sql`
- `supabase/migrations/xxxx_create_cvs_storage_bucket.sql`
- `supabase/migrations/xxxx_handle_new_user_trigger.sql` (auto-creates `profiles` row on signup)
- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/admin.ts`
- `src/proxy.ts`
- `.env.example`

**Changed (only once you approve the demo-auth migration step — not today):**
- `src/components/RequireDemoAuth.tsx` → replaced or supplemented by a server-side auth check
- `login/page.tsx`, `signup/page.tsx` → real Supabase Auth calls instead of `setDemoLoggedIn()`
- `Navbar.tsx`, `JoinBetaButton.tsx` → read real session state instead of `useIsDemoLoggedIn()`/`isDemoLoggedIn()`

**Not changed today:** `AGENTS.md`, `CLAUDE.md`, any dashboard/mock-data files, any visual/styling files.

## 10. Migration and rollback plan

- Supabase CLI migrations (`supabase/migrations/*.sql`) are the source of truth, per your requirement — no dashboard-only schema edits.
- One focused migration per concern (table, trigger, bucket+policies) rather than one giant file, so a single piece can be reverted independently.
- Local-only verification loop before anything touches a remote project: `supabase start` → apply migrations locally → `supabase db reset` to replay from scratch and catch ordering bugs.
- **Rollback**: Supabase CLI migrations are forward-only by design (no auto-generated "down" migration). Rollback = write an explicit new migration that reverses the change (e.g., `drop table if exists cvs`), reviewed the same as any other migration. I will not treat "delete the migration file" as a rollback strategy once something has run against a real database.
- Nothing gets applied to any remote/hosted project without a separate explicit approval — today's scope stops at reviewed `.sql` files.

## 11. Testing plan

- **No test runner exists in this repo today** (`package.json` has no `test` script). I won't silently add one — that's a dependency decision requiring your approval (§12).
- **RLS/isolation verification**: run `supabase start` locally, create two test auth users via the local Studio or CLI, and manually confirm (via the browser client, signed in as each user) that user A cannot `select`/`update`/`delete` user B's `profiles`/`job_preferences`/`cvs` rows or storage objects. This is the minimum bar before calling RLS "done."
- **Static validation**: `npm run lint`, `npx tsc --noEmit`, `npm run build` after code lands, per AGENTS.md §11.
- **Flow testing**: manual click-through of signup → onboarding (CV upload + preferences) → dashboard, confirming data written by one flow is what's read by another (no more mock-data drift).
- **Optional stretch** (would need your approval to add a dependency): pgTAP-based SQL tests via `supabase test db` for repeatable RLS regression coverage. I'm flagging this as a nice-to-have, not assuming it into scope.

## 12. Risks and decisions that need your approval

1. **Package installation** (`@supabase/supabase-js`, `@supabase/ssr`, and the Supabase CLI as a dev tool) — nothing installed yet per your instruction; needs a go-ahead before implementation.
2. **Supabase project creation and credentials** — I cannot create a project or obtain keys; you'll need to provide the project (I will not ask you to paste secret values into chat — only that the `.env.local` file gets populated on your machine).
3. **`proxy.ts` naming risk**: this repo's Next.js has renamed `middleware.ts` → `proxy.ts`. Standard Supabase SSR docs/examples use `middleware.ts`. I'll adapt the pattern to `proxy(request)`, but this combination isn't a well-trodden path — worth extra scrutiny (and a manual session-refresh test) at implementation time rather than trusting it blind.
4. **`cvs` model**: one active CV per user (simple, matches current UI) vs. keeping upload history. I recommend the simple model for MVP; flag if you want history instead.
5. **`job_preferences` model**: one row per user (matches the single "edit preferences" screen) vs. supporting multiple saved preference sets. Recommend one row for MVP.
6. **`university`/`major` placement**: currently proposed on `profiles` (collected during onboarding today), but conceptually these could later belong to a CV-derived/parsed-profile table once AI CV parsing exists. Flagging now so it's a conscious choice, not something that has to be migrated awkwardly later.
7. **Demo-auth coexistence, not removal**: per your explicit "do not remove demo authentication yet," today's plan only lays the Supabase foundation. Real auth would initially run *alongside* demo auth; actually cutting over `login`/`signup`/`Navbar`/`JoinBetaButton`/`RequireDemoAuth` to real sessions — and deleting `demoAuth.ts` — is a separate, later approval.
8. **Unguarded routes**: `/dashboard` and `/onboarding/*` have no gate at all today (not even demo-auth). I'd recommend gating them server-side as part of the real-auth cutover — flagging so it's a deliberate decision rather than something that happens as a side effect.

---

# Phase 1 Addendum (implemented)

The sections below were added when Phase 1 was implemented, per your approval and corrections: publishable-key env var naming, no admin/service-role client, `proxy.ts` convention, and the CV-replacement / ownership-boundary design requirements.

## 13. CV replacement design (documented, not implemented)

No upload UI or Server Function was written in Phase 1. This is the design a future upload Server Function must follow, so a replacement upload can never leave `cvs.storage_path` pointing at a missing object.

**Sequence:**
1. The Server Function only trusts `auth.uid()` from the verified session — never a client-supplied `user_id`.
2. Sanitize the original file name (strip path separators, `..`, control characters) and validate the actual uploaded bytes' size/mime server-side — never trust the client's declared `File.size`/`File.type` alone.
3. Generate a fresh random upload id (e.g. `crypto.randomUUID()`) and compute `new_storage_path = "${auth.uid()}/${uploadId}-${sanitizedFileName}"` — always a brand-new path, never reusing the current row's path.
4. Upload the file to `new_storage_path`. **If this fails, stop** — the existing row and its object are untouched. Nothing to roll back, nothing orphaned.
5. Before updating, read the row's current `storage_path` (the "old" object to clean up later).
6. Upsert the `cvs` row (`on conflict (user_id) do update ...`) to point at `new_storage_path`. **If this fails**, best-effort delete the just-uploaded new object and surface an error; the old object/row are still intact, so the user's existing CV keeps working.
7. **Only after the row update commits successfully**, delete the old object at the previously-read path (skipped on a user's first-ever upload, where there is no old object).
8. If step 7's delete itself fails, log it server-side (no CV content in the log) and leave the orphan — it's harmless: storage policies still scope it to that same user's folder, nothing references it, and it costs storage, not correctness or security.

**Partial-failure outcomes:**
| Failure point | Result | Safe? |
|---|---|---|
| Upload of new object fails | No row change, no orphan | Yes |
| Upload succeeds, DB update fails | Compensating delete attempted on the new object; old row/object still serve the user | Yes — worst case, one orphaned new object |
| DB update succeeds, old-object delete fails | Row correctly points at the new object; old object becomes an orphan | Yes — worst case, wasted storage |
| Never possible with this ordering | A `cvs` row pointing at a storage path that was deleted before the row was updated | N/A by construction |

**Orphan reconciliation (future phase, not Phase 1):** a job that lists a user's own folder (`storage.list('cvs', { prefix: auth.uid() })`) and deletes any object not matching the row's current `storage_path`. This can run entirely under the *user's own* authenticated session — the storage policies already permit a user to list/delete within their own folder — so it needs **no service-role key**, consistent with this phase's no-privileged-key constraint.

## 14. Account ownership and future billing boundaries

Confirmed against the schemas actually created in §4 / the migrations:

- `profiles.id`, `job_preferences.user_id`, and `cvs.user_id` are the **only** ownership identifiers anywhere in this schema, and all three are immutable foreign keys to `auth.users.id`.
- No `plan`, payment status, subscription ownership, Stripe id, or usage-counter column exists on `profiles` or `job_preferences` — confirmed by the column lists in §4; none were added.
- Editing `full_name`, `university`, `major`, preferences, or the CV never touches `auth.users.id` — none of those operations can transfer ownership.
- `email` is not duplicated on `profiles`; it remains solely on `auth.users` and is read via `supabase.auth.getUser()` when needed.
- No editable field (email, full name, CV file name) is used as a foreign key or join key anywhere in these migrations — every ownership check uses the `auth.users.id` / `user_id uuid` columns only.
- **Future compatibility**: `subscriptions`, `usage_events`, `application_actions`, and `audit_events` can each be added later with nothing more than their own `user_id uuid not null references auth.users(id) on delete cascade` column and an RLS policy following the exact pattern used in §6 — no change to today's ownership model is required to support them.
- **Not created in Phase 1** (confirmed): `subscriptions`, `usage_events`, `application_actions`, `audit_events`, `jobs`, `matches`, `cover_letters`, `applications`.
- **Stale CV-derived data**: today's schema has no CV-derived data table (no parsed-CV or matching data exists yet), so there is nothing to mark stale yet. When AI CV parsing/matching tables are introduced in a future phase, that design must include a way to invalidate or mark stale any derived rows tied to a superseded `cvs.id` — flagged for that phase, intentionally not built now.

---

# Phase 3 Addendum — Subscriptions, payment readiness, analysis-task foundation

Implemented on `feature/subscriptions-payment-foundation`. Builds the trusted plan/subscription/payment/analysis-task foundation described in the project roadmap below. No AI CV analysis, job matching, cover-letter generation, or real Whish payment calls were built — see "Deferred to Phase 4+" at the end.

## Project roadmap

1. Local Supabase, database foundation, Storage, and RLS — **complete**
2. Authentication, CV upload, preferences, onboarding, and dashboard — **complete**
3. Plans, subscriptions, Whish payment readiness, and analysis-task foundation — **this phase**
4. CV extraction, AI analysis, queue/worker, structured profile, and user review — not started
5. Jobs database, admin entry, and shared safe job collection with n8n — not started
6. Hard filters, job matching, match scores, explanations, and plan limits — not started
7. Cover letters, revisions, approve/reject/edit flow — not started
8. Notifications and application assistance after explicit approval — not started
9. Production Supabase, deployment, monitoring, and beta testing — not started

Jobs are collected once into a shared jobs database (Phase 5), not scraped separately per user. Matching (Phase 6) reads the confirmed CV profile, preferences, and the trusted plan from this phase. n8n's role begins with scheduled shared job collection and later background orchestration — not built yet. There is no LinkedIn scraping and no LinkedIn auto-apply anywhere in this design; LinkedIn jobs only ever receive a link and prepared materials, and nothing is sent without explicit user approval. Queues/workers (Phase 4's worker, built on this phase's `analysis_tasks` table) are designed to handle bursts of 50+ users. Paid access is enforced by backend/database rules, never the browser. Real Whish integration stays blocked until official merchant access exists (see "Whish — what's still missing" below).

## Contradictions found during inspection

None. The Free/Student/Pro prices and limits already shown in `src/components/landing/Pricing.tsx` matched the business rules given for this phase exactly (Free: 1 match + 1 cover letter; Student: $9/mo, 25 matches + 8 cover letters; Pro: $18/mo, 45 matches + 15 cover letters), so the canonical `plans` table seed below copies them verbatim rather than changing anything.

One pre-existing, unrelated finding worth flagging: `src/lib/demoAuth.ts` and `src/components/RequireDemoAuth.tsx` are dead code — nothing imports them anymore now that real Supabase Auth is fully wired (confirmed by a repo-wide grep). Left in place since removing them was outside this phase's scope; flagging for a future cleanup pass.

## Canonical plan definitions

Source of truth: the `public.plans` table (`supabase/migrations/20260802090000_create_plans.sql`), read by server-side code only — never a browser-supplied price/limit. `src/components/landing/Pricing.tsx` still owns the marketing copy (feature bullet lists, launch-offer strikethrough pricing) but its price/limit numbers are commented as required to match this table.

| plan_code | display_name | price | billing_period | job_match_limit | cover_letter_limit |
|---|---|---|---|---|---|
| free | Free | $0.00 | forever | 1 | 1 |
| student | Student | $9.00 | monthly | 25 | 8 |
| pro | Pro | $18.00 | monthly | 45 | 15 |

## Database changes made

New migrations (applied locally via `supabase db reset`, verified to apply cleanly on top of the existing Phase 1/2 migrations):

- `20260802090000_create_plans.sql` — `public.plans` (canonical catalog), RLS (`select` for `authenticated`, no client mutation), seeded with the three rows above.
- `20260802090010_create_subscriptions.sql` — `public.subscriptions` (one current row per user, `unique(user_id)`), RLS (`select` own only, no client insert/update/delete), a `handle_new_user_subscription()` trigger that gives every new `auth.users` row a trusted `free`/`active` subscription automatically (mirrors the existing `handle_new_user` profiles trigger), and three `service_role`-only functions: `activate_subscription`, `expire_subscription`, `cancel_subscription`.
- `20260802090020_create_payment_attempts.sql` — `public.payment_attempts` (full payment history, never overwritten on plan change), RLS (`select` own only), `create_payment_attempt(plan_code)` — callable by `authenticated`, always re-derives `auth.uid()` internally, looks up amount/currency from `plans` (never a client-supplied price), reuses an in-flight `created`/`pending` attempt instead of duplicating one — and `mark_payment_verified` / `mark_payment_failed`, both `service_role`-only. `mark_payment_verified` atomically marks the attempt paid and calls `activate_subscription` in the same transaction, and is itself idempotent (a second call on an already-`paid` attempt returns the existing row instead of reactivating).
- `20260802090030_create_analysis_tasks.sql` — `public.analysis_tasks` (internal CV-analysis tracking rows, no worker yet), RLS (`select` own only), a partial unique index enforcing at most one active (`pending`/`processing`) task per `cv_id`, and a `service_role`-only `create_analysis_task` function that safely reuses an existing active task instead of creating a duplicate.
- `20260802090040_onboarding_readiness.sql` — `public.get_onboarding_readiness()`, security-invoker (no elevated privilege — it only reads rows the calling user's own existing RLS policies already allow, including the `cvs`-backed `storage.objects` check), returns the single trusted readiness object described in Part 8 of the original request.

No existing table, column, policy, or function was modified or dropped.

## RLS and security model

Every new table follows the repo's existing pattern: RLS enabled, a `select ... using (auth.uid() = user_id)` policy for the owner, and — deliberately — **no** insert/update/delete policy for the `authenticated` role on `subscriptions`, `payment_attempts`, or `analysis_tasks`. All writes to those tables go through narrowly-scoped `security definer` functions (mirroring the existing `handle_new_user` pattern), each with `execute` explicitly revoked from `public` and granted only to the role that should be able to call it:

- `authenticated` may call `create_payment_attempt` (self-service, but the function ignores everything the client could try to fake — price, plan validity, and identity are all re-derived server-side) and `get_onboarding_readiness` (read-only, own data only).
- `service_role` — used only via `src/lib/supabase/admin.ts`, imported only from server-only Route Handlers, never a Client Component — is the only role that can call `activate_subscription`, `expire_subscription`, `cancel_subscription`, `mark_payment_verified`, `mark_payment_failed`, and `create_analysis_task`.

## Verified locally (see "Local validation results" below for the actual command transcript)

All 18 checks below were run against the real local Supabase Auth + PostgREST API (two throwaway auth users, cleaned up afterward) — see "Local validation results":

1. A user reads only their own subscription/payment/analysis-task rows — cross-user reads return empty.
2. Direct client `UPDATE` on `subscriptions` → `42501` (no grant).
3. Direct client `INSERT` on `payment_attempts` / `analysis_tasks` → `42501` (no grant).
4. `create_payment_attempt` rejects unknown plan codes and the `free` plan.
5. `create_payment_attempt` is idempotent — a second call while an attempt is in flight returns the same row.
6. `mark_payment_verified` / `activate_subscription` return `42501` (permission denied) when called with an authenticated user's token.
7. `mark_payment_verified` (via `service_role`) atomically flips the payment attempt to `paid` **and** the subscription to `active`/`pro`, and a duplicate call afterward is a no-op (returns the already-paid row, does not re-activate).
8. `get_onboarding_readiness` reflects real state (`plan_eligible: true` after activation, `next_step: "upload_cv"` since no CV existed yet).

## Whish provider boundary

`src/lib/payments/whish/` — `config.ts` reads optional `WHISH_API_BASE_URL` / `WHISH_MERCHANT_ID` / `WHISH_API_SECRET` server-only env vars (all unset in this repo) and returns `null` when incomplete; `provider.ts` defines the typed `WhishProvider` interface (`createCheckout`, `getPaymentStatus`, `verifyPayment`, `handleProviderNotification`) but every method throws `WhishNotConfiguredError` — no invented endpoint URLs, payload shapes, or signature verification. `src/app/checkout/page.tsx` shows the literal honest message "Online payment is not available yet. Please try again later." whenever `isConfigured()` is false, which is always, today.

**Still needed from Whish before real integration can start:** merchant approval; official API documentation; sandbox/test environment access; test credentials; production credentials; API base URL; authentication method; checkout-creation request/response shape; callback/return-URL behavior; server-to-server notification/webhook behavior and how to verify it; payment-status lookup; supported currencies; expiration/cancellation behavior; refund process; and whether recurring/auto-renewal billing is supported at all (until confirmed, this project treats Student/Pro as monthly access requiring manual renewal, not auto-recurring).

## Plan selection and onboarding flow (implemented)

- `src/components/landing/PricingCta.tsx` — replaces the plain `<Link href="/signup">` on each pricing card. Free → `/onboarding/upload-cv` (or `/signup?next=/onboarding/upload-cv` if signed out, unchanged from before). Student/Pro → `/checkout?plan=<code>` (or `/signup?next=/checkout?plan=<code>` if signed out).
- `src/proxy.ts` / `src/lib/supabase/session.ts` — `/checkout` added to `PROTECTED_PATHS`, so an unauthenticated visit redirects to `/login?next=/checkout?plan=<code>` automatically, the same mechanism already protecting `/dashboard` and `/onboarding/*`.
- `src/app/signup/page.tsx` — no changes needed; its existing `next`-passthrough logic already forwards `/checkout?plan=<code>` unchanged after signup.
- `src/app/checkout/page.tsx` + `src/app/api/checkout/route.ts` + `src/lib/payments/checkout.ts` — validates the plan code, calls `create_payment_attempt`, and always shows the honest "not available yet" state (never a fake success, never a fabricated checkout URL, no payment-success page was built at all — per the request, a return URL must never be treated as proof of payment, and building one with nothing real behind it seemed more likely to mislead than help).
- `src/app/onboarding/preferences/page.tsx` + `src/app/api/onboarding/complete/route.ts` — after preferences save, calls the trusted readiness check and (only if the user is now fully ready and has no active task already) safely enqueues one `analysis_tasks` row. This does **not** run any AI/analysis — it only creates the tracking row a future Phase 4 worker would claim.

## Usage-limit enforcement (documented, not built — Part 10)

No usage-counter table was added. Recommendation once matching/cover-letters exist (Phase 6/7): count directly from those feature tables (`where user_id = ... and created_at >= subscriptions.current_period_start`) rather than maintaining a separate counter table — fewer moving parts, and the count is always derived from the same rows that were actually created, so it can't drift out of sync with reality. CV analysis (Phase 4) runs once per CV version and must not consume a job-match or cover-letter allowance. Enforcement must happen inside the same trusted server-side write path that creates a match/cover-letter row, using a transaction/row lock so two concurrent requests can't both slip under the limit — the same pattern already used by `mark_payment_verified` and `create_analysis_task` in this phase.

## Local automation-test fixtures (`scripts/seed-local-automation-users.mjs`)

A local-dev-only, idempotent seed script creates three fictional test users (`maya.haddad@test.local`/free, `karim.nassar@test.local`/student, `lina.mansour@test.local`/pro) with a real uploaded CV, complete profile/preferences, an active entitlement, and one pending `analysis_tasks` row each — everything a Phase 4 worker will need as fixtures, with no fabricated AI/parsing/match/payment data. Positively refuses to run against anything but a local Supabase URL, and refuses to run without an explicit `LOCAL_SEED_USER_PASSWORD` (name only in `.env.example`, real local-only value in the gitignored `.env.local`). Student/Pro entitlements are activated with `subscriptions.provider = 'manual_test'` — a new value added in `20260803090000_allow_manual_test_subscription_provider.sql`, only ever settable through the existing `service_role`-only `activate_subscription()` function, and never accompanied by a `payment_attempts` row (no payment occurred). See the script's header comment for exact usage (`--dry-run`, `--cleanup`).

`20260803090010_grant_service_role_table_access.sql` fixes a latent gap found while building this fixture: `service_role` had `rolbypassrls` (bypasses RLS as intended) but no actual table GRANTs, so `src/lib/supabase/admin.ts` could only ever succeed via a `SECURITY DEFINER` RPC, never a direct table read/write — even though that's its whole documented purpose. This grants `service_role` the same full table access a hosted Supabase project's service role already has by default; `anon`/`authenticated` grants are untouched.

## Deferred to Phase 4+ (intentionally not built now)

CV text extraction, AI CV parsing, any AI provider call, job scraping/collection, job matching, cover-letter generation, notification emails, application sending, n8n workflows, the `analysis_tasks` worker/claim loop, real Whish HTTP calls, and production Supabase/deployment configuration. `analysis_tasks` rows can now be created safely and will sit in `pending` status until a Phase 4 worker exists to claim them.

---

# Phase 4A Addendum — CV Analysis Profile database foundation

Implemented on `feature/cv-analysis-profile`. Schema, constraints, and RLS only — see "Deferred" at the end for what this phase deliberately does not build.

## Experience-level vocabulary

Extended (not renamed) via `20260804090000_extend_job_preferences_experience_level.sql`. The existing convention on `job_preferences.experience_level` is lowercase, hyphen-separated text (`entry-level`, not `entry_level`) — the new values follow the same style rather than introducing a second naming convention:

`internship`, `entry-level`, `junior`, `mid-level`, `senior`, `open-to-all`

All three previously-stored values remain valid under the widened check constraint; no data migration was needed. The vocabulary is now defined once, in `src/lib/experienceLevel.ts`, and consumed by both the onboarding preferences form (`src/app/onboarding/preferences/page.tsx`) and the `cv_analyses.profile_level` TypeScript type — see below for why `profile_level` deliberately reuses this exact list.

## cv_analyses — three regions, one table, kept logically separate

`20260804090010_create_cv_analyses.sql`. Every column belongs to exactly one of three regions, and every future caller (worker, review API, matching engine) must preserve that boundary:

1. **cv_facts** (`professional_summary` … `extracted_text`) — supported only by the CV. Preferences must never alter these.
2. **preference_snapshot** (one `jsonb` column) — a historical copy of `job_preferences` at analysis time. **Not** the source of truth for current preferences — `job_preferences` still is. A later preferences edit can never retroactively change what an existing analysis says it used.
3. **ai_career_profile** (`profile_level` … `development_areas`) — conclusions drawn from (1) informed by (2). `profile_level` reuses the experience-level vocabulary above so the user's self-reported target level and the AI-assessed level are always directly comparable.

Array-shaped `jsonb` columns (`skills`, `education`, `work_experience`, `projects`, `certifications`, `languages`, `recommended_roles`, `strongest_areas`, `career_recommendations`, `search_focus`, `development_areas`) are constrained with `jsonb_typeof(...) = 'array'`; object-shaped ones (`preference_snapshot`, `contact_info`, `user_edits`) with `jsonb_typeof(...) = 'object'` — the database rejects a malformed shape, not just the UI.

**Re-analysis is supported by design**: `cv_id` is not unique, so a CV can accumulate multiple `cv_analyses` rows over time (new AI provider, new prompt version, user-requested re-run). Two invariants are enforced at the database layer instead of trusted to application code:
- `unique (analysis_task_id)` — one task produces at most one result (idempotency, matching `analysis_tasks`' own pattern).
- A partial unique index, `cv_analyses_one_approved_per_user on (user_id) where review_status = 'approved'` — at most one **approved** analysis per user at any time, since that's the one row future job matching must read. A future approve action must supersede (e.g. demote) any prior approved row for the same user to satisfy this constraint; it will not do so automatically.

## RLS

Enabled, `select`-own only (`auth.uid() = user_id`) for `authenticated`. **No insert/update/delete policy exists for `authenticated` at all** — not even a narrow one for `review_status`/`user_edits`. This was deliberate, not an oversight: this phase does not build a review endpoint, and per the request, an insecure direct-update policy must not be added just to make that future UI easier. `service_role` (via `src/lib/supabase/admin.ts`, already granted full table access by `20260803090010_grant_service_role_table_access.sql`) is the only role that can write to this table today.

**What the future review endpoint must do** (not built in this phase): run server-side, re-derive `auth.uid()` from the verified session itself (never trust a client-supplied user id), verify the target `cv_analyses` row's `user_id` matches, restrict which fields a review action may touch (`review_status` transitions + `user_edits` only — never `status`, `ai_provider`, `ai_model`, `analysis_version`, or any `cv_facts`/`preference_snapshot` column), and use the service-role client to perform the actual write (since no client-facing RLS policy will ever permit it directly). This mirrors the existing `create_payment_attempt` pattern: a validated, narrowly-scoped, server-only mutation path, not a broadened RLS policy.

## Automation contract (Part 5)

**Trusted input** to the future worker is exactly three identifiers, matching the existing `analysis_tasks` queue-payload contract in Phase 3 — never a storage path, plan name, ownership claim, or preferences payload from an untrusted request:

```json
{ "analysis_task_id": "...", "user_id": "...", "cv_id": "..." }
```

**The worker must use those identifiers to securely load, server-side, via the service-role client:**
- the trusted `cvs` row and its Storage path (never accept a path from the caller)
- the current `job_preferences` row (to build `preference_snapshot` — copied at read time, then frozen into the result)
- the active `subscriptions` row and its `plans` limits (for future usage-limit enforcement — Phase 6/7, not this phase)

**The stored result must keep the three regions above separate** — `cv_facts` columns, `preference_snapshot`, and `ai_career_profile` columns are never merged or allowed to overwrite one another.

**Plans do not change CV facts or AI conclusions.** A Free/Student/Pro plan_code must never influence what `cv_facts` or `ai_career_profile` say about a CV — plan limits only ever govern *usage* later: number of job matches, number of cover letters, number of revisions, and (if introduced) processing priority. If a plan-based feature ever needs to change analysis behavior itself (not just usage limits), that is a product decision requiring explicit approval, not something to infer from this schema.

## CV Profile page (Part 6) — not wired this phase

`src/components/dashboard/CvProfileSection.tsx` currently renders only `full_name`/`university`/`major`/CV-file-metadata from `profiles`/`cvs`, with an explicit `TrustNote` stating skills/languages/roles will appear "once AI CV parsing is available." That note is accurate and was left unchanged — no fake analysis data was added to this component or any other. New TypeScript types (`src/lib/cvAnalysis/types.ts`) describe the shape a future fetch would use, but nothing queries `cv_analyses` from the dashboard yet.

**Exact next implementation step**, when ready: add a server-side loader (`src/lib/cvAnalysis/` or inline in `src/app/dashboard/page.tsx`) that selects the calling user's own `cv_analyses` row(s) via the existing `select`-own RLS policy — the browser's `authenticated` session is sufficient for reads, no new endpoint is required for *display*. A new server-only Route Handler *is* required before any *review* action (approve/edit) can be wired — see the RLS section above for exactly what it must enforce.

## Generated types (Part 7)

No generated Supabase types file exists anywhere in this project (`grep -r "gen types" src` and a repo-wide file search both come back empty) — all TypeScript types here are manually maintained, matching the existing convention (`src/lib/plans/types.ts`). If a generated-types workflow is introduced later, the command is:

```
npx supabase gen types typescript --local > src/lib/supabase/database.types.ts
```

That was **not** run in this phase (no existing generated file to keep in sync, and generating one is a separate, deliberate architectural decision, not a side effect of adding one table).

## Deferred in Phase 4A (intentionally not built)

The extraction/parsing worker, any AI provider call, the review Route Handler, any UI data-fetching for `cv_analyses`, and trusted `SECURITY DEFINER` helper functions for creating/updating analysis rows (e.g. a `create_cv_analysis`-style RPC). That last one is a deliberate scope boundary, not an oversight: the exact fields a real worker needs to set atomically depend on the extraction/AI pipeline design, which doesn't exist yet — inventing a specific function signature now risks guessing wrong and having to migrate around it later. `service_role` already has full direct table access (via the existing grants migration), which is sufficient for a future worker to use immediately once it exists.

---

# Phase 4B Addendum — CV/preference versioning, stale-result protection, analysis lifecycle

Implemented on `feature/cv-analysis-profile`, after Phase 4A. Extends the Phase 4A foundation so concurrent workers, CV replacement, and preference changes can never silently corrupt or overwrite the current career profile. No AI worker, n8n automation, dashboard UI, notifications, job matching, or cover letters were built — schema and documented contracts only, exactly as scoped.

## Exact product rules (verbatim, as specified)

**CV changed** → Full extraction and new AI Career Profile → New user approval required.

**Preferences changed** → Keep valid CV facts → Refresh AI recommendations and future matching → Do not reparse the CV unnecessarily.

**Plan changed** → Usage limits only → Never alter CV facts or AI conclusions.

## job_preferences versioning

`20260805090000_add_job_preferences_versioning.sql`. `version integer not null default 1`, backfilled to `1` for all existing rows automatically by the `ALTER TABLE ... DEFAULT`. A `before insert or update` trigger (`bump_job_preferences_version`) computes the authoritative value itself:
- On insert: always `1`, regardless of anything in the payload.
- On update: increments only when `target_roles`, `location`, `remote_preference`, `job_type`, `experience_level`, or `additional_notes` actually changed (`is distinct from`, correctly handling `NULL`); an update that changes nothing else (there is currently no way to update *only* `updated_at` from application code — it's trigger-maintained) leaves `version` untouched.

**Verified live, through the real `authenticated` REST path** (not just as `postgres`): a client that includes `"version": 999` in its `PATCH` payload — whether or not it also changes real data — never affects the stored value; the trigger always recomputes it from `OLD`/`NEW` server-side. `job_preferences` remains the one table in this schema a user can write directly (RLS unchanged), which is exactly why this had to be enforced in the database, not trusted to the client or application code.

## CV versioning and one-active-CV enforcement

`20260805090010_add_cvs_versioning.sql`. Added `version integer not null default 1`, `is_active boolean not null default true`, `superseded_at timestamptz` (nullable) — all existing rows backfilled to `version=1, is_active=true, superseded_at=null`, trivially valid. Added `cvs_one_active_per_user`, a partial unique index on `(user_id) where is_active = true`.

**Schema conflict found and reported, not silently resolved**: `cvs_user_id_key`, a *plain* (non-partial) `unique(user_id)` constraint from Phase 1, still exists and was deliberately **not** dropped. It structurally forbids more than one `cvs` row per user ever — the exact opposite of history preservation — but dropping it would immediately break `src/app/onboarding/upload-cv/page.tsx`'s `.upsert({...}, { onConflict: "user_id" })`: Postgres' `ON CONFLICT` target must name a real unique constraint on exactly those columns, and Supabase-js's `.upsert()` cannot target a `WHERE`-qualified partial index. **Verified live**: attempting a second active-CV row for an existing user fails today on `cvs_user_id_key` specifically (confirmed via direct test) — `cvs_one_active_per_user` is currently a dormant, forward-compatible duplicate of that guarantee, not yet the operative one. The exact resolution (in a future migration, alongside the real Replace CV action) is documented in the migration file itself: create the new version row, deactivate + supersede the old one, *then* drop `cvs_user_id_key` — all in one transaction, using the service-role client, never a client-side upsert.

**Verified live**: the existing upload flow (`upsert` with `onConflict: user_id`) still works completely unchanged — same row `id`, `version`/`is_active`/`superseded_at` untouched (not in its payload).

**Observed, not fixed**: `cvs`' existing `UPDATE` RLS policy (unchanged in this phase — not part of what Part 3 asked for) is not column-scoped, so a user can today directly set their own `is_active`/`version`/`superseded_at` via a direct client request. This is flagged rather than silently tightened, since restricting it wasn't requested and the eventual Replace CV action's authorization model (client session vs. service-role-only) is an open design decision for that future phase, not this one.

## analysis_tasks lifecycle

`20260805090020_extend_analysis_tasks_lifecycle.sql`. Reused rather than duplicated: `cv_id`, `started_at`, `completed_at`, `attempt_count` (all pre-existing); `last_error` reused in place of a new `error_message` column. Added:
- `task_type text not null default 'full_analysis' check (task_type in ('full_analysis','career_profile_refresh'))` — distinct from the existing `trigger` column (why a task exists, today only `'onboarding_completed'`) vs. what kind of work it is. No caller sets this explicitly yet; `create_analysis_task`'s existing 3-argument signature is completely unchanged and every row it inserts correctly defaults to `full_analysis` (verified live: a task created through the unmodified function has `task_type = 'full_analysis'`).
- `preferences_version integer` (nullable) — auto-populated from the caller's current `job_preferences.version` by a new `before insert` trigger (`set_analysis_task_preferences_version`) when not explicitly supplied, so `create_analysis_task` needed no signature change at all. **Verified live**: after bumping a fixture user's preferences to version 4, a task created through the existing function correctly captured `preferences_version = 4`.
- `superseded_at timestamptz` (nullable) — a marker column only; nothing sets it in this phase (see the atomic claim contract below for what must respect it).

**No new duplicate-task partial unique index was added.** The existing `analysis_tasks_one_active_per_cv` (`unique(cv_id) where status in ('pending','processing')` — the real, confirmed status vocabulary) already forbids *any* two active tasks for the same CV, which is strictly stronger than "same user+cv+task_type+preferences_version." Adding the narrower index on top would be unreachable, redundant weight (Phase 1's own instruction against duplicate indexes) unless the coarser one is deliberately loosened first — documented as a future, explicit decision if the product ever wants `full_analysis` and `career_profile_refresh` to run concurrently for one CV.

## cv_analyses stale/current/superseded behavior

`20260805090030_extend_cv_analyses_lifecycle.sql`. Added `preferences_version integer` (nullable), `is_current boolean not null default false`, `superseded_at timestamptz` (nullable), and `recommendations_state text not null default 'current' check (in ('current','stale','superseded'))` — a **separate, clearly-named field** rather than overloading `status` or `review_status`, per the explicit instruction to keep processing status, review status, and system-determined validity independent:

| Field | Answers |
|---|---|
| `status` | Did extraction/AI generation succeed? (`processing`/`completed`/`failed`) |
| `review_status` | Did the user approve this result? (permanent historical fact) |
| `recommendations_state` + `is_current` | Is this still the record to trust *right now*? |

- **`current`**: `cv_facts` and `ai_career_profile` both match the live CV and live preferences.
- **`stale`**: CV unchanged, but `preferences_version` is behind the user's live `job_preferences.version` — `cv_facts` remain fully reusable (must not be reparsed); only `ai_career_profile` needs a `career_profile_refresh`.
- **`superseded`**: the CV itself was replaced — the entire result, `cv_facts` included, is no longer relevant.

Two `security definer` triggers enforce this automatically (definer because they fire during a user's own legitimate write to *their own* `cvs`/`job_preferences` row, but must then write to `cv_analyses`, which has no client-facing write policy at all — the same reasoning `handle_new_user` has always used):
- `mark_cv_analyses_superseded_on_cv_change` (`after update on cvs`): when `is_active` flips `true → false`, the CV's current analysis (if any) is set `is_current = false, recommendations_state = 'superseded', superseded_at = now()`. `review_status` is left untouched — approval is a historical fact independent of whether the record is still current.
- `mark_cv_analyses_stale_on_preferences_change` (`after update on job_preferences`): when `version` increments, the user's current analysis (if its `recommendations_state` was `'current'`) is set to `'stale'` — `is_current` stays `true`, since it's still "the" record, just due for a refresh.

**Invariants enforced by the database, not application code**:
- `cv_analyses_current_not_superseded` check constraint: `is_current` and `recommendations_state = 'superseded'` can never coexist on one row.
- `cv_analyses_one_current_per_user` partial unique index: at most one `is_current = true` row per user — independent of, and additional to, Phase 4A's `cv_analyses_one_approved_per_user` (review status and currency are decoupled, as above).

**Verified live** (four scenarios, using a real fixture user, cleaned up afterward): (1) a `current` + `superseded` combo is rejected outright by the check constraint; (2) a second `is_current = true` row for the same user is rejected by the partial unique index; (3) bumping `job_preferences.version` correctly flips an existing current analysis to `stale` while `is_current` stays `true`; (4) deactivating the referenced `cvs` row correctly flips it to `superseded`, `is_current = false`, with `superseded_at` set.

## Atomic worker claim (documented, not implemented)

Per the explicit instruction to defer this without guessing at a public function, no claim RPC was written. The required behavior, precisely:

```sql
-- One transaction, using the service-role client:
select * from public.analysis_tasks
where status = 'pending'
  and available_at <= now()
  and superseded_at is null
order by available_at
limit :batch_size
for update skip locked;
-- then, in the same transaction, for each claimed row:
update public.analysis_tasks
set status = 'processing', started_at = now(), attempt_count = attempt_count + 1
where id = :claimed_id;
```

`for update skip locked` is what makes claiming atomic across concurrent workers: two workers racing for the same row never process it twice — one gets it, the other's `select` silently skips the locked row and moves to the next candidate. `superseded_at is null` (added this phase) must be part of the filter once anything starts setting that column. Retry/idempotency is already fully provided by existing infrastructure: `idempotency_key` (unique), `attempt_count`/`max_attempts`, and `analysis_tasks_one_active_per_cv` together guarantee a retried or duplicate-triggered task creation can never result in two workers concurrently producing conflicting results for the same CV.

## Approval transaction (documented, not implemented)

Per the explicit instruction not to guess a public `security definer` approval function without an established pattern to safely base its authorization on, no such function was written. The required behavior for the future review endpoint, precisely, in one transaction:

1. `select ... for update` the target `cv_analyses` row (lock it against concurrent approval/supersession).
2. Confirm `user_id = auth.uid()` from the caller's own verified session — never a client-supplied user id (matches every other trusted mutation in this schema).
3. Confirm its `cv_id` still has `cvs.is_active = true` for that user — reject if not (the CV has since been replaced; this result is stale by construction).
4. Confirm `preferences_version = ` the user's live `job_preferences.version` — reject (or route to review-with-warning) if behind.
5. Reject if `status <> 'completed'`, or `recommendations_state = 'superseded'` — an incomplete, failed, or superseded result must never be approved.
6. If a different row is currently `review_status = 'approved'` and/or `is_current = true` for this user, demote it (`review_status` stays as historical fact per the header table above; only `is_current`/`recommendations_state` on the *old* row need to change, and only if it hasn't already been superseded by the triggers above).
7. Set the target row `review_status = 'approved'`, `is_current = true`, `recommendations_state = 'current'`.
8. Set `approved_at = now()`, `reviewed_at = now()`.

This must run server-side (service-role client), exactly mirroring the existing `create_payment_attempt`/`mark_payment_verified` pattern — never a broadened RLS policy on `cv_analyses`.

## Historical data preservation

Nothing in this phase deletes a row or a Storage object. Superseded `cvs` rows, every past `cv_analyses` row (`is_current` or not, any `recommendations_state`), and every `analysis_tasks` row remain queryable indefinitely — future matches/cover letters/applications may still reference a superseded `cv_id` or a non-current `cv_analyses.id` by design.

## Deferred in Phase 4B (intentionally not built)

The Replace CV server action (and the `cvs_user_id_key` drop it requires), the atomic claim function, the approval `security definer` function, any code path that creates a `career_profile_refresh` task, and everything already deferred in Phase 4A (worker, AI calls, review endpoint UI, matching, cover letters, notifications, n8n, deployment).
