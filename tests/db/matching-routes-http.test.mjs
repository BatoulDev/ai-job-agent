// tests/db/matching-routes-http.test.mjs
//
// Checkpoint 2E audit-remediation requirement: exercise the real
// prepare-rerank and save-rerank-results request-handling logic directly
// (not just the library functions they call) — authentication, malformed
// requests, missing signing configuration, and response status codes.
//
// HONEST CONSTRAINT: the literal route.ts `POST` export cannot be
// imported under plain `node --test` — it imports "next/server", which
// has no ESM "exports" map (confirmed: node_modules/next/package.json has
// no "exports" field at all), so Node's strict ESM resolver cannot locate
// "next/server" the way Next.js's own bundler does. This is a hard
// platform constraint, unrelated to the "@/" alias fix elsewhere in this
// checkpoint. Both route.ts files were therefore split: every real
// decision (auth check, missing-secret fail-closed, body parsing, per-item
// processing, response status/body) now lives in a `next/server`-free
// handler function (handlePrepareRerankRequest/handleSaveRerankResultsRequest,
// src/lib/matching/), which this file calls directly with real Request
// objects (the Web Fetch API, a Node global) — exactly the logic `POST`
// itself runs, since `POST` is now a trivial two-line wrapper
// (`NextResponse.json(body, {status})`) around these same functions. The
// two-line wrapper itself is not independently exercised — there is no
// way to do so under this test harness, and claiming otherwise would be
// inaccurate.
//
// LOCAL DATABASE ONLY — see tests/db/localTestGuard.mjs, which now also
// copies MATCHING_WORKER_SECRET/NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY
// into process.env for this exact reason (createAdminClient/
// isAuthorizedInternalRequest read process.env directly, matching real
// server behavior, which a real Next.js process already provides for free).

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
  uploadFakeCv,
  insertFakeAnalysis,
} from "./helpers.mjs";
import { handlePrepareRerankRequest } from "../../src/lib/matching/handlePrepareRerankRequest.ts";
import { handleSaveRerankResultsRequest } from "../../src/lib/matching/handleSaveRerankResultsRequest.ts";

await assertExpectedLocalProject();

const WORKER_SECRET = process.env.MATCHING_WORKER_SECRET;
if (!WORKER_SECRET) {
  throw new Error("MATCHING_WORKER_SECRET must be set in .env.local for this guarded local test to run.");
}

function makeRequest(body, { headers } = {}) {
  return new Request("http://127.0.0.1/api/internal/matching/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function authHeaders(token = WORKER_SECRET) {
  return { authorization: `Bearer ${token}` };
}

async function withEnvVarUnset(name, fn) {
  const saved = process.env[name];
  delete process.env[name];
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

describe("prepare-rerank request handling (handlePrepareRerankRequest)", () => {
  test("missing Authorization header -> 401", async () => {
    const res = await handlePrepareRerankRequest(makeRequest({ userLimit: 1, jobsPerUser: 1, candidatePoolSize: 1 }));
    assert.equal(res.status, 401);
  });

  test("wrong bearer token -> 401", async () => {
    const res = await handlePrepareRerankRequest(
      makeRequest({ userLimit: 1, jobsPerUser: 1, candidatePoolSize: 1 }, { headers: authHeaders("definitely-wrong-secret") })
    );
    assert.equal(res.status, 401);
  });

  test("malformed JSON body -> 400", async () => {
    const res = await handlePrepareRerankRequest(makeRequest("{not valid json", { headers: authHeaders() }));
    assert.equal(res.status, 400);
  });

  test("valid body but a malformed envelope (userLimit out of range) -> 400", async () => {
    const res = await handlePrepareRerankRequest(makeRequest({ userLimit: 0, jobsPerUser: 1, candidatePoolSize: 1 }, { headers: authHeaders() }));
    assert.equal(res.status, 400);
  });

  test("missing MATCHING_CANDIDATE_TOKEN_SECRET -> 500, fails closed before any candidate work", async () => {
    await withEnvVarUnset("MATCHING_CANDIDATE_TOKEN_SECRET", async () => {
      const res = await handlePrepareRerankRequest(makeRequest({ userLimit: 1, jobsPerUser: 1, candidatePoolSize: 1 }, { headers: authHeaders() }));
      assert.equal(res.status, 500);
      assert.match(res.body.error, /candidate token secret is not set/i);
    });
  });

  test("valid request, real auth, real secret -> 200 with a candidates array", async () => {
    const res = await handlePrepareRerankRequest(makeRequest({ userLimit: 5, jobsPerUser: 5, candidatePoolSize: 50 }, { headers: authHeaders() }));
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.candidates));
  });
});

describe("save-rerank-results request handling (handleSaveRerankResultsRequest)", () => {
  test("missing Authorization header -> 401", async () => {
    const res = await handleSaveRerankResultsRequest(makeRequest({ matchingModel: "test", results: [] }));
    assert.equal(res.status, 401);
  });

  test("wrong bearer token -> 401", async () => {
    const res = await handleSaveRerankResultsRequest(makeRequest({ matchingModel: "test", results: [] }, { headers: authHeaders("definitely-wrong-secret") }));
    assert.equal(res.status, 401);
  });

  test("malformed JSON body -> 400", async () => {
    const res = await handleSaveRerankResultsRequest(makeRequest("{not valid json", { headers: authHeaders() }));
    assert.equal(res.status, 400);
  });

  test("valid body but a malformed envelope (candidateId too long) -> 400", async () => {
    const res = await handleSaveRerankResultsRequest(
      makeRequest({ matchingModel: "test", results: [{ candidateId: "a".repeat(2000), response: {} }] }, { headers: authHeaders() })
    );
    assert.equal(res.status, 400);
  });

  test("missing MATCHING_CANDIDATE_TOKEN_SECRET -> 500, fails closed for the whole request before any per-item work", async () => {
    await withEnvVarUnset("MATCHING_CANDIDATE_TOKEN_SECRET", async () => {
      const res = await handleSaveRerankResultsRequest(makeRequest({ matchingModel: "test", results: [] }, { headers: authHeaders() }));
      assert.equal(res.status, 500);
      assert.match(res.body.error, /candidate token secret is not set/i);
    });
  });

  test("valid request, real auth, real secret, empty results -> 200 with all-zero counts", async () => {
    const res = await handleSaveRerankResultsRequest(makeRequest({ matchingModel: "test", results: [] }, { headers: authHeaders() }));
    assert.equal(res.status, 200);
    assert.equal(res.body.saved, 0);
    assert.equal(res.body.invalid_candidate_id, 0);
  });

  test("valid request with a tampered candidateId -> 200 (per-item outcome, not an HTTP error) with invalid_candidate_signature counted", async () => {
    const res = await handleSaveRerankResultsRequest(
      makeRequest({ matchingModel: "test", results: [{ candidateId: "garbage.token", response: {} }] }, { headers: authHeaders() })
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.invalid_candidate_signature, 1);
    assert.equal(res.body.saved, 0);
  });
});

describe("save-rerank-results — real fixture, full round trip through both handlers", () => {
  let user;
  const jobIds = [];

  after(async () => {
    if (jobIds.length > 0) {
      await adminClient.from("matches").delete().in("job_id", jobIds);
      await adminClient.from("jobs").delete().in("id", jobIds);
    }
    if (user) await deleteTestUsers([user]);
  });

  test("a real candidate submitted through both real handlers is saved, with status 200 and saved:1", async () => {
    user = await createTestUser("2e-http-route");
    const embedding = Array(1536).fill(0.01);
    const cv = await uploadFakeCv(user, "checkpoint-2e-http-route.pdf");
    const analysis = await insertFakeAnalysis(user, cv.id);
    const { data: confirmed, error: confirmError } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });
    if (confirmError) throw new Error(`confirm_cv_analysis failed: ${confirmError.message}`);
    await adminClient.from("cv_analyses").update({ profile_embedding: embedding }).eq("id", confirmed.id);

    const suffix = randomUUID();
    const { data: jobData, error: jobError } = await adminClient.rpc("upsert_job_with_locations", {
      p_job: {
        title: "HTTP Route Real Fixture Job",
        company_name: "Checkpoint 2E HTTP Route Fixture Co",
        description: "HTTP-level real fixture job for the full round trip.",
        application_method: "external_link",
        application_url: "https://example.test/apply",
        source_type: "admin_manual",
        external_id: `checkpoint-2e-http-route-${suffix}`,
        work_arrangement: "onsite",
        country_code: "LB",
        city: "Beirut",
      },
      p_locations: [{ country_code: "LB", city: "Beirut", is_primary: true, location_confidence: "high" }],
      p_replace_locations: true,
    });
    if (jobError) throw new Error(`job creation failed: ${jobError.message}`);
    const jobId = jobData[0].out_job_id;
    jobIds.push(jobId);
    await adminClient.from("jobs").update({ embedding }).eq("id", jobId);

    const prepareRes = await handlePrepareRerankRequest(makeRequest({ userLimit: 50, jobsPerUser: 50, candidatePoolSize: 200 }, { headers: authHeaders() }));
    assert.equal(prepareRes.status, 200);
    const ours = prepareRes.body.candidates.find((c) => typeof c.prompt === "string" && c.prompt.includes("HTTP Route Real Fixture Job"));
    assert.ok(ours, "expected the real fixture job to appear as a real prepare-rerank candidate");

    const saveRes = await handleSaveRerankResultsRequest(
      makeRequest(
        {
          matchingModel: "checkpoint-2e-http-test-model",
          results: [
            {
              candidateId: ours.candidateId,
              response: { score: 77, reason: "Full round trip fit.", strengths: [], missing_skills: [], preference_alignment: "ok" },
            },
          ],
        },
        { headers: authHeaders() }
      )
    );
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.body.saved, 1);

    const { data: match } = await adminClient.from("matches").select("id, score").eq("user_id", user.id).eq("job_id", jobId).maybeSingle();
    assert.ok(match, "a real match row must exist after the full real round trip");
    assert.equal(match.score, 77);
  });
});
