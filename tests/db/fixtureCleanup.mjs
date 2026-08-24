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

// public.bump_job_preferences_version_for_child() (an AFTER INSERT OR
// DELETE trigger on job_preference_target_roles/job_preference_locations,
// added in 20260806090070/20260806090080) UPDATEs the parent
// job_preferences row whenever a child join row changes. When a user with
// at least one target role or location is deleted, Postgres's single
// auth.users cascade deletes job_preferences AND its child join rows in
// the same statement — the child rows' AFTER DELETE trigger then tries to
// UPDATE the parent job_preferences row that the SAME cascading statement
// is already deleting, which Postgres rejects with "tuple to be updated
// was already modified by an operation triggered by the current command".
// GoTrue's admin deleteUser endpoint surfaces that as an opaque
// AuthRetryableFetchError (500, empty body) — reproduced directly against
// local Postgres/GoTrue while building this cleanup path, independent of
// any test-runner concurrency. This is a genuine account-deletion bug
// (not just a test-fixture issue): deleting ANY real user with saved job
// preferences that include a reference role/location would hit the same
// error — see docs/PRODUCTION_READINESS.md.
//
// Workaround, scoped to fixture cleanup only (no schema/trigger change
// here — that's a separate, deliberate fix): delete the child join rows
// as their own statement, before the user (and therefore job_preferences)
// is touched at all. The trigger's UPDATE then hits a parent row that
// is not itself mid-deletion, succeeds normally, and the now-childless
// job_preferences row cascades away cleanly with the auth user afterward.
async function removeJobPreferencesChildrenForUser(userId) {
  await retryWithBackoff(
    async () => {
      const { data: prefs, error: prefsError } = await adminClient
        .from("job_preferences")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      if (prefsError) throw new Error(`job_preferences lookup failed: ${prefsError.message}`);
      if (!prefs) return;

      const { error: rolesError } = await adminClient
        .from("job_preference_target_roles")
        .delete()
        .eq("job_preference_id", prefs.id);
      if (rolesError) throw new Error(`job_preference_target_roles cleanup failed: ${rolesError.message}`);

      const { error: locationsError } = await adminClient
        .from("job_preference_locations")
        .delete()
        .eq("job_preference_id", prefs.id);
      if (locationsError) throw new Error(`job_preference_locations cleanup failed: ${locationsError.message}`);
    },
    { label: `job_preferences children cleanup for ${redactId(userId)}` }
  );
}

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
      await removeJobPreferencesChildrenForUser(user.id);
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
