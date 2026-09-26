// Unit tests for src/app/api/internal/matching/save-embeddings/parseSaveEmbeddingsRequest.ts
// Run: node --test tests/unit/parse-save-embeddings-request.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSaveEmbeddingsRequestBody } from "../../src/app/api/internal/matching/save-embeddings/parseSaveEmbeddingsRequest.ts";

function validBody(overrides = {}) {
  return {
    jobs: [{ jobId: "job-1", embedding: [0.1, 0.2, 0.3], contentHash: "abc123" }],
    profiles: [{ cvAnalysisId: "analysis-1", embedding: [0.4, 0.5], contentHash: "def456" }],
    ...overrides,
  };
}

describe("parseSaveEmbeddingsRequestBody — valid requests", () => {
  test("accepts a well-formed body", () => {
    assert.equal(parseSaveEmbeddingsRequestBody(validBody()).ok, true);
  });

  test("accepts empty jobs/profiles arrays", () => {
    assert.equal(parseSaveEmbeddingsRequestBody({ jobs: [], profiles: [] }).ok, true);
  });
});

describe("parseSaveEmbeddingsRequestBody — malformed requests rejected", () => {
  test("rejects a non-object body", () => {
    assert.equal(parseSaveEmbeddingsRequestBody("nope").ok, false);
    assert.equal(parseSaveEmbeddingsRequestBody(null).ok, false);
  });

  test("rejects when jobs or profiles is not an array", () => {
    assert.equal(parseSaveEmbeddingsRequestBody(validBody({ jobs: "nope" })).ok, false);
    assert.equal(parseSaveEmbeddingsRequestBody(validBody({ profiles: {} })).ok, false);
  });

  test("rejects an oversized jobs array", () => {
    const jobs = Array.from({ length: 201 }, (_, i) => ({ jobId: `job-${i}`, embedding: [0.1], contentHash: "h" }));
    assert.equal(parseSaveEmbeddingsRequestBody(validBody({ jobs })).ok, false);
  });

  test("rejects a missing jobId", () => {
    assert.equal(parseSaveEmbeddingsRequestBody(validBody({ jobs: [{ embedding: [0.1], contentHash: "h" }] })).ok, false);
  });

  test("rejects a non-array embedding", () => {
    assert.equal(parseSaveEmbeddingsRequestBody(validBody({ jobs: [{ jobId: "j", embedding: "nope", contentHash: "h" }] })).ok, false);
  });

  test("rejects an embedding containing a non-finite number", () => {
    assert.equal(parseSaveEmbeddingsRequestBody(validBody({ jobs: [{ jobId: "j", embedding: [0.1, NaN], contentHash: "h" }] })).ok, false);
    assert.equal(parseSaveEmbeddingsRequestBody(validBody({ jobs: [{ jobId: "j", embedding: [0.1, Infinity], contentHash: "h" }] })).ok, false);
  });

  test("rejects an empty embedding array", () => {
    assert.equal(parseSaveEmbeddingsRequestBody(validBody({ jobs: [{ jobId: "j", embedding: [], contentHash: "h" }] })).ok, false);
  });

  test("rejects an oversized embedding array", () => {
    const embedding = new Array(4097).fill(0.1);
    assert.equal(parseSaveEmbeddingsRequestBody(validBody({ jobs: [{ jobId: "j", embedding, contentHash: "h" }] })).ok, false);
  });

  test("rejects a missing contentHash", () => {
    assert.equal(parseSaveEmbeddingsRequestBody(validBody({ jobs: [{ jobId: "j", embedding: [0.1] }] })).ok, false);
  });

  test("rejects a missing cvAnalysisId in profiles", () => {
    assert.equal(parseSaveEmbeddingsRequestBody(validBody({ profiles: [{ embedding: [0.1], contentHash: "h" }] })).ok, false);
  });
});
