// tests/db/shortlist-and-save-match-multi-location.test.mjs
//
// Checkpoint 2D (multi-location matching) — guarded local integration
// coverage proving the discovery pass (shortlistJobsForUser) and the save
// pass (saveMatchResult) stay consistent end-to-end for a job that is only
// eligible through a verified ADDITIONAL job_locations row (Paris primary,
// Beirut additional) — the exact scenario requirement 6 of the Checkpoint
// 2D approval asked to be inspected. saveMatchResult performs no job-
// location re-derivation of its own (confirmed by reading saveMatch.ts/
// save-rerank-results/route.ts — it only re-checks PROFILE-level matching
// eligibility via is_cv_analysis_matching_eligible, never re-runs
// checkJobEligibility against the job), so this test exists to prove that
// fact holds against the real schema, not just from reading the code.
//
// LOCAL DATABASE ONLY — see tests/db/localTestGuard.mjs. Creates the job
// fixture through the real upsert_job_with_locations RPC (service_role has
// SELECT-only grants on job_locations; the RPC is the only write path —
// 20261026090000) rather than a raw insert.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers, uploadFakeCv, insertFakeAnalysis } from "./helpers.mjs";
import { shortlistJobsForUser } from "../../src/lib/matching/shortlist.ts";
import { saveMatchResult } from "../../src/lib/matching/saveMatch.ts";

let user;
let approvedAnalysis;
let jobId;

function freeLebanonUserContext() {
  return {
    planCode: "free",
    preferredWorkArrangement: null,
    preferredJobType: null,
    jobMarketCoverage: null,
    internationalSearchEnabled: false,
    willingToRelocate: null,
    relocationMarketCountryCodes: [],
  };
}

before(async () => {
  await assertExpectedLocalProject();

  user = await createTestUser("2d-multi-loc");
  const cv = await uploadFakeCv(user, "checkpoint-2d-fixture.pdf");
  const analysis = await insertFakeAnalysis(user, cv.id);
  const { data: confirmed, error: confirmError } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });
  if (confirmError) throw new Error(`confirm_cv_analysis failed: ${confirmError.message}`);
  approvedAnalysis = confirmed;

  const suffix = randomUUID();
  const { data: upserted, error: upsertError } = await adminClient.rpc("upsert_job_with_locations", {
    p_job: {
      title: "Checkpoint 2D Paris/Beirut Fixture",
      company_name: "Checkpoint 2D Fixture Co",
      description: "Onsite role, Paris primary, Beirut verified additional — Checkpoint 2D fixture.",
      application_method: "external_link",
      application_url: "https://example.test/apply",
      source_type: "admin_manual",
      external_id: `checkpoint-2d-fixture-${suffix}`,
      work_arrangement: "onsite",
      country_code: "FR",
      city: "Paris",
    },
    p_locations: [
      { country_code: "FR", city: "Paris", is_primary: true, location_confidence: "high" },
      { country_code: "LB", city: "Beirut", is_primary: false, location_confidence: "high" },
    ],
    p_replace_locations: true,
  });
  if (upsertError) throw new Error(`upsert_job_with_locations failed: ${upsertError.message}`);
  jobId = upserted[0].out_job_id;
  assert.equal(upserted[0].out_status, "active", "Beirut alone should already make ingestion-time status active");

  // embedding is written by a separate worker (embedJob.ts), never by the
  // ingestion RPC — set directly so shortlistJobsForUser's own
  // `.not("embedding", "is", null)` filter includes this fixture.
  const { error: embeddingError } = await adminClient
    .from("jobs")
    .update({ embedding: Array(1536).fill(0.01) })
    .eq("id", jobId);
  if (embeddingError) throw new Error(`failed to set fixture embedding: ${embeddingError.message}`);
});

after(async () => {
  // Delete the test user FIRST: auth.users -> cvs -> cv_analyses all cascade,
  // and cv_analyses -> matches is ALSO on delete cascade, so any matches row
  // this test wrote is removed here. Only then is the job (matches.job_id is
  // on delete RESTRICT) safe to delete.
  if (user) await deleteTestUsers([user]);
  if (jobId) {
    const { error } = await adminClient.from("jobs").delete().eq("id", jobId);
    if (error) throw new Error(`cleanup: failed to delete fixture job: ${error.message}`);
  }
});

test("a job eligible only through its verified Beirut additional location is shortlisted for a Free-plan Lebanon user", async () => {
  const shortlisted = await shortlistJobsForUser(adminClient, Array(1536).fill(0.01), freeLebanonUserContext(), {
    candidatePoolSize: 50,
    shortlistSize: 50,
  });
  assert.ok(shortlisted.some((s) => s.jobId === jobId), "Paris-primary job must be included via its Beirut additional location");
});

test("saveMatchResult persists that same job without re-rejecting it — no secondary job-location gate exists in the save path", async () => {
  await saveMatchResult(adminClient, {
    userId: user.id,
    jobId,
    cvAnalysisId: approvedAnalysis.id,
    result: {
      score: 82,
      reason: "Strong fit for the Beirut-eligible role.",
      strengths: ["Relevant experience"],
      missingSkills: [],
      preferenceAlignment: "Matches stated preferences.",
    },
    matchingModel: "checkpoint-2d-test",
  });

  const { data: row, error } = await adminClient
    .from("matches")
    .select("hard_filter_passed, score, status")
    .eq("user_id", user.id)
    .eq("job_id", jobId)
    .eq("cv_analysis_id", approvedAnalysis.id)
    .maybeSingle();
  assert.equal(error, null, `matches lookup failed: ${error?.message}`);
  assert.ok(row, "the match row must exist — saveMatchResult must not have silently skipped it");
  assert.equal(row.hard_filter_passed, true);
  assert.equal(row.score, 82);
});
