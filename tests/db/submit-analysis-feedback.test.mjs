// Integration tests for submit_analysis_feedback() RPC and the analysis_feedback table.
// Covers the backend paths for Request Changes dialog options 1, 3, and 5:
//   1. "Incorrect CV information" → feedback_type = cv_correction
//   3. "Change AI recommendations" → feedback_type = recommendation_feedback
//   5. "Something else" → feedback_type = user_request
//
// Run: npm run test:db
// Requires: local Supabase running, migration 20260818100000_add_analysis_feedback.sql applied.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  createAnonClient,
  deleteTestUsers,
  uploadFakeCv,
  insertFakeAnalysis,
} from "./helpers.mjs";

// ── Fixtures ──────────────────────────────────────────────────────────────────

let userA;      // primary — has CV + completed analysis
let userB;      // secondary — used for cross-user isolation
let cvA;        // userA's active CV
let analysisA;  // userA's completed analysis (pending_review)

before(async () => {
  await assertExpectedLocalProject();
  [userA, userB] = await Promise.all([
    createTestUser("fb-a"),
    createTestUser("fb-b"),
  ]);

  cvA = await uploadFakeCv(userA, "feedback-test.pdf");
  analysisA = await insertFakeAnalysis(userA, cvA.id, {
    status: "completed",
    review_status: "pending_review",
    is_current: false,
    recommendations_state: "current",
  });
});

after(async () => {
  await deleteTestUsers([userA, userB]);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function submitFeedback(userClient, overrides = {}) {
  return userClient.rpc("submit_analysis_feedback", {
    p_analysis_id: analysisA.id,
    p_feedback_type: "cv_correction",
    p_feedback_text: "The dates for my last job are wrong.",
    p_affected_section: null,
    ...overrides,
  });
}

async function getActiveTasks(userId) {
  const { data, error } = await adminClient
    .from("analysis_tasks")
    .select("id, trigger, status")
    .eq("user_id", userId)
    .in("status", ["pending", "processing"])
    .is("superseded_at", null);
  assert.equal(error, null, `getActiveTasks error: ${error?.message}`);
  return data ?? [];
}

async function markTaskComplete(taskId) {
  const { error } = await adminClient
    .from("analysis_tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", taskId);
  assert.equal(error, null, `markTaskComplete error: ${error?.message}`);
}

// ── Option 1: cv_correction ───────────────────────────────────────────────────

describe("Option 1 — cv_correction (Incorrect CV information)", () => {
  test("submit_analysis_feedback creates a feedback row and a cv_correction task", async () => {
    // Clean state: ensure no active tasks before this test.
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    const { data: row, error } = await submitFeedback(userA.client, {
      p_feedback_type: "cv_correction",
      p_feedback_text: "My degree was in Computer Science, not Electrical Engineering.",
      p_affected_section: "Education",
    });
    assert.equal(error, null, `submit_analysis_feedback failed: ${error?.message}`);
    assert.ok(row, "must return a feedback row");
    assert.equal(row.feedback_type, "cv_correction");
    assert.equal(row.affected_section, "Education");
    assert.ok(row.analysis_task_id, "feedback row must be linked to a task");

    // Verify the task was created with the correct trigger.
    const { data: task } = await adminClient
      .from("analysis_tasks")
      .select("id, trigger, status")
      .eq("id", row.analysis_task_id)
      .single();
    assert.equal(task.trigger, "cv_correction");
    assert.equal(task.status, "pending");

    // Verify the feedback row in the table.
    const { data: fb } = await adminClient
      .from("analysis_feedback")
      .select("*")
      .eq("id", row.id)
      .single();
    assert.equal(fb.user_id, userA.id);
    assert.equal(fb.cv_id, cvA.id);
    assert.equal(fb.source_analysis_id, analysisA.id);
    assert.equal(fb.analysis_task_id, task.id);
    assert.equal(fb.feedback_type, "cv_correction");
    assert.equal(fb.affected_section, "Education");

    await markTaskComplete(task.id);
  });

  test("affected_section is optional — null is accepted", async () => {
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    const { data: row, error } = await submitFeedback(userA.client, {
      p_feedback_type: "cv_correction",
      p_feedback_text: "My phone number is listed but should not be.",
      p_affected_section: null,
    });
    assert.equal(error, null);
    assert.equal(row.affected_section, null);

    await markTaskComplete(row.analysis_task_id);
  });
});

// ── Option 3: recommendation_feedback ────────────────────────────────────────

describe("Option 3 — recommendation_feedback (Change AI recommendations)", () => {
  test("submit_analysis_feedback creates a recommendation_feedback task", async () => {
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    const { data: row, error } = await submitFeedback(userA.client, {
      p_feedback_type: "recommendation_feedback",
      p_feedback_text: "Please suggest product management roles rather than software engineering.",
      p_affected_section: null,
    });
    assert.equal(error, null);
    assert.equal(row.feedback_type, "recommendation_feedback");

    const { data: task } = await adminClient
      .from("analysis_tasks")
      .select("trigger")
      .eq("id", row.analysis_task_id)
      .single();
    assert.equal(task.trigger, "recommendation_feedback");

    await markTaskComplete(row.analysis_task_id);
  });
});

// ── Option 5: user_request ────────────────────────────────────────────────────

describe("Option 5 — user_request (Something else)", () => {
  test("submit_analysis_feedback creates a user_request task", async () => {
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    const { data: row, error } = await submitFeedback(userA.client, {
      p_feedback_type: "user_request",
      p_feedback_text: "Please include a section on my open-source contributions.",
      p_affected_section: null,
    });
    assert.equal(error, null);
    assert.equal(row.feedback_type, "user_request");

    const { data: task } = await adminClient
      .from("analysis_tasks")
      .select("trigger")
      .eq("id", row.analysis_task_id)
      .single();
    assert.equal(task.trigger, "user_request");

    await markTaskComplete(row.analysis_task_id);
  });
});

// ── Task deduplication ────────────────────────────────────────────────────────

describe("Task deduplication", () => {
  test("second submit while a task is pending returns the same task, still inserts a new feedback row", async () => {
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    const { data: row1, error: err1 } = await submitFeedback(userA.client, {
      p_feedback_type: "cv_correction",
      p_feedback_text: "First correction: wrong start date.",
    });
    assert.equal(err1, null);
    assert.ok(row1.analysis_task_id);

    // Second submission while the first task is still pending.
    const { data: row2, error: err2 } = await submitFeedback(userA.client, {
      p_feedback_type: "cv_correction",
      p_feedback_text: "Second correction: wrong end date.",
    });
    assert.equal(err2, null);
    assert.ok(row2.analysis_task_id);

    // Both feedback rows must point to the SAME task (deduplication).
    assert.equal(
      row1.analysis_task_id,
      row2.analysis_task_id,
      "second submit must reuse the existing active task, not create a duplicate"
    );

    // Both feedback rows must exist and be distinct.
    assert.notEqual(row1.id, row2.id, "each submit must produce its own feedback row");

    // Only one active task must exist.
    const activeTasks = await getActiveTasks(userA.id);
    assert.equal(activeTasks.length, 1, "only one active task must exist after two submits");

    await markTaskComplete(row1.analysis_task_id);
  });
});

// ── RLS: users see only their own feedback ────────────────────────────────────

describe("RLS isolation", () => {
  test("authenticated user can only read their own analysis_feedback rows", async () => {
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    // userA submits feedback.
    const { data: row, error } = await submitFeedback(userA.client, {
      p_feedback_type: "user_request",
      p_feedback_text: "Please add a skills summary at the top.",
    });
    assert.equal(error, null);

    // userB queries the feedback table — must see zero rows.
    const { data: bRows, error: bErr } = await userB.client
      .from("analysis_feedback")
      .select("id");
    assert.equal(bErr, null, `userB select must not error: ${bErr?.message}`);
    assert.equal((bRows ?? []).length, 0, "userB must see zero rows from userA's feedback");

    // userA can see their own row.
    const { data: aRows } = await userA.client
      .from("analysis_feedback")
      .select("id")
      .eq("id", row.id);
    assert.equal((aRows ?? []).length, 1, "userA must see their own feedback row");

    await markTaskComplete(row.analysis_task_id);
  });

  test("unauthenticated client cannot read analysis_feedback", async () => {
    const anon = createAnonClient();
    const { data, error } = await anon.from("analysis_feedback").select("id");
    // Either 0 rows (RLS filters all) or an auth error — never the real rows.
    if (!error) {
      assert.equal((data ?? []).length, 0, "unauthenticated must see no rows");
    }
  });
});

// ── Authorization checks ──────────────────────────────────────────────────────

describe("Authorization and ownership", () => {
  test("calling submit_analysis_feedback with another user's analysis_id is rejected", async () => {
    // userB tries to submit feedback using userA's analysis ID.
    const { error } = await userB.client.rpc("submit_analysis_feedback", {
      p_analysis_id: analysisA.id,
      p_feedback_type: "cv_correction",
      p_feedback_text: "Trying to modify another user's analysis.",
    });
    assert.ok(error, "must return an error when the analysis does not belong to the caller");
    assert.ok(
      error.message.includes("not found") || error.message.includes("Analysis"),
      `error message must indicate the analysis was not found (not reveal ownership): ${error.message}`
    );
  });

  test("feedback text shorter than 10 characters is rejected", async () => {
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    const { error } = await submitFeedback(userA.client, {
      p_feedback_text: "Too short",
    });
    assert.ok(error, "must return an error for too-short feedback");
    assert.ok(
      error.message.toLowerCase().includes("10") || error.message.toLowerCase().includes("characters"),
      `error message must mention the minimum length: ${error.message}`
    );
  });

  test("feedback text longer than 2000 characters is rejected", async () => {
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    const { error } = await submitFeedback(userA.client, {
      p_feedback_text: "x".repeat(2001),
    });
    assert.ok(error, "must return an error for too-long feedback");
    assert.ok(
      error.message.toLowerCase().includes("2000") || error.message.toLowerCase().includes("characters"),
      `error message must mention the maximum length: ${error.message}`
    );
  });

  test("affected_section longer than 200 characters is rejected", async () => {
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    const { error } = await submitFeedback(userA.client, {
      p_feedback_text: "My education section shows the wrong degree.",
      p_affected_section: "E".repeat(201),
    });
    assert.ok(error, "must return an error for too-long affected_section");
    assert.ok(
      error.message.toLowerCase().includes("200") || error.message.toLowerCase().includes("section"),
      `error message must mention section length limit: ${error.message}`
    );
  });

  test("invalid feedback_type is rejected", async () => {
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    const { error } = await submitFeedback(userA.client, {
      p_feedback_type: "invalid_type",
      p_feedback_text: "This should be rejected before reaching the database.",
    });
    assert.ok(error, "must return an error for invalid feedback_type");
  });
});
