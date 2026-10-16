// Unit tests for
// src/app/api/internal/ingestion/run-linkedin-enrichment-batch/parseLinkedInEnrichmentBatchRequest.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseLinkedInEnrichmentBatchRequestBody } from "../../src/app/api/internal/ingestion/run-linkedin-enrichment-batch/parseLinkedInEnrichmentBatchRequest.ts";

function validBody(overrides = {}) {
  return {
    requestedJobIds: ["4467352986"],
    rawDatasetItems: [{ job_posting_id: "4467352986", workplace_types: ["ONSITE"] }],
    ...overrides,
  };
}

describe("parseLinkedInEnrichmentBatchRequestBody — valid requests", () => {
  test("accepts a well-formed body", () => {
    assert.equal(parseLinkedInEnrichmentBatchRequestBody(validBody()).ok, true);
  });

  test("accepts an empty rawDatasetItems array (total actor failure forwarded as zero results)", () => {
    const result = parseLinkedInEnrichmentBatchRequestBody(validBody({ rawDatasetItems: [] }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.rawDatasetItems, []);
  });

  test("accepts up to the maximum batch size of requested ids", () => {
    const requestedJobIds = Array.from({ length: 25 }, (_, i) => String(i));
    assert.equal(parseLinkedInEnrichmentBatchRequestBody({ requestedJobIds, rawDatasetItems: [] }).ok, true);
  });

  test("accepts a rawDatasetItems entry that doesn't match any requested id — reconciliation (not parsing) is responsible for ignoring it", () => {
    const result = parseLinkedInEnrichmentBatchRequestBody(validBody({ rawDatasetItems: [{ job_posting_id: "some-other-id" }] }));
    assert.equal(result.ok, true);
  });
});

describe("parseLinkedInEnrichmentBatchRequestBody — malformed requests rejected", () => {
  test("rejects a non-object body", () => {
    assert.equal(parseLinkedInEnrichmentBatchRequestBody("nope").ok, false);
    assert.equal(parseLinkedInEnrichmentBatchRequestBody(null).ok, false);
    assert.equal(parseLinkedInEnrichmentBatchRequestBody([1, 2]).ok, false);
  });

  test("rejects a non-array requestedJobIds", () => {
    assert.equal(parseLinkedInEnrichmentBatchRequestBody(validBody({ requestedJobIds: "not-an-array" })).ok, false);
  });

  test("rejects an empty requestedJobIds array", () => {
    assert.equal(parseLinkedInEnrichmentBatchRequestBody(validBody({ requestedJobIds: [] })).ok, false);
  });

  test("rejects an oversized requestedJobIds batch — bounded batching (Phase 12), never hundreds in one run", () => {
    const requestedJobIds = Array.from({ length: 26 }, (_, i) => String(i));
    assert.equal(parseLinkedInEnrichmentBatchRequestBody(validBody({ requestedJobIds })).ok, false);
  });

  test("rejects a requestedJobIds entry that is an empty/whitespace string", () => {
    assert.equal(parseLinkedInEnrichmentBatchRequestBody(validBody({ requestedJobIds: ["123", "   "] })).ok, false);
  });

  test("rejects a requestedJobIds entry that is not a string", () => {
    assert.equal(parseLinkedInEnrichmentBatchRequestBody(validBody({ requestedJobIds: ["123", 456] })).ok, false);
  });

  test("rejects a non-array rawDatasetItems", () => {
    assert.equal(parseLinkedInEnrichmentBatchRequestBody(validBody({ rawDatasetItems: "not-an-array" })).ok, false);
  });

  test("rejects a missing rawDatasetItems field", () => {
    const body = validBody();
    delete body.rawDatasetItems;
    assert.equal(parseLinkedInEnrichmentBatchRequestBody(body).ok, false);
  });

  test("rejects an implausibly oversized rawDatasetItems payload", () => {
    const rawDatasetItems = Array.from({ length: 51 }, (_, i) => ({ job_posting_id: String(i) }));
    assert.equal(parseLinkedInEnrichmentBatchRequestBody(validBody({ rawDatasetItems })).ok, false);
  });
});
