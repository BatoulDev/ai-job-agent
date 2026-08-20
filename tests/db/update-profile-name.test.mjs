// Integration tests for update_profile_name_and_retry_analysis() RPC.
// Covers the complete "Update account name" lifecycle from the
// OwnershipMismatchBlock: name update, task deduplication, and cross-user
// isolation.
//
// Run: npm run test:db
// Requires: local Supabase running with migration
//   20260819120000_update_profile_name_rpc.sql applied.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  createAnonClient,
  deleteTestUsers,
  uploadFakeCv,
} from "./helpers.mjs";

// ── Fixtures ──────────────────────────────────────────────────────────────────

let userA;   // primary — has an active CV
let userB;   // secondary — used for cross-user isolation checks
let cvA;     // userA's active CV — verified in task assertions

before(async () => {
  await assertExpectedLocalProject();
  [userA, userB] = await Promise.all([
    createTestUser("upn-a"),
    createTestUser("upn-b"),
  ]);
  cvA = await uploadFakeCv(userA, "update-name-test.pdf");
});

after(async () => {
  await deleteTestUsers([userA, userB]);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function updateName(userClient, name) {
  return userClient.rpc("update_profile_name_and_retry_analysis", {
    p_full_name: name,
  });
}

async function getProfile(userId) {
  const { data, error } = await adminClient
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .single();
  assert.equal(error, null, `getProfile error: ${error?.message}`);
  return data;
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

// ── Core update behaviour ─────────────────────────────────────────────────────

describe("update_profile_name_and_retry_analysis — name update", () => {
  test("updates full_name on own profile", async () => {
    const { error } = await updateName(userA.client, "New Name A");
    assert.equal(error, null, `RPC failed: ${error?.message}`);
    const profile = await getProfile(userA.id);
    assert.equal(profile.full_name, "New Name A");

    // clean up task
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);
  });

  test("trims leading and trailing whitespace", async () => {
    const { error } = await updateName(userA.client, "   Trimmed Name   ");
    assert.equal(error, null, `RPC failed: ${error?.message}`);
    const profile = await getProfile(userA.id);
    assert.equal(profile.full_name, "Trimmed Name");

    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);
  });

  test("returns ok:true and has_active_task:true when active CV exists", async () => {
    const { data, error } = await updateName(userA.client, "Valid Name");
    assert.equal(error, null, `RPC failed: ${error?.message}`);
    assert.equal(data.ok, true);
    assert.equal(data.has_active_task, true);

    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);
  });

  test("returns has_active_task:false when user has no active CV", async () => {
    // userB was created without uploading a CV
    const { data, error } = await updateName(userB.client, "No CV User");
    assert.equal(error, null, `RPC failed: ${error?.message}`);
    assert.equal(data.ok, true);
    assert.equal(data.has_active_task, false);
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe("update_profile_name_and_retry_analysis — validation", () => {
  test("rejects an empty string", async () => {
    const { error } = await updateName(userA.client, "");
    assert.ok(error, "expected an error for empty name");
    assert.match(error.message, /cannot be empty/i);
  });

  test("rejects a whitespace-only string", async () => {
    const { error } = await updateName(userA.client, "   ");
    assert.ok(error, "expected an error for whitespace-only name");
    assert.match(error.message, /cannot be empty/i);
  });

  test("rejects a name exceeding 200 characters", async () => {
    const longName = "A".repeat(201);
    const { error } = await updateName(userA.client, longName);
    assert.ok(error, "expected an error for overly long name");
    assert.match(error.message, /must not exceed/i);
  });

  test("accepts a name exactly 200 characters long", async () => {
    const name = "A".repeat(200);
    const { error } = await updateName(userA.client, name);
    assert.equal(error, null, `200-char name rejected: ${error?.message}`);

    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    // restore a sensible name for later tests
    await updateName(userA.client, "Valid Name A");
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);
  });
});

// ── Task deduplication ────────────────────────────────────────────────────────

describe("update_profile_name_and_retry_analysis — task deduplication", () => {
  test("queues exactly one task after a single name update", async () => {
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    await updateName(userA.client, "Dedup Test Name");
    const tasks = await getActiveTasks(userA.id);
    assert.equal(tasks.length, 1, `expected 1 active task, got ${tasks.length}`);
    assert.equal(tasks[0].trigger, "user_request");
    assert.equal(tasks[0].status, "pending");
    // Confirms the task targets the active CV, not a stale historical row.
    const { data: fullTask } = await adminClient
      .from("analysis_tasks")
      .select("cv_id")
      .eq("id", tasks[0].id)
      .single();
    assert.equal(fullTask.cv_id, cvA.id, "task cv_id must match the active CV");

    await markTaskComplete(tasks[0].id);
  });

  test("does not create a duplicate when an active task already exists", async () => {
    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);

    // First update creates the task.
    await updateName(userA.client, "First Update");
    const afterFirst = await getActiveTasks(userA.id);
    assert.equal(afterFirst.length, 1, "expected 1 task after first update");
    const firstTaskId = afterFirst[0].id;

    // Second update while the task is still pending must NOT create a second one.
    await updateName(userA.client, "Second Update");
    const afterSecond = await getActiveTasks(userA.id);
    assert.equal(afterSecond.length, 1, "duplicate task created — expected still 1");
    assert.equal(afterSecond[0].id, firstTaskId, "task id must be unchanged");

    await markTaskComplete(firstTaskId);
  });
});

// ── Security ──────────────────────────────────────────────────────────────────

describe("update_profile_name_and_retry_analysis — security", () => {
  test("unauthenticated (anon) call is rejected", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("update_profile_name_and_retry_analysis", {
      p_full_name: "Anon Hacker",
    });
    assert.ok(error, "expected anon call to fail");
  });

  test("userA cannot update userB's profile", async () => {
    // The RPC uses auth.uid() internally — there is no parameter to supply
    // a target user_id. Calling it as userA only ever touches userA's row.
    await updateName(userA.client, "UserA Overwrite Attempt");
    const profileB = await getProfile(userB.id);
    // userB's name should remain unchanged (set to "No CV User" in an
    // earlier test, or whatever the trigger produced).
    assert.notEqual(
      profileB.full_name,
      "UserA Overwrite Attempt",
      "userA must not be able to overwrite userB's full_name"
    );

    for (const t of await getActiveTasks(userA.id)) await markTaskComplete(t.id);
  });
});
