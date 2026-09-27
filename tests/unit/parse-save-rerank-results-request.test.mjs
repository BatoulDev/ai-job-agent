// Unit tests for src/app/api/internal/matching/save-rerank-results/parseSaveRerankResultsRequest.ts
// Run: node --test tests/unit/parse-save-rerank-results-request.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSaveRerankResultsRequestBody } from "../../src/app/api/internal/matching/save-rerank-results/parseSaveRerankResultsRequest.ts";

function validBody(overrides = {}) {
  return {
    matchingModel: "gpt-4o-mini",
    results: [{ candidateId: "analysis-1:job-1", response: { score: 80 } }],
    ...overrides,
  };
}

describe("parseSaveRerankResultsRequestBody — valid requests", () => {
  test("accepts a well-formed body", () => {
    assert.equal(parseSaveRerankResultsRequestBody(validBody()).ok, true);
  });

  test("accepts an empty results array", () => {
    assert.equal(parseSaveRerankResultsRequestBody({ matchingModel: "gpt-4o-mini", results: [] }).ok, true);
  });

  test("accepts a string response (raw LLM text, validated later by parseRerankResponse)", () => {
    const result = parseSaveRerankResultsRequestBody(validBody({ results: [{ candidateId: "a:b", response: "not json yet" }] }));
    assert.equal(result.ok, true);
  });
});

describe("parseSaveRerankResultsRequestBody — malformed requests rejected", () => {
  test("rejects a non-object body", () => {
    assert.equal(parseSaveRerankResultsRequestBody("nope").ok, false);
  });

  test("rejects a missing matchingModel", () => {
    assert.equal(parseSaveRerankResultsRequestBody({ results: [] }).ok, false);
  });

  test("rejects an empty matchingModel", () => {
    assert.equal(parseSaveRerankResultsRequestBody(validBody({ matchingModel: "" })).ok, false);
  });

  test("rejects a non-array results", () => {
    assert.equal(parseSaveRerankResultsRequestBody(validBody({ results: "nope" })).ok, false);
  });

  test("rejects an oversized results array", () => {
    const results = Array.from({ length: 201 }, (_, i) => ({ candidateId: `a:${i}`, response: {} }));
    assert.equal(parseSaveRerankResultsRequestBody(validBody({ results })).ok, false);
  });

  test("rejects a missing candidateId", () => {
    assert.equal(parseSaveRerankResultsRequestBody(validBody({ results: [{ response: {} }] })).ok, false);
  });

  test("rejects a missing response key entirely", () => {
    assert.equal(parseSaveRerankResultsRequestBody(validBody({ results: [{ candidateId: "a:b" }] })).ok, false);
  });
});
