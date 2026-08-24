// tests/db/account-deletion-cascade.test.mjs
//
// Regression coverage for the production account-deletion defect fixed by
// supabase/migrations/20260824170000_fix_job_preferences_account_deletion_cascade.sql.
//
// Root cause: bump_job_preferences_version_for_child() — an AFTER INSERT OR
// DELETE trigger on job_preference_target_roles/job_preference_locations —
// UPDATEd the parent job_preferences row on every child-row change. When
// auth.users is deleted, Postgres cascades the single DELETE statement
// through job_preferences to its child join rows in the same statement; the
// child rows' AFTER DELETE trigger then tried to UPDATE the parent row the
// same statement was already deleting, which Postgres rejected with "tuple
// to be updated was already modified by an operation triggered by the
// current command." GoTrue surfaced that as an opaque 500
// (AuthRetryableFetchError). The fix removes those child triggers entirely —
// save_job_preferences already bumps job_preferences.version exactly once
// per logical save via selection_version (20260818090000), making the child
// triggers both redundant and, during cascade deletion, actively broken.
//
// Every test below calls adminClient.auth.admin.deleteUser() DIRECTLY, with
// no pre-deletion of job_preferences children — unlike
// tests/db/fixtureCleanup.mjs's deleteFixtureUsers, which still deliberately
// deletes children first as a general-purpose test-fixture safety net (see
// Part 6 reconciliation note there). Proving the fix means proving the raw
// admin API call itself no longer needs that workaround.
//
// Run: node --test tests/db/account-deletion-cascade.test.mjs
// (requires a running local Supabase project with all migrations applied,
// including 20260824170000)
//
// Storage lifecycle (Part 4 finding, verified empirically below): Supabase
// Storage objects are NOT linked to auth.users by a database foreign key —
// admin.auth.admin.deleteUser() removes only the auth user and every DB-owned
// row (via the cascade this migration fixes); any storage.objects rows under
// that user's "{uid}/..." folder are left behind untouched. A future
// production Delete Account flow must therefore call auth.admin.deleteUser()
// FIRST (so a transient Storage failure never leaves an active user with no
// CV — see Part 4 of the mission brief for the exact unsafe sequence to
// avoid), then explicitly remove that user's Storage objects as a second,
// idempotent, retryable step scoped to exactly that user's own folder —
// mirroring the pattern tests/db/fixtureCleanup.mjs already uses for fixture
// cleanup (see removeStorageForUser there), just in the opposite order for
// production safety. Every test below that uploads a CV performs this same
// two-step cleanup explicitly (deleteStorageForUser, called AFTER the
// deleteUserDirect + DB-cascade assertions) so no fixture Storage object is
// ever left behind.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  uploadFakeCv,
  insertFakeAnalysis,
  insertFakeJob,
  deleteFakeJobs,
} from "./helpers.mjs";

// ── Shared fixtures (reference data only, read-only) ─────────────────────────

let roleSlugs; // >= 2 active target_roles slugs
let locationSlugs; // >= 2 active locations slugs
const jobIdsToClean = [];

before(async () => {
  await assertExpectedLocalProject();

  const [rolesResult, locsResult] = await Promise.all([
    adminClient.from("target_roles").select("slug").eq("is_active", true).limit(2),
    adminClient.from("locations").select("slug").eq("is_active", true).limit(2),
  ]);
  assert.ok(rolesResult.data && rolesResult.data.length >= 2, "Need >= 2 active target_roles");
  assert.ok(locsResult.data && locsResult.data.length >= 2, "Need >= 2 active locations");
  roleSlugs = rolesResult.data.map((r) => r.slug);
  locationSlugs = locsResult.data.map((l) => l.slug);
});

after(async () => {
  await deleteFakeJobs(jobIdsToClean);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function savePrefs(userClient, overrides = {}) {
  const defaults = {
    p_work_arrangement: "remote",
    p_job_market_coverage: null,
    p_job_type: "full-time",
    p_experience_level: "junior",
    p_additional_notes: null,
    p_custom_target_roles: [],
    p_custom_locations: [],
    p_target_role_ids: [],
    p_location_ids: [],
  };
  const { data, error } = await userClient.rpc("save_job_preferences", { ...defaults, ...overrides });
  assert.equal(error, null, `save_job_preferences failed: ${error?.message}`);
  return data;
}

// Deletes the user directly via the real Supabase Admin API — the exact
// call the reported production defect broke. No child-row pre-deletion.
async function deleteUserDirect(userId) {
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  return error;
}

async function countRows(table, column, value, selectColumn = "id") {
  const { count, error } = await adminClient
    .from(table)
    .select(selectColumn, { count: "exact", head: true })
    .eq(column, value);
  assert.equal(error, null, `count ${table} failed: ${error?.message}`);
  return count ?? 0;
}

// Scoped to exactly this user's own "{uid}/..." Storage folder — never a
// prefix that could reach another user's objects. Idempotent (a no-op if
// already empty), and verifies its own result rather than trusting the
// remove() call blindly. See the Storage-lifecycle note at the top of this
// file: admin.deleteUser() never does this on its own.
async function deleteStorageForUser(userId) {
  const { data: objects, error: listError } = await adminClient.storage.from("cvs").list(userId);
  assert.equal(listError, null, `storage list failed for ${userId}: ${listError?.message}`);
  if (objects && objects.length > 0) {
    const { error: removeError } = await adminClient.storage.from("cvs").remove(objects.map((o) => `${userId}/${o.name}`));
    assert.equal(removeError, null, `storage cleanup failed for ${userId}: ${removeError?.message}`);
  }
  const { data: verify } = await adminClient.storage.from("cvs").list(userId);
  assert.ok(!verify || verify.length === 0, `storage objects must be fully cleaned up for ${userId}`);
}

// Verifies the auth user and every DB-owned row are gone. jobPreferenceId,
// when passed, lets the check confirm child join rows are gone even though
// job_preferences itself (and therefore its user_id) no longer exists.
async function assertUserFullyDeleted(userId, { jobPreferenceId } = {}) {
  const { data: authUser } = await adminClient.auth.admin.getUserById(userId);
  assert.equal(authUser?.user ?? null, null, "auth user must no longer exist");

  const { data: profile } = await adminClient.from("profiles").select("id").eq("id", userId).maybeSingle();
  assert.equal(profile, null, "profiles row must be gone");

  const tables = [
    "cvs",
    "job_preferences",
    "subscriptions",
    "analysis_tasks",
    "cv_analyses",
    "analysis_feedback",
    "matches",
    "applications",
    "cover_letters",
    "notifications",
    "payment_attempts",
    "rate_limit_events",
  ];
  for (const table of tables) {
    const count = await countRows(table, "user_id", userId);
    assert.equal(count, 0, `${table} must have zero rows for deleted user (got ${count})`);
  }

  if (jobPreferenceId) {
    const [roles, locations] = await Promise.all([
      countRows("job_preference_target_roles", "job_preference_id", jobPreferenceId, "target_role_id"),
      countRows("job_preference_locations", "job_preference_id", jobPreferenceId, "location_id"),
    ]);
    assert.equal(roles, 0, "job_preference_target_roles children must be gone");
    assert.equal(locations, 0, "job_preference_locations children must be gone");
  }
}

async function fingerprintUser(userId) {
  const [profile, cvs, prefs, subs, tasks, analyses] = await Promise.all([
    adminClient.from("profiles").select("*").eq("id", userId).maybeSingle(),
    adminClient.from("cvs").select("*").eq("user_id", userId).order("id"),
    adminClient.from("job_preferences").select("*").eq("user_id", userId).maybeSingle(),
    adminClient.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
    adminClient.from("analysis_tasks").select("*").eq("user_id", userId).order("id"),
    adminClient.from("cv_analyses").select("*").eq("user_id", userId).order("id"),
  ]);
  let children = { roles: [], locations: [] };
  if (prefs.data?.id) {
    const [roles, locations] = await Promise.all([
      adminClient.from("job_preference_target_roles").select("target_role_id").eq("job_preference_id", prefs.data.id).order("target_role_id"),
      adminClient.from("job_preference_locations").select("location_id").eq("job_preference_id", prefs.data.id).order("location_id"),
    ]);
    children = {
      roles: (roles.data ?? []).map((r) => r.target_role_id),
      locations: (locations.data ?? []).map((l) => l.location_id),
    };
  }
  const payload = { profile: profile.data, cvs: cvs.data, prefs: prefs.data, children, subs: subs.data, tasks: tasks.data, analyses: analyses.data };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// ── Scenario 1 & 10: new user, profile/subscription only, incomplete onboarding ──

describe("Scenario: new user with only profile/subscription (incomplete onboarding)", () => {
  test("admin.deleteUser succeeds directly and cascades fully; repeated call is idempotent", async () => {
    const user = await createTestUser("del-minimal");

    const { data: readiness } = await user.client.rpc("get_onboarding_readiness");
    assert.notEqual(readiness.next_step, "dashboard", "a brand-new user must not already read as onboarding-complete");

    const err = await deleteUserDirect(user.id);
    assert.equal(err, null, `admin.deleteUser must succeed for a minimal user: ${err?.message}`);
    await assertUserFullyDeleted(user.id);

    // Repeated deletion request: must not resurrect the original bug (no
    // opaque 500) — either a clean success or a "not found"-shaped error.
    const err2 = await deleteUserDirect(user.id);
    if (err2) {
      assert.match(err2.message, /not.?found/i, `repeated deleteUser must fail cleanly (not.?found), got: ${err2.message}`);
    }
  });
});

// ── Scenario 2: CV but no preferences ─────────────────────────────────────────

describe("Scenario: user with a CV but no saved preferences", () => {
  test("admin.deleteUser succeeds, removes the CV row, but (empirically) leaves the storage object — cleaned up explicitly", async () => {
    const user = await createTestUser("del-cv-only");
    const cv = await uploadFakeCv(user, "cv-only.pdf");

    const { data: before } = await adminClient.storage.from("cvs").list(user.id);
    assert.ok(before && before.length >= 1, "fixture CV must exist in storage before deletion");

    const err = await deleteUserDirect(user.id);
    assert.equal(err, null, `admin.deleteUser must succeed with a CV and no preferences: ${err?.message}`);
    await assertUserFullyDeleted(user.id);

    const { data: cvRow } = await adminClient.from("cvs").select("id").eq("id", cv.id).maybeSingle();
    assert.equal(cvRow, null, "cvs row must be gone");

    // Empirical Part 4 finding: admin.deleteUser() does NOT cascade to
    // Storage — the object from storage.objects survives the auth user it
    // belonged to. A future Delete Account flow must remove it explicitly
    // (see the Storage-lifecycle note at the top of this file).
    const { data: afterAuthDelete } = await adminClient.storage.from("cvs").list(user.id);
    assert.ok(
      afterAuthDelete && afterAuthDelete.length >= 1,
      "documents empirically that admin.deleteUser() leaves Storage objects behind — Storage cleanup must be a separate explicit step"
    );

    await deleteStorageForUser(user.id);
  });
});

// ── Scenario 3 & custom roles/locations: preferences with no reference child rows ──

describe("Scenario: preferences saved with only custom (free-text) roles/locations", () => {
  test("admin.deleteUser succeeds when job_preferences exists with zero reference child rows", async () => {
    const user = await createTestUser("del-prefs-custom");
    const prefs = await savePrefs(user.client, {
      p_custom_target_roles: ["Custom Fixture Role"],
      p_custom_locations: [],
      p_target_role_ids: [],
      p_location_ids: [],
    });
    assert.equal(prefs.custom_target_roles?.length, 1);

    const err = await deleteUserDirect(user.id);
    assert.equal(err, null, `admin.deleteUser must succeed with custom-only preferences: ${err?.message}`);
    await assertUserFullyDeleted(user.id, { jobPreferenceId: prefs.id });
  });
});

// ── Scenario 4 & 5: one / multiple reference target roles (the reported bug) ──

describe("Scenario: preferences with reference target-role child rows (reported bug)", () => {
  test("one target role: admin.deleteUser succeeds without the trigger self-conflict", async () => {
    const user = await createTestUser("del-one-role");
    const prefs = await savePrefs(user.client, { p_target_role_ids: [roleSlugs[0]] });

    const roleCountBefore = await countRows("job_preference_target_roles", "job_preference_id", prefs.id, "target_role_id");
    assert.equal(roleCountBefore, 1);

    const err = await deleteUserDirect(user.id);
    assert.equal(
      err,
      null,
      `admin.deleteUser must succeed for a user with one reference target role (reported defect): ${err?.message}`
    );
    await assertUserFullyDeleted(user.id, { jobPreferenceId: prefs.id });
  });

  test("multiple target roles: admin.deleteUser succeeds without the trigger self-conflict", async () => {
    const user = await createTestUser("del-multi-role");
    const prefs = await savePrefs(user.client, { p_target_role_ids: [...roleSlugs] });

    const roleCountBefore = await countRows("job_preference_target_roles", "job_preference_id", prefs.id, "target_role_id");
    assert.equal(roleCountBefore, roleSlugs.length);

    const err = await deleteUserDirect(user.id);
    assert.equal(err, null, `admin.deleteUser must succeed for a user with multiple reference target roles: ${err?.message}`);
    await assertUserFullyDeleted(user.id, { jobPreferenceId: prefs.id });
  });
});

// ── Scenario 6, 7, 8 & complete onboarding: locations, and roles+locations together ──

describe("Scenario: preferences with reference location child rows", () => {
  test("one location (onsite): admin.deleteUser succeeds", async () => {
    const user = await createTestUser("del-one-loc");
    const prefs = await savePrefs(user.client, {
      p_work_arrangement: "onsite",
      p_target_role_ids: [roleSlugs[0]],
      p_location_ids: [locationSlugs[0]],
    });

    const locCountBefore = await countRows("job_preference_locations", "job_preference_id", prefs.id, "location_id");
    assert.equal(locCountBefore, 1);

    const err = await deleteUserDirect(user.id);
    assert.equal(err, null, `admin.deleteUser must succeed for a user with one reference location: ${err?.message}`);
    await assertUserFullyDeleted(user.id, { jobPreferenceId: prefs.id });
  });

  test("multiple locations + multiple roles + complete onboarding: admin.deleteUser succeeds", async () => {
    const user = await createTestUser("del-multi-loc");
    await uploadFakeCv(user, "complete-onboarding.pdf");

    // Complete every field get_onboarding_readiness checks besides prefs.
    const { error: profileErr } = await adminClient
      .from("profiles")
      .update({
        country_of_residence: "LB",
        university_id: null,
        custom_university: "Fixture University",
        major_id: null,
        custom_major: "Fixture Major",
      })
      .eq("id", user.id);
    assert.equal(profileErr, null, `profile completion update failed: ${profileErr?.message}`);

    const prefs = await savePrefs(user.client, {
      p_work_arrangement: "flexible",
      p_target_role_ids: [...roleSlugs],
      p_location_ids: [...locationSlugs],
    });

    const { data: readiness } = await user.client.rpc("get_onboarding_readiness");
    assert.equal(readiness.next_step, "dashboard", "onboarding must read as complete before deletion");

    const [roleCount, locCount] = await Promise.all([
      countRows("job_preference_target_roles", "job_preference_id", prefs.id, "target_role_id"),
      countRows("job_preference_locations", "job_preference_id", prefs.id, "location_id"),
    ]);
    assert.equal(roleCount, roleSlugs.length);
    assert.equal(locCount, locationSlugs.length);

    const err = await deleteUserDirect(user.id);
    assert.equal(
      err,
      null,
      `admin.deleteUser must succeed for a fully onboarded user with roles AND locations: ${err?.message}`
    );
    await assertUserFullyDeleted(user.id, { jobPreferenceId: prefs.id });
    await deleteStorageForUser(user.id);
  });
});

// ── Scenario 9, 13, 14: replaced CV (superseded), pending task, storage lifecycle ──

describe("Scenario: replaced/superseded CV with a pending analysis task", () => {
  test("admin.deleteUser removes both CV database rows and the pending task; storage objects need the explicit cleanup step", async () => {
    const user = await createTestUser("del-replaced-cv");
    const firstCv = await uploadFakeCv(user, "first.pdf");
    const secondCv = await uploadFakeCv(user, "second.pdf"); // supersedes first; auto-creates a cv_replaced task

    const { data: cvsBefore } = await adminClient
      .from("cvs")
      .select("id, is_active, superseded_at")
      .eq("user_id", user.id)
      .order("version");
    assert.equal(cvsBefore.length, 2, "both CV versions must exist before deletion");
    assert.equal(cvsBefore.find((c) => c.id === firstCv.id).is_active, false);
    assert.notEqual(cvsBefore.find((c) => c.id === firstCv.id).superseded_at, null);
    assert.equal(cvsBefore.find((c) => c.id === secondCv.id).is_active, true);

    const { data: tasksBefore } = await adminClient
      .from("analysis_tasks")
      .select("id, status, trigger")
      .eq("user_id", user.id);
    assert.ok(
      tasksBefore.some((t) => t.trigger === "cv_replaced" && t.status === "pending"),
      "replacing the CV must leave a pending cv_replaced task"
    );

    const { data: storageBefore } = await adminClient.storage.from("cvs").list(user.id);
    assert.equal(storageBefore.length, 2, "both CV storage objects must exist before deletion");

    const err = await deleteUserDirect(user.id);
    assert.equal(err, null, `admin.deleteUser must succeed with a pending task and a superseded CV: ${err?.message}`);
    await assertUserFullyDeleted(user.id);

    const { data: cvsAfter } = await adminClient.from("cvs").select("id").eq("user_id", user.id);
    assert.equal(cvsAfter.length, 0, "both cvs rows must be gone from the database");

    const { data: storageAfterAuthDelete } = await adminClient.storage.from("cvs").list(user.id);
    assert.equal(storageAfterAuthDelete.length, 2, "both storage objects (active + superseded) survive admin.deleteUser alone");

    await deleteStorageForUser(user.id);
  });
});

// ── Scenario 12: completed analysis + feedback ────────────────────────────────

describe("Scenario: completed, approved analysis with feedback", () => {
  test("admin.deleteUser removes the analysis and its feedback row", async () => {
    const user = await createTestUser("del-analysis-fb");
    const cv = await uploadFakeCv(user, "analysis-fb.pdf");
    const analysis = await insertFakeAnalysis(user, cv.id, {
      status: "completed",
      review_status: "approved",
      is_current: true,
      recommendations_state: "current",
    });
    const { data: confirmed, error: confirmErr } = await user.client.rpc("confirm_cv_analysis", {
      p_analysis_id: analysis.id,
    });
    assert.equal(confirmErr, null, `confirm_cv_analysis failed: ${confirmErr?.message}`);

    const { data: feedback, error: fbErr } = await user.client.rpc("submit_analysis_feedback", {
      p_analysis_id: confirmed.id,
      p_feedback_type: "recommendation_feedback",
      p_feedback_text: "Please weight remote roles higher in future recommendations.",
    });
    assert.equal(fbErr, null, `submit_analysis_feedback failed: ${fbErr?.message}`);
    assert.notEqual(feedback, null);

    const err = await deleteUserDirect(user.id);
    assert.equal(err, null, `admin.deleteUser must succeed with a completed analysis and feedback: ${err?.message}`);
    await assertUserFullyDeleted(user.id);

    const { data: analysisRow } = await adminClient.from("cv_analyses").select("id").eq("id", confirmed.id).maybeSingle();
    assert.equal(analysisRow, null, "cv_analyses row must be gone");
    const { data: feedbackRow } = await adminClient.from("analysis_feedback").select("id").eq("id", feedback.id).maybeSingle();
    assert.equal(feedbackRow, null, "analysis_feedback row must be gone");

    await deleteStorageForUser(user.id);
  });
});

// ── Scenario 15: match / cover letter / application / notification / payment ──

describe("Scenario: full downstream graph (match, cover letter, application, notification, payment attempt)", () => {
  test("admin.deleteUser cascades every owned row but leaves the shared job row intact", async () => {
    const user = await createTestUser("del-full-graph");
    const cv = await uploadFakeCv(user, "full-graph.pdf");
    const analysis = await insertFakeAnalysis(user, cv.id);
    const { data: approvedAnalysis } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });

    const job = await insertFakeJob({ title: "Full-graph fixture job" });
    jobIdsToClean.push(job.id);

    const { data: match, error: matchErr } = await adminClient
      .from("matches")
      .insert({ user_id: user.id, job_id: job.id, cv_analysis_id: approvedAnalysis.id, score: 88 })
      .select()
      .single();
    assert.equal(matchErr, null, `insert match failed: ${matchErr?.message}`);

    const { error: approveErr } = await user.client.rpc("approve_match", { p_match_id: match.id });
    assert.equal(approveErr, null, `approve_match failed: ${approveErr?.message}`);

    const { data: coverLetter, error: clErr } = await adminClient
      .from("cover_letters")
      .insert({ user_id: user.id, match_id: match.id, generated_content: "Dear hiring manager, ...", generation_status: "completed" })
      .select()
      .single();
    assert.equal(clErr, null, `insert cover_letter failed: ${clErr?.message}`);

    const { data: application, error: appErr } = await user.client.rpc("create_application", { p_match_id: match.id });
    assert.equal(appErr, null, `create_application failed: ${appErr?.message}`);

    const { data: notification, error: notifErr } = await adminClient
      .from("notifications")
      .insert({ user_id: user.id, notification_type: "match_ready" })
      .select()
      .single();
    assert.equal(notifErr, null, `insert notification failed: ${notifErr?.message}`);

    const { data: paymentAttempt, error: payErr } = await user.client.rpc("create_payment_attempt", {
      p_plan_code: "pro",
    });
    assert.equal(payErr, null, `create_payment_attempt failed: ${payErr?.message}`);

    // Sanity: everything exists before deletion.
    assert.ok(match?.id && coverLetter?.id && application?.id && notification?.id && paymentAttempt?.id);

    const err = await deleteUserDirect(user.id);
    assert.equal(err, null, `admin.deleteUser must succeed with the full downstream graph populated: ${err?.message}`);
    await assertUserFullyDeleted(user.id);

    // The job itself is NOT user-owned data — jobs.created_by is `on delete
    // set null`, and this job's created_by was never this user anyway (it
    // was inserted directly via the admin client). It must survive.
    const { data: jobRow } = await adminClient.from("jobs").select("id").eq("id", job.id).maybeSingle();
    assert.notEqual(jobRow, null, "an unrelated jobs row must never be deleted as a side effect of user deletion");

    await deleteStorageForUser(user.id);
  });
});

// ── Scenario: two isolated users — deleting A must leave B byte-for-byte unchanged ──

describe("Scenario: isolated users — deleting one must not affect the other", () => {
  test("deleting user A leaves user B's rows unchanged", async () => {
    const userA = await createTestUser("del-iso-a");
    const userB = await createTestUser("del-iso-b");

    await uploadFakeCv(userA, "iso-a.pdf");
    await uploadFakeCv(userB, "iso-b.pdf");
    const prefsA = await savePrefs(userA.client, { p_target_role_ids: [roleSlugs[0]] });
    await savePrefs(userB.client, { p_target_role_ids: [...roleSlugs], p_work_arrangement: "onsite", p_location_ids: [...locationSlugs] });

    const hashBBefore = await fingerprintUser(userB.id);

    const err = await deleteUserDirect(userA.id);
    assert.equal(err, null, `admin.deleteUser for user A must succeed: ${err?.message}`);
    await assertUserFullyDeleted(userA.id, { jobPreferenceId: prefsA.id });

    // User A's storage folder is untouched by admin.deleteUser (see the
    // Storage-lifecycle note at the top of this file) — clean it up
    // explicitly, and confirm doing so never reaches into user B's folder.
    await deleteStorageForUser(userA.id);
    const { data: userBStorageStillIntact } = await adminClient.storage.from("cvs").list(userB.id);
    assert.ok(userBStorageStillIntact && userBStorageStillIntact.length >= 1, "user B's own storage object must be untouched");

    const { data: authB } = await adminClient.auth.admin.getUserById(userB.id);
    assert.notEqual(authB?.user, null, "user B must still exist after user A is deleted");

    const hashBAfter = await fingerprintUser(userB.id);
    assert.equal(hashBAfter, hashBBefore, "user B's data must be byte-for-byte unchanged by user A's deletion");

    const errB = await deleteUserDirect(userB.id);
    assert.equal(errB, null, `admin.deleteUser for user B must succeed: ${errB?.message}`);
    await assertUserFullyDeleted(userB.id);
    await deleteStorageForUser(userB.id);
  });
});
