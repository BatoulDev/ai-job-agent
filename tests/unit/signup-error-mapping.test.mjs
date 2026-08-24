// Unit tests for the duplicate-signup fix in
// src/app/api/auth/signup/route.ts.
//
// Root cause (confirmed empirically against local GoTrue before this fix,
// not assumed): supabase.auth.signUp() against an email that already
// belongs to a *confirmed* account — the normal case locally, since email
// confirmation is auto-enabled — returns a genuine AuthApiError with
// { status: 422, code: "user_already_exists" }, not the empty-`identities`-
// array 200 Supabase uses for an *unconfirmed* duplicate. The route only
// special-cased status === 429 (rate limit); every other error, including
// this one, fell through to a raw generic 500.
//
// This project has no TS-import/mocking harness wired into the plain
// `node --test` runner (see tests/unit/cv-ownership.test.mjs and
// tests/unit/auth-rate-limit-fail-closed.test.mjs's own "mirrored
// implementation" convention) — so, consistent with that existing
// convention, this file mirrors the exact classification logic from the
// route's `if (error) { ... }` block and empty-identities check, and must
// be kept in sync with them.
//
// Run: node --test tests/unit/signup-error-mapping.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── Mirrored from src/app/api/auth/signup/route.ts ──────────────────────────
const GENERIC_RATE_LIMIT_ERROR = "Too many signup attempts. Please wait and try again.";
const GENERIC_SIGNUP_ERROR = "We couldn't create your account right now. Please try again.";
const SIGNUP_CONFLICT_ERROR =
  "We couldn't create the account. If you already have an account, try signing in or resetting your password.";
const SIGNUP_CONFLICT_CODE = "signup_conflict";
const DUPLICATE_EMAIL_ERROR_CODES = new Set(["user_already_exists", "email_exists"]);

const KNOWN_SAFE_MESSAGES = new Set([GENERIC_RATE_LIMIT_ERROR, GENERIC_SIGNUP_ERROR, SIGNUP_CONFLICT_ERROR]);

// error: the object supabase.auth.signUp() returned as `error`, or null.
// emptyIdentities: true when signUp() returned no error but
// data.user.identities.length === 0 (the unconfirmed-duplicate case).
function classifySignupError({ error, emptyIdentities }) {
  if (error) {
    if (error.status === 429) {
      return { status: 429, body: { error: GENERIC_RATE_LIMIT_ERROR } };
    }
    if (error.code && DUPLICATE_EMAIL_ERROR_CODES.has(error.code)) {
      return { status: 409, body: { error: SIGNUP_CONFLICT_ERROR, code: SIGNUP_CONFLICT_CODE } };
    }
    return { status: 500, body: { error: GENERIC_SIGNUP_ERROR } };
  }
  if (emptyIdentities) {
    return { status: 409, body: { error: SIGNUP_CONFLICT_ERROR, code: SIGNUP_CONFLICT_CODE } };
  }
  return { status: 200, body: { ok: true } };
}

describe("classifySignupError — duplicate-signup fix", () => {
  test("a genuinely new signup (no error, non-empty identities) succeeds normally", () => {
    const result = classifySignupError({ error: null, emptyIdentities: false });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true });
  });

  test("a duplicate against an already-confirmed account (the root-caused bug) maps to 409, not 500", () => {
    // Reproduces exactly what local GoTrue returned before this fix.
    const result = classifySignupError({ error: { status: 422, code: "user_already_exists" }, emptyIdentities: false });
    assert.equal(result.status, 409, "must never be 500 for this specific, known error code");
    assert.equal(result.body.error, SIGNUP_CONFLICT_ERROR);
    assert.equal(result.body.code, SIGNUP_CONFLICT_CODE);
  });

  test("the email_exists code variant is handled identically", () => {
    const result = classifySignupError({ error: { status: 422, code: "email_exists" }, emptyIdentities: false });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, SIGNUP_CONFLICT_ERROR);
  });

  test("a duplicate against an unconfirmed account (empty identities, no error) maps to the exact same response", () => {
    const viaError = classifySignupError({ error: { status: 422, code: "user_already_exists" }, emptyIdentities: false });
    const viaEmptyIdentities = classifySignupError({ error: null, emptyIdentities: true });
    assert.deepEqual(
      viaEmptyIdentities.body,
      viaError.body,
      "both duplicate-detection paths must be indistinguishable to the caller"
    );
    assert.equal(viaEmptyIdentities.status, viaError.status);
  });

  test("the conflict message never affirms account existence", () => {
    assert.ok(!SIGNUP_CONFLICT_ERROR.toLowerCase().includes("already exists"));
    assert.ok(!SIGNUP_CONFLICT_ERROR.toLowerCase().includes("this email"));
    assert.ok(SIGNUP_CONFLICT_ERROR.toLowerCase().includes("if you already have an account"));
  });

  test("a rate-limited signup keeps its own distinct message, never the conflict or generic message", () => {
    const result = classifySignupError({ error: { status: 429, code: "over_email_send_rate_limit" }, emptyIdentities: false });
    assert.equal(result.status, 429);
    assert.equal(result.body.error, GENERIC_RATE_LIMIT_ERROR);
    assert.notEqual(result.body.error, SIGNUP_CONFLICT_ERROR);
  });

  test("rate-limit status takes priority even if a duplicate-email code is somehow also present", () => {
    // Defensive: status is checked first in the real route, so a 429 is
    // never miscategorized as a conflict even if GoTrue attached an
    // unrelated code to it.
    const result = classifySignupError({ error: { status: 429, code: "user_already_exists" }, emptyIdentities: false });
    assert.equal(result.status, 429);
    assert.equal(result.body.error, GENERIC_RATE_LIMIT_ERROR);
  });

  test("an unexpected error with a known-unrelated code falls back to the generic message, not the conflict message", () => {
    const result = classifySignupError({ error: { status: 500, code: "unexpected_failure" }, emptyIdentities: false });
    assert.equal(result.status, 500);
    assert.equal(result.body.error, GENERIC_SIGNUP_ERROR);
    assert.equal(result.body.code, undefined, "the generic path must never emit a machine-readable code");
  });

  test("a network-level failure with no code at all (undefined) is handled safely, not crashed on", () => {
    const result = classifySignupError({ error: { status: undefined, code: undefined }, emptyIdentities: false });
    assert.equal(result.status, 500);
    assert.equal(result.body.error, GENERIC_SIGNUP_ERROR);
  });

  test("every possible mapped response uses one of exactly three known-safe, hand-authored messages — never anything else", () => {
    const inputs = [
      { error: null, emptyIdentities: false },
      { error: null, emptyIdentities: true },
      { error: { status: 429, code: "over_email_send_rate_limit" }, emptyIdentities: false },
      { error: { status: 422, code: "user_already_exists" }, emptyIdentities: false },
      { error: { status: 422, code: "email_exists" }, emptyIdentities: false },
      { error: { status: 500, code: "unexpected_failure" }, emptyIdentities: false },
      { error: { status: 400, code: "weak_password" }, emptyIdentities: false },
      { error: { status: undefined, code: undefined }, emptyIdentities: false },
    ];
    for (const input of inputs) {
      const result = classifySignupError(input);
      if (result.body.error) {
        assert.ok(
          KNOWN_SAFE_MESSAGES.has(result.body.error),
          `unexpected message leaked through for input ${JSON.stringify(input)}: "${result.body.error}"`
        );
      }
    }
  });

  test("the classifier never receives or touches the submitted email or password — proof by signature", () => {
    // classifySignupError's only inputs are the Supabase error shape and a
    // boolean; the submitted email/password are structurally impossible
    // for this function to log, since it never sees them. The route itself
    // never passes body.email/body.password to console.error in the
    // unexpected-error branch — only error.status and error.code (see the
    // route's own comment on that line).
    assert.equal(classifySignupError.length, 1);
  });
});
