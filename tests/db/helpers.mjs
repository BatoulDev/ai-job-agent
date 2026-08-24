// tests/db/helpers.mjs
//
// Shared setup for the local database/RLS integration tests
// (node --test tests/db/*.test.mjs). LOCAL DATABASE ONLY.
//
// Environment safety (hostname allowlist + LOCAL_TEST_DB_MARKER + canonical
// catalog check) lives in ./localTestGuard.mjs and is enforced at import
// time there. Retry/verify delete logic lives in ./fixtureCleanup.mjs, so
// both this file and the plain-Node scripts that also clean up fixtures
// outside of a running test (scripts/run-db-tests.mjs,
// scripts/db-test-crash-recovery-sweep.mjs) share exactly one
// implementation of "delete a fixture user/job and prove it's gone."
//
// Every test creates its own randomly-suffixed fixture users and deletes
// them in an `after` hook. On top of that, this file tracks every user id
// and job id created via createTestUser/insertFakeJob in a per-process
// manifest and registers its own top-level after() safety net (below) that
// sweeps anything still outstanding once the file's own hooks are done —
// closing the gap where a partially-failed before() (e.g. one of two
// Promise.all-created users failing) would otherwise leave the first,
// successfully-created user with no reference left to clean it up. This
// safety net is what actually enforces "never leaves a fixture behind" —
// deleteTestUsers/deleteFakeJobs below are the normal path, not the only
// path.
//
// Never logs a key, token, or password value — only presence/host checks.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { after } from "node:test";
import {
  supabaseUrl,
  supabaseAnonKey,
  adminClient,
  assertExpectedLocalProject,
  fail,
} from "./localTestGuard.mjs";
import { deleteFixtureUsers, deleteFixtureJobs } from "./fixtureCleanup.mjs";

export { supabaseUrl, supabaseAnonKey, adminClient, assertExpectedLocalProject };

// One id per `node --test` child process (each test file runs in its own
// process by default). scripts/run-db-tests.mjs sets TEST_RUN_ID in the
// environment before spawning `node --test`, so every file in one
// `npm run test:db` invocation shares the same id — that's what lets the
// orchestrator's post-run verification find every fixture the whole run
// created, across every file, by a single email-substring check. Falls
// back to a fresh id when a file is run directly
// (`node --test tests/db/x.test.mjs`, bypassing the orchestrator).
export const TEST_RUN_ID = process.env.TEST_RUN_ID ?? randomUUID();
const RUN_ID_SHORT = TEST_RUN_ID.replace(/-/g, "").slice(0, 8);

// A fresh, unauthenticated client for the same local project — for tests
// that need to confirm anon access is correctly rejected.
export function createAnonClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ---------------------------------------------------------------------
// Per-process fixture manifest + safety-net cleanup.
// ---------------------------------------------------------------------
const trackedUserIds = new Set();
const trackedJobIds = new Set();

after(async () => {
  const remainingUsers = [...trackedUserIds].map((id) => ({ id }));
  const remainingJobs = [...trackedJobIds];
  if (remainingUsers.length === 0 && remainingJobs.length === 0) return;

  // Jobs first: a fixture admin user's `jobs.created_by` would otherwise
  // be set null (not cascaded) once the user is deleted below, which is
  // harmless either way, but cleaning jobs first keeps the order matching
  // deleteFakeJobs-then-deleteTestUsers as used throughout the test files.
  if (remainingJobs.length > 0) {
    await deleteFixtureJobs(remainingJobs);
    for (const id of remainingJobs) trackedJobIds.delete(id);
  }
  if (remainingUsers.length > 0) {
    await deleteFixtureUsers(remainingUsers);
    for (const u of remainingUsers) trackedUserIds.delete(u.id);
  }
});

const TEST_PASSWORD_PREFIX = "db-test-";
function randomTestPassword() {
  return `${TEST_PASSWORD_PREFIX}${randomUUID()}`;
}

// Creates a fresh, uniquely-named, local-only fixture user and returns
// both an admin-scoped handle (id) and a real per-user Supabase client
// authenticated as them (via signInWithPassword against the local GoTrue
// instance) — queries through this client are evaluated under RLS exactly
// as a real browser session would be, which is what makes these
// integration tests meaningful rather than mocked.
//
// Email is tagged with this run's id
// (db-test-{label}-{runIdShort}-{uuid}@test.local) both for crash-recovery
// bookkeeping (see scripts/db-test-crash-recovery-sweep.mjs) and so a
// leaked fixture can always be traced back to the run that created it.
// Tracked in the manifest immediately on creation — before the sign-in
// step — so a failure signing in still leaves the user reachable for
// cleanup by the after() safety net above.
export async function createTestUser(label) {
  const safeLabel = String(label).replace(/[^a-zA-Z0-9-]+/g, "-").slice(0, 20);
  const email = `db-test-${safeLabel}-${RUN_ID_SHORT}-${randomUUID().slice(0, 8)}@test.local`;
  const password = randomTestPassword();

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) fail(`Failed to create test user ${label}: ${createError.message}`);
  trackedUserIds.add(created.user.id);

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) fail(`Failed to sign in test user ${label}: ${signInError.message}`);

  return {
    id: created.user.id,
    email,
    client: userClient,
    session: signIn.session,
  };
}

// Deletes exactly the given fixture users, retrying transient failures and
// verifying each is actually gone before returning — throws (never just
// logs) if any survive. Removes successfully-deleted ids from the
// manifest so the file's top-level after() safety net above does not
// re-attempt them (idempotent either way: deleting an already-gone user is
// a no-op success in fixtureCleanup.mjs, not an error).
export async function deleteTestUsers(users) {
  await deleteFixtureUsers(users);
  for (const user of users) {
    if (user?.id) trackedUserIds.delete(user.id);
  }
}

// Clears every rate_limit_events row for a user (both the ai_task_create
// cooldown and the cv_replace rolling-window counter added by
// 20260821090000_add_ai_task_and_cv_replace_rate_limits.sql). Admin-only —
// uses the service-role client, which bypasses RLS the same way
// insertFakeAnalysis already does to fabricate test state directly. Local
// database only, gated by the guard in ./localTestGuard.mjs. No separate
// tracking/cleanup needed: rate_limit_events.user_id is `on delete
// cascade` to auth.users, so deleteTestUsers/the after() safety net above
// already remove every row this touches.
export async function resetRateLimits(userId) {
  const { error } = await adminClient.from("rate_limit_events").delete().eq("user_id", userId);
  if (error) fail(`Failed to reset rate limits for ${userId}: ${error.message}`);
}

// Moves every rate_limit_events row for (userId, action) back in time by
// minutesAgo, so a test can deterministically prove "succeeds again once the
// window has elapsed" without a real 10-minute/1-hour sleep. Admin-only,
// same trust boundary as resetRateLimits.
export async function backdateRateLimitEvents(userId, action, minutesAgo) {
  const backdated = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const { error } = await adminClient
    .from("rate_limit_events")
    .update({ created_at: backdated })
    .eq("user_id", userId)
    .eq("action", action);
  if (error) fail(`Failed to backdate rate_limit_events for ${userId}/${action}: ${error.message}`);
}

// A minimal, valid fake CV upload — never a real user's file. Used
// wherever a test needs a cvs row to exist before exercising
// replace_cv/analysis/matches.
//
// By default, resets this user's rate_limit_events immediately before
// calling replace_cv, so existing tests that upload/replace a fake CV many
// times in quick succession (well within the production 5-per-rolling-hour
// and 10-minute AI-task-cooldown windows) continue to exercise dedup/
// supersession/ownership behavior unaffected by the new rate limits — those
// limits are deliberately exercised for real, with explicit timestamp
// control, only in tests/db/rate-limits.test.mjs. Pass
// { skipRateLimitReset: true } to opt out and hit the real limits.
//
// No separate Storage-path tracking is needed here: deleteTestUsers/the
// after() safety net remove every object under this user's own Storage
// folder (cvs/{user.id}/...) unconditionally, which covers every path this
// function ever uploads to.
export async function uploadFakeCv(user, fileName = "fake-cv.pdf", { skipRateLimitReset = false } = {}) {
  if (!skipRateLimitReset) {
    await resetRateLimits(user.id);
  }

  const storagePath = `${user.id}/${randomUUID()}-${fileName}`;
  const fakeBytes = new TextEncoder().encode("%PDF-1.4 fake test fixture, not a real CV\n");
  const { error: uploadError } = await user.client.storage
    .from("cvs")
    .upload(storagePath, fakeBytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) fail(`Failed to upload fake CV for ${user.email}: ${uploadError.message}`);

  const { data, error } = await user.client.rpc("replace_cv", {
    p_storage_path: storagePath,
    p_file_name: fileName,
    p_file_size_bytes: fakeBytes.byteLength,
    p_mime_type: "application/pdf",
  });
  if (error) fail(`replace_cv failed for ${user.email}: ${error.message}`);
  return data;
}

// Inserts a minimal, valid, already-completed cv_analyses row directly via
// the admin client — standing in for a future AI worker, which this
// mission does not build. Not approved by default. No separate tracking
// needed: cv_analyses.user_id is `on delete cascade` to auth.users.
export async function insertFakeAnalysis(user, cvId, overrides = {}) {
  const { data, error } = await adminClient
    .from("cv_analyses")
    .insert({
      user_id: user.id,
      cv_id: cvId,
      status: "completed",
      analyzed_at: new Date().toISOString(),
      preference_snapshot: {},
      ...overrides,
    })
    .select()
    .single();
  if (error) fail(`Failed to insert fake analysis for ${user.email}: ${error.message}`);
  return data;
}

// jobs.created_by is `on delete set null`, not cascade — a fake job
// outlives the fixture user who created it, so it must be tracked and
// cleaned up independently. Tracked in the manifest immediately, same
// reasoning as createTestUser.
export async function insertFakeJob(overrides = {}) {
  const { data, error } = await adminClient
    .from("jobs")
    .insert({
      title: "Fake Test Job",
      company_name: "Fake Test Co",
      description: "A fake job fixture for automated tests only.",
      application_method: "external_link",
      application_url: "https://example.test/apply",
      source_type: "admin_manual",
      status: "active",
      ...overrides,
    })
    .select()
    .single();
  if (error) fail(`Failed to insert fake job: ${error.message}`);
  trackedJobIds.add(data.id);
  return data;
}

// Deletes exactly the given fake `jobs` rows, retrying transient failures
// and verifying none remain — throws (never just logs) if any survive.
export async function deleteFakeJobs(ids) {
  if (!ids || ids.length === 0) return;
  await deleteFixtureJobs(ids);
  for (const id of ids) trackedJobIds.delete(id);
}
