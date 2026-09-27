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
