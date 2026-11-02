// Checkpoint 2E — pure, offline tests for
// src/lib/matching/saveRerankResult.ts's saveOneRerankResult(), proving:
// (1) distinct outcomes for invalid token / expired token / ineligible
// job / revalidation infrastructure error, and (2) that a failure inside
// ONE candidate's processing never throws out of the function — the real
// pre-existing bug this checkpoint fixed (previously only the final
// saveMatchResult call was try/caught; everything before it could throw
// and abort every subsequent candidate in the same save-rerank-results
// batch). Each call here uses its own independent mock Supabase client,
// proving each candidate is processed to completion independently — the
// same guarantee the real per-item loop in save-rerank-results/route.ts
// relies on.
//
// Run: node --test tests/unit/save-rerank-result-batch-isolation.test.mjs

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { saveOneRerankResult } from "../../src/lib/matching/saveRerankResult.ts";
import { signCandidateToken } from "../../src/lib/matching/candidateToken.ts";

const ORIGINAL_SECRET = process.env.MATCHING_CANDIDATE_TOKEN_SECRET;
const TEST_SECRET = "test-only-batch-isolation-secret-do-not-use-in-production";

before(() => {
  process.env.MATCHING_CANDIDATE_TOKEN_SECRET = TEST_SECRET;
});

after(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.MATCHING_CANDIDATE_TOKEN_SECRET;
  else process.env.MATCHING_CANDIDATE_TOKEN_SECRET = ORIGINAL_SECRET;
});

const VALID_RESPONSE = { score: 80, reason: "Good fit.", strengths: ["TypeScript"], missing_skills: [], preference_alignment: "Matches." };

// Real-shaped UUIDs — candidateToken.ts now strictly validates these,
// matching cv_analyses.id/jobs.id's real uuid-typed columns.
const ANALYSIS_ID = randomUUID();
const JOB_ID = randomUUID();
const RUN_ID = randomUUID();
const FAILING_ANALYSIS_ID = randomUUID();
const FAILING_JOB_ID = randomUUID();
const USER_ID = randomUUID();

function makeMockSupabase(responses) {
  let callIndex = 0;
  return {
    rpc() {
      return Promise.resolve(responses[callIndex++]);
    },
    from() {
      const result = responses[callIndex++];
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        in() { return Promise.resolve(result); },
        maybeSingle() { return Promise.resolve(result); },
        upsert() { return Promise.resolve(result); },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
      return builder;
    },
  };
}

function happyPathResponses(jobOverrides = {}) {
  return [
    { data: true, error: null }, // is_cv_analysis_matching_eligible RPC
    { data: { user_id: USER_ID }, error: null }, // cv_analyses lookup
    { data: { plan_code: "free", status: "active", current_period_end: null }, error: null }, // subscriptions
    { data: null, error: null }, // job_preferences (none set)
    { data: { id: JOB_ID, status: "active", location: null, country_code: "LB", city: "Beirut", work_arrangement: "onsite", remote_scope: null, employment_type: null, published_at: null, last_seen_at: new Date().toISOString(), expires_at: null, closing_date: null, created_at: new Date().toISOString(), ...jobOverrides }, error: null }, // jobs
    { data: [], error: null, count: 0 }, // job_locations
    { error: null }, // matches upsert
  ];
}

describe("saveOneRerankResult — distinct outcomes", () => {
  test("a valid, still-eligible candidate saves successfully", async () => {
    const token = signCandidateToken({ cvAnalysisId: ANALYSIS_ID, jobId: JOB_ID, runId: RUN_ID });
    const supabase = makeMockSupabase(happyPathResponses());
    const outcome = await saveOneRerankResult(supabase, "gpt-4o-mini", token, VALID_RESPONSE);
    assert.equal(outcome, "saved");
  });

  test("a tampered/invalid-signature token is rejected without touching the database at all", async () => {
    const supabase = makeMockSupabase([]); // no responses queued — any call would throw "undefined" and fail the test
    const outcome = await saveOneRerankResult(supabase, "gpt-4o-mini", "garbage.token", VALID_RESPONSE);
    assert.equal(outcome, "invalid_candidate_signature");
  });

  test("a legacy unsigned candidateId is rejected as invalid_candidate_id, not accepted as a compatibility fallback", async () => {
    const supabase = makeMockSupabase([]);
    const outcome = await saveOneRerankResult(supabase, "gpt-4o-mini", `${ANALYSIS_ID}:${JOB_ID}`, VALID_RESPONSE);
    assert.equal(outcome, "invalid_candidate_id");
  });

  test("an expired token is rejected as candidate_token_expired, distinct from a bad signature", async () => {
    const issuedAt = new Date(Date.now() - 1000 * 60 * 200); // 200 minutes ago, past the 90-minute TTL
    const token = signCandidateToken({ cvAnalysisId: ANALYSIS_ID, jobId: JOB_ID, runId: RUN_ID }, issuedAt);
    const supabase = makeMockSupabase([]);
    const outcome = await saveOneRerankResult(supabase, "gpt-4o-mini", token, VALID_RESPONSE);
    assert.equal(outcome, "candidate_token_expired");
  });

  test("a job that is no longer eligible at save time is rejected as job_no_longer_eligible, not saved", async () => {
    const token = signCandidateToken({ cvAnalysisId: ANALYSIS_ID, jobId: JOB_ID, runId: RUN_ID });
    const responses = happyPathResponses({ status: "unavailable" });
    const supabase = makeMockSupabase(responses);
    const outcome = await saveOneRerankResult(supabase, "gpt-4o-mini", token, VALID_RESPONSE);
    assert.equal(outcome, "job_no_longer_eligible");
  });

  test("ISOLATION: an infrastructure error during one candidate's eligibility RPC returns revalidation_failed rather than throwing", async () => {
    const token = signCandidateToken({ cvAnalysisId: ANALYSIS_ID, jobId: JOB_ID, runId: RUN_ID });
    const supabase = makeMockSupabase([{ data: null, error: { message: "simulated eligibility RPC failure" } }]);
    const outcome = await saveOneRerankResult(supabase, "gpt-4o-mini", token, VALID_RESPONSE);
    assert.equal(outcome, "revalidation_failed");
  });

  test("ISOLATION: a failing candidate (infra error) and a valid candidate processed independently both complete correctly — neither affects the other", async () => {
    const failingToken = signCandidateToken({ cvAnalysisId: FAILING_ANALYSIS_ID, jobId: FAILING_JOB_ID, runId: RUN_ID });
    const failingSupabase = makeMockSupabase([{ data: null, error: { message: "simulated eligibility RPC failure" } }]);
    const failingOutcome = await saveOneRerankResult(failingSupabase, "gpt-4o-mini", failingToken, VALID_RESPONSE);

    const validToken = signCandidateToken({ cvAnalysisId: ANALYSIS_ID, jobId: JOB_ID, runId: RUN_ID });
    const validSupabase = makeMockSupabase(happyPathResponses());
    const validOutcome = await saveOneRerankResult(validSupabase, "gpt-4o-mini", validToken, VALID_RESPONSE);

    assert.equal(failingOutcome, "revalidation_failed", "the failing candidate must be rejected, never thrown as an uncaught exception");
    assert.equal(validOutcome, "saved", "a separate valid candidate must save normally, unaffected by the other candidate's failure");
  });

  test("a malformed LLM response is rejected as invalid_response before any database call is even made", async () => {
    const token = signCandidateToken({ cvAnalysisId: ANALYSIS_ID, jobId: JOB_ID, runId: RUN_ID });
    const supabase = makeMockSupabase([]); // response validation happens before any supabase call
    const outcome = await saveOneRerankResult(supabase, "gpt-4o-mini", token, { score: "not-a-number" });
    assert.equal(outcome, "invalid_response");
  });
});
