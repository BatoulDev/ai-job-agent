// Unit tests for src/lib/internalAuth.ts
// Run: node --test tests/unit/internal-auth.test.mjs

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedInternalRequest } from "../../src/lib/internalAuth.ts";

const ENV_VAR = "TEST_INTERNAL_SECRET";

function requestWithAuth(headerValue) {
  const headers = new Headers();
  if (headerValue !== undefined) headers.set("authorization", headerValue);
  return new Request("https://example.test/api/internal/whatever", { headers });
}

describe("isAuthorizedInternalRequest", () => {
  let original;
  before(() => {
    original = process.env[ENV_VAR];
  });
  after(() => {
    if (original === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = original;
  });

  test("fails closed when the env var is unset", () => {
    delete process.env[ENV_VAR];
    assert.equal(isAuthorizedInternalRequest(requestWithAuth("Bearer whatever"), ENV_VAR), false);
  });

  test("fails closed when the env var is empty string", () => {
    process.env[ENV_VAR] = "";
    assert.equal(isAuthorizedInternalRequest(requestWithAuth("Bearer whatever"), ENV_VAR), false);
  });

  test("rejects a missing Authorization header", () => {
    process.env[ENV_VAR] = "correct-secret";
    assert.equal(isAuthorizedInternalRequest(requestWithAuth(undefined), ENV_VAR), false);
  });

  test("rejects a non-Bearer scheme", () => {
    process.env[ENV_VAR] = "correct-secret";
    assert.equal(isAuthorizedInternalRequest(requestWithAuth("Basic correct-secret"), ENV_VAR), false);
  });

  test("rejects the wrong token", () => {
    process.env[ENV_VAR] = "correct-secret";
    assert.equal(isAuthorizedInternalRequest(requestWithAuth("Bearer wrong-secret"), ENV_VAR), false);
  });

  test("rejects a token of different length (never throws on length mismatch)", () => {
    process.env[ENV_VAR] = "correct-secret";
    assert.equal(isAuthorizedInternalRequest(requestWithAuth("Bearer short"), ENV_VAR), false);
  });

  test("accepts the exact correct token", () => {
    process.env[ENV_VAR] = "correct-secret";
    assert.equal(isAuthorizedInternalRequest(requestWithAuth("Bearer correct-secret"), ENV_VAR), true);
  });
});
