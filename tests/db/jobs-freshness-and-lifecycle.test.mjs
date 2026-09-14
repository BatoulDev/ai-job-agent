// P0 remediation — jobs freshness/geography/status extension
// (supabase/migrations/20260914120000_add_jobs_freshness_and_geography.sql).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  insertFakeJob,
  deleteFakeJobs,
  createTestUser,
  deleteTestUsers,
} from "./helpers.mjs";

const jobIdsToClean = [];

before(async () => {
  await assertExpectedLocalProject();
});

after(async () => {
  await deleteFakeJobs(jobIdsToClean);
});

test("a newly inserted job has no freshness timestamps by default (ingestion sets them explicitly)", async () => {
  const job = await insertFakeJob();
  jobIdsToClean.push(job.id);
  assert.equal(job.first_seen_at, null);
  assert.equal(job.last_seen_at, null);
  assert.equal(job.closed_at, null);
});

test("the widened status check accepts every new lifecycle value and rejects an invalid one", async () => {
  for (const status of ["pending_review", "active", "closed", "expired", "unavailable", "rejected", "source_error"]) {
    const job = await insertFakeJob({ status });
    jobIdsToClean.push(job.id);
    assert.equal(job.status, status);
  }

  const { error } = await adminClient.from("jobs").insert({
    title: "Invalid status",
    company_name: "Test Co",
    description: "x",
    application_method: "external_link",
    application_url: "https://example.test",
    source_type: "admin_manual",
    status: "totally_made_up",
  });
  assert.notEqual(error, null);
});

test("closed_at is stamped when status transitions into a terminal state, and cleared on reactivation", async () => {
  const job = await insertFakeJob({ status: "active" });
  jobIdsToClean.push(job.id);
  assert.equal(job.closed_at, null);

  const { data: closed } = await adminClient.from("jobs").update({ status: "closed" }).eq("id", job.id).select().single();
  assert.notEqual(closed.closed_at, null);

  const { data: reactivated } = await adminClient.from("jobs").update({ status: "active" }).eq("id", job.id).select().single();
  assert.equal(reactivated.closed_at, null);
});

test("closed_at is not touched by an update that leaves status unchanged", async () => {
  const job = await insertFakeJob({ status: "closed" });
  jobIdsToClean.push(job.id);
  const firstClosedAt = job.closed_at;
  assert.notEqual(firstClosedAt, null);

  await new Promise((resolve) => setTimeout(resolve, 10));
  const { data: updated } = await adminClient.from("jobs").update({ title: "Renamed" }).eq("id", job.id).select().single();
  assert.equal(updated.closed_at, firstClosedAt);
});

test("country_code must reference a real countries row", async () => {
  const job = await insertFakeJob({ country_code: "LB" });
  jobIdsToClean.push(job.id);
  assert.equal(job.country_code, "LB");

  const { error } = await adminClient.from("jobs").insert({
    title: "Bad country",
    company_name: "Test Co",
    description: "x",
    application_method: "external_link",
    application_url: "https://example.test",
    source_type: "admin_manual",
    country_code: "ZZ_NOT_REAL",
  });
  assert.notEqual(error, null);
});

test("first_seen_at/last_seen_at/last_checked_at/last_successful_check_at are independently settable, as an ingestion worker needs", async () => {
  const now = new Date().toISOString();
  const job = await insertFakeJob({
    first_seen_at: now,
    last_seen_at: now,
    last_checked_at: now,
    // last_successful_check_at deliberately omitted — simulates a check that
    // was attempted but failed, without ever asserting the job is gone.
  });
  jobIdsToClean.push(job.id);
  assert.equal(new Date(job.first_seen_at).getTime(), new Date(now).getTime());
  assert.equal(new Date(job.last_checked_at).getTime(), new Date(now).getTime());
  assert.equal(job.last_successful_check_at, null);
  assert.equal(job.status, "active"); // a failed check alone never flips status
});

test("ordinary users still cannot write the new lifecycle columns directly (admin-only jobs write policy is unaffected)", async () => {
  const job = await insertFakeJob();
  jobIdsToClean.push(job.id);
  const user = await createTestUser("jobs-lifecycle-user");
  try {
    const { error } = await user.client.from("jobs").update({ status: "closed", status_reason: "forged" }).eq("id", job.id);
    assert.equal(error, null); // RLS silently matches 0 rows, same existing contract as jobs-and-admin.test.mjs
    const { data: unchanged } = await adminClient.from("jobs").select("status, status_reason").eq("id", job.id).single();
    assert.equal(unchanged.status, "active");
    assert.equal(unchanged.status_reason, null);
  } finally {
    await deleteTestUsers([user]);
  }
});
