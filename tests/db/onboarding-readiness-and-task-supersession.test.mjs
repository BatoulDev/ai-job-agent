// Regression coverage for the onboarding-redirect bug: get_onboarding_
// readiness() resolving a stale, superseded cvs row once a user has more
// than one, and analysis_tasks accumulating one simultaneously-claimable
// task per historical CV version. Fixed by:
//   - 20260812100000_fix_onboarding_readiness_active_cv.sql
//   - 20260812100010_supersede_analysis_tasks_on_cv_replace.sql
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers, uploadFakeCv } from "./helpers.mjs";

let userA;
let userB;

before(async () => {
  await assertExpectedLocalProject();
  userA = await createTestUser("readiness-a");
  userB = await createTestUser("readiness-b");
});

after(async () => {
  await deleteTestUsers([userA, userB]);
});

test("get_onboarding_readiness resolves the active CV, not a stale historical row", async () => {
  await uploadFakeCv(userA, "v1.pdf");
  await uploadFakeCv(userA, "v2.pdf");
  const v3 = await uploadFakeCv(userA, "v3.pdf");

  const { data: activeCvs } = await adminClient
    .from("cvs")
    .select("id")
    .eq("user_id", userA.id)
    .eq("is_active", true);
  assert.equal(activeCvs.length, 1);
  assert.equal(activeCvs[0].id, v3.id);

  const { data: allCvs } = await adminClient.from("cvs").select("id").eq("user_id", userA.id);
  assert.equal(allCvs.length, 3, "fixture must have multiple historical rows for this test to be meaningful");

  const { data: readiness, error } = await userA.client.rpc("get_onboarding_readiness");
  assert.equal(error, null);
  assert.equal(readiness.has_cv, true);
  assert.equal(readiness.cv_id, v3.id, "readiness must resolve the active CV, not an older superseded one");
  assert.equal(readiness.cv_storage_object_exists, true, "the active CV's Storage object exists and must be reported as such");
  assert.notEqual(readiness.next_step, "upload_cv");
});

test("get_onboarding_readiness never resolves to a superseded CV even with many replacements", async () => {
  let lastCv;
  for (let i = 0; i < 5; i++) {
    lastCv = await uploadFakeCv(userB, `replace-${i}.pdf`);
  }

  const { data: readiness, error } = await userB.client.rpc("get_onboarding_readiness");
  assert.equal(error, null);
  assert.equal(readiness.cv_id, lastCv.id);
  assert.equal(readiness.cv_storage_object_exists, true);
  assert.notEqual(readiness.next_step, "upload_cv");
});

test("replacing a CV supersedes unfinished tasks for older CV versions, never the new one", async () => {
  const v1 = await uploadFakeCv(userA, "task-v1.pdf");

  // Simulates /api/onboarding/complete enqueuing the first-time task —
  // replace_cv() itself only auto-enqueues on a true replacement.
  const { data: task1, error: task1Error } = await adminClient.rpc("create_analysis_task", {
    p_user_id: userA.id,
    p_cv_id: v1.id,
    p_trigger: "onboarding_completed",
  });
  assert.equal(task1Error, null);
  assert.equal(task1.status, "pending");
  assert.equal(task1.superseded_at, null);

  const v2 = await uploadFakeCv(userA, "task-v2.pdf");

  const { data: task1After } = await adminClient
    .from("analysis_tasks")
    .select("status, superseded_at")
    .eq("id", task1.id)
    .single();
  assert.equal(task1After.status, "pending", "superseding must not change status — only mark superseded_at");
  assert.notEqual(task1After.superseded_at, null, "the old CV's task must be superseded once it's no longer active");

  const { data: v2Tasks } = await adminClient
    .from("analysis_tasks")
    .select("id, status, superseded_at, trigger")
    .eq("cv_id", v2.id);
  assert.equal(v2Tasks.length, 1, "replace_cv must auto-enqueue exactly one task for the new active CV");
  assert.equal(v2Tasks[0].trigger, "cv_replaced");
  assert.equal(v2Tasks[0].status, "pending");
  assert.equal(v2Tasks[0].superseded_at, null, "the new active CV's own task must never be superseded");
});

test("the active CV retains exactly one eligible (pending, not superseded) task after repeated replacement", async () => {
  const { data: eligible } = await adminClient
    .from("analysis_tasks")
    .select("id, cv_id")
    .eq("user_id", userA.id)
    .eq("status", "pending")
    .is("superseded_at", null);

  assert.equal(eligible.length, 1);

  const { data: activeCv } = await adminClient
    .from("cvs")
    .select("id")
    .eq("user_id", userA.id)
    .eq("is_active", true)
    .single();
  assert.equal(eligible[0].cv_id, activeCv.id);
});

test("completed historical tasks are preserved untouched by later replacements", async () => {
  const v1 = await uploadFakeCv(userB, "completed-flow-v1.pdf");
  const { data: task } = await adminClient.rpc("create_analysis_task", {
    p_user_id: userB.id,
    p_cv_id: v1.id,
    p_trigger: "onboarding_completed",
  });

  const { data: completed } = await adminClient
    .from("analysis_tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", task.id)
    .select()
    .single();
  assert.equal(completed.status, "completed");
  assert.equal(completed.superseded_at, null);

  await uploadFakeCv(userB, "completed-flow-v2.pdf");

  const { data: after } = await adminClient
    .from("analysis_tasks")
    .select("status, superseded_at, completed_at")
    .eq("id", task.id)
    .single();
  assert.equal(after.status, "completed", "a terminal task must never be reopened or rewritten");
  assert.equal(after.superseded_at, null, "a completed task needs no supersession — it was never in the way of claiming");
  assert.equal(after.completed_at, completed.completed_at);
});

test("repeated replacement never leaves more than one claimable task for a user", async () => {
  const freshUser = await createTestUser("readiness-c");
  try {
    for (let i = 0; i < 6; i++) {
      const cv = await uploadFakeCv(freshUser, `churn-${i}.pdf`);
      // Mirrors onboarding: only enqueue explicitly for the first CV;
      // every later replace_cv call auto-enqueues via create_analysis_task.
      if (i === 0) {
        await adminClient.rpc("create_analysis_task", {
          p_user_id: freshUser.id,
          p_cv_id: cv.id,
          p_trigger: "onboarding_completed",
        });
      }
    }

    const { data: claimable } = await adminClient
      .from("analysis_tasks")
      .select("id, cv_id")
      .eq("user_id", freshUser.id)
      .eq("status", "pending")
      .is("superseded_at", null);
    assert.equal(claimable.length, 1, "at most one claimable task must ever exist for a user regardless of replacement count");

    const { data: activeCv } = await adminClient
      .from("cvs")
      .select("id")
      .eq("user_id", freshUser.id)
      .eq("is_active", true)
      .single();
    assert.equal(claimable[0].cv_id, activeCv.id);
  } finally {
    await deleteTestUsers([freshUser]);
  }
});
