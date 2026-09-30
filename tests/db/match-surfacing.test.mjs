// DB tests for public.surface_new_matches_for_user() (Phase 07) against the
// real local Supabase instance — quota enforcement, idempotency, ordering,
// and ownership.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers, uploadFakeCv, insertFakeAnalysis, deleteFakeJobs, createAnonClient } from "./helpers.mjs";

const jobIdsToClean = [];
let user;
let analysis;

before(async () => {
  await assertExpectedLocalProject();
  user = await createTestUser("match-surfacing");
  const cv = await uploadFakeCv(user, "match-surfacing.pdf");
  const created = await insertFakeAnalysis(user, cv.id);
  const { data: approved, error } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
  if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);
  analysis = approved;

  // free plan (this fixture user's default) has job_match_limit 1 — bump to
  // a small, easy-to-reason-about number for these tests via a real plan
  // change rather than hand-editing plans (never mutate the canonical catalog).
  const { error: subError } = await adminClient.from("subscriptions").update({ plan_code: "pro", provider: "whish" }).eq("user_id", user.id);
  if (subError) throw new Error(`failed to set fixture user to pro: ${subError.message}`);
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
      title: "Fixture Match Surfacing Job",
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

async function insertFixtureMatch(jobId, score) {
  const { data, error } = await adminClient
    .from("matches")
    .insert({ user_id: user.id, job_id: jobId, cv_analysis_id: analysis.id, score, matching_model: "test-fixture" })
    .select()
    .single();
  if (error) throw new Error(`fixture match insert failed: ${error.message}`);
  return data;
}

test("surface_new_matches_for_user: an unauthenticated call is rejected", async () => {
  const anon = createAnonClient();
  const { error } = await anon.rpc("surface_new_matches_for_user");
  assert.notEqual(error, null);
});

test("surface_new_matches_for_user: surfaces up to the plan's job_match_limit, highest score first, and stops there", async () => {
  const { error: limitError } = await adminClient.from("plans").select("job_match_limit").eq("plan_code", "pro").single();
  assert.equal(limitError, null);

  const jobLow = await insertFixtureJob({ title: "Low Score Job" });
  const jobHigh = await insertFixtureJob({ title: "High Score Job" });
  const jobMid = await insertFixtureJob({ title: "Mid Score Job" });
  await insertFixtureMatch(jobLow.id, 40);
  await insertFixtureMatch(jobHigh.id, 90);
  await insertFixtureMatch(jobMid.id, 65);

  const { data, error } = await user.client.rpc("surface_new_matches_for_user");
  assert.equal(error, null);

  // Pro's job_match_limit is 95 (public.plans — see
  // 20260930150000_update_student_pro_job_match_limits.sql) — comfortably
  // above our 3 fixture matches, so all three should surface, ordered by
  // score desc.
  assert.equal(data.length, 3);
  assert.deepEqual(data.map((m) => m.score), [90, 65, 40]);
  assert.ok(data.every((m) => m.surfaced_at !== null));
});

test("surface_new_matches_for_user: is idempotent — re-calling never re-surfaces or duplicates", async () => {
  const first = await user.client.rpc("surface_new_matches_for_user");
  const second = await user.client.rpc("surface_new_matches_for_user");
  assert.equal(second.error, null);
  assert.equal(second.data.length, first.data.length);
  assert.deepEqual(
    second.data.map((m) => m.id).sort(),
    first.data.map((m) => m.id).sort()
  );
});

test("surface_new_matches_for_user: never returns another user's matches", async () => {
  const otherUser = await createTestUser("match-surfacing-other");
  try {
    const { data, error } = await otherUser.client.rpc("surface_new_matches_for_user");
    assert.equal(error, null);
    assert.equal(data.length, 0, "a user with no approved analysis must surface nothing");
  } finally {
    await deleteTestUsers([otherUser]);
  }
});

test("surface_new_matches_for_user: enforces the plan limit across separate calls", async () => {
  const freeUser = await createTestUser("match-surfacing-free");
  try {
    const cv = await uploadFakeCv(freeUser, "match-surfacing-free.pdf");
    const created = await insertFakeAnalysis(freeUser, cv.id);
    const { data: approved } = await freeUser.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });

    const jobA = await insertFixtureJob({ title: "Free Plan Job A" });
    const jobB = await insertFixtureJob({ title: "Free Plan Job B" });
    await adminClient.from("matches").insert([
      { user_id: freeUser.id, job_id: jobA.id, cv_analysis_id: approved.id, score: 80, matching_model: "test-fixture" },
      { user_id: freeUser.id, job_id: jobB.id, cv_analysis_id: approved.id, score: 70, matching_model: "test-fixture" },
    ]);

    // Free plan's job_match_limit is 1 (AGENTS.md §6).
    const { data, error } = await freeUser.client.rpc("surface_new_matches_for_user");
    assert.equal(error, null);
    assert.equal(data.length, 1, "free plan must never surface more than its job_match_limit");
    assert.equal(data[0].score, 80, "the highest-scoring match must be the one surfaced");

    // A second call must not surface the remaining match either — the limit
    // is already met.
    const second = await freeUser.client.rpc("surface_new_matches_for_user");
    assert.equal(second.data.length, 1);
  } finally {
    await adminClient.from("matches").delete().eq("user_id", freeUser.id);
    await deleteTestUsers([freeUser]);
  }
});
