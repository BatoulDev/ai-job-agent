// DB tests for Model C's daily new-match allowance (founder decision,
// 2026-09-30) — the daily_new_match_limit half of
// public.surface_new_matches_for_user(). See
// supabase/migrations/20260930160000_add_model_c_active_capacity_and_daily_limits.sql.
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

async function insertPendingMatch(jobIdsToClean, userId, analysisId, score, title) {
  const { data: job, error: jobError } = await adminClient
    .from("jobs")
    .insert({
      title,
      company_name: "Fixture Co",
      description: "Fixture.",
      application_method: "external_link",
      application_url: "https://example.test/apply",
      source_type: "admin_manual",
      status: "active",
    })
    .select()
    .single();
  if (jobError) throw new Error(`fixture job insert failed: ${jobError.message}`);
  jobIdsToClean.push(job.id);

  const { data: match, error: matchError } = await adminClient
    .from("matches")
    .insert({ user_id: userId, job_id: job.id, cv_analysis_id: analysisId, score, status: "pending_review", matching_model: "test-fixture" })
    .select()
    .single();
  if (matchError) throw new Error(`fixture match insert failed: ${matchError.message}`);
  return match;
}

test("surface_new_matches_for_user: never surfaces more than the plan's daily_new_match_limit in one UTC day, even with ample active capacity and strong candidates", async () => {
  await assertExpectedLocalProject();
  const { data: proPlan } = await adminClient.from("plans").select("daily_new_match_limit").eq("plan_code", "pro").single();
  const dailyLimit = proPlan.daily_new_match_limit;
  assert.equal(dailyLimit, 10, "this test assumes the founder-confirmed Pro daily limit of 10");

  const { user, analysis } = await setupProUser("daily-cap-basic");
  const jobIdsToClean = [];
  try {
    for (let i = 0; i < dailyLimit + 5; i++) {
      await insertPendingMatch(jobIdsToClean, user.id, analysis.id, 100 - i, `Daily Cap Job ${i}`);
    }

    const { data, error } = await user.client.rpc("surface_new_matches_for_user");
    if (error) throw new Error(`surface_new_matches_for_user failed: ${error.message}`);
    assert.equal(data.length, dailyLimit, "must never exceed the daily cap even though active capacity and candidates comfortably allow more");
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("surface_new_matches_for_user: fewer strong candidates than the daily limit surfaces only that many — never padded with weaker matches", async () => {
  const { user, analysis } = await setupProUser("daily-cap-few-strong");
  const jobIdsToClean = [];
  try {
    await insertPendingMatch(jobIdsToClean, user.id, analysis.id, 92, "Only Strong Job 1");
    await insertPendingMatch(jobIdsToClean, user.id, analysis.id, 88, "Only Strong Job 2");

    const { data, error } = await user.client.rpc("surface_new_matches_for_user");
    if (error) throw new Error(`surface_new_matches_for_user failed: ${error.message}`);
    assert.equal(data.length, 2, "only 2 real candidates exist — the daily cap of 10 must never be padded to reach a target");
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("surface_new_matches_for_user: two calls within the same UTC day share one combined daily allowance — never exceeded across calls", async () => {
  const { user, analysis } = await setupProUser("daily-cap-multi-call");
  const jobIdsToClean = [];
  try {
    const { error: lowerError } = await adminClient.from("plans").update({ daily_new_match_limit: 3 }).eq("plan_code", "pro");
    if (lowerError) throw new Error(`failed to lower pro daily_new_match_limit: ${lowerError.message}`);

    try {
      for (let i = 0; i < 6; i++) {
        await insertPendingMatch(jobIdsToClean, user.id, analysis.id, 90 - i, `Multi Call Job ${i}`);
      }

      const first = await user.client.rpc("surface_new_matches_for_user");
      if (first.error) throw new Error(`first call failed: ${first.error.message}`);
      assert.equal(first.data.length, 3, "first call must surface exactly the daily limit of 3");

      const second = await user.client.rpc("surface_new_matches_for_user");
      if (second.error) throw new Error(`second call failed: ${second.error.message}`);
      assert.equal(second.data.length, 3, "second call returns the same already-surfaced set — 3 total surfaced today, not 6");

      // A third, fresh ingestion adds even more excellent jobs later the same day.
      await insertPendingMatch(jobIdsToClean, user.id, analysis.id, 99, "Multi Call Late Arrival");
      const third = await user.client.rpc("surface_new_matches_for_user");
      if (third.error) throw new Error(`third call failed: ${third.error.message}`);
      assert.equal(third.data.length, 3, "the day's allowance of 3 is already fully used — a new excellent job must wait for the next day, not exceed the allowance");
    } finally {
      await adminClient.from("plans").update({ daily_new_match_limit: 10 }).eq("plan_code", "pro");
    }
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("surface_new_matches_for_user: active capacity can further lower the number below the daily limit (Part 5 combined-rule example)", async () => {
  const { user, analysis } = await setupProUser("daily-cap-capacity-tighter");
  const jobIdsToClean = [];
  try {
    const { error: lowerError } = await adminClient.from("plans").update({ job_match_limit: 2 }).eq("plan_code", "pro");
    if (lowerError) throw new Error(`failed to lower pro job_match_limit: ${lowerError.message}`);

    try {
      // Daily limit (10) is roomy; active capacity (2) is the binding constraint.
      for (let i = 0; i < 8; i++) {
        await insertPendingMatch(jobIdsToClean, user.id, analysis.id, 90 - i, `Capacity Tighter Job ${i}`);
      }

      const { data, error } = await user.client.rpc("surface_new_matches_for_user");
      if (error) throw new Error(`surface_new_matches_for_user failed: ${error.message}`);
      assert.equal(data.length, 2, "remaining active capacity (2) must win over the roomier daily allowance (10) — min() semantics");
    } finally {
      await adminClient.from("plans").update({ job_match_limit: 95 }).eq("plan_code", "pro");
    }
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("surface_new_matches_for_user: the next UTC calendar day's allowance is available again — no cron/reset job, derived from surfaced_at", async () => {
  const { user, analysis } = await setupProUser("daily-cap-reset");
  const jobIdsToClean = [];
  try {
    const { error: lowerError } = await adminClient.from("plans").update({ daily_new_match_limit: 2 }).eq("plan_code", "pro");
    if (lowerError) throw new Error(`failed to lower pro daily_new_match_limit: ${lowerError.message}`);

    try {
      await insertPendingMatch(jobIdsToClean, user.id, analysis.id, 90, "Reset Day1 Job A");
      await insertPendingMatch(jobIdsToClean, user.id, analysis.id, 89, "Reset Day1 Job B");
      await insertPendingMatch(jobIdsToClean, user.id, analysis.id, 88, "Reset Day1 Job C");

      const day1 = await user.client.rpc("surface_new_matches_for_user");
      if (day1.error) throw new Error(`day1 call failed: ${day1.error.message}`);
      assert.equal(day1.data.length, 2, "today's allowance of 2 is used up");

      // Simulate the calendar day rolling over: backdate the real surfaced_at
      // timestamps to yesterday (UTC) rather than manipulating wall-clock
      // time — deterministic, and exercises the exact column the function reads.
      const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const { error: backdateError } = await adminClient.from("matches").update({ surfaced_at: yesterday }).eq("user_id", user.id).not("surfaced_at", "is", null);
      if (backdateError) throw new Error(`failed to backdate fixture surfaced_at: ${backdateError.message}`);

      const day2 = await user.client.rpc("surface_new_matches_for_user");
      if (day2.error) throw new Error(`day2 call failed: ${day2.error.message}`);
      const newlySurfacedToday = day2.data.filter((m) => new Date(m.surfaced_at) > new Date(Date.now() - 60_000));
      assert.equal(newlySurfacedToday.length, 1, "the new UTC day's allowance of 2 must be available again, surfacing the 1 remaining candidate (Job C)");
    } finally {
      await adminClient.from("plans").update({ daily_new_match_limit: 10 }).eq("plan_code", "pro");
    }
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("surface_new_matches_for_user: two concurrent calls for the same user never collectively exceed the daily allowance", async () => {
  const { user, analysis } = await setupProUser("daily-cap-concurrency");
  const jobIdsToClean = [];
  try {
    const { error: lowerError } = await adminClient.from("plans").update({ daily_new_match_limit: 2 }).eq("plan_code", "pro");
    if (lowerError) throw new Error(`failed to lower pro daily_new_match_limit: ${lowerError.message}`);

    try {
      for (let i = 0; i < 6; i++) {
        await insertPendingMatch(jobIdsToClean, user.id, analysis.id, 90 - i, `Concurrency Job ${i}`);
      }

      const [a, b] = await Promise.all([user.client.rpc("surface_new_matches_for_user"), user.client.rpc("surface_new_matches_for_user")]);
      if (a.error) throw new Error(`concurrent call A failed: ${a.error.message}`);
      if (b.error) throw new Error(`concurrent call B failed: ${b.error.message}`);

      // Both calls return the full surfaced set (idempotent read), so the
      // real proof is the total number of matches that actually got
      // surfaced_at stamped — not either call's own returned length.
      const { count, error: countError } = await adminClient
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .not("surfaced_at", "is", null);
      if (countError) throw new Error(`count query failed: ${countError.message}`);
      assert.equal(count, 2, "two concurrent calls racing the same advisory lock must never collectively surface more than the daily allowance of 2");
    } finally {
      await adminClient.from("plans").update({ daily_new_match_limit: 10 }).eq("plan_code", "pro");
    }
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});

test("surface_new_matches_for_user: Free plan preserves its existing behavior (daily_new_match_limit is NULL, bounded only by active capacity of 1)", async () => {
  const user = await createTestUser("daily-cap-free");
  const jobIdsToClean = [];
  try {
    const { data: freePlan } = await adminClient.from("plans").select("job_match_limit, daily_new_match_limit").eq("plan_code", "free").single();
    assert.equal(freePlan.job_match_limit, 1);
    assert.equal(freePlan.daily_new_match_limit, null, "no new Free product decision was made — NULL preserves existing behavior");

    const cv = await uploadFakeCv(user, "daily-cap-free.pdf");
    const created = await insertFakeAnalysis(user, cv.id);
    const { data: analysis, error } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
    if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);

    await insertPendingMatch(jobIdsToClean, user.id, analysis.id, 90, "Free Job A");
    await insertPendingMatch(jobIdsToClean, user.id, analysis.id, 80, "Free Job B");

    const { data, error: surfaceError } = await user.client.rpc("surface_new_matches_for_user");
    if (surfaceError) throw new Error(`surface_new_matches_for_user failed: ${surfaceError.message}`);
    assert.equal(data.length, 1, "Free must still surface at most 1 — identical observable behavior to before this change");
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});
