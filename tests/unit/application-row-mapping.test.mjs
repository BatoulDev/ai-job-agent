// Unit tests for src/lib/applications/types.ts's mapApplicationRow (Phase 09).
// Pure logic, no DB, no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mapApplicationRow } from "../../src/lib/applications/types.ts";

describe("mapApplicationRow", () => {
  test("maps a pending_send row into camelCase fields", () => {
    const result = mapApplicationRow({
      id: "app-1",
      match_id: "match-1",
      job_id: "job-1",
      cover_letter_id: "cl-1",
      application_method: "email",
      status: "pending_send",
      send_attempt_count: 0,
      last_attempt_at: null,
      last_error: null,
      provider_message_id: null,
      approved_at: "2026-09-01T00:00:00Z",
    });
    assert.equal(result.id, "app-1");
    assert.equal(result.matchId, "match-1");
    assert.equal(result.applicationMethod, "email");
    assert.equal(result.status, "pending_send");
    assert.equal(result.sendAttemptCount, 0);
  });

  test("maps a sent row with a provider message id", () => {
    const result = mapApplicationRow({
      id: "app-2",
      match_id: "match-2",
      job_id: "job-2",
      cover_letter_id: null,
      application_method: "external_link",
      status: "sent",
      send_attempt_count: 1,
      last_attempt_at: "2026-09-01T00:05:00Z",
      last_error: null,
      provider_message_id: "mock-abc",
      approved_at: "2026-09-01T00:00:00Z",
    });
    assert.equal(result.status, "sent");
    assert.equal(result.providerMessageId, "mock-abc");
    assert.equal(result.coverLetterId, null);
  });
});
