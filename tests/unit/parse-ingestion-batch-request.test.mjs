// Unit tests for src/app/api/internal/ingestion/run-batch/parseIngestionBatchRequest.ts
// Run: node --test tests/unit/parse-ingestion-batch-request.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseIngestionBatchRequestBody } from "../../src/app/api/internal/ingestion/run-batch/parseIngestionBatchRequest.ts";

function validBody(overrides = {}) {
  return {
    sourceId: "sr-lb-test-co",
    sourceType: "greenhouse",
    rawJobs: [{ id: 1 }],
    maxJobsPerSource: 10,
    dryRun: false,
    ...overrides,
  };
}

describe("parseIngestionBatchRequestBody — valid requests", () => {
  test("accepts a well-formed body", () => {
    const result = parseIngestionBatchRequestBody(validBody());
    assert.equal(result.ok, true);
  });

  test("accepts each of the three automatable source types", () => {
    for (const sourceType of ["greenhouse", "lever", "workable"]) {
      assert.equal(parseIngestionBatchRequestBody(validBody({ sourceType })).ok, true);
    }
  });
});

describe("parseIngestionBatchRequestBody — malformed/tampered requests rejected", () => {
  test("rejects a non-object body", () => {
    assert.equal(parseIngestionBatchRequestBody("nope").ok, false);
    assert.equal(parseIngestionBatchRequestBody(null).ok, false);
    assert.equal(parseIngestionBatchRequestBody([1, 2]).ok, false);
  });

  test("rejects a missing/blank sourceId", () => {
    assert.equal(parseIngestionBatchRequestBody(validBody({ sourceId: "" })).ok, false);
    assert.equal(parseIngestionBatchRequestBody(validBody({ sourceId: undefined })).ok, false);
  });

  test("rejects an unknown sourceType", () => {
    assert.equal(parseIngestionBatchRequestBody(validBody({ sourceType: "indeed" })).ok, false);
  });

  test("rejects a source type with no automated adapter (admin_manual/linkedin/etc.)", () => {
    assert.equal(parseIngestionBatchRequestBody(validBody({ sourceType: "admin_manual" })).ok, false);
    assert.equal(parseIngestionBatchRequestBody(validBody({ sourceType: "linkedin" })).ok, false);
  });

  test("rejects a non-array rawJobs", () => {
    assert.equal(parseIngestionBatchRequestBody(validBody({ rawJobs: "not-an-array" })).ok, false);
  });

  test("rejects an oversized rawJobs payload", () => {
    const rawJobs = Array.from({ length: 2001 }, (_, i) => ({ id: i }));
    assert.equal(parseIngestionBatchRequestBody(validBody({ rawJobs })).ok, false);
  });

  test("rejects a non-integer or out-of-range maxJobsPerSource", () => {
    assert.equal(parseIngestionBatchRequestBody(validBody({ maxJobsPerSource: 0 })).ok, false);
    assert.equal(parseIngestionBatchRequestBody(validBody({ maxJobsPerSource: 1.5 })).ok, false);
    assert.equal(parseIngestionBatchRequestBody(validBody({ maxJobsPerSource: 501 })).ok, false);
    assert.equal(parseIngestionBatchRequestBody(validBody({ maxJobsPerSource: "10" })).ok, false);
  });

  test("rejects a non-boolean dryRun", () => {
    assert.equal(parseIngestionBatchRequestBody(validBody({ dryRun: "false" })).ok, false);
  });
});
