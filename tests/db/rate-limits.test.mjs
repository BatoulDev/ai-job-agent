// Integration tests for Phase 1 application-level rate limiting, added by
// 20260821090000_add_ai_task_and_cv_replace_rate_limits.sql:
//
//   A. create_analysis_task(): version/state-aware scheduling — NOT a
//      blanket time cooldown. Dedup first (collapse onto an existing
//      pending task in place, or flag a processing task for exactly one
//      automatic follow-up once it finishes). No time-based cooldown at
//      all — abuse protection comes from that structural cap (at most one
//      processing + one queued follow-up per cv_id, regardless of call
//      volume or which of the seven trigger types asked) plus each
//      caller's own independent bound (replace_cv's 5-per-hour quota,
//      save_job_preferences' own change-detection, the onboarding-complete
//      readiness gate).
//   B. replace_cv(): at most 5 successful CV replacements per rolling hour
//      per user — unchanged from the prior revision. Its internal
//      create_analysis_task('cv_replaced') call is unconditional again (no
//      more catching/swallowing a rate-limit error) — every successful
//      replacement always ends up with a real task lifecycle.
//
// Run: npm run test:db
// Requires: local Supabase running with that migration applied.
//
// Deterministic by construction — never sleeps for the real 1-hour
// cv_replace window. "Succeeds again after the window" uses
// backdateRateLimitEvents to move recorded events into the past instead of
// waiting in real time. The AI-task side has no time-based window at all,
// so nothing there needs backdating.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
  uploadFakeCv,
  insertFakeAnalysis,
  resetRateLimits,
  backdateRateLimitEvents,
} from "./helpers.mjs";

// ── Shared helpers ────────────────────────────────────────────────────────────

async function getActiveTasks(userId) {
  const { data, error } = await adminClient
    .from("analysis_tasks")
    .select("id, trigger, status, cv_id, needs_followup, followup_trigger, superseded_at")
    .eq("user_id", userId)
    .in("status", ["pending", "processing"]);
  assert.equal(error, null, `getActiveTasks error: ${error?.message}`);
  return data ?? [];
}

async function getTasksForCv(cvId) {
  const { data, error } = await adminClient
    .from("analysis_tasks")
    .select("id, trigger, status, cv_id, needs_followup, followup_trigger, superseded_at")
    .eq("cv_id", cvId)
    .order("created_at", { ascending: true });
  assert.equal(error, null, `getTasksForCv error: ${error?.message}`);
  return data ?? [];
}

async function getTask(taskId) {
  const { data, error } = await adminClient
    .from("analysis_tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  assert.equal(error, null, `getTask error: ${error?.message}`);
  return data;
}

async function markTaskComplete(taskId) {
  const { error } = await adminClient
    .from("analysis_tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", taskId);
  assert.equal(error, null, `markTaskComplete error: ${error?.message}`);
}

async function markTaskFailed(taskId) {
  const { error } = await adminClient
    .from("analysis_tasks")
    .update({ status: "failed", failed_at: new Date().toISOString() })
    .eq("id", taskId);
  assert.equal(error, null, `markTaskFailed error: ${error?.message}`);
}

// Simulates the n8n worker claiming a task (pending -> processing), without
// going through claim_analysis_task (service_role RPC, exercised elsewhere)
// — a direct status update is sufficient here since these tests are about
// create_analysis_task's scheduling behavior, not the claim contract itself.
async function markTaskProcessing(taskId) {
  const { error } = await adminClient
    .from("analysis_tasks")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", taskId);
  assert.equal(error, null, `markTaskProcessing error: ${error?.message}`);
}

async function countRateLimitEvents(userId, action) {
  const { count, error } = await adminClient
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", action);
  assert.equal(error, null, `countRateLimitEvents error: ${error?.message}`);
  return count ?? 0;
}

async function countCvs(userId) {
  const { count, error } = await adminClient
    .from("cvs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  assert.equal(error, null, `countCvs error: ${error?.message}`);
  return count ?? 0;
}

// The stable, distinguishable signal a client can match on without parsing
// message text — see the PT429 convention documented in the migration. Used
// by both replace_cv's quota and the shared feedback-category quota
// (charge_feedback_task_quota) — the latter can now be raised by
// create_analysis_task itself (via submit_analysis_feedback or
// update_profile_name_and_retry_analysis), unlike the pure dedup/collapse
// path, which never raises.
function isRateLimited(error) {
  return Boolean(error) && error.code === "PT429";
}

async function createTask(userId, cvId, trigger) {
  return adminClient.rpc("create_analysis_task", {
    p_user_id: userId,
    p_cv_id: cvId,
    p_trigger: trigger,
  });
}

async function getFeedbackRow(id) {
  const { data, error } = await adminClient
    .from("analysis_feedback")
    .select("*")
    .eq("id", id)
    .single();
  assert.equal(error, null, `getFeedbackRow error: ${error?.message}`);
  return data;
}

async function getAllFeedbackForCv(cvId) {
  const { data, error } = await adminClient
    .from("analysis_feedback")
    .select("*")
    .eq("cv_id", cvId)
    .order("created_at", { ascending: true });
  assert.equal(error, null, `getAllFeedbackForCv error: ${error?.message}`);
  return data ?? [];
}

// Exactly mirrors the n8n worker's "Load Task Feedback" step (read, not
// modified — n8n-workflows/cv-analysis-worker.ts / .json):
// analysis_feedback?analysis_task_id=eq.{taskId}&select=feedback_type,affected_section,feedback_text&limit=1
// No order= clause — deterministic only because at most one row can ever
// have a live (non-superseded) analysis_task_id equal to a given task id.
async function simulateWorkerFeedbackRead(taskId) {
  const { data, error } = await adminClient
    .from("analysis_feedback")
    .select("feedback_type, affected_section, feedback_text")
    .eq("analysis_task_id", taskId)
    .limit(1);
  assert.equal(error, null, `simulateWorkerFeedbackRead error: ${error?.message}`);
  return data ?? [];
}

async function submitFeedback(userClient, analysisId, feedbackType, feedbackText) {
  return userClient.rpc("submit_analysis_feedback", {
    p_analysis_id: analysisId,
    p_feedback_type: feedbackType,
    p_feedback_text: feedbackText,
  });
}

// A fresh CV via uploadFakeCv auto-enqueues its own 'cv_replaced' task
// whenever the user already has an active CV (any CV after the first).
// Tests that need a truly clean slate (no pre-existing active task to
// accidentally collapse onto) use this instead of uploadFakeCv directly.
async function freshCvNoActiveTask(user, label) {
  const cv = await uploadFakeCv(user, label);
  for (const t of await getActiveTasks(user.id)) await markTaskComplete(t.id);
  return cv;
}

// Inserts a fake, inactive cvs row directly (no real Storage object, no
// replace_cv call, no ownership/is_active constraints to juggle) — used
// only for concurrency tests that need several independent cv_id targets
// for the same user so create_analysis_task's per-cv_id dedup cannot
// collapse them into one.
async function insertFakeCvRow(userId, label) {
  const { data, error } = await adminClient
    .from("cvs")
    .insert({
      user_id: userId,
      storage_path: `${userId}/${label}.pdf`,
      file_name: `${label}.pdf`,
      file_size_bytes: 1024,
      mime_type: "application/pdf",
      is_active: false,
    })
    .select()
    .single();
  if (error) assert.fail(`insertFakeCvRow failed: ${error.message}`);
  return data;
}

// ── A. create_analysis_task() — version/state-aware scheduling ───────────────

describe("AI-task scheduling (create_analysis_task)", () => {
  let userA;
  let userB;

  before(async () => {
    await assertExpectedLocalProject();
    [userA, userB] = await Promise.all([
      createTestUser("rl-ai-a"),
      createTestUser("rl-ai-b"),
    ]);
  });

  after(async () => {
    await deleteTestUsers([userA, userB]);
  });

  // Every test below gets its own fresh CV (uploadFakeCv resets the
  // cv_replace quota by default, and — critically — each cv_id starts with
  // zero task history) so getTasksForCv() reflects only what that test
  // itself did, never leftovers from an earlier test sharing the same CV.
  async function freshCv(label) {
    return uploadFakeCv(userA, `${label}.pdf`);
  }

  test("first genuinely new task creation succeeds", async () => {
    const cv = await freshCv("scheduling-1");
    const { data: task, error } = await createTask(userA.id, cv.id, "onboarding_completed");
    assert.equal(error, null, `create_analysis_task failed: ${error?.message}`);
    assert.equal(task.status, "pending");
    assert.equal((await getTasksForCv(cv.id)).length, 1);

    await markTaskComplete(task.id);
  });

  test("a repeated identical request while pending collapses onto the same row — no duplicate, no charge", async () => {
    const cv = await freshCv("scheduling-2");
    const { data: task1, error: err1 } = await createTask(userA.id, cv.id, "preferences_updated");
    assert.equal(err1, null);

    const { data: task2, error: err2 } = await createTask(userA.id, cv.id, "preferences_updated");
    assert.equal(err2, null, `duplicate call must not error: ${err2?.message}`);
    assert.equal(task2.id, task1.id, "must return the same row, not a new one");
    assert.equal((await getTasksForCv(cv.id)).length, 1, "a duplicate request must not create a second row");

    await markTaskComplete(task1.id);
  });

  test("a DIFFERENT trigger for the same active CV while pending is not blocked — it collapses onto the same task", async () => {
    const cv = await freshCv("scheduling-3");
    const { data: task1, error: err1 } = await createTask(userA.id, cv.id, "preferences_updated");
    assert.equal(err1, null);

    // A genuinely different, legitimate trigger (feedback) arrives moments
    // later for the same still-pending task. Under the old blanket-cooldown
    // design this would have been rejected; it must now succeed immediately.
    const { data: task2, error: err2 } = await createTask(userA.id, cv.id, "cv_correction");
    assert.equal(err2, null, `a different trigger must not be blocked: ${err2?.message}`);
    assert.equal(task2.id, task1.id, "still the same underlying task — collapsed, not duplicated");
    assert.equal(task2.trigger, "cv_correction", "the recorded reason is refreshed to the latest trigger");
    assert.equal((await getTasksForCv(cv.id)).length, 1);

    await markTaskComplete(task1.id);
  });

  test("a task already processing is flagged for exactly one follow-up, never duplicated", async () => {
    const cv = await freshCv("scheduling-4");
    const { data: task1 } = await createTask(userA.id, cv.id, "onboarding_completed");
    await markTaskProcessing(task1.id);

    const { data: task2, error } = await createTask(userA.id, cv.id, "preferences_updated");
    assert.equal(error, null, `must not be blocked while processing: ${error?.message}`);
    assert.equal(task2.id, task1.id, "the processing row itself is returned, not a new one");
    assert.equal(task2.status, "processing");
    assert.equal(task2.needs_followup, true);
    assert.equal(task2.followup_trigger, "preferences_updated");
    assert.equal((await getTasksForCv(cv.id)).length, 1, "no second claimable row must exist while the first is processing");

    await markTaskComplete(task1.id);
  });

  test("repeated flagging while processing still collapses to exactly one follow-up, using the latest reason", async () => {
    const cv = await freshCv("scheduling-5");
    const { data: task1 } = await createTask(userA.id, cv.id, "onboarding_completed");
    await markTaskProcessing(task1.id);

    await createTask(userA.id, cv.id, "preferences_updated");
    await createTask(userA.id, cv.id, "cv_correction");
    const { data: task3 } = await createTask(userA.id, cv.id, "user_request");

    assert.equal(task3.id, task1.id);
    assert.equal(task3.followup_trigger, "user_request", "the flag must reflect the most recent request");
    assert.equal((await getTasksForCv(cv.id)).length, 1, "still exactly one row while processing, regardless of call count");

    await markTaskComplete(task1.id);
  });

  test("when a flagged processing task completes, exactly one follow-up task is automatically queued", async () => {
    const cv = await freshCv("scheduling-6");
    const { data: task1 } = await createTask(userA.id, cv.id, "onboarding_completed");
    await markTaskProcessing(task1.id);
    await createTask(userA.id, cv.id, "recommendation_feedback");

    await markTaskComplete(task1.id);

    const tasks = await getTasksForCv(cv.id);
    assert.equal(tasks.length, 2, "the original task plus exactly one automatic follow-up");
    const followup = tasks.find((t) => t.id !== task1.id);
    assert.ok(followup, "a follow-up task must exist");
    assert.equal(followup.status, "pending");
    assert.equal(followup.trigger, "recommendation_feedback");

    await markTaskComplete(followup.id);
  });

  test("when a flagged processing task fails, exactly one follow-up task is automatically queued", async () => {
    const cv = await freshCv("scheduling-7");
    const { data: task1 } = await createTask(userA.id, cv.id, "onboarding_completed");
    await markTaskProcessing(task1.id);
    await createTask(userA.id, cv.id, "cv_correction");

    await markTaskFailed(task1.id);

    const tasks = await getTasksForCv(cv.id);
    const followup = tasks.find((t) => t.id !== task1.id);
    assert.ok(followup, "a follow-up must still be queued after a failure, not just a completion");
    assert.equal(followup.status, "pending");
    assert.equal(followup.trigger, "cv_correction");

    await markTaskComplete(followup.id);
  });

  test("a processing task with no follow-up flag completes without spawning any extra task", async () => {
    const cv = await freshCv("scheduling-8");
    const { data: task1 } = await createTask(userA.id, cv.id, "onboarding_completed");
    await markTaskProcessing(task1.id);
    // No intervening create_analysis_task call — needs_followup stays false.

    await markTaskComplete(task1.id);

    assert.equal((await getTasksForCv(cv.id)).length, 1, "no follow-up must be created when nothing changed while processing");
  });

  test("no follow-up is queued if the CV was replaced (no longer active) before the flagged task finished", async () => {
    const cv = await freshCv("scheduling-9");
    const { data: task1 } = await createTask(userA.id, cv.id, "onboarding_completed");
    await markTaskProcessing(task1.id);
    await createTask(userA.id, cv.id, "preferences_updated"); // flags needs_followup

    // Replace the CV out from under the still-processing task, bypassing
    // replace_cv's own supersession step by deactivating cv directly —
    // isolates the "stale cv_id" guard in enqueue_followup_analysis_task
    // from replace_cv's own (separately tested) supersession behavior.
    await adminClient.from("cvs").update({ is_active: false }).eq("id", cv.id);

    await markTaskComplete(task1.id);

    const tasks = await getTasksForCv(cv.id);
    assert.equal(tasks.length, 1, "no follow-up must be queued for a CV that is no longer active");
  });

  test("no follow-up is queued if the flagged task was superseded before it finished", async () => {
    const cv = await freshCv("scheduling-10");
    const { data: task1 } = await createTask(userA.id, cv.id, "onboarding_completed");
    await markTaskProcessing(task1.id);
    await createTask(userA.id, cv.id, "user_request"); // flags needs_followup

    await adminClient.from("analysis_tasks").update({ superseded_at: new Date().toISOString() }).eq("id", task1.id);
    await markTaskComplete(task1.id);

    const tasks = await getTasksForCv(cv.id);
    assert.equal(tasks.length, 1, "no follow-up must be queued for a task that was superseded");
  });

  test("scheduling is scoped per user — userB is unaffected by userA's activity", async () => {
    const cvA = await freshCv("scheduling-11");
    const cvB = await uploadFakeCv(userB, "rl-ai-b.pdf");

    const { data: taskA } = await createTask(userA.id, cvA.id, "onboarding_completed");
    const { data: taskB, error: errB } = await createTask(userB.id, cvB.id, "onboarding_completed");
    assert.equal(errB, null, `userB must not be affected by userA's activity: ${errB?.message}`);
    assert.equal(taskB.status, "pending");
    assert.notEqual(taskB.id, taskA.id);

    await markTaskComplete(taskA.id);
    await markTaskComplete(taskB.id);
  });

  test("authenticated clients cannot call create_analysis_task directly (service_role only)", async () => {
    const cv = await freshCv("scheduling-12");
    const { error } = await userA.client.rpc("create_analysis_task", {
      p_user_id: userA.id,
      p_cv_id: cv.id,
      p_trigger: "onboarding_completed",
    });
    assert.ok(
      error,
      "create_analysis_task must remain unreachable to authenticated clients — only its wrapper RPCs are callable"
    );
  });

  test("an authenticated client cannot choose another user's id when calling a wrapper RPC", async () => {
    // update_profile_name_and_retry_analysis derives the acting user from
    // auth.uid() only — there is no p_user_id parameter to spoof. Confirm
    // calling it as userA can never affect userB's rows.
    const { error } = await userA.client.rpc("update_profile_name_and_retry_analysis", {
      p_full_name: "Spoof Attempt",
    });
    assert.equal(error, null);
    const { data: profileB } = await adminClient.from("profiles").select("full_name").eq("id", userB.id).single();
    assert.notEqual(profileB.full_name, "Spoof Attempt");

    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);
  });

  test("concurrent calls for the same active CV never create more than one task", async () => {
    const cv = await freshCv("scheduling-13");
    const results = await Promise.allSettled(
      ["onboarding_completed", "preferences_updated", "cv_correction", "recommendation_feedback", "user_request"].map(
        (trigger) => createTask(userA.id, cv.id, trigger)
      )
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    assert.equal(fulfilled.length, 5, "create_analysis_task never throws — every call must resolve");
    for (const r of fulfilled) {
      assert.equal(r.value.error, null, `no concurrent call should error: ${r.value.error?.message}`);
    }

    assert.equal((await getTasksForCv(cv.id)).length, 1, "five concurrent requests for one active CV must collapse to exactly one row");

    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);
  });
});

// ── B. CV replacement + AI-task interaction — the core regression coverage ──

describe("CV replacement always results in a scheduled analysis (no silent skip)", () => {
  let userA;

  before(async () => {
    await assertExpectedLocalProject();
    userA = await createTestUser("rl-lifecycle-a");
  });

  after(async () => {
    await deleteTestUsers([userA]);
  });

  test("replacing a CV while another trigger's task is PENDING for the old CV still creates a fresh task for the new CV", async () => {
    const cv1 = await uploadFakeCv(userA, "lifecycle-1.pdf");
    const { data: prefsTask } = await createTask(userA.id, cv1.id, "preferences_updated");
    assert.equal(prefsTask.status, "pending");

    const cv2 = await uploadFakeCv(userA, "lifecycle-2.pdf", { skipRateLimitReset: true });

    const cv2Tasks = await getTasksForCv(cv2.id);
    assert.equal(cv2Tasks.length, 1, "the replacement must always result in its own task");
    assert.equal(cv2Tasks[0].status, "pending");
    assert.equal(cv2Tasks[0].trigger, "cv_replaced");

    const oldTask = await getTask(prefsTask.id);
    assert.notEqual(oldTask.superseded_at, null, "the old CV's task must be superseded, not left dangling");

    await markTaskComplete(cv2Tasks[0].id);
  });

  test("replacing a CV while another trigger's task is PROCESSING for the old CV still creates a fresh task for the new CV", async () => {
    const cv1 = await uploadFakeCv(userA, "lifecycle-3.pdf", { skipRateLimitReset: true });
    const { data: fbTask } = await createTask(userA.id, cv1.id, "cv_correction");
    await markTaskProcessing(fbTask.id);

    const cv2 = await uploadFakeCv(userA, "lifecycle-4.pdf", { skipRateLimitReset: true });

    const cv2Tasks = await getTasksForCv(cv2.id);
    assert.equal(cv2Tasks.length, 1, "replacement must succeed and create its own task even while the old CV's task is processing");
    assert.equal(cv2Tasks[0].trigger, "cv_replaced");

    // The old (now-superseded) processing task can still finish safely.
    const oldTask = await getTask(fbTask.id);
    assert.notEqual(oldTask.superseded_at, null);
    await markTaskComplete(fbTask.id);
    // Superseded -> no follow-up should appear for the old, no-longer-active CV.
    assert.equal((await getTasksForCv(cv1.id)).length, 1, "a superseded task must never spawn a follow-up");

    await markTaskComplete(cv2Tasks[0].id);
  });

  test("preference change immediately followed by CV replacement both succeed and the newest CV ends up scheduled", async () => {
    await resetRateLimits(userA.id);
    await uploadFakeCv(userA, "lifecycle-5.pdf");

    const prefsErr = await userA.client.rpc("save_job_preferences", {
      p_work_arrangement: "remote",
      p_job_market_coverage: null,
      p_job_type: "full-time",
      p_experience_level: "junior",
      p_additional_notes: null,
      p_custom_target_roles: ["Rate Limit Test Role"],
      p_custom_locations: [],
      p_target_role_ids: [],
      p_location_ids: [],
    });
    assert.equal(prefsErr.error, null, `preferences save must succeed: ${prefsErr.error?.message}`);

    const cv2 = await uploadFakeCv(userA, "lifecycle-6.pdf", { skipRateLimitReset: true });
    const cv2Tasks = await getTasksForCv(cv2.id);
    assert.equal(cv2Tasks.length, 1);
    assert.equal(cv2Tasks[0].status, "pending");

    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);
  });

  test("CV replacement immediately followed by feedback both succeed safely", async () => {
    await resetRateLimits(userA.id);
    const cv = await uploadFakeCv(userA, "lifecycle-7.pdf");
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    // Simulate the worker having produced a completed, reviewable analysis
    // for the freshly-replaced CV.
    const analysis = await insertFakeAnalysis(userA, cv.id, {
      status: "completed",
      review_status: "pending_review",
    });

    const { error: fbErr } = await userA.client.rpc("submit_analysis_feedback", {
      p_analysis_id: analysis.id,
      p_feedback_type: "cv_correction",
      p_feedback_text: "Feedback submitted immediately after a CV replacement.",
    });
    assert.equal(fbErr, null, `feedback right after a replacement must succeed: ${fbErr?.message}`);

    // Check ACTIVE tasks only — if this was a true replacement (not
    // userA's first-ever CV), replace_cv's own cv_replaced task for `cv`
    // already exists too (from the immediately-preceding uploadFakeCv call,
    // now completed by the cleanup loop above); getTasksForCv would include
    // that historical row as well, which is expected and not what this
    // test is checking.
    const activeTasks = await getActiveTasks(userA.id);
    assert.equal(activeTasks.length, 1, "feedback must result in exactly one active task");
    assert.equal(activeTasks[0].trigger, "cv_correction");
    assert.equal(activeTasks[0].cv_id, cv.id);

    await adminClient.from("cv_analyses").delete().eq("id", analysis.id);
    await markTaskComplete(activeTasks[0].id);
  });

  test("preference change immediately followed by a profile-name retry collapses onto one task, uncharged", async () => {
    await resetRateLimits(userA.id);
    await uploadFakeCv(userA, "lifecycle-8.pdf");
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    const { error: prefsErr } = await userA.client.rpc("save_job_preferences", {
      p_work_arrangement: "remote",
      p_job_market_coverage: null,
      p_job_type: "full-time",
      p_experience_level: "junior",
      p_additional_notes: "Rapid-sequence test note.",
      p_custom_target_roles: ["Rate Limit Sequence Role"],
      p_custom_locations: [],
      p_target_role_ids: [],
      p_location_ids: [],
    });
    assert.equal(prefsErr, null, `preferences save must succeed: ${prefsErr?.message}`);

    const afterPrefs = await getActiveTasks(userA.id);
    assert.equal(afterPrefs.length, 1, "preferences change must schedule exactly one task");
    assert.equal(afterPrefs[0].trigger, "preferences_updated");

    const quotaBefore = await countRateLimitEvents(userA.id, "feedback_task_create");

    const { error: nameErr } = await userA.client.rpc("update_profile_name_and_retry_analysis", {
      p_full_name: "Sequence Test Retry Name",
    });
    assert.equal(nameErr, null, `profile-name retry immediately after a preferences change must succeed: ${nameErr?.message}`);

    const afterName = await getActiveTasks(userA.id);
    assert.equal(afterName.length, 1, "the profile-name retry must collapse onto the same task, not create a second one");
    assert.equal(afterName[0].id, afterPrefs[0].id, "it must be the exact same task row, refreshed in place");
    assert.equal(afterName[0].trigger, "user_request", "the trigger must be refreshed to reflect the latest legitimate request");

    const quotaAfter = await countRateLimitEvents(userA.id, "feedback_task_create");
    assert.equal(quotaAfter, quotaBefore, "collapsing onto an already-pending task must never charge the shared quota, regardless of which trigger types are involved");

    await markTaskComplete(afterName[0].id);
  });

  test("every one of 5 replacements interleaved with other trigger activity ends up with a scheduled analysis", async () => {
    await resetRateLimits(userA.id);
    let previousCv = null;

    for (let i = 0; i < 5; i++) {
      const cv = await uploadFakeCv(userA, `lifecycle-quota-${i}.pdf`, { skipRateLimitReset: true });

      // Interleave a different trigger against the newly-active CV before
      // the next replacement — must never prevent that next replacement
      // from getting its own task.
      await createTask(userA.id, cv.id, "preferences_updated");

      const cvTasks = await getTasksForCv(cv.id);
      assert.equal(cvTasks.length, 1, `replacement ${i} must have exactly one associated task`);
      assert.ok(["pending", "processing"].includes(cvTasks[0].status));

      if (previousCv) {
        const priorTasks = await getTasksForCv(previousCv.id);
        assert.ok(
          priorTasks.every((t) => t.superseded_at !== null || t.status === "completed"),
          "every earlier CV's task must be superseded or completed once replaced — never left silently active and orphaned"
        );
      }
      previousCv = cv;
    }
  });
});

// ── C. replace_cv() — CV-replacement rolling-window limit ────────────────────

describe("CV-replacement rate limit (replace_cv)", () => {
  let userA;
  let userB;

  before(async () => {
    await assertExpectedLocalProject();
    [userA, userB] = await Promise.all([
      createTestUser("rl-cv-a"),
      createTestUser("rl-cv-b"),
    ]);
  });

  after(async () => {
    await deleteTestUsers([userA, userB]);
  });

  test("the first five successful replacements within the hour all succeed", async () => {
    await resetRateLimits(userA.id);

    for (let i = 0; i < 5; i++) {
      const cv = await uploadFakeCv(userA, `rl-cv-a-${i}.pdf`, { skipRateLimitReset: true });
      assert.ok(cv?.id, `replacement ${i} must succeed`);
    }
    assert.equal(await countRateLimitEvents(userA.id, "cv_replace"), 5);
  });

  test("the sixth replacement within the same hour is rejected", async () => {
    const { error } = await userA.client.rpc("replace_cv", {
      p_storage_path: `${userA.id}/rl-cv-a-sixth.pdf`,
      p_file_name: "rl-cv-a-sixth.pdf",
      p_file_size_bytes: 1024,
      p_mime_type: "application/pdf",
    });
    assert.ok(error, "the sixth replacement within the rolling hour must be rejected");
    assert.ok(isRateLimited(error), `expected a PT429 rate-limit error, got code=${error?.code}`);
    assert.equal(
      await countRateLimitEvents(userA.id, "cv_replace"),
      5,
      "a rejected replacement must not consume quota"
    );
  });

  test("a failed replacement (invalid MIME type) does not consume quota", async () => {
    await resetRateLimits(userA.id);

    const { error } = await userA.client.rpc("replace_cv", {
      p_storage_path: `${userA.id}/invalid-mime.docx`,
      p_file_name: "invalid-mime.docx",
      p_file_size_bytes: 1024,
      p_mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    assert.ok(error, "expected the PDF-only guard to reject this call");
    assert.notEqual(
      error.code,
      "PT429",
      "a validation failure must be distinguishable from a rate-limit rejection"
    );
    assert.equal(
      await countRateLimitEvents(userA.id, "cv_replace"),
      0,
      "a failed (non-rate-limit) replacement must not consume quota either"
    );

    // Confirms the earlier failure truly left the full quota available.
    for (let i = 0; i < 5; i++) {
      const cv = await uploadFakeCv(userA, `rl-cv-a-after-failure-${i}.pdf`, { skipRateLimitReset: true });
      assert.ok(cv?.id, `replacement ${i} after the earlier failure must still succeed`);
    }
  });

  test("replacement succeeds again once the rolling hour has elapsed", async () => {
    await backdateRateLimitEvents(userA.id, "cv_replace", 61);

    const cv = await uploadFakeCv(userA, "rl-cv-a-post-window.pdf", { skipRateLimitReset: true });
    assert.ok(cv?.id, "expected success once the rolling window has elapsed");
  });

  test("the CV-replace limit is scoped per user — userB is unaffected by userA's rate limit", async () => {
    await resetRateLimits(userA.id);
    await resetRateLimits(userB.id);

    for (let i = 0; i < 5; i++) {
      await uploadFakeCv(userA, `rl-cv-a-scope-${i}.pdf`, { skipRateLimitReset: true });
    }
    const { error: sixthErr } = await userA.client.rpc("replace_cv", {
      p_storage_path: `${userA.id}/rl-cv-a-scope-sixth.pdf`,
      p_file_name: "rl-cv-a-scope-sixth.pdf",
      p_file_size_bytes: 1024,
      p_mime_type: "application/pdf",
    });
    assert.ok(isRateLimited(sixthErr), "userA must be rate-limited after 5 replacements");

    // userB has never replaced a CV — must succeed normally.
    const cvB = await uploadFakeCv(userB, "rl-cv-b-first.pdf", { skipRateLimitReset: true });
    assert.ok(cvB?.id, "userB must not be affected by userA's exhausted quota");
  });

  test("concurrent replace_cv calls for the same user allow at most five successes", async () => {
    const freshUser = await createTestUser("rl-cv-concurrent");
    try {
      const results = await Promise.allSettled(
        [0, 1, 2, 3, 4, 5, 6].map((i) =>
          uploadFakeCv(freshUser, `concurrent-cv-${i}.pdf`, { skipRateLimitReset: true })
        )
      );

      const succeeded = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      assert.equal(succeeded.length, 5, "at most 5 of 7 concurrent replacements may succeed");
      assert.equal(rejected.length, 2, "the remaining concurrent replacements must be rejected");

      assert.equal(
        await countCvs(freshUser.id),
        5,
        "the database must never contain more than 5 cvs rows created within the window"
      );
      assert.equal(await countRateLimitEvents(freshUser.id, "cv_replace"), 5);

      // Every successful replacement must still have ended up with a task
      // lifecycle — the core regression this correction fixes. Note:
      // replace_cv only auto-enqueues a task on a TRUE replacement
      // (v_had_active) — a user's very first-ever CV upload intentionally
      // has no task yet (onboarding/complete enqueues that one once
      // preferences are also done), so exactly one of these five successful
      // concurrent uploads (whichever one happened to run first under the
      // per-user advisory lock) is expected to have zero tasks.
      const { data: cvs } = await adminClient
        .from("cvs")
        .select("id, created_at")
        .eq("user_id", freshUser.id)
        .order("created_at", { ascending: true });
      const withoutTask = [];
      for (const cv of cvs) {
        const tasks = await getTasksForCv(cv.id);
        if (tasks.length === 0) withoutTask.push(cv.id);
      }
      assert.equal(
        withoutTask.length,
        1,
        "exactly one of the five successful replacements (the very first-ever upload) is expected to have no task yet"
      );

      const { data: activeCv } = await adminClient
        .from("cvs")
        .select("id")
        .eq("user_id", freshUser.id)
        .eq("is_active", true)
        .single();
      const activeTasks = await getTasksForCv(activeCv.id);
      assert.ok(activeTasks.length > 0, "the final active CV must have a scheduled analysis task");
    } finally {
      await deleteTestUsers([freshUser]);
    }
  });
});

// ── D. Feedback linkage across a deferred follow-up ───────────────────────────
// See the "Second correction" design note in the migration: analysis_feedback
// rows must not remain attached only to a task that will never run again.

describe("Feedback linkage across a deferred follow-up task", () => {
  let userA;

  before(async () => {
    await assertExpectedLocalProject();
    userA = await createTestUser("rl-fb-a");
  });

  after(async () => {
    await deleteTestUsers([userA]);
  });

  test("feedback submitted while processing is moved to the follow-up, and the worker's own query can find it there", async () => {
    const cv = await uploadFakeCv(userA, "fb-linkage-1.pdf");
    const analysis = await insertFakeAnalysis(userA, cv.id, { status: "completed", review_status: "pending_review" });

    const { data: fb1, error: err1 } = await submitFeedback(userA.client, analysis.id, "cv_correction", "First feedback, wrong dates.");
    assert.equal(err1, null, `first feedback failed: ${err1?.message}`);
    const task1Id = fb1.analysis_task_id;
    await markTaskProcessing(task1Id);

    const { data: fb2, error: err2 } = await submitFeedback(userA.client, analysis.id, "recommendation_feedback", "Second feedback, while processing.");
    assert.equal(err2, null, `second feedback (while processing) failed: ${err2?.message}`);
    assert.equal(fb2.analysis_task_id, task1Id, "still attached to the processing task at submission time");

    // fb1 must have been superseded and detached by fb2's submission.
    const fb1After = await getFeedbackRow(fb1.id);
    assert.notEqual(fb1After.superseded_at, null, "fb1 must be superseded once a newer submission arrives for the same task");
    assert.equal(fb1After.analysis_task_id, null, "a superseded row must be detached, not left pointing at a live task");

    await markTaskComplete(task1Id);

    const tasks = await getTasksForCv(cv.id);
    const followup = tasks.find((t) => t.id !== task1Id);
    assert.ok(followup, "a follow-up task must have been queued (fb2 flagged needs_followup)");

    // fb2 must now point at the follow-up, not the terminal task.
    const fb2After = await getFeedbackRow(fb2.id);
    assert.equal(fb2After.analysis_task_id, followup.id, "live feedback must be carried forward to the follow-up task");
    assert.equal(fb2After.superseded_at, null, "carrying forward is not supersession — fb2 is still the live, current feedback");

    // Nothing must still point at the now-terminal original task.
    const stillOnOldTask = await simulateWorkerFeedbackRead(task1Id);
    assert.equal(stillOnOldTask.length, 0, "no feedback may remain attached to a task that will never run again");

    // The worker's exact query, run against the follow-up's id, must find
    // fb2 — and only fb2.
    const workerRead = await simulateWorkerFeedbackRead(followup.id);
    assert.equal(workerRead.length, 1);
    assert.equal(workerRead[0].feedback_text, "Second feedback, while processing.");

    // No duplicate rows: exactly fb1 + fb2 exist for this CV, nothing more.
    assert.equal((await getAllFeedbackForCv(cv.id)).length, 2, "no duplicate feedback copies may be created by the move");

    await markTaskComplete(followup.id);
  });

  test("multiple rapid submissions while processing are deterministic — only the newest is ever live, full history preserved", async () => {
    const cv = await uploadFakeCv(userA, "fb-linkage-2.pdf");
    const analysis = await insertFakeAnalysis(userA, cv.id, { status: "completed", review_status: "pending_review" });

    const { data: fbA } = await submitFeedback(userA.client, analysis.id, "cv_correction", "Submission A.");
    const taskId = fbA.analysis_task_id;
    await markTaskProcessing(taskId);

    const { data: fbB } = await submitFeedback(userA.client, analysis.id, "recommendation_feedback", "Submission B.");
    const { data: fbC } = await submitFeedback(userA.client, analysis.id, "user_request", "Submission C, the latest.");

    // A and B must both be superseded/detached; only C is live.
    assert.notEqual((await getFeedbackRow(fbA.id)).superseded_at, null);
    assert.equal((await getFeedbackRow(fbA.id)).analysis_task_id, null);
    assert.notEqual((await getFeedbackRow(fbB.id)).superseded_at, null);
    assert.equal((await getFeedbackRow(fbB.id)).analysis_task_id, null);
    assert.equal((await getFeedbackRow(fbC.id)).superseded_at, null);
    assert.equal((await getFeedbackRow(fbC.id)).analysis_task_id, taskId);

    // The worker's query against the still-processing task deterministically
    // finds exactly C (the newest, authoritative submission).
    let workerRead = await simulateWorkerFeedbackRead(taskId);
    assert.equal(workerRead.length, 1);
    assert.equal(workerRead[0].feedback_text, "Submission C, the latest.");

    await markTaskComplete(taskId);
    const followup = (await getTasksForCv(cv.id)).find((t) => t.id !== taskId);
    assert.ok(followup, "the last flagged reason (user_request) must have queued a follow-up");
    assert.equal(followup.trigger, "user_request");

    // C moves to the follow-up; the worker's query against the follow-up
    // deterministically finds exactly C again.
    workerRead = await simulateWorkerFeedbackRead(followup.id);
    assert.equal(workerRead.length, 1);
    assert.equal(workerRead[0].feedback_text, "Submission C, the latest.");

    // Full history preserved: A, B, C all still exist as permanent rows.
    assert.equal((await getAllFeedbackForCv(cv.id)).length, 3, "every submission must still have its own permanent historical row");

    await markTaskComplete(followup.id);
  });

  test("feedback is not lost when the flagged processing task FAILS, not just completes", async () => {
    const cv = await uploadFakeCv(userA, "fb-linkage-3.pdf");
    const analysis = await insertFakeAnalysis(userA, cv.id, { status: "completed", review_status: "pending_review" });

    const { data: fb1 } = await submitFeedback(userA.client, analysis.id, "cv_correction", "Feedback before failure.");
    await markTaskProcessing(fb1.analysis_task_id);
    const { data: fb2 } = await submitFeedback(userA.client, analysis.id, "recommendation_feedback", "Feedback during processing, before failure.");

    await markTaskFailed(fb1.analysis_task_id);

    const followup = (await getTasksForCv(cv.id)).find((t) => t.id !== fb1.analysis_task_id);
    assert.ok(followup, "a follow-up must be queued even when the original task fails, not just completes");

    const fb2After = await getFeedbackRow(fb2.id);
    assert.equal(fb2After.analysis_task_id, followup.id, "feedback must not be lost when the task fails");

    await markTaskComplete(followup.id);
  });

  test("feedback submitted only before processing (no change while processing) is left exactly where it was — no needless move", async () => {
    const cv = await uploadFakeCv(userA, "fb-linkage-4.pdf");
    const analysis = await insertFakeAnalysis(userA, cv.id, { status: "completed", review_status: "pending_review" });

    const { data: fb1 } = await submitFeedback(userA.client, analysis.id, "cv_correction", "Only feedback, submitted before claim.");
    const taskId = fb1.analysis_task_id;
    await markTaskProcessing(taskId);
    // No further create_analysis_task call while processing — needs_followup stays false.
    await markTaskComplete(taskId);

    assert.equal((await getTasksForCv(cv.id)).length, 1, "no follow-up must be created when nothing changed while processing");
    const fb1After = await getFeedbackRow(fb1.id);
    assert.equal(fb1After.analysis_task_id, taskId, "feedback that was already consumed must stay exactly where it was");
    assert.equal(fb1After.superseded_at, null);
  });
});

// ── E. Feedback-category quota (charge_feedback_task_quota) ──────────────────
// Shared across cv_correction, recommendation_feedback, and user_request
// (including update_profile_name_and_retry_analysis's own 'user_request'
// trigger) — 5 successful new requests per rolling hour per user. Never
// applies to cv_replaced or preferences_updated. Never charged for a
// deduplicated/collapsed request or a failed/rejected call.

describe("Feedback-category quota (5 per rolling hour, shared bucket)", () => {
  let userA;
  let userB;

  before(async () => {
    await assertExpectedLocalProject();
    [userA, userB] = await Promise.all([
      createTestUser("rl-fbq-a"),
      createTestUser("rl-fbq-b"),
    ]);
  });

  after(async () => {
    await deleteTestUsers([userA, userB]);
  });

  // Submits feedback for a fresh completed analysis on the given cv and
  // immediately completes the resulting task, so each call in a test loop
  // represents a genuinely new, independent request (no dedup shortcut).
  async function freshFeedbackRequest(cv, feedbackType, text) {
    const analysis = await insertFakeAnalysis(userA, cv.id, { status: "completed", review_status: "pending_review" });
    const result = await submitFeedback(userA.client, analysis.id, feedbackType, text);
    if (!result.error) {
      await markTaskComplete(result.data.analysis_task_id);
    }
    await adminClient.from("cv_analyses").delete().eq("id", analysis.id);
    return result;
  }

  test("5 genuinely new feedback-category requests succeed; the 6th is rejected with PT429", async () => {
    await resetRateLimits(userA.id);
    const cv = await uploadFakeCv(userA, "fbq-1.pdf");
    const types = ["cv_correction", "recommendation_feedback", "user_request", "cv_correction", "recommendation_feedback"];

    for (let i = 0; i < 5; i++) {
      const { error } = await freshFeedbackRequest(cv, types[i], `Request number ${i}, long enough text.`);
      assert.equal(error, null, `request ${i} must succeed: ${error?.message}`);
    }
    assert.equal(await countRateLimitEvents(userA.id, "feedback_task_create"), 5);

    const { error: sixthErr } = await freshFeedbackRequest(cv, "user_request", "The sixth request, should be rejected.");
    assert.ok(sixthErr, "the 6th genuinely new request within the hour must be rejected");
    assert.ok(isRateLimited(sixthErr), `expected PT429, got code=${sixthErr?.code}`);
    assert.equal(await countRateLimitEvents(userA.id, "feedback_task_create"), 5, "a rejected request must not itself consume quota");
  });

  test("deduplicated (collapsed) requests do not consume quota", async () => {
    await resetRateLimits(userA.id);
    const cv = await freshCvNoActiveTask(userA, "fbq-2.pdf");
    const analysis = await insertFakeAnalysis(userA, cv.id, { status: "completed", review_status: "pending_review" });

    const { data: fb1, error: err1 } = await submitFeedback(userA.client, analysis.id, "cv_correction", "First submission, creates the task.");
    assert.equal(err1, null);
    assert.equal(await countRateLimitEvents(userA.id, "feedback_task_create"), 1);

    // Second submission while the task is still pending — collapses onto
    // the same task, must not charge a second time.
    const { error: err2 } = await submitFeedback(userA.client, analysis.id, "recommendation_feedback", "Second submission, same still-pending task.");
    assert.equal(err2, null);
    assert.equal(await countRateLimitEvents(userA.id, "feedback_task_create"), 1, "a deduplicated request must not consume quota");

    await markTaskComplete(fb1.analysis_task_id);
  });

  test("a genuinely new flag on a processing task is charged once; repeated flags while still processing are not charged again", async () => {
    await resetRateLimits(userA.id);
    const cv = await freshCvNoActiveTask(userA, "fbq-3.pdf");
    const analysis = await insertFakeAnalysis(userA, cv.id, { status: "completed", review_status: "pending_review" });

    const { data: fb1 } = await submitFeedback(userA.client, analysis.id, "cv_correction", "Original request.");
    await markTaskProcessing(fb1.analysis_task_id);

    const { error: err2 } = await submitFeedback(userA.client, analysis.id, "recommendation_feedback", "First flag while processing.");
    assert.equal(err2, null);
    assert.equal(await countRateLimitEvents(userA.id, "feedback_task_create"), 2, "the first flag on a processing task is a genuinely new accepted request");

    const { error: err3 } = await submitFeedback(userA.client, analysis.id, "user_request", "Second flag while still processing — same follow-up slot.");
    assert.equal(err3, null);
    assert.equal(await countRateLimitEvents(userA.id, "feedback_task_create"), 2, "re-flagging the same pending follow-up must not charge again");

    await markTaskComplete(fb1.analysis_task_id);
    const followup = (await getTasksForCv(cv.id)).find((t) => t.status === "pending");
    if (followup) await markTaskComplete(followup.id);
  });

  test("a failed transaction (validation error) does not consume quota", async () => {
    await resetRateLimits(userA.id);
    const { error } = await submitFeedback(userA.client, "00000000-0000-0000-0000-000000000000", "cv_correction", "Feedback for a nonexistent analysis.");
    assert.ok(error, "expected an ownership/not-found error");
    assert.notEqual(error.code, "PT429", "a validation failure must be distinguishable from a rate-limit rejection");
    assert.equal(await countRateLimitEvents(userA.id, "feedback_task_create"), 0);
  });

  test("the quota does not block genuine CV replacement, even when fully exhausted", async () => {
    await resetRateLimits(userA.id);
    const cv = await freshCvNoActiveTask(userA, "fbq-4.pdf");
    for (let i = 0; i < 5; i++) {
      await freshFeedbackRequest(cv, "cv_correction", `Exhausting request ${i}, long enough text.`);
    }
    assert.equal(await countRateLimitEvents(userA.id, "feedback_task_create"), 5);

    const cv2 = await uploadFakeCv(userA, "fbq-4b.pdf", { skipRateLimitReset: true });
    assert.ok(cv2?.id, "CV replacement must succeed regardless of the exhausted feedback-category quota");
    const cv2Tasks = await getTasksForCv(cv2.id);
    assert.equal(cv2Tasks.length, 1);
    assert.equal(cv2Tasks[0].trigger, "cv_replaced");

    await markTaskComplete(cv2Tasks[0].id);
  });

  test("the quota does not block a genuine preferences change, even when fully exhausted", async () => {
    await resetRateLimits(userA.id);
    const cv = await freshCvNoActiveTask(userA, "fbq-5.pdf");

    // Anchor save: save_job_preferences only enqueues a task on a CHANGE
    // relative to an existing row — this user's very first-ever save is
    // treated as onboarding and enqueues nothing at all, regardless of the
    // feedback quota. Establish a baseline first so the second save below
    // is a genuine, detectable change.
    const anchorErr = await userA.client.rpc("save_job_preferences", {
      p_work_arrangement: "remote",
      p_job_market_coverage: null,
      p_job_type: "full-time",
      p_experience_level: "junior",
      p_additional_notes: null,
      p_custom_target_roles: ["Anchor Role"],
      p_custom_locations: [],
      p_target_role_ids: [],
      p_location_ids: [],
    });
    assert.equal(anchorErr.error, null, `anchor save failed: ${anchorErr.error?.message}`);
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    for (let i = 0; i < 5; i++) {
      await freshFeedbackRequest(cv, "recommendation_feedback", `Exhausting request ${i}, long enough text.`);
    }
    assert.equal(await countRateLimitEvents(userA.id, "feedback_task_create"), 5);

    const { error: prefsErr } = await userA.client.rpc("save_job_preferences", {
      p_work_arrangement: "remote",
      p_job_market_coverage: null,
      p_job_type: "internship",
      p_experience_level: "junior",
      p_additional_notes: null,
      p_custom_target_roles: ["Anchor Role"],
      p_custom_locations: [],
      p_target_role_ids: [],
      p_location_ids: [],
    });
    assert.equal(prefsErr, null, `preferences save must succeed regardless of the exhausted feedback quota: ${prefsErr?.message}`);

    const activeTasks = await getActiveTasks(userA.id);
    const prefsTask = activeTasks.find((t) => t.trigger === "preferences_updated");
    assert.ok(prefsTask, "a preferences_updated task must still be scheduled");

    await markTaskComplete(prefsTask.id);
  });

  test("update_profile_name_and_retry_analysis degrades gracefully when the shared quota is exhausted — the name change still succeeds", async () => {
    await resetRateLimits(userA.id);
    const cv = await freshCvNoActiveTask(userA, "fbq-6.pdf");
    for (let i = 0; i < 5; i++) {
      await freshFeedbackRequest(cv, "user_request", `Exhausting request ${i}, long enough text.`);
    }

    const { data, error } = await userA.client.rpc("update_profile_name_and_retry_analysis", {
      p_full_name: "Quota Exhausted Name",
    });
    assert.equal(error, null, "the name update itself must never fail due to the feedback quota");
    assert.equal(data.ok, true);
    assert.equal(data.has_active_task, false, "no retry-analysis task can be scheduled while the quota is exhausted");

    const { data: profile } = await adminClient.from("profiles").select("full_name").eq("id", userA.id).single();
    assert.equal(profile.full_name, "Quota Exhausted Name");
  });

  test("update_profile_name_and_retry_analysis's successful retries share the same quota bucket as feedback", async () => {
    await resetRateLimits(userA.id);
    const cv = await freshCvNoActiveTask(userA, "fbq-7.pdf");

    for (let i = 0; i < 3; i++) {
      const { data, error } = await userA.client.rpc("update_profile_name_and_retry_analysis", {
        p_full_name: `Shared Bucket Name ${i}`,
      });
      assert.equal(error, null);
      assert.equal(data.has_active_task, true, `retry ${i} must succeed while quota remains`);
      const active = await getActiveTasks(userA.id);
      for (const t of active) await markTaskComplete(t.id);
    }
    assert.equal(await countRateLimitEvents(userA.id, "feedback_task_create"), 3);

    // 2 more via feedback should exhaust the shared bucket at 5.
    await freshFeedbackRequest(cv, "cv_correction", "Fourth request via feedback, long enough.");
    await freshFeedbackRequest(cv, "cv_correction", "Fifth request via feedback, long enough.");
    assert.equal(await countRateLimitEvents(userA.id, "feedback_task_create"), 5);

    const { data: sixth } = await userA.client.rpc("update_profile_name_and_retry_analysis", {
      p_full_name: "Sixth, should have no active task",
    });
    assert.equal(sixth.has_active_task, false, "the 6th request, regardless of which action triggered it, must be denied");
  });

  test("the quota is scoped per user — userB is unaffected by userA's exhausted quota", async () => {
    await resetRateLimits(userA.id);
    await resetRateLimits(userB.id);
    const cvA = await freshCvNoActiveTask(userA, "fbq-8a.pdf");
    for (let i = 0; i < 5; i++) {
      await freshFeedbackRequest(cvA, "cv_correction", `Exhausting request ${i}, long enough text.`);
    }

    const cvB = await uploadFakeCv(userB, "fbq-8b.pdf");
    const analysisB = await insertFakeAnalysis(userB, cvB.id, { status: "completed", review_status: "pending_review" });
    const { error: errB } = await submitFeedback(userB.client, analysisB.id, "cv_correction", "userB must be unaffected by userA's exhausted quota.");
    assert.equal(errB, null, `userB must not be rate-limited by userA's activity: ${errB?.message}`);
  });

  test("concurrent feedback-category requests are bounded by the quota, race-safe", async () => {
    const freshUser = await createTestUser("rl-fbq-concurrent");
    try {
      // 7 distinct cv_id targets (direct rows, not real replace_cv calls)
      // so create_analysis_task's per-cv_id dedup cannot collapse the
      // concurrent calls onto one another — this isolates the quota's own
      // concurrency safety (the advisory lock), exactly as the earlier
      // "concurrent calls for the same active CV" test isolates dedup from
      // it in the other direction.
      const cvs = await Promise.all(
        [0, 1, 2, 3, 4, 5, 6].map((i) => insertFakeCvRow(freshUser.id, `fbq-concurrent-${i}`))
      );

      const results = await Promise.allSettled(
        cvs.map((cv) =>
          adminClient.rpc("create_analysis_task", {
            p_user_id: freshUser.id,
            p_cv_id: cv.id,
            p_trigger: "cv_correction",
          })
        )
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      assert.equal(fulfilled.length, 7, "create_analysis_task never throws — every call must resolve");
      const succeeded = fulfilled.filter((r) => !r.value.error);
      const rejected = fulfilled.filter((r) => r.value.error && isRateLimited(r.value.error));
      assert.equal(succeeded.length, 5, "at most 5 of 7 concurrent requests may succeed");
      assert.equal(rejected.length, 2, "the remaining concurrent requests must be rejected with PT429");

      assert.equal(await countRateLimitEvents(freshUser.id, "feedback_task_create"), 5);
    } finally {
      await deleteTestUsers([freshUser]);
    }
  });
});
