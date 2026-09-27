// DB tests for public.get_my_matches(p_status) (Phase 07) against the real
// local Supabase instance — the RLS-bypass fix for jobs that have gone
// non-active since a match was created, ownership isolation, and input
// validation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers, uploadFakeCv, insertFakeAnalysis, deleteFakeJobs, createAnonClient } from "./helpers.mjs";

const jobIdsToClean = [];
let user;
let analysis;

before(async () => {
  await assertExpectedLocalProject();
  user = await createTestUser("get-my-matches");
  const cv = await uploadFakeCv(user, "get-my-matches.pdf");
  const created = await insertFakeAnalysis(user, cv.id);
  const { data: approved, error } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
  if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);
  analysis = approved;
});

after(async () => {
  await adminClient.from("matches").delete().eq("user_id", user.id);
  await deleteFakeJobs(jobIdsToClean);
  await deleteTestUsers([user]);
});

async function insertFixtureJob(overrides = {}) {
  const { data, error } = await adminClient
    .from("jobs")
    .insert({
      title: "Fixture Get My Matches Job",
      company_name: "Fixture Co",
      description: "A fake job fixture for automated tests only.",
      application_method: "external_link",
      application_url: "https://example.test/apply",
      source_type: "admin_manual",
      status: "active",
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`fixture job insert failed: ${error.message}`);
  jobIdsToClean.push(data.id);
  return data;
}

async function insertFixtureMatch(jobId, overrides = {}) {
  const { data, error } = await adminClient
    .from("matches")
    .insert({
      user_id: user.id,
      job_id: jobId,
      cv_analysis_id: analysis.id,
      score: 80,
      matching_model: "test-fixture",
      surfaced_at: new Date().toISOString(),
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`fixture match insert failed: ${error.message}`);
  return data;
}

test("get_my_matches: an unauthenticated call is rejected", async () => {
  const anon = createAnonClient();
  const { error } = await anon.rpc("get_my_matches", { p_status: "pending_review" });
  assert.notEqual(error, null);
});

test("get_my_matches: rejects an invalid status value", async () => {
  const { error } = await user.client.rpc("get_my_matches", { p_status: "not_a_real_status" });
  assert.notEqual(error, null);
});

test("get_my_matches: returns job details for a match even after the job's status changes away from active", async () => {
  const job = await insertFixtureJob();
  await insertFixtureMatch(job.id);

  // Confirm the RLS gap actually exists first: a direct client-side jobs
  // query for a non-active job must return nothing.
  const { error: closeError } = await adminClient.from("jobs").update({ status: "closed" }).eq("id", job.id);
  assert.equal(closeError, null);
  const direct = await user.client.from("jobs").select("id").eq("id", job.id).maybeSingle();
  assert.equal(direct.data, null, "sanity check: jobs_select_active must hide a closed job from a direct query");

  // get_my_matches must still surface it, because ownership of the match
  // is independently re-verified, not delegated to jobs_select_active.
  const { data, error } = await user.client.rpc("get_my_matches", { p_status: "pending_review" });
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.equal(data[0].job_id, job.id);
  assert.equal(data[0].job_status, "closed");
  assert.equal(data[0].job_title, "Fixture Get My Matches Job");
});

test("get_my_matches: never returns another user's matches", async () => {
  const otherUser = await createTestUser("get-my-matches-other");
  try {
    const { data, error } = await otherUser.client.rpc("get_my_matches", { p_status: "pending_review" });
    assert.equal(error, null);
    assert.equal(data.length, 0);
  } finally {
    await deleteTestUsers([otherUser]);
  }
});

test("get_my_matches: never returns an unsurfaced match", async () => {
  const job = await insertFixtureJob({ title: "Unsurfaced Job" });
  await insertFixtureMatch(job.id, { surfaced_at: null });

  const { data, error } = await user.client.rpc("get_my_matches", { p_status: "pending_review" });
  assert.equal(error, null);
  assert.ok(!data.some((m) => m.job_id === job.id), "an unsurfaced match must never be returned");
});

test("get_my_matches: filters by status and orders by score descending", async () => {
  await adminClient.from("matches").delete().eq("user_id", user.id);

  const jobA = await insertFixtureJob({ title: "Status Filter Job A" });
  const jobB = await insertFixtureJob({ title: "Status Filter Job B" });
  const jobRejected = await insertFixtureJob({ title: "Status Filter Rejected Job" });
  await insertFixtureMatch(jobA.id, { score: 60 });
  await insertFixtureMatch(jobB.id, { score: 95 });
  await insertFixtureMatch(jobRejected.id, { score: 70, status: "user_rejected", decided_at: new Date().toISOString() });

  const pending = await user.client.rpc("get_my_matches", { p_status: "pending_review" });
  assert.equal(pending.error, null);
  assert.deepEqual(pending.data.map((m) => m.job_id), [jobB.id, jobA.id]);

  const rejected = await user.client.rpc("get_my_matches", { p_status: "user_rejected" });
  assert.equal(rejected.error, null);
  assert.deepEqual(rejected.data.map((m) => m.job_id), [jobRejected.id]);
});
