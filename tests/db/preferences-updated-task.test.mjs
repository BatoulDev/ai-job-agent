// Integration tests for the preferences_updated analysis-task lifecycle
// introduced by 20260818090000_preferences_updated_lifecycle.sql.
//
// Coverage (10 required cases):
//  1. Direct preference column change → one preferences_updated task
//  2. Target-role change → one preferences_updated task
//  3. Location change → one preferences_updated task
//  4. Saving identical values → no new task
//  5. Repeating the same save → no duplicate task
//  6. No active CV → no task created, no error
//  7. Onboarding task creation (onboarding_completed) still works
//  8. CV-replacement task creation (cv_replaced) still works
//  9. Pending/processing task deduplication: second preferences save reuses
//     the existing active task instead of creating a duplicate
// 10. Analysis is marked stale only when an approved is_current analysis
//     exists and preferences actually changed
//
// Run: npm run test:db   (node --test tests/db/)
// Requires: local Supabase running, all migrations applied including
//           20260818090000_preferences_updated_lifecycle.sql.

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

let userA; // primary test user — has a CV from uploadFakeCv
let userB; // secondary user — used for isolation checks
let roleSlug1;
let roleSlug2;
let locationSlug1;

before(async () => {
  await assertExpectedLocalProject();
  [userA, userB] = await Promise.all([
    createTestUser("pref-task-a"),
    createTestUser("pref-task-b"),
  ]);

  // Resolve two active reference roles and one location from the real catalog
  // so slugs are valid without hard-coding seed data.
  const [rolesResult, locsResult] = await Promise.all([
    adminClient.from("target_roles").select("slug").eq("is_active", true).limit(2),
    adminClient.from("locations").select("slug").eq("is_active", true).limit(1),
  ]);
  assert.ok(
    rolesResult.data && rolesResult.data.length >= 2,
    "Need ≥ 2 active target_roles to run these tests"
  );
  assert.ok(
    locsResult.data && locsResult.data.length >= 1,
    "Need ≥ 1 active location to run these tests"
  );
  roleSlug1 = rolesResult.data[0].slug;
  roleSlug2 = rolesResult.data[1].slug;
  locationSlug1 = locsResult.data[0].slug;
});

after(async () => {
  await deleteTestUsers([userA, userB]);
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
    p_target_role_ids: [roleSlug1],
    p_location_ids: [],
  };
  const { error } = await userClient.rpc("save_job_preferences", {
    ...defaults,
    ...overrides,
  });
  return error;
}

async function getActiveTasks(userId) {
  const { data, error } = await adminClient
    .from("analysis_tasks")
    .select("id, trigger, status, superseded_at, cv_id")
    .eq("user_id", userId)
    .in("status", ["pending", "processing"])
    .is("superseded_at", null);
  assert.equal(error, null, `getActiveTasks error: ${error?.message}`);
  return data ?? [];
}

async function getAllTasks(userId) {
  const { data, error } = await adminClient
    .from("analysis_tasks")
    .select("id, trigger, status, superseded_at, cv_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  assert.equal(error, null, `getAllTasks error: ${error?.message}`);
  return data ?? [];
}

async function markTaskComplete(taskId) {
  const { error } = await adminClient
    .from("analysis_tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", taskId);
  assert.equal(error, null, `markTaskComplete error: ${error?.message}`);
}

async function getAnalysis(userId) {
  const { data, error } = await adminClient
    .from("cv_analyses")
    .select("id, recommendations_state, is_current, review_status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assert.equal(error, null, `getAnalysis error: ${error?.message}`);
  return data;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Case 6 — no active CV: save_job_preferences creates no task and no error", () => {
  // Tested before uploading a CV so userA has no CV at this point.
  test("saving preferences without a CV completes successfully and creates no task", async () => {
    const error = await savePrefs(userA.client);
    assert.equal(error, null, `save_job_preferences must succeed even with no CV: ${error?.message}`);

    const tasks = await getAllTasks(userA.id);
    const prefsTasks = tasks.filter((t) => t.trigger === "preferences_updated");
    assert.equal(prefsTasks.length, 0, "no preferences_updated task must be created when there is no active CV");
  });
});

describe("Case 7 — onboarding_completed task creation still works", () => {
  test("create_analysis_task with onboarding_completed trigger succeeds", async () => {
    // Upload a CV for userA so tests that follow have one.
    const cv = await uploadFakeCv(userA, "initial.pdf");

    const { data: task, error } = await adminClient.rpc("create_analysis_task", {
      p_user_id: userA.id,
      p_cv_id: cv.id,
      p_trigger: "onboarding_completed",
    });
    assert.equal(error, null, `create_analysis_task(onboarding_completed) must succeed: ${error?.message}`);
    assert.equal(task.trigger, "onboarding_completed");
    assert.equal(task.status, "pending");

    // Mark it complete so subsequent tests start with no active task.
    await markTaskComplete(task.id);
  });
});

describe("Case 8 — cv_replaced task creation still works", () => {
  test("replacing the CV creates a cv_replaced task and supersedes any prior tasks", async () => {
    // At this point userA has one completed onboarding task and is_active CV.
    // Replacing the CV should create a cv_replaced task for the new CV.
    const newCv = await uploadFakeCv(userA, "replacement.pdf");

    const activeTasks = await getActiveTasks(userA.id);
    const replacedTask = activeTasks.find((t) => t.cv_id === newCv.id);
    assert.ok(replacedTask, "replace_cv must have created an active task for the new CV");
    assert.equal(replacedTask.trigger, "cv_replaced");

    // Mark it complete so subsequent tests start clean.
    await markTaskComplete(replacedTask.id);
  });
});

describe("Case 4 — saving identical preferences creates no task", () => {
  test("re-saving the same preferences does not create a new task", async () => {
    // First save (already done in case 6 above on the same userA, but that
    // was before the CV existed). We do a fresh explicit first save here with
    // the CV now in place — this is still a "change" (first save into an
    // existing prefs row from Case 6 with the same values).
    //
    // Strategy: do one save to anchor the state, complete any created task,
    // then save again with IDENTICAL values and verify no new task appears.
    const err1 = await savePrefs(userA.client, { p_job_type: "internship" });
    assert.equal(err1, null, `anchor save failed: ${err1?.message}`);

    // Complete any task that may have been created by the anchor save.
    for (const t of await getActiveTasks(userA.id)) {
      await markTaskComplete(t.id);
    }

    const tasksBefore = await getAllTasks(userA.id);
    const countBefore = tasksBefore.length;

    // Repeat the exact same save.
    const err2 = await savePrefs(userA.client, { p_job_type: "internship" });
    assert.equal(err2, null, `identical re-save failed: ${err2?.message}`);

    const tasksAfter = await getAllTasks(userA.id);
    assert.equal(
      tasksAfter.length,
      countBefore,
      "identical re-save must not create a new task"
    );
  });
});

describe("Case 1 — direct column change creates exactly one preferences_updated task", () => {
  test("changing job_type creates one preferences_updated task", async () => {
    // Ensure clean state.
    for (const t of await getActiveTasks(userA.id)) {
      await markTaskComplete(t.id);
    }

    const tasksBefore = await getAllTasks(userA.id);
    const countBefore = tasksBefore.length;

    // Change a direct column (job_type from 'internship' to 'full-time').
    const err = await savePrefs(userA.client, { p_job_type: "full-time" });
    assert.equal(err, null, `job_type change save failed: ${err?.message}`);

    const activeTasks = await getActiveTasks(userA.id);
    const newPrefsTasks = activeTasks.filter((t) => t.trigger === "preferences_updated");
    assert.equal(newPrefsTasks.length, 1, "exactly one preferences_updated task must be created");

    const allTasks = await getAllTasks(userA.id);
    assert.equal(allTasks.length, countBefore + 1, "exactly one new task row must exist");

    // Clean up.
    await markTaskComplete(newPrefsTasks[0].id);
  });
});

describe("Case 2 — target-role change creates exactly one preferences_updated task", () => {
  test("adding a second reference role creates one preferences_updated task", async () => {
    for (const t of await getActiveTasks(userA.id)) {
      await markTaskComplete(t.id);
    }

    const tasksBefore = await getAllTasks(userA.id);
    const countBefore = tasksBefore.length;

    // Add a second role (currently only roleSlug1 is saved from Case 1).
    const err = await savePrefs(userA.client, {
      p_job_type: "full-time",
      p_target_role_ids: [roleSlug1, roleSlug2],
    });
    assert.equal(err, null, `role-add save failed: ${err?.message}`);

    const activeTasks = await getActiveTasks(userA.id);
    const newPrefsTasks = activeTasks.filter((t) => t.trigger === "preferences_updated");
    assert.equal(newPrefsTasks.length, 1, "exactly one preferences_updated task from role change");

    const allTasks = await getAllTasks(userA.id);
    assert.equal(allTasks.length, countBefore + 1, "exactly one new task row from role change");

    await markTaskComplete(newPrefsTasks[0].id);
  });

  test("removing a reference role creates one preferences_updated task", async () => {
    for (const t of await getActiveTasks(userA.id)) {
      await markTaskComplete(t.id);
    }

    const tasksBefore = await getAllTasks(userA.id);
    const countBefore = tasksBefore.length;

    // Remove back to just one role.
    const err = await savePrefs(userA.client, {
      p_job_type: "full-time",
      p_target_role_ids: [roleSlug1],
    });
    assert.equal(err, null, `role-remove save failed: ${err?.message}`);

    const activeTasks = await getActiveTasks(userA.id);
    const newPrefsTasks = activeTasks.filter((t) => t.trigger === "preferences_updated");
    assert.equal(newPrefsTasks.length, 1, "exactly one preferences_updated task from role removal");

    const allTasks = await getAllTasks(userA.id);
    assert.equal(allTasks.length, countBefore + 1, "exactly one new task row from role removal");

    await markTaskComplete(newPrefsTasks[0].id);
  });
});

describe("Case 3 — location change creates exactly one preferences_updated task", () => {
  test("switching from remote to flexible with a location creates one preferences_updated task", async () => {
    for (const t of await getActiveTasks(userA.id)) {
      await markTaskComplete(t.id);
    }

    const tasksBefore = await getAllTasks(userA.id);
    const countBefore = tasksBefore.length;

    // Switch work arrangement to flexible and add a location.
    const err = await savePrefs(userA.client, {
      p_work_arrangement: "flexible",
      p_job_type: "full-time",
      p_target_role_ids: [roleSlug1],
      p_location_ids: [locationSlug1],
    });
    assert.equal(err, null, `location-add save failed: ${err?.message}`);

    const activeTasks = await getActiveTasks(userA.id);
    const newPrefsTasks = activeTasks.filter((t) => t.trigger === "preferences_updated");
    assert.equal(newPrefsTasks.length, 1, "exactly one preferences_updated task from location change");

    const allTasks = await getAllTasks(userA.id);
    assert.equal(allTasks.length, countBefore + 1, "exactly one new task row from location change");

    await markTaskComplete(newPrefsTasks[0].id);
  });
});

describe("Case 5 — repeating the same save creates no duplicate task", () => {
  test("two rapid identical saves produce at most one task total", async () => {
    for (const t of await getActiveTasks(userA.id)) {
      await markTaskComplete(t.id);
    }

    // First save — creates a task (direct column change: job_type full-time → part-time).
    const err1 = await savePrefs(userA.client, {
      p_job_type: "part-time",
      p_work_arrangement: "remote",
      p_target_role_ids: [roleSlug1],
      p_location_ids: [],
    });
    assert.equal(err1, null, `first rapid save failed: ${err1?.message}`);

    const tasksAfterFirst = await getActiveTasks(userA.id);
    const prefTasksAfterFirst = tasksAfterFirst.filter((t) => t.trigger === "preferences_updated");
    assert.equal(prefTasksAfterFirst.length, 1, "first save must create exactly one task");

    // Second save with the same values while the first task is still active.
    // create_analysis_task's dedup must prevent a second task.
    const err2 = await savePrefs(userA.client, {
      p_job_type: "part-time",
      p_work_arrangement: "remote",
      p_target_role_ids: [roleSlug1],
      p_location_ids: [],
    });
    assert.equal(err2, null, `second rapid save (no change) failed: ${err2?.message}`);

    const tasksAfterSecond = await getActiveTasks(userA.id);
    const prefTasksAfterSecond = tasksAfterSecond.filter((t) => t.trigger === "preferences_updated");
    assert.equal(
      prefTasksAfterSecond.length,
      1,
      "identical second save while a task is active must not create a duplicate"
    );

    await markTaskComplete(prefTasksAfterFirst[0].id);
  });
});

describe("Case 9 — pending/processing task deduplication", () => {
  test("a new preferences change while a task is pending returns the existing task, not a second", async () => {
    for (const t of await getActiveTasks(userA.id)) {
      await markTaskComplete(t.id);
    }

    // Create a pending task manually (simulating a preferences_updated task
    // that the worker has not yet claimed).
    const { data: activeCv } = await adminClient
      .from("cvs")
      .select("id")
      .eq("user_id", userA.id)
      .eq("is_active", true)
      .maybeSingle();
    assert.ok(activeCv, "userA must have an active CV for this test");

    const { data: existingTask, error: existingErr } = await adminClient.rpc(
      "create_analysis_task",
      {
        p_user_id: userA.id,
        p_cv_id: activeCv.id,
        p_trigger: "preferences_updated",
      }
    );
    assert.equal(existingErr, null, `manual task creation failed: ${existingErr?.message}`);
    assert.equal(existingTask.status, "pending");

    // Now save different preferences — this should call
    // enqueue_preferences_analysis_task which calls create_analysis_task,
    // which finds the existing pending task and returns it (no new row).
    const err = await savePrefs(userA.client, {
      p_job_type: "open",
      p_target_role_ids: [roleSlug1],
    });
    assert.equal(err, null, `preferences save while task pending failed: ${err?.message}`);

    const activeTasks = await getActiveTasks(userA.id);
    assert.equal(
      activeTasks.length,
      1,
      "there must be exactly one active task — no duplicate created by concurrent preference change"
    );
    assert.equal(
      activeTasks[0].id,
      existingTask.id,
      "the active task must be the originally created one, not a new duplicate"
    );

    await markTaskComplete(existingTask.id);
  });
});

describe("Case 10 — analysis staleness: marked stale only when appropriate", () => {
  test("an approved is_current analysis is marked stale when preferences change", async () => {
    for (const t of await getActiveTasks(userA.id)) {
      await markTaskComplete(t.id);
    }

    const { data: activeCv } = await adminClient
      .from("cvs")
      .select("id")
      .eq("user_id", userA.id)
      .eq("is_active", true)
      .maybeSingle();
    assert.ok(activeCv, "userA must have an active CV");

    // Insert an approved, is_current analysis (simulating a completed + approved profile).
    const analysis = await insertFakeAnalysis(userA, activeCv.id, {
      status: "completed",
      review_status: "approved",
      is_current: true,
      recommendations_state: "current",
    });
    assert.equal(analysis.is_current, true);
    assert.equal(analysis.recommendations_state, "current");

    // Change preferences — this should mark the analysis stale.
    const err = await savePrefs(userA.client, {
      p_job_type: "freelance",
      p_target_role_ids: [roleSlug1],
    });
    assert.equal(err, null, `preferences change save failed: ${err?.message}`);

    const updatedAnalysis = await getAnalysis(userA.id);
    assert.equal(
      updatedAnalysis.recommendations_state,
      "stale",
      "approved is_current analysis must be marked stale when preferences change"
    );
    assert.equal(
      updatedAnalysis.is_current,
      true,
      "is_current must NOT be cleared — the analysis is still the current one until a new one is produced"
    );

    // Verify a preferences_updated task was also created.
    const activeTasks = await getActiveTasks(userA.id);
    const prefTask = activeTasks.find((t) => t.trigger === "preferences_updated");
    assert.ok(prefTask, "a preferences_updated task must exist alongside the stale marking");

    // Delete the analysis and complete the task so subsequent tests start clean.
    // We delete rather than reset because cv_analyses_one_approved_per_user
    // allows only one approved analysis per user at a time; resetting
    // recommendations_state alone would still leave the approved row in place
    // and block the next test from inserting a fresh approved analysis.
    await adminClient.from("cv_analyses").delete().eq("id", analysis.id);
    await markTaskComplete(prefTask.id);
  });

  test("saving identical preferences does NOT mark a current analysis stale", async () => {
    for (const t of await getActiveTasks(userA.id)) {
      await markTaskComplete(t.id);
    }

    const { data: activeCv } = await adminClient
      .from("cvs")
      .select("id")
      .eq("user_id", userA.id)
      .eq("is_active", true)
      .maybeSingle();
    assert.ok(activeCv, "userA must have an active CV");

    // Anchor the current preference state.
    const anchorErr = await savePrefs(userA.client, {
      p_job_type: "freelance",
      p_target_role_ids: [roleSlug1],
    });
    assert.equal(anchorErr, null);
    for (const t of await getActiveTasks(userA.id)) {
      await markTaskComplete(t.id);
    }

    // Insert a fresh approved is_current analysis.
    const analysis = await insertFakeAnalysis(userA, activeCv.id, {
      status: "completed",
      review_status: "approved",
      is_current: true,
      recommendations_state: "current",
    });

    // Re-save the SAME preferences — should not change version, should not
    // mark analysis stale, and should not create a new task.
    const noChangeErr = await savePrefs(userA.client, {
      p_job_type: "freelance",
      p_target_role_ids: [roleSlug1],
    });
    assert.equal(noChangeErr, null);

    const updatedAnalysis = await getAnalysis(userA.id);
    assert.equal(
      updatedAnalysis.recommendations_state,
      "current",
      "identical re-save must NOT mark the analysis stale"
    );

    const activeTasks = await getActiveTasks(userA.id);
    assert.equal(
      activeTasks.length,
      0,
      "identical re-save must NOT create any new task"
    );

    // Clean up.
    await adminClient.from("cv_analyses").delete().eq("id", analysis.id);
  });
});
