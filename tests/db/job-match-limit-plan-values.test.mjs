// DB tests for the founder-confirmed job-match-limit change (2026-09-30):
// Student 25 -> 45, Pro 45 -> 95, Free unchanged
// (supabase/migrations/20260930150000_update_student_pro_job_match_limits.sql).
// Proves the catalog holds the new values and that surface_new_matches_for_user()
// reads public.plans.job_match_limit dynamically — changing the catalog value
// changes delivered-match behavior with no matching-code edit at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers, uploadFakeCv, insertFakeAnalysis, deleteFakeJobs } from "./helpers.mjs";

test("public.plans: student's job_match_limit is the founder-confirmed 45", async () => {
  await assertExpectedLocalProject();
  const { data, error } = await adminClient.from("plans").select("job_match_limit").eq("plan_code", "student").single();
  assert.equal(error, null);
  assert.equal(data.job_match_limit, 45);
});

test("public.plans: pro's job_match_limit is the founder-confirmed 95", async () => {
  const { data, error } = await adminClient.from("plans").select("job_match_limit").eq("plan_code", "pro").single();
  assert.equal(error, null);
  assert.equal(data.job_match_limit, 95);
});

test("public.plans: free's job_match_limit is unchanged by this migration (1)", async () => {
  const { data, error } = await adminClient.from("plans").select("job_match_limit").eq("plan_code", "free").single();
  assert.equal(error, null);
  assert.equal(data.job_match_limit, 1);
});

test("surface_new_matches_for_user() reads public.plans.job_match_limit dynamically — changing only the catalog row changes the surfaced count, with zero matching-code changes", async () => {
  const jobIdsToClean = [];
  const user = await createTestUser("job-match-limit-dynamic");
  try {
    const cv = await uploadFakeCv(user, "job-match-limit-dynamic.pdf");
    const created = await insertFakeAnalysis(user, cv.id);
    const { data: analysis, error: confirmError } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
    if (confirmError) throw new Error(`confirm_cv_analysis failed: ${confirmError.message}`);

    await adminClient.from("subscriptions").update({ plan_code: "pro", provider: "whish" }).eq("user_id", user.id);

    async function fixtureMatch(index, score) {
      const { data: job, error: jobError } = await adminClient
        .from("jobs")
        .insert({
          title: `Dynamic Limit Job ${index}`,
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

      const { error: matchError } = await adminClient
        .from("matches")
        .insert({ user_id: user.id, job_id: job.id, cv_analysis_id: analysis.id, score, matching_model: "test-fixture" });
      if (matchError) throw new Error(`fixture match insert failed: ${matchError.message}`);
    }

    for (let i = 0; i < 3; i++) {
      await fixtureMatch(i, 90 - i);
    }

    // Temporarily lower the REAL catalog row (not a fork, not a parameter) to
    // a value smaller than our 3 fixture matches — the only way this can
    // change what gets surfaced is if surface_new_matches_for_user() reads
    // it live, since nothing else in this test touches matching code.
    const { error: lowerError } = await adminClient.from("plans").update({ job_match_limit: 2 }).eq("plan_code", "pro");
    if (lowerError) throw new Error(`failed to lower pro job_match_limit for this test: ${lowerError.message}`);

    try {
      const { data: surfaced, error: surfaceError } = await user.client.rpc("surface_new_matches_for_user");
      assert.equal(surfaceError, null);
      assert.equal(surfaced.length, 2, "lowering public.plans.job_match_limit to 2 must cap surfacing at 2, proving it is read dynamically at call time");
    } finally {
      // Restore immediately — this file runs with other DB test files under
      // --test-concurrency=1 (sequential), but the real catalog value must
      // never be left mutated for a later file or manual use.
      const { error: restoreError } = await adminClient.from("plans").update({ job_match_limit: 95 }).eq("plan_code", "pro");
      if (restoreError) throw new Error(`failed to restore pro job_match_limit after this test: ${restoreError.message}`);
    }
  } finally {
    await adminClient.from("matches").delete().eq("user_id", user.id);
    await deleteFakeJobs(jobIdsToClean);
    await deleteTestUsers([user]);
  }
});
