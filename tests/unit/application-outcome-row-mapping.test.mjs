// Unit tests for src/lib/applications/outcomeTypes.ts's mapApplicationOutcomeRow (Phase 10).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mapApplicationOutcomeRow } from "../../src/lib/applications/outcomeTypes.ts";

describe("mapApplicationOutcomeRow", () => {
  test("maps a manually-reported outcome into camelCase fields", () => {
    const result = mapApplicationOutcomeRow({
      id: "outcome-1",
      application_id: "app-1",
      outcome_status: "interviewing",
      notes: "Phone screen scheduled.",
      updated_at: "2026-09-01T00:00:00Z",
    });
    assert.equal(result.id, "outcome-1");
    assert.equal(result.applicationId, "app-1");
    assert.equal(result.outcomeStatus, "interviewing");
    assert.equal(result.notes, "Phone screen scheduled.");
  });

  test("maps a row with no notes", () => {
    const result = mapApplicationOutcomeRow({
      id: "outcome-2",
      application_id: "app-2",
      outcome_status: "unknown",
      notes: null,
      updated_at: "2026-09-01T00:00:00Z",
    });
    assert.equal(result.outcomeStatus, "unknown");
    assert.equal(result.notes, null);
  });
});
