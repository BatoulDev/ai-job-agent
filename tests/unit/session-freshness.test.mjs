// Unit tests for src/lib/account/sessionFreshness.ts (account-deletion
// reauthentication gate, founder-approved 2026-11-02). Pure logic, no
// network, no Supabase client — exercises the exact JWT shape
// supabase.auth.getSession() returns (header.payload.signature, base64url).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decodeJwtIssuedAt, isSessionFresh, REAUTH_FRESHNESS_SECONDS } from "../../src/lib/account/sessionFreshness.ts";

function fakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

describe("decodeJwtIssuedAt", () => {
  test("reads the iat claim from a well-formed token", () => {
    assert.equal(decodeJwtIssuedAt(fakeJwt({ iat: 12345, sub: "user-1" })), 12345);
  });

  test("returns null for a token missing iat", () => {
    assert.equal(decodeJwtIssuedAt(fakeJwt({ sub: "user-1" })), null);
  });

  test("returns null for a malformed token (wrong segment count)", () => {
    assert.equal(decodeJwtIssuedAt("not-a-jwt"), null);
  });

  test("returns null for a token whose payload segment isn't valid JSON", () => {
    assert.equal(decodeJwtIssuedAt("header.not-json.sig"), null);
  });
});

describe("isSessionFresh", () => {
  test("is fresh exactly at the boundary", () => {
    const now = 1_000_000;
    assert.equal(isSessionFresh(now - REAUTH_FRESHNESS_SECONDS, now), true);
  });

  test("is not fresh one second past the boundary", () => {
    const now = 1_000_000;
    assert.equal(isSessionFresh(now - REAUTH_FRESHNESS_SECONDS - 1, now), false);
  });

  test("a just-issued token is fresh", () => {
    const now = 1_000_000;
    assert.equal(isSessionFresh(now, now), true);
  });
});
