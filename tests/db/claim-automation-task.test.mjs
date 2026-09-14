// P0 remediation — automation_tasks claim function
// (supabase/migrations/20260914110000_create_claim_automation_task.sql).
// Mirrors the concurrency/lease/permission contract claim_analysis_task
// already proves for analysis_tasks, applied to the generic outbox table.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, createAnonClient, createTestUser, deleteTestUsers } from "./helpers.mjs";

let ordinaryUser;
const taskIdsToClean = [];

before(async () => {
  await assertExpectedLocalProject();
  ordinaryUser = await createTestUser("claim-automation-task-user");
});

after(async () => {
  if (taskIdsToClean.length > 0) {
    await adminClient.from("automation_tasks").delete().in("id", taskIdsToClean);
  }
  await deleteTestUsers([ordinaryUser]);
});

async function insertTask(overrides = {}) {
  const { data, error } = await adminClient
    .from("automation_tasks")
    .insert({
      task_type: "job_matching",
      subject_type: "match",
      subject_id: randomUUID(),
      idempotency_key: `claim-test-${randomUUID()}`,
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`insertTask failed: ${error.message}`);
  taskIdsToClean.push(data.id);
  return data;
}

test("claim_automation_task claims a pending task and stamps locked_by/locked_at", async () => {
  const task = await insertTask();

  const { data: claimed, error } = await adminClient.rpc("claim_automation_task", {
    p_worker_id: "test-worker-1",
    p_batch_size: 5,
  });
  assert.equal(error, null);
  const row = claimed.find((t) => t.id === task.id);
  assert.notEqual(row, undefined);
  assert.equal(row.status, "processing");
  assert.equal(row.locked_by, "test-worker-1");
  assert.notEqual(row.locked_at, null);
  assert.equal(row.attempt_count, 1);
});

test("claim_automation_task never claims the same task twice while it is still processing", async () => {
  const task = await insertTask();

  const { data: first } = await adminClient.rpc("claim_automation_task", { p_worker_id: "w1", p_batch_size: 10 });
  assert.ok(first.some((t) => t.id === task.id));

  const { data: second } = await adminClient.rpc("claim_automation_task", { p_worker_id: "w2", p_batch_size: 10 });
  assert.equal(second.some((t) => t.id === task.id), false);
});

test("concurrent claim_automation_task callers claim disjoint rows (FOR UPDATE SKIP LOCKED)", async () => {
  const tasks = await Promise.all([insertTask(), insertTask(), insertTask(), insertTask()]);

  const [batchA, batchB] = await Promise.all([
    adminClient.rpc("claim_automation_task", { p_worker_id: "concurrent-a", p_batch_size: 2 }),
    adminClient.rpc("claim_automation_task", { p_worker_id: "concurrent-b", p_batch_size: 2 }),
  ]);
  assert.equal(batchA.error, null);
  assert.equal(batchB.error, null);

  const idsA = new Set(batchA.data.map((t) => t.id));
  const idsB = new Set(batchB.data.map((t) => t.id));
  for (const id of idsA) {
    assert.equal(idsB.has(id), false, `task ${id} claimed by both concurrent callers`);
  }

  const relevantClaimed = [...idsA, ...idsB].filter((id) => tasks.some((t) => t.id === id));
  const uniqueRelevant = new Set(relevantClaimed);
  assert.equal(relevantClaimed.length, uniqueRelevant.size);
});

test("a lease-expired processing task with attempts remaining is reclaimed", async () => {
  const task = await insertTask();
  const staleLock = new Date(Date.now() - 15 * 60_000).toISOString(); // 15 min ago, past the 10-min lease
  await adminClient
    .from("automation_tasks")
    .update({ status: "processing", locked_by: "dead-worker", locked_at: staleLock, attempt_count: 1 })
    .eq("id", task.id);

  const { data: reclaimed, error } = await adminClient.rpc("claim_automation_task", {
    p_worker_id: "reclaimer",
    p_batch_size: 10,
  });
  assert.equal(error, null);
  const row = reclaimed.find((t) => t.id === task.id);
  assert.notEqual(row, undefined);
  assert.equal(row.locked_by, "reclaimer");
  assert.equal(row.attempt_count, 2);
  assert.match(row.last_error, /Reclaimed after lease expiry/);
});

test("a processing task still within its lease is NOT reclaimed", async () => {
  const task = await insertTask();
  await adminClient
    .from("automation_tasks")
    .update({ status: "processing", locked_by: "active-worker", locked_at: new Date().toISOString(), attempt_count: 1 })
    .eq("id", task.id);

  const { data: claimed } = await adminClient.rpc("claim_automation_task", { p_worker_id: "intruder", p_batch_size: 10 });
  assert.equal(claimed.some((t) => t.id === task.id), false);
});

test("fail_stale_automation_tasks permanently fails a lease-expired task with no attempts left", async () => {
  const task = await insertTask({ max_attempts: 1 });
  const staleLock = new Date(Date.now() - 15 * 60_000).toISOString();
  await adminClient
    .from("automation_tasks")
    .update({ status: "processing", locked_by: "dead-worker", locked_at: staleLock, attempt_count: 1 })
    .eq("id", task.id);

  const { data: failedCount, error } = await adminClient.rpc("fail_stale_automation_tasks", { p_lease_minutes: 10 });
  assert.equal(error, null);
  assert.ok(failedCount >= 1);

  const { data: row } = await adminClient
    .from("automation_tasks")
    .select("status, failed_at, completed_at, last_error")
    .eq("id", task.id)
    .single();
  assert.equal(row.status, "failed");
  assert.notEqual(row.failed_at, null);
  assert.equal(row.completed_at, null); // completed_at is reserved for genuine success, never failure
  assert.match(row.last_error, /Permanently failed/);
});

test("fail_stale_automation_tasks does not touch a task still within its lease or with attempts remaining", async () => {
  const withinLease = await insertTask({ max_attempts: 1 });
  await adminClient
    .from("automation_tasks")
    .update({ status: "processing", locked_by: "w", locked_at: new Date().toISOString(), attempt_count: 1 })
    .eq("id", withinLease.id);

  const attemptsRemaining = await insertTask({ max_attempts: 3 });
  const staleLock = new Date(Date.now() - 15 * 60_000).toISOString();
  await adminClient
    .from("automation_tasks")
    .update({ status: "processing", locked_by: "w", locked_at: staleLock, attempt_count: 1 })
    .eq("id", attemptsRemaining.id);

  await adminClient.rpc("fail_stale_automation_tasks", { p_lease_minutes: 10 });

  const { data: rows } = await adminClient
    .from("automation_tasks")
    .select("id, status")
    .in("id", [withinLease.id, attemptsRemaining.id]);
  for (const row of rows) {
    assert.equal(row.status, "processing");
  }
});

test("neither claim_automation_task nor fail_stale_automation_tasks is executable by anon or authenticated", async () => {
  const anon = createAnonClient();
  const { error: anonClaimError } = await anon.rpc("claim_automation_task", { p_worker_id: "x", p_batch_size: 1 });
  assert.notEqual(anonClaimError, null);
  const { error: anonFailError } = await anon.rpc("fail_stale_automation_tasks", { p_lease_minutes: 10 });
  assert.notEqual(anonFailError, null);

  const { error: userClaimError } = await ordinaryUser.client.rpc("claim_automation_task", {
    p_worker_id: "x",
    p_batch_size: 1,
  });
  assert.notEqual(userClaimError, null);
  const { error: userFailError } = await ordinaryUser.client.rpc("fail_stale_automation_tasks", {
    p_lease_minutes: 10,
  });
  assert.notEqual(userFailError, null);
});
