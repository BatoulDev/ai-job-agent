// DB-dependent integration tests for src/lib/matching/{rerankCandidates,saveMatch}.ts
// (Phase 06) against the real local Supabase instance. No real LLM call —
// saveMatchResult persists a hand-built RerankResult, and findRerankCandidates
// only builds prompts (never calls an LLM itself).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers, uploadFakeCv, insertFakeAnalysis, deleteFakeJobs } from "./helpers.mjs";
import { findRerankCandidates, encodeCandidateId, decodeCandidateId } from "../../src/lib/matching/rerankCandidates.ts";
import { saveMatchResult } from "../../src/lib/matching/saveMatch.ts";

const jobIdsToClean = [];
let user;

before(async () => {
  await assertExpectedLocalProject();
  user = await createTestUser("matching-rerank");
});

after(async () => {
  // matches.job_id -> jobs(id) is ON DELETE RESTRICT (unlike cv_analysis_id/
  // user_id, which cascade) — this file's own tests insert matches rows
  // referencing jobIdsToClean, so those must be deleted explicitly first.
  // Same fix as tests/db/jobs-ingestion-identity.test.mjs's own header
  // comment describes hitting and fixing for the identical reason.
  if (jobIdsToClean.length > 0) {
    const { error } = await adminClient.from("matches").delete().in("job_id", jobIdsToClean);
    if (error) throw new Error(`cleanup: failed to delete matches referencing fixture jobs: ${error.message}`);
  }
  await deleteFakeJobs(jobIdsToClean);
  await deleteTestUsers([user]);
});

async function insertFixtureJob(overrides = {}) {
  const { data, error } = await adminClient
    .from("jobs")
    .insert({
      title: "Fixture Backend Engineer",
      company_name: "Fixture Co",
      description: "A fake job fixture for automated tests only.",
      application_method: "external_link",
      application_url: "https://example.test/apply",
      source_type: "admin_manual",
      status: "active",
      country_code: "LB",
      city: "Beirut",
      work_arrangement: "onsite",
      embedding: [1, 0, 0, 0],
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`fixture job insert failed: ${error.message}`);
  jobIdsToClean.push(data.id);
  return data;
}

// Sets the user's real, persisted job_preferences.work_arrangement before
// their analysis is created — must happen first, since insertFakeAnalysis
// snapshots preferences_version at creation time, and changing the row
// afterwards would bump the version (job_preferences_version_bump_trigger)
// and make the analysis look stale for is_cv_analysis_matching_eligible().
async function setUserWorkArrangementPreference(forUser, workArrangement) {
  const { data: existing } = await adminClient.from("job_preferences").select("id").eq("user_id", forUser.id).maybeSingle();
  if (existing) {
    const { error } = await adminClient.from("job_preferences").update({ work_arrangement: workArrangement }).eq("user_id", forUser.id);
    if (error) throw new Error(`setUserWorkArrangementPreference: update failed: ${error.message}`);
  } else {
    const { error } = await adminClient.from("job_preferences").insert({ user_id: forUser.id, work_arrangement: workArrangement });
    if (error) throw new Error(`setUserWorkArrangementPreference: insert failed: ${error.message}`);
  }
}

async function approveAnalysisWithEmbedding(cvSuffix, embedding = [1, 0, 0, 0]) {
  const cv = await uploadFakeCv(user, `rerank-${cvSuffix}.pdf`);
  const analysis = await insertFakeAnalysis(user, cv.id, {
    professional_summary: "Backend engineer with API design experience.",
    skills: ["TypeScript", "PostgreSQL"],
  });
  const { data: approved, error } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });
  if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);
  await adminClient.from("cv_analyses").update({ profile_embedding: embedding }).eq("id", approved.id);
  return approved;
}

test("encodeCandidateId/decodeCandidateId round-trip exactly", () => {
  const id = encodeCandidateId("analysis-1", "job-1");
  assert.equal(id, "analysis-1:job-1");
  assert.deepEqual(decodeCandidateId(id), { cvAnalysisId: "analysis-1", jobId: "job-1" });
});

test("decodeCandidateId returns null for a malformed id", () => {
  assert.equal(decodeCandidateId("no-separator-here"), null);
});

test("saveMatchResult: inserts a new match, then upserts on re-score without duplicating the row", async () => {
  const analysis = await approveAnalysisWithEmbedding("save-1");
  const job = await insertFixtureJob({ title: "Save Match Job" });

  await saveMatchResult(adminClient, {
    userId: user.id,
    jobId: job.id,
    cvAnalysisId: analysis.id,
    result: { score: 70, reason: "Decent fit.", strengths: ["TypeScript"], missingSkills: ["Kubernetes"], preferenceAlignment: "Onsite Beirut matches." },
    matchingModel: "gpt-4o-mini",
  });

  const { data: firstRow } = await adminClient.from("matches").select("*").eq("user_id", user.id).eq("job_id", job.id).eq("cv_analysis_id", analysis.id).single();
  assert.equal(firstRow.score, 70);
  assert.equal(firstRow.status, "pending_review");

  await saveMatchResult(adminClient, {
    userId: user.id,
    jobId: job.id,
    cvAnalysisId: analysis.id,
    result: { score: 90, reason: "Even better fit on re-score.", strengths: ["TypeScript", "PostgreSQL"], missingSkills: [], preferenceAlignment: "Strong match." },
    matchingModel: "gpt-4o-mini",
  });

  const { data: rows } = await adminClient.from("matches").select("*").eq("user_id", user.id).eq("job_id", job.id).eq("cv_analysis_id", analysis.id);
  assert.equal(rows.length, 1, "a re-score must update the same row, never create a second one");
  assert.equal(rows[0].score, 90);
  assert.equal(rows[0].id, firstRow.id);
});

test("saveMatchResult: a re-score never overwrites a user's already-made decision (status/decided_at untouched)", async () => {
  const analysis = await approveAnalysisWithEmbedding("save-2");
  const job = await insertFixtureJob({ title: "Decision Preserved Job" });

  await saveMatchResult(adminClient, {
    userId: user.id,
    jobId: job.id,
    cvAnalysisId: analysis.id,
    result: { score: 60, reason: "Initial score.", strengths: [], missingSkills: [], preferenceAlignment: "ok" },
    matchingModel: "gpt-4o-mini",
  });

  const { data: match } = await adminClient.from("matches").select("id").eq("user_id", user.id).eq("job_id", job.id).eq("cv_analysis_id", analysis.id).single();
  const { error: approveError } = await user.client.rpc("approve_match", { p_match_id: match.id });
  assert.equal(approveError, null);

  await saveMatchResult(adminClient, {
    userId: user.id,
    jobId: job.id,
    cvAnalysisId: analysis.id,
    result: { score: 95, reason: "Re-scored after the user already decided.", strengths: [], missingSkills: [], preferenceAlignment: "ok" },
    matchingModel: "gpt-4o-mini",
  });

  const { data: row } = await adminClient.from("matches").select("status, decided_at, score").eq("id", match.id).single();
  assert.equal(row.status, "user_approved", "re-scoring must never revert an already-made user decision");
  assert.notEqual(row.decided_at, null);
  assert.equal(row.score, 95, "the score itself is still updated by a re-score");
});

test("findRerankCandidates: returns a grounded prompt for an eligible, shortlisted job with no existing match", async () => {
  const analysis = await approveAnalysisWithEmbedding("find-1", [1, 0, 0, 0]);
  const job = await insertFixtureJob({ title: "Find Candidates Job", embedding: [1, 0, 0, 0] });

  const candidates = await findRerankCandidates(adminClient, { userLimit: 50, jobsPerUser: 10, candidatePoolSize: 100 });
  const match = candidates.find((c) => c.cvAnalysisId === analysis.id && c.jobId === job.id);
  assert.ok(match, "an eligible, embedded, shortlisted job with no existing match must appear as a rerank candidate");
  assert.match(match.prompt, /Find Candidates Job/);
  assert.match(match.prompt, /TypeScript/);
  assert.equal(match.candidateId, encodeCandidateId(analysis.id, job.id));
});

test("findRerankCandidates: excludes a job that already has a matches row for that (user, analysis)", async () => {
  const analysis = await approveAnalysisWithEmbedding("find-2", [1, 0, 0, 0]);
  const job = await insertFixtureJob({ title: "Already Matched Job", embedding: [1, 0, 0, 0] });

  await saveMatchResult(adminClient, {
    userId: user.id,
    jobId: job.id,
    cvAnalysisId: analysis.id,
    result: { score: 50, reason: "Already scored.", strengths: [], missingSkills: [], preferenceAlignment: "ok" },
    matchingModel: "gpt-4o-mini",
  });

  const candidates = await findRerankCandidates(adminClient, { userLimit: 50, jobsPerUser: 10, candidatePoolSize: 100 });
  const match = candidates.find((c) => c.cvAnalysisId === analysis.id && c.jobId === job.id);
  assert.equal(match, undefined, "a job already matched for this (user, analysis) pair must never be re-sent for rerank");
});

test("findRerankCandidates: excludes an unapproved analysis entirely", async () => {
  const cv = await uploadFakeCv(user, "rerank-unapproved.pdf");
  const pending = await insertFakeAnalysis(user, cv.id);
  await adminClient.from("cv_analyses").update({ profile_embedding: [1, 0, 0, 0] }).eq("id", pending.id);
  const job = await insertFixtureJob({ title: "Unapproved Analysis Job", embedding: [1, 0, 0, 0] });

  const candidates = await findRerankCandidates(adminClient, { userLimit: 50, jobsPerUser: 10, candidatePoolSize: 100 });
  const match = candidates.find((c) => c.cvAnalysisId === pending.id && c.jobId === job.id);
  assert.equal(match, undefined, "an unapproved analysis must never produce a rerank candidate");
});

// Founder decision (Phase 21 follow-up): work_arrangement preference must
// reach real matching. These tests prove the REAL production propagation
// path — a genuinely persisted job_preferences.work_arrangement row, read
// by the real loadUserContext() inside findRerankCandidates(), not a
// hand-built ShortlistUserContext/JobEligibilityInput object. See
// docs/PRODUCT_MATCHING_RULES.md "Work arrangement" and
// docs/LEBANON_LIVE_SOURCE_EXPANSION.md §5.
test("work-arrangement propagation: a real persisted 'remote' preference excludes a real explicit-onsite job (conflict), via loadUserContext reading the real row", async () => {
  await setUserWorkArrangementPreference(user, "remote");
  try {
    const analysis = await approveAnalysisWithEmbedding("wa-conflict", [1, 0, 0, 0]);
    const conflictingJob = await insertFixtureJob({ title: "Real Conflict Onsite Job", embedding: [1, 0, 0, 0], work_arrangement: "onsite" });

    const candidates = await findRerankCandidates(adminClient, { userLimit: 50, jobsPerUser: 10, candidatePoolSize: 100 });
    const match = candidates.find((c) => c.cvAnalysisId === analysis.id && c.jobId === conflictingJob.id);
    assert.equal(match, undefined, "a job whose real, known work_arrangement conflicts with the user's real, persisted preference must never reach rerank");
  } finally {
    await setUserWorkArrangementPreference(user, null);
  }
});

test("work-arrangement propagation: a real persisted preference does NOT exclude a job with unknown work_arrangement (the Phase 21 fix, proven end-to-end)", async () => {
  await setUserWorkArrangementPreference(user, "remote");
  try {
    const analysis = await approveAnalysisWithEmbedding("wa-unknown", [1, 0, 0, 0]);
    const unknownArrangementJob = await insertFixtureJob({ title: "Real Unknown Arrangement Job", embedding: [1, 0, 0, 0], work_arrangement: null });

    const candidates = await findRerankCandidates(adminClient, { userLimit: 50, jobsPerUser: 10, candidatePoolSize: 100 });
    const match = candidates.find((c) => c.cvAnalysisId === analysis.id && c.jobId === unknownArrangementJob.id);
    assert.ok(match, "a job with unknown work_arrangement must still reach rerank when the user has a real preference set — never rejected solely for missing arrangement metadata");
  } finally {
    await setUserWorkArrangementPreference(user, null);
  }
});

test("combined matching context: real AI Career Profile (skills/summary) + real preferences (work_arrangement) + real job all flow into one grounded rerank candidate", async () => {
  await setUserWorkArrangementPreference(user, "remote");
  try {
    const cv = await uploadFakeCv(user, "combined-context.pdf");
    const analysis = await insertFakeAnalysis(user, cv.id, {
      professional_summary: "Frontend engineer specializing in React and design systems.",
      skills: ["React", "TypeScript", "Design Systems"],
      recommended_roles: ["Frontend Engineer"],
    });
    const { data: approved, error } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });
    if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);
    await adminClient.from("cv_analyses").update({ profile_embedding: [1, 0, 0, 0] }).eq("id", approved.id);

    const job = await insertFixtureJob({
      title: "Combined Context Frontend Role",
      description: "Looking for a React specialist.",
      embedding: [1, 0, 0, 0],
      work_arrangement: null, // unknown — must not eliminate the job
    });

    const candidates = await findRerankCandidates(adminClient, { userLimit: 50, jobsPerUser: 10, candidatePoolSize: 100 });
    const match = candidates.find((c) => c.cvAnalysisId === approved.id && c.jobId === job.id);
    assert.ok(match, "career profile + preferences + an unknown-arrangement job must still produce a real candidate");
    // Career Profile contributes to the grounded prompt (already proven
    // generically by the "returns a grounded prompt" test above — this
    // asserts it specifically alongside a real preference and an unknown
    // job arrangement, the exact combination this decision is about).
    assert.match(match.prompt, /React/);
    assert.match(match.prompt, /Combined Context Frontend Role/);
    // The prompt must never claim a specific arrangement it doesn't know —
    // still true after this change, since job.workArrangement stays null.
    assert.doesNotMatch(match.prompt, /Work arrangement:/);
  } finally {
    await setUserWorkArrangementPreference(user, null);
  }
});

// job_market_coverage wiring fix: proves a correctly-entitled Pro user's
// real, RPC-persisted job_market_coverage (never hand-built) reaches real
// matching via the full persisted preferences -> loadUserContext ->
// checkJobEligibility -> shortlist/rerank-candidates path. See
// supabase/migrations/20260930110000_derive_job_market_coverage_server_side.sql
// and tests/db/international-job-preferences.test.mjs for the RPC-level
// derivation tests this test builds on.
test("job_market_coverage propagation: a Pro user's real save_job_preferences-derived remote_worldwide coverage reaches a real non-Lebanon remote job via the real matching path", async () => {
  const coverageUser = await createTestUser("matching-coverage");
  try {
    await adminClient
      .from("subscriptions")
      .update({ plan_code: "pro", status: "active", provider: "whish", current_period_end: new Date(Date.now() + 86400000).toISOString() })
      .eq("user_id", coverageUser.id);

    const { data: role } = await adminClient.from("target_roles").select("slug").eq("is_active", true).limit(1).single();

    const usRemoteJob = await insertFixtureJob({
      title: "Real US-Only Remote Role",
      embedding: [1, 0, 0, 0],
      country_code: "US",
      city: null,
      work_arrangement: "remote",
      remote_scope: "country:US",
    });

    const cv = await uploadFakeCv(coverageUser, "coverage-off.pdf");
    const offAnalysis = await insertFakeAnalysis(coverageUser, cv.id, {
      professional_summary: "Backend engineer with API design experience.",
      skills: ["TypeScript"],
    });
    const { data: offApproved, error: offConfirmError } = await coverageUser.client.rpc("confirm_cv_analysis", { p_analysis_id: offAnalysis.id });
    if (offConfirmError) throw new Error(`confirm_cv_analysis failed: ${offConfirmError.message}`);
    await adminClient.from("cv_analyses").update({ profile_embedding: [1, 0, 0, 0] }).eq("id", offApproved.id);

    const candidatesBefore = await findRerankCandidates(adminClient, { userLimit: 50, jobsPerUser: 10, candidatePoolSize: 100 });
    assert.equal(
      candidatesBefore.find((c) => c.cvAnalysisId === offApproved.id && c.jobId === usRemoteJob.id),
      undefined,
      "before opting in to international search, this user's derived job_market_coverage is null — the US-only remote job must not reach matching"
    );

    // Real onboarding save: international search enabled, remote, not
    // willing to relocate — save_job_preferences derives remote_worldwide
    // server-side (never supplied by this test).
    const { error: saveError } = await coverageUser.client.rpc("save_job_preferences", {
      p_work_arrangement: "remote",
      p_job_type: "full-time",
      p_experience_level: "junior",
      p_additional_notes: null,
      p_custom_target_roles: [],
      p_custom_locations: [],
      p_target_role_ids: [role.slug],
      p_location_ids: [],
      p_lebanon_location_scope: "selected_only",
      p_international_search_enabled: true,
      p_willing_to_relocate: false,
    });
    assert.equal(saveError, null, `save_job_preferences failed: ${saveError?.message}`);

    const { data: persisted } = await adminClient.from("job_preferences").select("job_market_coverage").eq("user_id", coverageUser.id).single();
    assert.equal(persisted.job_market_coverage, "remote_worldwide", "sanity: the real row must carry the derived value before checking propagation");

    const cv2 = await uploadFakeCv(coverageUser, "coverage-on.pdf", { skipRateLimitReset: true });
    const onAnalysis = await insertFakeAnalysis(coverageUser, cv2.id, {
      professional_summary: "Backend engineer with API design experience.",
      skills: ["TypeScript"],
    });
    const { data: onApproved, error: onConfirmError } = await coverageUser.client.rpc("confirm_cv_analysis", { p_analysis_id: onAnalysis.id });
    if (onConfirmError) throw new Error(`confirm_cv_analysis failed: ${onConfirmError.message}`);
    await adminClient.from("cv_analyses").update({ profile_embedding: [1, 0, 0, 0] }).eq("id", onApproved.id);

    const candidatesAfter = await findRerankCandidates(adminClient, { userLimit: 50, jobsPerUser: 10, candidatePoolSize: 100 });
    const match = candidatesAfter.find((c) => c.cvAnalysisId === onApproved.id && c.jobId === usRemoteJob.id);
    assert.ok(match, "after the real RPC-derived remote_worldwide coverage is persisted, the same real non-Lebanon remote job must reach a real matching candidate");
  } finally {
    await deleteTestUsers([coverageUser]);
  }
});
