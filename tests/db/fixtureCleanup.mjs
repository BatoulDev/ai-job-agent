// tests/db/fixtureCleanup.mjs
//
// Retry-with-backoff, delete, and verify logic for automated-test fixture
// users and jobs — shared by tests/db/helpers.mjs (which the `node --test`
// test files import) and the plain Node scripts that also need to clean up
// fixtures outside of a running test: scripts/run-db-tests.mjs's post-run
// verification sweep, and scripts/db-test-crash-recovery-sweep.mjs.
//
// No node:test import here, deliberately — same reasoning as
// localTestGuard.mjs: this must be safely importable from a plain script,
// not only from inside `node --test`.
//
// Every delete here is retried with bounded exponential backoff (transient
// GoTrue/Storage failures under concurrent load are exactly what produced
// the ~134 orphaned fixture users this module replaces the old fail-open
// cleanup for — see docs/PRODUCTION_READINESS.md), then verified, then
// thrown on failure. Nothing here ever logs an email address or other
// fixture content — only redacted ids and counts.

import { adminClient } from "./localTestGuard.mjs";

function redactId(id) {
  return id ? `${id.slice(0, 8)}…` : "(none)";
}

export async function retryWithBackoff(fn, { attempts = 6, baseDelayMs = 300, label = "operation" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempt(s): ${lastError?.message ?? lastError}`);
}

async function removeStorageForUser(userId) {
  await retryWithBackoff(
    async () => {
      const { data: objects, error: listError } = await adminClient.storage.from("cvs").list(userId);
      if (listError) throw new Error(`storage list failed: ${listError.message}`);
      if (objects && objects.length > 0) {
        const { error: removeError } = await adminClient.storage
          .from("cvs")
          .remove(objects.map((o) => `${userId}/${o.name}`));
        if (removeError) throw new Error(`storage remove failed: ${removeError.message}`);
      }
    },
    { label: `storage cleanup for ${redactId(userId)}` }
  );
}

// RESOLVED by supabase/migrations/20260824170000_fix_job_preferences_account_deletion_cascade.sql
// (2026-08-24) — this used to be a pre-delete-the-children workaround for a
// genuine account-deletion defect: public.bump_job_preferences_version_for_child()
// (an AFTER INSERT OR DELETE trigger on job_preference_target_roles/
// job_preference_locations, added in 20260806090070/20260806090080) UPDATEd
// the parent job_preferences row whenever a child join row changed. When a
// user with at least one target role or location was deleted, Postgres's
// single auth.users cascade deleted job_preferences AND its child join rows
// in the same statement — the child rows' AFTER DELETE trigger then tried to
// UPDATE the parent job_preferences row that the SAME cascading statement
// was already deleting, which Postgres rejected with "tuple to be updated
// was already modified by an operation triggered by the current command".
// GoTrue's admin deleteUser endpoint surfaced that as an opaque
// AuthRetryableFetchError (500, empty body).
//
// The fix migration removed those child triggers entirely (versioning for
// join-table changes already happens exactly once inside save_job_preferences
// via selection_version, since 20260818090000 — the triggers were redundant
// with that path even outside of deletion). admin.deleteUser() now succeeds
// directly for every onboarding state, proven without any child-row
// pre-deletion by tests/db/account-deletion-cascade.test.mjs. This
// pre-deletion step is intentionally NOT restored here — keeping it would
// silently mask a future regression of the same schema defect, since
// ordinary fixture cleanup would keep working around it instead of failing
// loudly the way admin.deleteUser() now correctly does on its own.
async function removeAuthUser(userId) {
  await retryWithBackoff(
    async () => {
      const { error } = await adminClient.auth.admin.deleteUser(userId);
      // "not found" means it's already gone (idempotent success), whether
      // from a prior attempt in this same call, the file's own after()
      // hook running before this manifest sweep, or a retried call
      // succeeding server-side before its response reached us.
      if (error && !/not.?found/i.test(error.message ?? "")) {
        throw new Error(`deleteUser failed: ${error.message}`);
      }
    },
    { label: `auth user delete for ${redactId(userId)}` }
  );
}

async function verifyUserGone(userId) {
  const { data } = await adminClient.auth.admin.getUserById(userId);
  return !data?.user;
}

async function verifyStorageGone(userId) {
  const { data } = await adminClient.storage.from("cvs").list(userId);
  return !data || data.length === 0;
}

// Deletes exactly the given fixture users — their Storage objects (no FK,
// so removed explicitly first) then the auth user itself, which cascades
// (`on delete cascade` to auth.users) to profiles, cvs, job_preferences
// (and its target-role/location joins), subscriptions, analysis_tasks,
// cv_analyses, rate_limit_events, matches, cover_letters, applications,
// notifications, and analysis_feedback. Retries transient failures with
// bounded exponential backoff, then verifies both the auth user and their
// Storage folder are actually gone. Throws — never just logs — if any
// fixture survives after retries, so a cleanup failure fails the test run
// instead of silently leaking a row into the shared local database.
export async function deleteFixtureUsers(users) {
  const failures = [];
  for (const user of users) {
    if (!user?.id) continue;
    try {
      await removeStorageForUser(user.id);
      await removeAuthUser(user.id);
      const [userGone, storageGone] = await Promise.all([verifyUserGone(user.id), verifyStorageGone(user.id)]);
      if (!userGone || !storageGone) {
        throw new Error(`post-delete verification failed (userGone=${userGone}, storageGone=${storageGone})`);
      }
    } catch (err) {
      failures.push({ id: redactId(user.id), message: err.message });
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Fixture cleanup failed for ${failures.length} user(s): ` +
        failures.map((f) => `${f.id}: ${f.message}`).join("; ")
    );
  }
}

// Deletes exactly the given fake `jobs` rows. jobs.created_by is
// `on delete set null` (not cascade), so these never disappear on their
// own when the fixture admin user who created them is deleted — they must
// always be tracked and removed explicitly. Verifies none remain.
export async function deleteFixtureJobs(ids) {
  if (!ids || ids.length === 0) return;
  await retryWithBackoff(
    async () => {
      const { error } = await adminClient.from("jobs").delete().in("id", ids);
      if (error) throw new Error(`jobs delete failed: ${error.message}`);
    },
    { label: `fake job cleanup (${ids.length} row(s))` }
  );

  const { data: remaining, error: verifyError } = await adminClient.from("jobs").select("id").in("id", ids);
  if (verifyError) throw new Error(`Failed to verify fake job cleanup: ${verifyError.message}`);
  if (remaining && remaining.length > 0) {
    throw new Error(`${remaining.length} fake job row(s) still present after delete.`);
  }
}
