// Unit tests for src/app/api/internal/matching/prepare-rerank/parsePrepareRerankRequest.ts
// Run: node --test tests/unit/parse-prepare-rerank-request.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parsePrepareRerankRequestBody } from "../../src/app/api/internal/matching/prepare-rerank/parsePrepareRerankRequest.ts";

describe("parsePrepareRerankRequestBody", () => {
  test("accepts valid limits", () => {
    const result = parsePrepareRerankRequestBody({ userLimit: 20, jobsPerUser: 10, candidatePoolSize: 100 });
    assert.deepEqual(result, { ok: true, value: { userLimit: 20, jobsPerUser: 10, candidatePoolSize: 100 } });
  });

  test("rejects a non-object body", () => {
    assert.equal(parsePrepareRerankRequestBody("nope").ok, false);
    assert.equal(parsePrepareRerankRequestBody(null).ok, false);
  });

  test("rejects a missing field", () => {
    assert.equal(parsePrepareRerankRequestBody({ userLimit: 1, jobsPerUser: 1 }).ok, false);
  });

  test("rejects zero or negative limits", () => {
    assert.equal(parsePrepareRerankRequestBody({ userLimit: 0, jobsPerUser: 1, candidatePoolSize: 1 }).ok, false);
  });

  test("rejects a limit above the cap", () => {
    assert.equal(parsePrepareRerankRequestBody({ userLimit: 201, jobsPerUser: 1, candidatePoolSize: 1 }).ok, false);
  });

  test("rejects a non-integer limit", () => {
    assert.equal(parsePrepareRerankRequestBody({ userLimit: 1.5, jobsPerUser: 1, candidatePoolSize: 1 }).ok, false);
  });
});
