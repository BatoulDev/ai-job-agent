# Account Deletion — Design, Status, and Approval Checklist

Status (updated 2026-11-02): the founder approved the open product/legal decisions below (see "2026-11-02 founder decisions and resulting implementation"). Reauthentication, the `/settings/delete-account` UI, and a password/Google reauth gate are now **implemented and locally tested**. This is **NOT YET production-verified or deployed** — see that section for exactly what remains before real users can reach this flow.

Everything below this line is the original 2026-08-24 design record, preserved as-is for history. Where the founder's 2026-11-02 decision changes something stated below, the new section above/below takes precedence — the text below is not rewritten.

Original status line (2026-08-24): **data-layer cascade and the deletion function are implemented and tested. Production activation (a real, user-reachable "Delete my account" flow) is BLOCKED_PENDING_APPROVAL** on the product/legal decisions in "Open decisions" below — not on any remaining code defect.

## What already exists (verified this session)

- Every personal-data table cascades on `auth.users` deletion via `on delete cascade` FKs: `profiles`, `job_preferences` (+ `job_preference_target_roles`/`job_preference_locations`/`job_preference_authorized_countries`/`job_preference_relocation_locations`), `cvs`, `subscriptions`, `payment_attempts`, `analysis_tasks`, `cv_analyses`, `analysis_feedback`, `matches`, `cover_letters`, `applications`, `notifications`, `rate_limit_events`. `audit_events.user_id` is `on delete set null` (deliberate — retains an anonymized audit trail rather than deleting it).
- `tests/db/account-deletion-cascade.test.mjs` (pre-existing, 15 scenarios) empirically proves `adminClient.auth.admin.deleteUser()` cascades all of the above correctly, is idempotent on a repeat call, never touches another user's data, and — critically — that Supabase **Storage objects are NOT covered by any DB foreign key**: the CV file bytes under `cvs/{userId}/...` survive `deleteUser()` and must be removed as a separate, explicit step.
- `src/lib/account/deleteAccount.ts` (new, this session): a small production wrapper around that exact proven sequence — `auth.admin.deleteUser(userId)` first (so a transient failure never leaves an account half-deleted-looking), then Storage cleanup for that user's own `{userId}/...` folder, each step retried with bounded backoff, "not found" treated as success for idempotency.
- `tests/unit/delete-account.test.mjs` (new): unit-tests the wrapper's own logic (call order, retry, per-step failure reporting) against a fake client.
- `tests/db/delete-account-route-logic.test.mjs` (new): one real end-to-end run of the wrapper against the guarded local database with a disposable fixture user (CV + Storage object), confirming it actually deletes everything including the Storage folder.
- `src/app/api/account/delete/route.ts` (new): a `POST` route that requires an authenticated session (`supabase.auth.getUser()` — never a client-supplied id), requires a literal `{"confirm":"DELETE"}` body as a misfire guard, and calls the wrapper with the caller's own id only.
- **Not wired to any UI.** No settings-page button exists yet, and none should be added until the decisions below are made — see "Why this isn't live yet."

## Why this isn't live yet

Three open product/legal questions, not code defects:

1. **Payment/financial record retention.** `payment_attempts` currently cascades to full deletion like everything else. Many jurisdictions require financial/transaction records to be retained for a fixed period (commonly years) for tax/accounting purposes even after a user deletes their account. AI Job Guide does not yet process real payments (see the Privacy Policy draft), so this is low urgency today, but **must be decided before real payments go live** — the fix (if retention is required) is changing `payment_attempts.user_id`'s FK to `on delete set null` (mirroring `audit_events`) in a reviewed migration, not a code change here.
2. **Recent re-authentication.** AGENTS.md §28: "Sensitive account changes should require recent authentication when supported." The route today only requires an *existing* session, not a fresh password re-entry. Recommended before activation: prompt for the current password (or require a session younger than e.g. 15 minutes) immediately before this call. Not implemented this session — a UX decision, not purely a technical one.
3. **Vendor data retention outside this codebase.** CV/profile text is sent to our AI model provider for analysis; job-sourcing uses Apify (receives no personal data). n8n execution history lives in n8n's own database, outside this app's schema, and may retain input/output payloads per its own execution-data retention setting. None of these are controlled by the `deleteAccount` cascade above. Confirming/configuring each vendor's own retention and, where needed, requesting deletion from them is an operational task for whoever owns those accounts — tracked here as a dependency, not something this session can execute.

## Exact proposed migration for the one residual schema gap found

Separately from the above: `applications.approved_by uuid not null references auth.users (id)` and `registry_sync_staging.resolved_by uuid references auth.users (id)` have **no `on delete` clause** (defaults to `NO ACTION`). Today this is latent and unreachable — the only path that sets `approved_by` (`create_application`'s RPC) always derives it from the same `auth.uid()` as the row's own `user_id`, so the row is cascade-deleted via `user_id` before `approved_by` could ever block anything. It would only become a real bug if a future feature lets one user approve on behalf of another (not in this product's current scope). Documented and **not applied** (no migration file created), per this session's boundaries:

```sql
-- PROPOSED, NOT APPLIED — for review only.
alter table public.applications
  drop constraint applications_approved_by_fkey,
  add constraint applications_approved_by_fkey
    foreign key (approved_by) references auth.users (id) on delete cascade;

alter table public.registry_sync_staging
  drop constraint registry_sync_staging_resolved_by_fkey,
  add constraint registry_sync_staging_resolved_by_fkey
    foreign key (resolved_by) references auth.users (id) on delete set null;
```

(Exact constraint names must be confirmed against the live schema before this is ever applied — the names above are inferred from Postgres's default naming convention and have not been verified against `information_schema`.)

## Activation checklist (when approved)

1. Decide the three open questions above.
2. If payment retention requires a change, apply the reviewed migration changing `payment_attempts.user_id` to `on delete set null`.
3. Add password re-entry (or a recent-session check) in front of the existing `POST /api/account/delete` route.
4. Add a "Delete my account" control to `/settings` with a clear, explicit confirmation step, wired to the existing route.
5. Re-run `tests/db/account-deletion-cascade.test.mjs` and `tests/db/delete-account-route-logic.test.mjs` once more after any schema change.
6. Update the Privacy Policy's "Your choices" section to describe self-service deletion instead of a contact-email request.

## 2026-11-02 founder decisions and resulting implementation

The founder answered all three open decisions above directly:

1. **Deletion timing**: immediate, after successful reauthentication and final confirmation — no 30-day wait. Implemented as designed; there was never a waiting-period mechanism in the code to remove.
2. **Reauthentication**: password accounts require a fresh password; Google accounts require a fresh Google reauthentication. The one existing session is never sufficient on its own.
3. **Payment/financial record retention**: retain only what's legally required, minimize everything else, never invent a retention period. Re-verified this session: AI Job Guide still has **no real payment processor integrated** (`src/lib/payments/checkout.ts` and `src/lib/payments/whish/provider.ts` are the only payment-adjacent code, and `whish/provider.ts` throws on every real operation — confirmed, not assumed, by reading both files). `payment_attempts` rows are entirely simulated today, so there is no real financial/accounting record that any jurisdiction's retention law could apply to. **This question is therefore moot until a real payment processor exists** — the originally-proposed `on delete set null` migration for `payment_attempts.user_id` was NOT applied, because applying it now would be solving a problem that does not yet exist and would need to be re-reviewed against whatever real processor is eventually chosen anyway.

### What was implemented (local, tested, not yet deployed)

- `src/lib/account/sessionFreshness.ts` (new): decodes the `iat` claim from the session's own access token (no new reauth-token table) and defines a 5-minute freshness window.
- `POST /api/account/reauthenticate` (new): verifies a password account's current password via `signInWithPassword` against the already-authenticated caller's own email (never a client-supplied email), rate-limited and user-id-keyed (`account_reauth` action — `supabase/migrations/20261102090000_add_account_reauth_rate_limit.sql`, following the exact same pattern as the existing `password_update` action). A successful call re-issues the session cookie with a fresh `iat`.
- Google accounts re-authenticate via a fresh `signInWithOAuth({queryParams:{prompt:"consent"}})` round-trip — `src/lib/authRateLimit/startGoogleOAuth.ts` gained optional `redirectTo`/`forceConsent` parameters (default behavior for login/signup is unchanged) so the existing OAuth callback (`src/app/auth/callback/route.ts`) lands back on `/settings/delete-account` with a freshly re-issued session, no new callback route needed.
- `POST /api/account/delete` (modified): now requires the current session's `iat` to be within the last 5 minutes before calling the existing, unchanged `deleteAccount()` wrapper; returns `{error:"REAUTH_REQUIRED"}` (403) otherwise. Calls `supabase.auth.signOut()` after a successful deletion.
- `/settings/delete-account` (new page + `DeleteAccountForm.tsx` client component): branches the reauth step on `user.app_metadata.provider` (password vs. Google), then a final step requiring both an acknowledgement checkbox and typing `DELETE`, with loading/error/success states. Linked from a new "Danger zone" card on `/settings/profile`.
- The residual `applications.approved_by`/`registry_sync_staging.resolved_by` FK gap above is **unchanged** — still a documented, not-applied proposal, still latent/unreachable via any current code path. Not touched this session; no new information changes its priority.

### What remains before this is exposed to real users

- No Playwright E2E test exists yet for this specific flow (password reauth → confirm → delete → sign-out; Google reauth → confirm → delete → sign-out).
- Never run against a real deployed environment — only the local Supabase instance and local dev server.
- Explicit founder sign-off to actually link/expose this to production users, per AGENTS.md §11's deployment boundaries.
- Privacy Policy's "Your choices" section was updated this session to describe self-service deletion (item 6 above) — still pending legal review and a real support-contact email before the policy itself can be treated as final.
