// Unit tests for src/lib/coverLetters/types.ts's mapCoverLetterRow (Phase 08).
// Pure logic, no DB, no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mapCoverLetterRow } from "../../src/lib/coverLetters/types.ts";

describe("mapCoverLetterRow", () => {
  test("maps a draft row into camelCase fields", () => {
    const result = mapCoverLetterRow({
      id: "cl-1",
      match_id: "match-1",
      generated_content: "Dear Hiring Team...",
      edited_content: null,
      approved_content: null,
      generation_status: "completed",
      approval_status: "draft",
    });
    assert.equal(result.id, "cl-1");
    assert.equal(result.matchId, "match-1");
    assert.equal(result.generatedContent, "Dear Hiring Team...");
    assert.equal(result.editedContent, null);
    assert.equal(result.generationStatus, "completed");
    assert.equal(result.approvalStatus, "draft");
  });

  test("maps an approved row", () => {
    const result = mapCoverLetterRow({
      id: "cl-2",
      match_id: "match-2",
      generated_content: "original",
      edited_content: "edited version",
      approved_content: "edited version",
      generation_status: "completed",
      approval_status: "user_approved",
    });
    assert.equal(result.approvalStatus, "user_approved");
    assert.equal(result.approvedContent, "edited version");
  });
});
