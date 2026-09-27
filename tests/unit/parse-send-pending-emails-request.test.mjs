// Unit tests for src/app/api/internal/applications/send-pending-emails/parseSendPendingEmailsRequest.ts (Phase 09).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSendPendingEmailsRequestBody } from "../../src/app/api/internal/applications/send-pending-emails/parseSendPendingEmailsRequest.ts";

describe("parseSendPendingEmailsRequestBody", () => {
  test("accepts a valid limit", () => {
    const result = parseSendPendingEmailsRequestBody({ limit: 10 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { limit: 10 });
  });

  test("rejects a non-object body", () => {
    assert.equal(parseSendPendingEmailsRequestBody(null).ok, false);
    assert.equal(parseSendPendingEmailsRequestBody("nope").ok, false);
  });

  test("rejects a missing limit", () => {
    assert.equal(parseSendPendingEmailsRequestBody({}).ok, false);
  });

  test("rejects an out-of-range limit", () => {
    assert.equal(parseSendPendingEmailsRequestBody({ limit: 0 }).ok, false);
    assert.equal(parseSendPendingEmailsRequestBody({ limit: 201 }).ok, false);
  });
});
