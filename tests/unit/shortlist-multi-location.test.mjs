// Checkpoint 2D (multi-location matching) — unit coverage for
// shortlistJobsForUser's new job_locations handling. Pure, offline: a
// hand-rolled in-memory fake Supabase client (same pattern as
// tests/unit/ingest-source-batch-partial-persistence.test.mjs), zero
// network, zero real database. shortlistJobsForUser always queries
// "jobs" first, then "job_locations" — responses are consumed in that
// fixed call order.
//
// Run: node --test tests/unit/shortlist-multi-location.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { shortlistJobsForUser } from "../../src/lib/matching/shortlist.ts";

function baseUserContext(overrides = {}) {
  return {
    planCode: "free",
    preferredWorkArrangement: null,
    preferredJobType: null,
    jobMarketCoverage: null,
    internationalSearchEnabled: false,
    willingToRelocate: null,
    relocationMarketCountryCodes: [],
    ...overrides,
  };
}

function baseJobRow(overrides = {}) {
  return {
    id: "job-1",
    location: null,
    country_code: null,
    city: null,
    work_arrangement: "onsite",
    remote_scope: null,
    embedding: [1, 0, 0],
    employment_type: null,
    published_at: null,
    last_seen_at: new Date().toISOString(),
    expires_at: null,
    closing_date: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockSupabase(responses) {
  let callIndex = 0;
  const calls = [];
  return {
    calls,
    from(table) {
      const result = responses[callIndex++];
      const record = { table, ops: [] };
      calls.push(record);
      const builder = {
        select(...args) { record.ops.push(["select", args]); return builder; },
        eq(...args) { record.ops.push(["eq", args]); return builder; },
        not(...args) { record.ops.push(["not", args]); return builder; },
        order(...args) { record.ops.push(["order", args]); return builder; },
        in(...args) { record.ops.push(["in", args]); return builder; },
        limit(...args) { record.ops.push(["limit", args]); return Promise.resolve(result); },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
      return builder;
    },
  };
}

const OPTIONS = { candidatePoolSize: 10, shortlistSize: 10 };

describe("shortlistJobsForUser — Checkpoint 2D multi-location eligibility", () => {
  test("Paris-primary + Beirut-additional: Free-plan Lebanon user is eligible via Beirut, even though Paris alone would fail", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: "FR", city: "Paris" })], error: null }, // jobs
      {
        data: [
          { job_id: "job-1", country_code: "FR", location_confidence: "high" },
          { job_id: "job-1", country_code: "LB", location_confidence: "high" },
        ],
        error: null,
        count: 2,
      }, // job_locations
    ]);
    const shortlisted = await shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS);
    assert.equal(shortlisted.length, 1, "Beirut makes the job eligible");
    assert.equal(shortlisted[0].jobId, "job-1");
  });

  test("Paris-only (no qualifying additional location): Free-plan Lebanon user is NOT eligible", () => {
    return (async () => {
      const supabase = makeMockSupabase([
        { data: [baseJobRow({ country_code: "FR", city: "Paris" })], error: null },
        { data: [{ job_id: "job-1", country_code: "FR", location_confidence: "high" }], error: null, count: 1 },
      ]);
      const shortlisted = await shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS);
      assert.equal(shortlisted.length, 0, "Paris alone must not pass for a Free Lebanon user");
    })();
  });

  test("Free/Student plan boundary: neither Paris nor Dubai qualifies, regardless of how many locations the job has", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: "FR", city: "Paris" })], error: null },
      {
        data: [
          { job_id: "job-1", country_code: "FR", location_confidence: "high" },
          { job_id: "job-1", country_code: "AE", location_confidence: "high" },
        ],
        error: null,
        count: 2,
      },
    ]);
    const shortlisted = await shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext({ planCode: "student" }), OPTIONS);
    assert.equal(shortlisted.length, 0, "Student plan never gets relocation eligibility, no matter how many locations");
  });

  test("Pro + relocation market restriction: a job with [FR, AE] locations is ineligible when the user's market is only SA", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: "FR", city: "Paris" })], error: null },
      {
        data: [
          { job_id: "job-1", country_code: "FR", location_confidence: "high" },
          { job_id: "job-1", country_code: "AE", location_confidence: "high" },
        ],
        error: null,
        count: 2,
      },
    ]);
    const shortlisted = await shortlistJobsForUser(
      supabase,
      [1, 0, 0],
      baseUserContext({ planCode: "pro", internationalSearchEnabled: true, willingToRelocate: true, relocationMarketCountryCodes: ["SA"] }),
      OPTIONS
    );
    assert.equal(shortlisted.length, 0, "neither FR nor AE is in the user's selected SA-only relocation market");
  });

  test("Pro + relocation market match: a job with [FR, SA] locations IS eligible for a user whose market is SA", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: "FR", city: "Paris" })], error: null },
      {
        data: [
          { job_id: "job-1", country_code: "FR", location_confidence: "high" },
          { job_id: "job-1", country_code: "SA", location_confidence: "high" },
        ],
        error: null,
        count: 2,
      },
    ]);
    const shortlisted = await shortlistJobsForUser(
      supabase,
      [1, 0, 0],
      baseUserContext({ planCode: "pro", internationalSearchEnabled: true, willingToRelocate: true, relocationMarketCountryCodes: ["SA"] }),
      OPTIONS
    );
    assert.equal(shortlisted.length, 1, "SA additional location should make the job eligible");
  });

  test("unknown remote_scope is never inferred from an additional location — a remote job with no stated scope stays ineligible even with a verified LB-less additional country", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ work_arrangement: "remote", remote_scope: null, country_code: "FR", city: "Paris" })], error: null },
      {
        data: [
          { job_id: "job-1", country_code: "FR", location_confidence: "high" },
          { job_id: "job-1", country_code: "AE", location_confidence: "high" },
        ],
        error: null,
        count: 2,
      },
    ]);
    const shortlisted = await shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS);
    assert.equal(shortlisted.length, 0, "a null remote_scope must stay ineligible — AE is not Lebanon and grants no remote eligibility on its own");
  });

  test("remote job with LB as a verified additional location IS eligible via the country_code==='LB' remote-scope path — not because remote_scope was inferred from the row", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ work_arrangement: "remote", remote_scope: null, country_code: "FR", city: "Paris" })], error: null },
      {
        data: [
          { job_id: "job-1", country_code: "FR", location_confidence: "high" },
          { job_id: "job-1", country_code: "LB", location_confidence: "high" },
        ],
        error: null,
        count: 2,
      },
    ]);
    const shortlisted = await shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS);
    assert.equal(shortlisted.length, 1, "remoteScopeIncludesLebanon's own countryCode==='LB' branch, unchanged — not a new inference");
  });

  test("multiple qualifying locations still produce exactly one shortlist entry for the job", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: "LB", city: "Beirut" })], error: null },
      {
        data: [
          { job_id: "job-1", country_code: "LB", location_confidence: "high" },
          { job_id: "job-1", country_code: "LB", location_confidence: "high" }, // Beirut + Tripoli, same country, both qualify
        ],
        error: null,
        count: 2,
      },
    ]);
    const shortlisted = await shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS);
    assert.equal(shortlisted.length, 1, "never one shortlist entry per qualifying location");
  });

  test("legacy job with zero job_locations rows falls back to the original scalar country_code path, unchanged", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: "LB", city: "Beirut" })], error: null },
      { data: [], error: null, count: 0 },
    ]);
    const shortlisted = await shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS);
    assert.equal(shortlisted.length, 1, "legacy single-location behavior must be preserved exactly");
  });

  test("low-confidence legacy job (no job_locations rows, ambiguous free-text location) stays ineligible", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: null, city: null, work_arrangement: null, location: "Beirut, Dubai, or Riyadh" })], error: null },
      { data: [], error: null, count: 0 },
    ]);
    const shortlisted = await shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS);
    assert.equal(shortlisted.length, 0, "a genuinely low-confidence scalar location must still be rejected");
  });

  test("a truncated job_locations fetch (returned rows < reported count) throws rather than silently evaluating a partial location set", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: "FR", city: "Paris" })], error: null },
      { data: [{ job_id: "job-1", country_code: "FR", location_confidence: "high" }], error: null, count: 5 },
    ]);
    await assert.rejects(
      () => shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS),
      /partially loaded location set/
    );
  });

  test("a job_locations query error propagates rather than being silently swallowed", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: "FR", city: "Paris" })], error: null },
      { data: null, error: { message: "simulated job_locations fetch failure" }, count: null },
    ]);
    await assert.rejects(
      () => shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS),
      /simulated job_locations fetch failure/
    );
  });
});

// Checkpoint 2D safety-review remediation: fetchVerifiedLocationsByJobId's
// completeness check must fail closed in every one of these five cases —
// the original version silently skipped validation whenever `count` came
// back null, which is exactly the "apparently complete but partial" gap
// the function exists to catch.
describe("fetchVerifiedLocationsByJobId — completeness check fails closed", () => {
  test("count = null WITH returned rows -> throws (must not silently trust an unverifiable non-empty result)", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: "FR", city: "Paris" })], error: null },
      { data: [{ job_id: "job-1", country_code: "FR", location_confidence: "high" }], error: null, count: null },
    ]);
    await assert.rejects(
      () => shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS),
      /no exact count/
    );
  });

  test("count = null WITH zero returned rows -> throws (an absent count is unverifiable even when rows happen to be empty)", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: "FR", city: "Paris" })], error: null },
      { data: [], error: null, count: null },
    ]);
    await assert.rejects(
      () => shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS),
      /no exact count/
    );
  });

  test("exact-count mismatch (truncated page) -> throws", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: "FR", city: "Paris" })], error: null },
      { data: [{ job_id: "job-1", country_code: "FR", location_confidence: "high" }], error: null, count: 5 },
    ]);
    await assert.rejects(
      () => shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS),
      /partially loaded location set/
    );
  });

  test("valid exact-count match -> proceeds normally, no throw", async () => {
    const supabase = makeMockSupabase([
      { data: [baseJobRow({ country_code: "LB", city: "Beirut" })], error: null },
      { data: [{ job_id: "job-1", country_code: "LB", location_confidence: "high" }], error: null, count: 1 },
    ]);
    const shortlisted = await shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS);
    assert.equal(shortlisted.length, 1);
  });

  test("empty candidate job-ID list -> short-circuits before querying job_locations at all, no throw", async () => {
    const supabase = makeMockSupabase([{ data: [], error: null }]); // jobs query returns zero candidates
    const shortlisted = await shortlistJobsForUser(supabase, [1, 0, 0], baseUserContext(), OPTIONS);
    assert.equal(shortlisted.length, 0);
    // Only the "jobs" query should have run — job_locations is never queried for an empty id list.
    assert.equal(supabase.calls.length, 1);
    assert.equal(supabase.calls[0].table, "jobs");
  });
});
