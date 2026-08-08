// Phase 10 — Jobs and admin authorization.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
  insertFakeJob,
  deleteFakeJobs,
} from "./helpers.mjs";

let admin;
let ordinaryUser;
const jobIdsToClean = [];

before(async () => {
  await assertExpectedLocalProject();
  admin = await createTestUser("jobs-admin");
  ordinaryUser = await createTestUser("jobs-user");
  const { data: promoted, error: promoteError } = await adminClient
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", admin.id)
    .select()
    .single();
  if (promoteError) throw new Error(`Failed to promote fixture admin: ${promoteError.message}`);
  if (promoted.role !== "admin") throw new Error(`Promotion did not stick: role is "${promoted.role}"`);
});

after(async () => {
  await deleteFakeJobs(jobIdsToClean);
  await deleteTestUsers([admin, ordinaryUser]);
});

test("admin can create and manage jobs", async () => {
  const { data, error } = await admin.client
    .from("jobs")
    .insert({
      title: "Admin-created job",
      company_name: "Test Co",
      description: "Fixture job",
      application_method: "external_link",
      application_url: "https://example.test/apply",
      source_type: "admin_manual",
    })
    .select()
    .single();
  assert.equal(error, null);
  jobIdsToClean.push(data.id);

  const { error: updateError } = await admin.client
    .from("jobs")
    .update({ status: "closed" })
    .eq("id", data.id);
  assert.equal(updateError, null);
});

test("ordinary user cannot create, update, or delete jobs", async () => {
  const job = await insertFakeJob();
  jobIdsToClean.push(job.id);

  const { error: insertError } = await ordinaryUser.client.from("jobs").insert({
    title: "Should fail",
    company_name: "Nope",
    description: "x",
    application_method: "external_link",
    application_url: "https://example.test",
    source_type: "admin_manual",
  });
  assert.notEqual(insertError, null);

  const { error: updateError } = await ordinaryUser.client.from("jobs").update({ status: "closed" }).eq("id", job.id);
  assert.equal(updateError, null); // RLS silently matches 0 rows
  const { data: unchanged } = await adminClient.from("jobs").select("status").eq("id", job.id).single();
  assert.equal(unchanged.status, "active");

  const { error: deleteError } = await ordinaryUser.client.from("jobs").delete().eq("id", job.id);
  assert.equal(deleteError, null);
  const { data: stillThere } = await adminClient.from("jobs").select("id").eq("id", job.id).maybeSingle();
  assert.notEqual(stillThere, null);
});

test("ordinary users can read active jobs but not closed/expired ones", async () => {
  const activeJob = await insertFakeJob({ title: "Visible job" });
  const closedJob = await insertFakeJob({ title: "Hidden job", status: "closed" });
  jobIdsToClean.push(activeJob.id, closedJob.id);

  const { data } = await ordinaryUser.client.from("jobs").select("id").in("id", [activeJob.id, closedJob.id]);
  const ids = data.map((j) => j.id);
  assert.ok(ids.includes(activeJob.id));
  assert.ok(!ids.includes(closedJob.id));
});

test("duplicate (source_type, external_id) is rejected", async () => {
  const externalId = `gh-dup-test-${randomUUID()}`;
  const job1 = await insertFakeJob({ source_type: "greenhouse", external_id: externalId });
  jobIdsToClean.push(job1.id);

  const { error } = await adminClient.from("jobs").insert({
    title: "Duplicate external id",
    company_name: "Test Co",
    description: "x",
    application_method: "external_link",
    application_url: "https://example.test",
    source_type: "greenhouse",
    external_id: externalId,
  });
  assert.notEqual(error, null);
});

test("manually entered jobs (no external_id) never collide with each other", async () => {
  const job1 = await insertFakeJob({ title: "Manual 1" });
  const job2 = await insertFakeJob({ title: "Manual 2" });
  jobIdsToClean.push(job1.id, job2.id);
  // Both succeeded (insertFakeJob throws on error) — dedup key correctly
  // does not apply to admin_manual rows with no external_id.
});

test("invalid application-method/target combinations are rejected", async () => {
  const { error } = await adminClient.from("jobs").insert({
    title: "Missing url",
    company_name: "Test Co",
    description: "x",
    application_method: "external_link",
    application_url: null,
    source_type: "admin_manual",
  });
  assert.notEqual(error, null);
});

test("a LinkedIn job can never be marked eligible for automated email sending", async () => {
  const { error } = await adminClient.from("jobs").insert({
    title: "LinkedIn job",
    company_name: "Test Co",
    description: "x",
    application_method: "email",
    application_email: "apply@example.test",
    source_type: "linkedin",
  });
  assert.notEqual(error, null);
});
