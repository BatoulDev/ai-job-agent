// Unit tests for src/app/api/internal/matching/prepare-embeddings/parsePrepareEmbeddingsRequest.ts
// Run: node --test tests/unit/parse-prepare-embeddings-request.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parsePrepareEmbeddingsRequestBody } from "../../src/app/api/internal/matching/prepare-embeddings/parsePrepareEmbeddingsRequest.ts";

describe("parsePrepareEmbeddingsRequestBody", () => {
  test("accepts valid limits", () => {
    const result = parsePrepareEmbeddingsRequestBody({ jobLimit: 50, profileLimit: 20 });
    assert.deepEqual(result, { ok: true, value: { jobLimit: 50, profileLimit: 20 } });
  });

  test("rejects a non-object body", () => {
    assert.equal(parsePrepareEmbeddingsRequestBody("nope").ok, false);
    assert.equal(parsePrepareEmbeddingsRequestBody(null).ok, false);
    assert.equal(parsePrepareEmbeddingsRequestBody([1]).ok, false);
  });

  test("rejects zero or negative limits", () => {
    assert.equal(parsePrepareEmbeddingsRequestBody({ jobLimit: 0, profileLimit: 10 }).ok, false);
    assert.equal(parsePrepareEmbeddingsRequestBody({ jobLimit: -5, profileLimit: 10 }).ok, false);
  });

  test("rejects a non-integer limit", () => {
    assert.equal(parsePrepareEmbeddingsRequestBody({ jobLimit: 1.5, profileLimit: 10 }).ok, false);
  });

  test("rejects a limit above the cap", () => {
    assert.equal(parsePrepareEmbeddingsRequestBody({ jobLimit: 201, profileLimit: 10 }).ok, false);
  });

  test("rejects a missing field", () => {
    assert.equal(parsePrepareEmbeddingsRequestBody({ jobLimit: 10 }).ok, false);
  });
});
