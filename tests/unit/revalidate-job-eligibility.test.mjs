// Checkpoint 2E — pure, offline tests for
// src/lib/matching/revalidateJobEligibility.ts. Hand-rolled in-memory fake
// Supabase client (same pattern as tests/unit/shortlist-multi-location.test.mjs),
// zero network, zero real database. revalidateJobEligibilityForSave
// always queries "jobs" (terminal .maybeSingle()) then "job_locations"
// (terminal .in()), in that order.
//
// Run: node --test tests/unit/revalidate-job-eligibility.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { revalidateJobEligibilityForSave } from "../../src/lib/matching/revalidateJobEligibility.ts";

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
    status: "active",
    location: null,
    country_code: null,
    city: null,
    work_arrangement: "onsite",
    remote_scope: null,
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
  return {
    from() {
      const result = responses[callIndex++];
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        in() { return Promise.resolve(result); },
        maybeSingle() { return Promise.resolve(result); },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
      return builder;
    },
  };
}

describe("revalidateJobEligibilityForSave", () => {
  test("a still-eligible job (Lebanon, onsite) -> eligible: true", async () => {
    const supabase = makeMockSupabase([
      { data: baseJobRow({ country_code: "LB", city: "Beirut" }), error: null },
      { data: [], error: null, count: 0 },
    ]);
    const result = await revalidateJobEligibilityForSave(supabase, "job-1", baseUserContext());
    assert.deepEqual(result, { eligible: true });
  });

  test("job no longer found (deleted/unreachable) -> job_not_found", async () => {
    const supabase = makeMockSupabase([{ data: null, error: null }]);
    const result = await revalidateJobEligibilityForSave(supabase, "job-1", baseUserContext());
    assert.deepEqual(result, { eligible: false, reason: "job_not_found" });
  });

  test("job status changed to unavailable since discovery -> job_not_active (never silently saved)", async () => {
    const supabase = makeMockSupabase([{ data: baseJobRow({ status: "unavailable", country_code: "LB" }), error: null }]);
    const result = await revalidateJobEligibilityForSave(supabase, "job-1", baseUserContext());
    assert.deepEqual(result, { eligible: false, reason: "job_not_active" });
  });

  test("job went stale (long-unconfirmed) since discovery -> job_not_fresh", async () => {
    const supabase = makeMockSupabase([
      baseJobRow({
        country_code: "LB",
        last_seen_at: new Date(Date.now() - 90 * 86_400_000).toISOString(),
        published_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
      }),
    ].map((data) => ({ data, error: null })));
    const result = await revalidateJobEligibilityForSave(supabase, "job-1", baseUserContext());
    assert.deepEqual(result, { eligible: false, reason: "job_not_fresh" });
  });

  test("Beirut verified additional location removed since discovery, Paris-only now -> job_not_eligible for a Free Lebanon user", async () => {
    const supabase = makeMockSupabase([
      { data: baseJobRow({ country_code: "FR", city: "Paris" }), error: null },
      { data: [{ job_id: "job-1", country_code: "FR", location_confidence: "high" }], error: null, count: 1 },
    ]);
    const result = await revalidateJobEligibilityForSave(supabase, "job-1", baseUserContext());
    assert.deepEqual(result, { eligible: false, reason: "job_not_eligible" });
  });

  test("Beirut verified location still present -> eligible: true (Paris-primary + Beirut-additional, Checkpoint 2D case)", async () => {
    const supabase = makeMockSupabase([
      { data: baseJobRow({ country_code: "FR", city: "Paris" }), error: null },
      {
        data: [
          { job_id: "job-1", country_code: "FR", location_confidence: "high" },
          { job_id: "job-1", country_code: "LB", location_confidence: "high" },
        ],
        error: null,
        count: 2,
      },
    ]);
    const result = await revalidateJobEligibilityForSave(supabase, "job-1", baseUserContext());
    assert.deepEqual(result, { eligible: true });
  });

  test("plan downgraded to Free since discovery: a relocation-only-eligible job is now ineligible", async () => {
    const supabase = makeMockSupabase([
      { data: baseJobRow({ country_code: "AE", city: "Dubai" }), error: null },
      { data: [], error: null, count: 0 },
    ]);
    // Discovery-time context would have been Pro+relocation; at save time
    // the reloaded context already reflects the downgrade (this is what
    // loadUserContext's fresh re-read provides — here simulated directly).
    const result = await revalidateJobEligibilityForSave(supabase, "job-1", baseUserContext({ planCode: "free" }));
    assert.deepEqual(result, { eligible: false, reason: "job_not_eligible" });
  });

  test("remote job with unknown remote_scope stays ineligible even with a verified non-LB additional location (remote_scope never inferred from a location row)", async () => {
    const supabase = makeMockSupabase([
      { data: baseJobRow({ work_arrangement: "remote", remote_scope: null, country_code: "FR", city: "Paris" }), error: null },
      {
        data: [
          { job_id: "job-1", country_code: "FR", location_confidence: "high" },
          { job_id: "job-1", country_code: "AE", location_confidence: "high" },
        ],
        error: null,
        count: 2,
      },
    ]);
    const result = await revalidateJobEligibilityForSave(supabase, "job-1", baseUserContext());
    assert.deepEqual(result, { eligible: false, reason: "job_not_eligible" });
  });

  test("fail-closed: a job-fetch database error throws rather than defaulting to eligible", async () => {
    const supabase = makeMockSupabase([{ data: null, error: { message: "simulated jobs fetch failure" } }]);
    await assert.rejects(
      () => revalidateJobEligibilityForSave(supabase, "job-1", baseUserContext()),
      /simulated jobs fetch failure/
    );
  });

  test("fail-closed: a job_locations fetch database error throws rather than defaulting to eligible", async () => {
    const supabase = makeMockSupabase([
      { data: baseJobRow({ country_code: "FR" }), error: null },
      { data: null, error: { message: "simulated job_locations fetch failure" }, count: null },
    ]);
    await assert.rejects(
      () => revalidateJobEligibilityForSave(supabase, "job-1", baseUserContext()),
      /simulated job_locations fetch failure/
    );
  });

  test("fail-closed: an incomplete (truncated) job_locations read throws rather than evaluating a partial set", async () => {
    const supabase = makeMockSupabase([
      { data: baseJobRow({ country_code: "FR" }), error: null },
      { data: [{ job_id: "job-1", country_code: "FR", location_confidence: "high" }], error: null, count: 5 },
    ]);
    await assert.rejects(
      () => revalidateJobEligibilityForSave(supabase, "job-1", baseUserContext()),
      /partially loaded location set/
    );
  });
});
