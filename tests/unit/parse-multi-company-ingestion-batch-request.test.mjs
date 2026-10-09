// Unit tests for
// src/app/api/internal/ingestion/run-multi-company-batch/parseMultiCompanyIngestionBatchRequest.ts
// (Phase 13). Mirrors tests/unit/parse-ingestion-batch-request.test.mjs's
// coverage for the multi-company-feed counterpart endpoint.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseMultiCompanyIngestionBatchRequestBody } from "../../src/app/api/internal/ingestion/run-multi-company-batch/parseMultiCompanyIngestionBatchRequest.ts";

function validBody(overrides = {}) {
  return {
    sourceType: "remoteok",
    rawJobs: [{ id: 1 }],
    maxJobsPerSource: 10,
    dryRun: false,
    ...overrides,
  };
}

describe("parseMultiCompanyIngestionBatchRequestBody — valid requests", () => {
  test("accepts a well-formed body", () => {
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody()).ok, true);
  });

  test("accepts each currently-enabled multi-company source type", () => {
    for (const sourceType of ["remoteok", "jobicy", "arbeitnow"]) {
      assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ sourceType })).ok, true);
    }
  });
});

describe("parseMultiCompanyIngestionBatchRequestBody — malformed/tampered/disabled requests rejected", () => {
  test("rejects a non-object body", () => {
    assert.equal(parseMultiCompanyIngestionBatchRequestBody("nope").ok, false);
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(null).ok, false);
    assert.equal(parseMultiCompanyIngestionBatchRequestBody([1, 2]).ok, false);
  });

  test("rejects a company-specific (Tier-A) source type — those go through run-batch instead", () => {
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ sourceType: "greenhouse" })).ok, false);
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ sourceType: "ashby" })).ok, false);
  });

  test("rejects an unknown sourceType", () => {
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ sourceType: "linkedin" })).ok, false);
  });

  test("rejects a disabled/credential-blocked provider (jsearch/adzuna) even though it is a known JobSourceType", () => {
    for (const sourceType of ["jsearch", "adzuna"]) {
      assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ sourceType })).ok, false, `${sourceType} should be rejected while disabled`);
    }
  });

  // Phase 21: Bayt/GulfTalent/Indeed went live enabled:true — a real
  // request for any of them must now be ACCEPTED at this layer (the
  // route no longer rejects them, though runMultiCompanyIngestionBatch
  // itself still re-checks enabled live either way).
  test("accepts live-verified Apify-sourced providers (bayt/gulftalent/indeed)", () => {
    for (const sourceType of ["bayt", "gulftalent", "indeed"]) {
      assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ sourceType })).ok, true, `${sourceType} should be accepted now that it is enabled`);
    }
  });

  test("rejects a non-array rawJobs", () => {
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ rawJobs: "not-an-array" })).ok, false);
  });

  test("rejects an oversized rawJobs payload", () => {
    const rawJobs = Array.from({ length: 2001 }, (_, i) => ({ id: i }));
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ rawJobs })).ok, false);
  });

  test("rejects a non-integer, out-of-range, or missing maxJobsPerSource — never silently defaulted", () => {
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ maxJobsPerSource: 0 })).ok, false);
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ maxJobsPerSource: 501 })).ok, false);
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ maxJobsPerSource: undefined })).ok, false);
  });

  test("rejects a non-boolean dryRun", () => {
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ dryRun: "false" })).ok, false);
  });

  test("does NOT accept a sourceId field — multi-company feeds have none", () => {
    const result = parseMultiCompanyIngestionBatchRequestBody(validBody({ sourceId: "sr-should-be-ignored" }));
    assert.equal(result.ok, true);
    assert.equal("sourceId" in result.value, false);
  });
});

// Phase 22 fix: GulfTalent SA/AE collision — refreshScope lets a caller
// declare which independently-complete query partition this call's rawJobs
// belong to, separate from sourceType identity. Optional/null by default so
// every single-partition provider (RemoteOK/Jobicy/Arbeitnow/Bayt/Indeed)
// is unaffected.
describe("parseMultiCompanyIngestionBatchRequestBody — refreshScope (Phase 22 fix)", () => {
  test("defaults to null when omitted", () => {
    const result = parseMultiCompanyIngestionBatchRequestBody(validBody());
    assert.equal(result.ok, true);
    assert.equal(result.value.refreshScope, null);
  });

  test("accepts an explicit null", () => {
    const result = parseMultiCompanyIngestionBatchRequestBody(validBody({ refreshScope: null }));
    assert.equal(result.ok, true);
    assert.equal(result.value.refreshScope, null);
  });

  test("accepts a deterministic partition string, e.g. GulfTalent's SA/AE market split", () => {
    const result = parseMultiCompanyIngestionBatchRequestBody(validBody({ sourceType: "gulftalent", refreshScope: "country:SA" }));
    assert.equal(result.ok, true);
    assert.equal(result.value.refreshScope, "country:SA");
  });

  test("rejects a non-string, non-null refreshScope", () => {
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ refreshScope: 123 })).ok, false);
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ refreshScope: {} })).ok, false);
  });

  test("rejects an empty-string refreshScope", () => {
    assert.equal(parseMultiCompanyIngestionBatchRequestBody(validBody({ refreshScope: "   " })).ok, false);
  });
});
