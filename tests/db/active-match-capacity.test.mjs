// DB tests for Model C's active-capacity predicate (founder decision,
// 2026-09-30) — public.count_active_matches_for_user() and its consumption
// by public.surface_new_matches_for_user(). See
// supabase/migrations/20260930160000_add_model_c_active_capacity_and_daily_limits.sql
// and docs/PRODUCT_MATCHING_RULES.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers, uploadFakeCv, insertFakeAnalysis, deleteFakeJobs } from "./helpers.mjs";

async function setupProUser(namePrefix) {
  const user = await createTestUser(namePrefix);
  await adminClient.from("subscriptions").update({ plan_code: "pro", provider: "whish" }).eq("user_id", user.id);
  const cv = await uploadFakeCv(user, `${namePrefix}.pdf`);
  const created = await insertFakeAnalysis(user, cv.id);
  const { data: analysis, error } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
  if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);
  return { user, analysis };
}

async function insertJob(jobIdsToClean, overrides = {}) {
  const { data, error } = await adminClient
    .from("jobs")
    .insert({
      title: "Fixture Capacity Job",
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

async function insertMatch(userId, analysisId, jobId, overrides = {}) {
  const { data, error } = await adminClient
    .from("matches")
    .insert({
      user_id: userId,
      job_id: jobId,
      cv_analysis_id: analysisId,
      score: 80,
      status: "pending_review",
      matching_model: "test-fixture",
      surfaced_at: new Date().toISOString(),
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`fixture match insert failed: ${error.message}`);
  return data;
}

async function countActive(userId) {
  const { data, error } = await adminClient.rpc("count_active_matches_for_user", { p_user_id: userId });
  if (error) throw new Error(`count_active_matches_for_user failed: ${error.message}`);
  return data;
}

test("count_active_matches_for_user: a surfaced pending_review match on an active job counts as 1 active slot", async () => {
  await assertExpectedLocalProject();
  const { user, analysis } = await setupProUser("capacity-pending");
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean);
    await insertMatch(user.id, analysis.id, job.id);
    assert.equal(await countActive(user.id), 1);
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("count_active_matches_for_user: a surfaced user_approved match with no application yet still counts", async () => {
  const { user, analysis } = await setupProUser("capacity-approved");
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean);
    await insertMatch(user.id, analysis.id, job.id, { status: "user_approved", decided_at: new Date().toISOString() });
    assert.equal(await countActive(user.id), 1, "approved-but-not-yet-applied must still be an active opportunity");
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("count_active_matches_for_user: a user_rejected match never counts", async () => {
  const { user, analysis } = await setupProUser("capacity-rejected");
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean);
    await insertMatch(user.id, analysis.id, job.id, { status: "user_rejected", decided_at: new Date().toISOString() });
    assert.equal(await countActive(user.id), 0);
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

for (const jobStatus of ["expired", "closed", "unavailable", "rejected", "source_error"]) {
  test(`count_active_matches_for_user: a match whose job.status = '${jobStatus}' never counts`, async () => {
    const { user, analysis } = await setupProUser(`capacity-job-${jobStatus}`);
    const jobIdsToClean = [];
    try {
      const job = await insertJob(jobIdsToClean, { status: jobStatus });
      await insertMatch(user.id, analysis.id, job.id);
      assert.equal(await countActive(user.id), 0);
    } finally {
      await adminClient.from("matches").delete().eq("user_id", user.id);
      await deleteFakeJobs(jobIdsToClean);
      await deleteTestUsers([user]);
    }
  });
}

test("count_active_matches_for_user: a not-yet-surfaced pending_review match (surfaced_at null) never counts", async () => {
  const { user, analysis } = await setupProUser("capacity-unsurfaced");
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean);
    await insertMatch(user.id, analysis.id, job.id, { surfaced_at: null });
    assert.equal(await countActive(user.id), 0);
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("count_active_matches_for_user: an approved match with a 'pending_send' application still counts (still actionable)", async () => {
  const { user, analysis } = await setupProUser("capacity-pending-send");
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean);
    const match = await insertMatch(user.id, analysis.id, job.id, { status: "user_approved", decided_at: new Date().toISOString() });
    const { error: appError } = await adminClient.from("applications").insert({
      user_id: user.id,
      match_id: match.id,
      job_id: job.id,
      application_method: "external_link",
      approved_at: new Date().toISOString(),
      approved_by: user.id,
      status: "pending_send",
      idempotency_key: `capacity-test-${match.id}`,
    });
    if (appError) throw new Error(`fixture application insert failed: ${appError.message}`);
    assert.equal(await countActive(user.id), 1, "a not-yet-sent application must not free the slot");
  } finally {
    await adminClient.from("applications").delete().eq("user_id", user.id);
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("count_active_matches_for_user: an approved match with a 'sent' application no longer counts — conceptually finished, moved to history", async () => {
  const { user, analysis } = await setupProUser("capacity-sent");
  const jobIdsToClean = [];
  try {
    const job = await insertJob(jobIdsToClean);
    const match = await insertMatch(user.id, analysis.id, job.id, { status: "user_approved", decided_at: new Date().toISOString() });
    const { error: appError } = await adminClient.from("applications").insert({
      user_id: user.id,
      match_id: match.id,
      job_id: job.id,
      application_method: "external_link",
      approved_at: new Date().toISOString(),
      approved_by: user.id,
      status: "sent",
      idempotency_key: `capacity-test-sent-${match.id}`,
    });
    if (appError) throw new Error(`fixture application insert failed: ${appError.message}`);
    assert.equal(await countActive(user.id), 0, "a sent application must free the active-capacity slot");

    // History must remain fully intact even though it no longer occupies capacity.
    const { data: historyRows, error: historyError } = await user.client.rpc("get_my_matches", { p_status: "user_approved" });
    if (historyError) throw new Error(`get_my_matches failed: ${historyError.message}`);
    assert.ok(historyRows.some((r) => r.match_id === match.id), "the match must still be visible in approved history");
  } finally {
    await adminClient.from("applications").delete().eq("user_id", user.id);
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("surface_new_matches_for_user: rejecting a match frees a capacity slot that a later call can fill (Scenario C)", async () => {
  const { user, analysis } = await setupProUser("capacity-reject-refill");
  const jobIdsToClean = [];
  try {
    // Temporarily shrink pro's active capacity to 1 so this test is fast
    // and exact, restoring it in the finally block below.
    const { error: lowerError } = await adminClient.from("plans").update({ job_match_limit: 1 }).eq("plan_code", "pro");
    if (lowerError) throw new Error(`failed to lower pro job_match_limit: ${lowerError.message}`);

    try {
      const jobA = await insertJob(jobIdsToClean, { title: "Capacity Reject A" });
      const matchA = await insertMatch(user.id, analysis.id, jobA.id);
      assert.equal(await countActive(user.id), 1, "capacity is now fully occupied");

      // A second strong candidate exists but is not yet surfaced.
      const jobB = await insertJob(jobIdsToClean, { title: "Capacity Reject B" });
      await adminClient.from("matches").insert({
        user_id: user.id,
        job_id: jobB.id,
        cv_analysis_id: analysis.id,
        score: 95,
        status: "pending_review",
        matching_model: "test-fixture",
        surfaced_at: null,
      });

      const { data: beforeReject } = await user.client.rpc("surface_new_matches_for_user");
      assert.equal((beforeReject ?? []).filter((m) => m.job_id === jobB.id).length, 0, "capacity is full — job B must not surface yet");

      // Reject match A — frees the one occupied slot.
      const { error: rejectError } = await user.client.rpc("reject_match", { p_match_id: matchA.id });
      if (rejectError) throw new Error(`reject_match failed: ${rejectError.message}`);
      assert.equal(await countActive(user.id), 0, "rejecting must immediately free the slot");

      const { data: afterReject, error: surfaceError } = await user.client.rpc("surface_new_matches_for_user");
      if (surfaceError) throw new Error(`surface_new_matches_for_user failed: ${surfaceError.message}`);
      assert.ok(afterReject.some((m) => m.job_id === jobB.id), "the freed slot must be fillable by the next strong candidate");
    } finally {
      await adminClient.from("plans").update({ job_match_limit: 95 }).eq("plan_code", "pro");
    }
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("surface_new_matches_for_user: an underlying job expiring frees its slot for a later call to fill (Scenario D)", async () => {
  const { user, analysis } = await setupProUser("capacity-expire-refill");
  const jobIdsToClean = [];
  try {
    const { error: lowerError } = await adminClient.from("plans").update({ job_match_limit: 1 }).eq("plan_code", "pro");
    if (lowerError) throw new Error(`failed to lower pro job_match_limit: ${lowerError.message}`);

    try {
      const jobA = await insertJob(jobIdsToClean, { title: "Capacity Expire A" });
      await insertMatch(user.id, analysis.id, jobA.id);
      assert.equal(await countActive(user.id), 1);

      const jobB = await insertJob(jobIdsToClean, { title: "Capacity Expire B" });
      await adminClient.from("matches").insert({
        user_id: user.id,
        job_id: jobB.id,
        cv_analysis_id: analysis.id,
        score: 95,
        status: "pending_review",
        matching_model: "test-fixture",
        surfaced_at: null,
      });

      // Simulate the hourly expiry sweep having already run on job A.
      const { error: expireError } = await adminClient.from("jobs").update({ status: "expired" }).eq("id", jobA.id);
      if (expireError) throw new Error(`fixture job expire failed: ${expireError.message}`);
      assert.equal(await countActive(user.id), 0, "an expired job must immediately stop occupying capacity");

      const { data: afterExpiry, error: surfaceError } = await user.client.rpc("surface_new_matches_for_user");
      if (surfaceError) throw new Error(`surface_new_matches_for_user failed: ${surfaceError.message}`);
      assert.ok(afterExpiry.some((m) => m.job_id === jobB.id), "the freed slot must be fillable once the expired job stops occupying it");

      // Job A's own match must remain in history, untouched.
      assert.ok(afterExpiry.some((m) => m.job_id === jobA.id), "the historical match for the now-expired job must still be retrievable, not deleted");
    } finally {
      await adminClient.from("plans").update({ job_match_limit: 95 }).eq("plan_code", "pro");
    }
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});
