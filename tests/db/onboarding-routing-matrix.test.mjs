// DB integration tests for the post-auth routing matrix required by the
// "existing user incorrectly redirected to /onboarding/upload-cv" fix.
// get_onboarding_readiness() is the single authoritative source both
// src/app/auth/callback/route.ts (Google OAuth) and src/app/api/auth/
// login/route.ts (email/password) resolve their destination from via
// src/lib/entitlements/postAuthDestination.ts — this file proves the RPC
// itself returns the correct next_step for every state in that matrix, and
// that repeatedly calling it (simulating repeated sign-in/sign-out or a
// replayed OAuth callback) never mutates or duplicates any row.
//
// Complements (does not duplicate):
//   - tests/db/auth-new-user-triggers.test.mjs — State A (brand-new user).
//   - tests/db/onboarding-readiness-and-task-supersession.test.mjs —
//     multi-CV-row resolution correctness.
//   - tests/db/preferences-location-validation.test.mjs — preferences_complete
//     edge cases around the flexible/onsite/hybrid location requirement.
//
// Run: node --test tests/db/onboarding-routing-matrix.test.mjs

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
  uploadFakeCv,
  insertFakeAnalysis,
} from "./helpers.mjs";

let user;
let roleSlug;

before(async () => {
  await assertExpectedLocalProject();
  user = await createTestUser("routing-matrix");

  const { data: roleRows } = await adminClient
    .from("target_roles")
    .select("slug")
    .eq("is_active", true)
    .limit(1);
  assert.ok(roleRows && roleRows.length > 0, "Need at least 1 active target_roles row to run these tests");
  roleSlug = roleRows[0].slug;
});

after(async () => {
  await deleteTestUsers([user]);
});

async function readiness() {
  const { data, error } = await user.client.rpc("get_onboarding_readiness");
  assert.equal(error, null, `get_onboarding_readiness error: ${error?.message}`);
  return data;
}

describe("State A — no active CV", () => {
  test("next_step is upload_cv before any CV is uploaded", async () => {
    const r = await readiness();
    assert.equal(r.has_cv, false);
    assert.equal(r.next_step, "upload_cv");
  });
});

describe("State B — active CV, preferences incomplete", () => {
  test("next_step is preferences once a CV exists but no preferences row does", async () => {
    await uploadFakeCv(user, "state-b.pdf");
    const r = await readiness();
    assert.equal(r.has_cv, true);
    assert.equal(r.cv_storage_object_exists, true);
    assert.equal(r.has_preferences, false);
    assert.equal(r.preferences_complete, false);
    assert.equal(r.next_step, "preferences", "must route to preferences, never back to upload_cv");
  });
});

describe("State C — active CV and complete preferences (every analysis state)", () => {
  before(async () => {
    await adminClient
      .from("profiles")
      .update({
        country_of_residence: "LB",
        custom_university: "Test University",
        custom_major: "Computer Science",
      })
      .eq("id", user.id);

    const { error } = await user.client.rpc("save_job_preferences", {
      p_work_arrangement: "remote",
      p_job_market_coverage: null,
      p_job_type: "full-time",
      p_experience_level: "junior",
      p_additional_notes: null,
      p_custom_target_roles: [],
      p_custom_locations: [],
      p_target_role_ids: [roleSlug],
      p_location_ids: [],
      p_lebanon_location_scope: "selected_only",
    });
    assert.equal(error, null, `save_job_preferences failed: ${error?.message}`);
  });

  test("next_step is dashboard once preferences are complete", async () => {
    const r = await readiness();
    assert.equal(r.preferences_complete, true);
    assert.equal(r.next_step, "dashboard");
    assert.equal(r.onboarding_complete, true);
  });

  test("next_step stays dashboard — never upload_cv or preferences — with a pending analysis task", async () => {
    const { data: cv } = await adminClient
      .from("cvs")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();
    const { error } = await adminClient.rpc("create_analysis_task", {
      p_user_id: user.id,
      p_cv_id: cv.id,
      p_trigger: "onboarding_completed",
    });
    assert.equal(error, null);

    const r = await readiness();
    assert.equal(r.has_active_analysis_task, true);
    assert.equal(r.next_step, "dashboard");
  });

  test("next_step stays dashboard while the task is processing", async () => {
    await adminClient.from("analysis_tasks").update({ status: "processing" }).eq("user_id", user.id);
    const r = await readiness();
    assert.equal(r.has_active_analysis_task, true);
    assert.equal(r.next_step, "dashboard");
  });

  test("next_step stays dashboard once the analysis completes (pending review)", async () => {
    const { data: cv } = await adminClient
      .from("cvs")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();
    await adminClient
      .from("analysis_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("user_id", user.id);
    await insertFakeAnalysis(user, cv.id, { review_status: "pending_review" });

    const r = await readiness();
    assert.equal(r.has_active_analysis_task, false, "a completed task is no longer active");
    assert.equal(r.next_step, "dashboard");
  });

  test("next_step stays dashboard for a failed analysis", async () => {
    await adminClient.from("cv_analyses").delete().eq("user_id", user.id);
    await adminClient
      .from("analysis_tasks")
      .update({ status: "failed", last_error: "worker_crash" })
      .eq("user_id", user.id);

    const r = await readiness();
    assert.equal(r.next_step, "dashboard");
  });

  test("next_step stays dashboard for an ownership-mismatch failure", async () => {
    await adminClient
      .from("analysis_tasks")
      .update({ status: "failed", last_error: "OWNERSHIP_MISMATCH: name does not match" })
      .eq("user_id", user.id);

    const r = await readiness();
    assert.equal(r.next_step, "dashboard");
  });

  test("next_step stays dashboard for changes_requested review status", async () => {
    const { data: cv } = await adminClient
      .from("cvs")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();
    await insertFakeAnalysis(user, cv.id, { review_status: "changes_requested" });

    const r = await readiness();
    assert.equal(r.next_step, "dashboard");
  });
});

describe("State D — active CV and complete preferences, no analysis row at all", () => {
  test("next_step is dashboard even with zero analysis_tasks/cv_analyses rows", async () => {
    await adminClient.from("cv_analyses").delete().eq("user_id", user.id);
    await adminClient.from("analysis_tasks").delete().eq("user_id", user.id);

    const r = await readiness();
    assert.equal(r.has_active_analysis_task, false);
    assert.equal(r.next_step, "dashboard", "a missing analysis row must never send a fully onboarded user back to onboarding");
  });
});

describe("State E — repeated sign-in never mutates or duplicates state", () => {
  test("calling get_onboarding_readiness repeatedly returns byte-identical results and creates no rows", async () => {
    const [profilesBefore, cvsBefore, prefsBefore, subsBefore] = await Promise.all([
      adminClient.from("profiles").select("id").eq("id", user.id),
      adminClient.from("cvs").select("id").eq("user_id", user.id),
      adminClient.from("job_preferences").select("id").eq("user_id", user.id),
      adminClient.from("subscriptions").select("id").eq("user_id", user.id),
    ]);

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await readiness());
    }
    for (const r of results) {
      assert.deepEqual(r, results[0], "repeated calls (simulating repeated sign-in/sign-out) must be fully deterministic");
    }

    const [profilesAfter, cvsAfter, prefsAfter, subsAfter] = await Promise.all([
      adminClient.from("profiles").select("id").eq("id", user.id),
      adminClient.from("cvs").select("id").eq("user_id", user.id),
      adminClient.from("job_preferences").select("id").eq("user_id", user.id),
      adminClient.from("subscriptions").select("id").eq("user_id", user.id),
    ]);

    assert.equal(profilesAfter.data.length, profilesBefore.data.length, "profiles row count must not change");
    assert.equal(cvsAfter.data.length, cvsBefore.data.length, "cvs row count must not change");
    assert.equal(prefsAfter.data.length, prefsBefore.data.length, "job_preferences row count must not change");
    assert.equal(subsAfter.data.length, subsBefore.data.length, "subscriptions row count must not change");
    assert.equal(profilesBefore.data.length, 1);
    assert.equal(cvsBefore.data.length, 1, "exactly one active CV — repeated reads never create a new one");
    assert.equal(prefsBefore.data.length, 1);
    assert.equal(subsBefore.data.length, 1);
  });

  test("repeated admin sign-in (mirrors sign-out/sign-in cycles) never creates a second profile or subscription", async () => {
    for (let i = 0; i < 3; i++) {
      const { error } = await adminClient.auth.admin.updateUserById(user.id, {
        // No-op update — the point is to exercise auth.users without ever
        // inserting a new row (the trigger only fires on INSERT).
        email_confirm: true,
      });
      assert.equal(error, null);
    }

    const { data: profiles } = await adminClient.from("profiles").select("id").eq("id", user.id);
    const { data: subs } = await adminClient.from("subscriptions").select("id").eq("user_id", user.id);
    assert.equal(profiles.length, 1);
    assert.equal(subs.length, 1);
  });
});
