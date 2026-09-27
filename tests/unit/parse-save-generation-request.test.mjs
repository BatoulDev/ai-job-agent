// Unit tests for src/app/api/internal/cover-letters/save-generation/parseSaveGenerationRequest.ts (Phase 08).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSaveGenerationRequestBody } from "../../src/app/api/internal/cover-letters/save-generation/parseSaveGenerationRequest.ts";

describe("parseSaveGenerationRequestBody", () => {
  test("accepts a valid successful result", () => {
    const result = parseSaveGenerationRequestBody({
      modelProvider: "openai",
      modelVersion: "gpt-4o-mini",
      results: [{ matchId: "match-1", response: "Dear Hiring Team..." }],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.results, [{ matchId: "match-1", response: "Dear Hiring Team..." }]);
  });

  test("rejects a non-object body", () => {
    assert.equal(parseSaveGenerationRequestBody(null).ok, false);
    assert.equal(parseSaveGenerationRequestBody([]).ok, false);
  });

  test("rejects a missing modelProvider/modelVersion", () => {
    assert.equal(parseSaveGenerationRequestBody({ modelVersion: "v1", results: [] }).ok, false);
    assert.equal(parseSaveGenerationRequestBody({ modelProvider: "openai", results: [] }).ok, false);
  });

  test("rejects a non-array results", () => {
    assert.equal(parseSaveGenerationRequestBody({ modelProvider: "openai", modelVersion: "v1", results: "nope" }).ok, false);
  });

  test("rejects a result missing matchId", () => {
    const result = parseSaveGenerationRequestBody({
      modelProvider: "openai",
      modelVersion: "v1",
      results: [{ response: "text" }],
    });
    assert.equal(result.ok, false);
  });

  test("rejects a result missing response", () => {
    const result = parseSaveGenerationRequestBody({
      modelProvider: "openai",
      modelVersion: "v1",
      results: [{ matchId: "match-1" }],
    });
    assert.equal(result.ok, false);
  });

  test("rejects more than 200 results", () => {
    const results = Array.from({ length: 201 }, (_, i) => ({ matchId: `match-${i}`, response: "text" }));
    const result = parseSaveGenerationRequestBody({ modelProvider: "openai", modelVersion: "v1", results });
    assert.equal(result.ok, false);
  });
});
