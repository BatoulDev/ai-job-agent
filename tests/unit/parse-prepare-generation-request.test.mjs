// Unit tests for src/app/api/internal/cover-letters/prepare-generation/parsePrepareGenerationRequest.ts (Phase 08).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parsePrepareGenerationRequestBody } from "../../src/app/api/internal/cover-letters/prepare-generation/parsePrepareGenerationRequest.ts";

describe("parsePrepareGenerationRequestBody", () => {
  test("accepts a valid limit", () => {
    const result = parsePrepareGenerationRequestBody({ limit: 20 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { limit: 20 });
  });

  test("rejects a non-object body", () => {
    assert.equal(parsePrepareGenerationRequestBody("nope").ok, false);
    assert.equal(parsePrepareGenerationRequestBody(null).ok, false);
    assert.equal(parsePrepareGenerationRequestBody([1, 2]).ok, false);
  });

  test("rejects a missing limit", () => {
    assert.equal(parsePrepareGenerationRequestBody({}).ok, false);
  });

  test("rejects a non-integer limit", () => {
    assert.equal(parsePrepareGenerationRequestBody({ limit: 1.5 }).ok, false);
    assert.equal(parsePrepareGenerationRequestBody({ limit: "20" }).ok, false);
  });

  test("rejects an out-of-range limit", () => {
    assert.equal(parsePrepareGenerationRequestBody({ limit: 0 }).ok, false);
    assert.equal(parsePrepareGenerationRequestBody({ limit: 201 }).ok, false);
  });
});
