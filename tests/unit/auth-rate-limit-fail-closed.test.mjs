// Unit tests for the fail-closed policy on limiter-infrastructure failure.
//
// Policy (see src/lib/authRateLimit/rateLimit.ts and
// docs/PRODUCTION_READINESS.md): if reserve_auth_attempt's RPC call itself
// fails or returns no row, reserveAuthAttempt() returns null, and EVERY
// call site in src/app/api/auth/{login,signup,forgot-password,oauth-init}/
// route.ts and src/app/auth/callback/route.ts and
// src/app/api/auth/update-password/route.ts treats null as "cannot verify
// the request" — a safe generic 500 (or, for the two redirect-based
// routes, a safe redirect), never proceeding to the protected operation.
//
// This project has no TS-import/mocking harness wired into the plain
// `node --test` runner (see tests/unit/cv-ownership.test.mjs's own
// "mirrored implementation" convention) — so, consistent with that
// existing convention, this file mirrors the exact decision logic from
// reserveAuthAttempt() and from one representative call site, and must be
// kept in sync with them.
//
// Run: node --test tests/unit/auth-rate-limit-fail-closed.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── Mirrored from src/lib/authRateLimit/rateLimit.ts's reserveAuthAttempt ──
function mirroredReserveAuthAttempt({ error, row }) {
  if (error) return null;
  if (!row) return null;
  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
}

// ── Mirrored from every call site's null-handling, e.g.
// src/app/api/auth/login/route.ts ──
function mirroredRouteDecision(gate) {
  if (gate === null) return { status: 500, proceeded: false };
  if (!gate.allowed) return { status: 429, proceeded: false };
  return { status: 200, proceeded: true };
}

describe("reserveAuthAttempt fails closed on RPC error or missing row", () => {
  test("an RPC error yields null, never a permissive default", () => {
    const gate = mirroredReserveAuthAttempt({ error: { message: "connection reset" }, row: undefined });
    assert.equal(gate, null);
  });

  test("a missing/empty result row yields null", () => {
    const gate = mirroredReserveAuthAttempt({ error: null, row: undefined });
    assert.equal(gate, null);
  });

  test("a genuine allowed result is passed through unchanged", () => {
    const gate = mirroredReserveAuthAttempt({ error: null, row: { allowed: true, retry_after_seconds: 0 } });
    assert.deepEqual(gate, { allowed: true, retryAfterSeconds: 0 });
  });

  test("a genuine blocked result is passed through unchanged", () => {
    const gate = mirroredReserveAuthAttempt({ error: null, row: { allowed: false, retry_after_seconds: 42 } });
    assert.deepEqual(gate, { allowed: false, retryAfterSeconds: 42 });
  });
});

describe("every call site fails closed on a null gate — never proceeds to the protected operation", () => {
  test("null (RPC failure) blocks the request with a safe 500, and never proceeds", () => {
    const decision = mirroredRouteDecision(null);
    assert.equal(decision.status, 500);
    assert.equal(decision.proceeded, false, "the protected Supabase Auth operation must never run when the limiter itself could not be verified");
  });

  test("an explicit block (allowed: false) returns 429, and never proceeds", () => {
    const decision = mirroredRouteDecision({ allowed: false, retryAfterSeconds: 10 });
    assert.equal(decision.status, 429);
    assert.equal(decision.proceeded, false);
  });

  test("an explicit allow (allowed: true) is the only path that proceeds", () => {
    const decision = mirroredRouteDecision({ allowed: true, retryAfterSeconds: 0 });
    assert.equal(decision.status, 200);
    assert.equal(decision.proceeded, true);
  });
});
