// Integration tests for the generalized defense-in-depth auth rate
// limiting added by supabase/migrations/20260822110000_add_login_rate_
// limiting.sql, 20260822130000_generalize_auth_rate_limits.sql
// (login/signup/forgot_password/oauth_init, email- or session-keyed), and
// 20260822150000_add_oauth_callback_and_password_update_rate_limits.sql
// (oauth_callback, session-keyed; password_update, user-keyed — added
// during the rate-limiting review to close the previously-unprotected
// /auth/callback and post-recovery password-update surfaces).
//
// reserve_auth_attempt()/clear_auth_attempts() are service_role-only —
// called exclusively from src/lib/authRateLimit/rateLimit.ts, itself only
// ever imported from server-only Next.js route handlers
// (src/app/api/auth/{login,signup,forgot-password,oauth-init}/route.ts).
// These tests call them the same way those routes do: through adminClient
// (service_role). A dedicated section below proves the vulnerability this
// design specifically closes — that anon/authenticated cannot call these
// functions at all, and so cannot target an arbitrary victim identifier
// directly, bypassing the routes' own request shape.
//
// Run: npm run test:db
// Requires: local Supabase running with both migrations applied.
//
// Deterministic by construction — never sleeps for a real window. "Succeeds
// again after the window" backdates rows directly instead of waiting.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, createAnonClient } from "./helpers.mjs";

function hashIdentifier(value) {
  return createHash("sha256").update(value.toLowerCase()).digest("hex");
}

function freshHash(label) {
  return hashIdentifier(`auth-rl-${label}-${randomUUID()}@test.local`);
}

async function countEvents(action, identifierKind, identifierHash) {
  const { data, error } = await adminClient
    .from("auth_rate_limit_events")
    .select("id")
    .eq("action", action)
    .eq("identifier_kind", identifierKind)
    .eq("identifier_hash", identifierHash);
  assert.equal(error, null, `countEvents error: ${error?.message}`);
  return data.length;
}

async function backdateEvents(action, identifierKind, identifierHash, minutesAgo) {
  const backdated = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const { error } = await adminClient
    .from("auth_rate_limit_events")
    .update({ created_at: backdated })
    .eq("action", action)
    .eq("identifier_kind", identifierKind)
    .eq("identifier_hash", identifierHash);
  assert.equal(error, null, `backdateEvents error: ${error?.message}`);
}

async function reserve(action, identifierKind, identifierHash, limit, windowMinutes) {
  return adminClient.rpc("reserve_auth_attempt", {
    p_action: action,
    p_identifier_kind: identifierKind,
    p_identifier_hash: identifierHash,
    p_limit: limit,
    p_window_minutes: windowMinutes,
  });
}

async function clear(action, identifierKind, identifierHash) {
  return adminClient.rpc("clear_auth_attempts", {
    p_action: action,
    p_identifier_kind: identifierKind,
    p_identifier_hash: identifierHash,
  });
}

describe("Generalized auth rate limiting (reserve_auth_attempt / clear_auth_attempts)", () => {
  const createdKeys = [];

  function trackedHash(label) {
    const h = freshHash(label);
    createdKeys.push(h);
    return h;
  }

  after(async () => {
    if (createdKeys.length > 0) {
      await adminClient.from("auth_rate_limit_events").delete().in("identifier_hash", createdKeys);
    }
  });

  test("the first N reservations within the window all succeed, N+1th is rejected", async () => {
    await assertExpectedLocalProject();
    const h = trackedHash("basic");

    for (let i = 0; i < 5; i++) {
      const { data, error } = await reserve("signup", "email", h, 5, 15);
      assert.equal(error, null, `reservation ${i} must not error: ${error?.message}`);
      assert.equal(data?.[0]?.allowed, true, `reservation ${i} must be allowed`);
      assert.equal(data?.[0]?.retry_after_seconds, 0);
    }
    assert.equal(await countEvents("signup", "email", h), 5);

    const { data: blocked, error } = await reserve("signup", "email", h, 5, 15);
    assert.equal(error, null);
    assert.equal(blocked?.[0]?.allowed, false, "the 6th reservation must be rejected");
    assert.ok(blocked?.[0]?.retry_after_seconds > 0);
    assert.equal(await countEvents("signup", "email", h), 5, "a rejected reservation must not itself be recorded");
  });

  test("clear_auth_attempts resets the window, allowing further reservations", async () => {
    const h = trackedHash("clears");
    for (let i = 0; i < 3; i++) await reserve("forgot_password", "email", h, 3, 15);
    const { data: blocked } = await reserve("forgot_password", "email", h, 3, 15);
    assert.equal(blocked?.[0]?.allowed, false);

    const { error: clearError } = await clear("forgot_password", "email", h);
    assert.equal(clearError, null, `clear must not error: ${clearError?.message}`);
    assert.equal(await countEvents("forgot_password", "email", h), 0);

    const { data: afterClear, error } = await reserve("forgot_password", "email", h, 3, 15);
    assert.equal(error, null);
    assert.equal(afterClear?.[0]?.allowed, true, "a reservation right after clearing must succeed");
  });

  test("reservations are scoped per identifier — a different hash is never blocked by another's exhausted window", async () => {
    const hA = trackedHash("scope-a");
    const hB = trackedHash("scope-b");
    for (let i = 0; i < 6; i++) await reserve("signup", "email", hA, 5, 15);
    const { data: aBlocked } = await reserve("signup", "email", hA, 5, 15);
    assert.equal(aBlocked?.[0]?.allowed, false);

    const { data: bAllowed, error } = await reserve("signup", "email", hB, 5, 15);
    assert.equal(error, null);
    assert.equal(bAllowed?.[0]?.allowed, true, "a different identifier must be completely unaffected");
  });

  test("reservations are scoped per action — the same identifier hash is independent across login/signup/forgot_password/oauth_init", async () => {
    // A coincidental hash collision across actions should never happen in
    // practice (different inputs), but the action column must still be a
    // real part of the key, not just documentation — verified here by
    // reusing one hash across all four actions and confirming each has its
    // own independent budget.
    const h = trackedHash("action-scope");
    for (let i = 0; i < 5; i++) await reserve("login", "email", h, 5, 15);
    const { data: loginBlocked } = await reserve("login", "email", h, 5, 15);
    assert.equal(loginBlocked?.[0]?.allowed, false, "login budget must be exhausted");

    for (const otherAction of ["signup", "forgot_password", "oauth_init"]) {
      const kind = otherAction === "oauth_init" ? "session" : "email";
      const { data, error } = await reserve(otherAction, kind, h, 5, 15);
      assert.equal(error, null);
      assert.equal(data?.[0]?.allowed, true, `${otherAction} must be unaffected by login's exhausted budget for the same hash`);
    }
  });

  test("reservations are scoped per identifier_kind — 'email' and 'session' with the same hash string are independent", async () => {
    const h = trackedHash("kind-scope");
    for (let i = 0; i < 5; i++) await reserve("signup", "email", h, 5, 15);
    const { data: emailBlocked } = await reserve("signup", "email", h, 5, 15);
    assert.equal(emailBlocked?.[0]?.allowed, false);

    const { data: sessionAllowed, error } = await reserve("signup", "session", h, 8, 15);
    assert.equal(error, null);
    assert.equal(sessionAllowed?.[0]?.allowed, true, "the session-kind bucket must be independent of the email-kind bucket");
  });

  test("reservations succeed again once the window has elapsed", async () => {
    const h = trackedHash("post-window");
    for (let i = 0; i < 3; i++) await reserve("forgot_password", "email", h, 3, 15);
    const { data: blocked } = await reserve("forgot_password", "email", h, 3, 15);
    assert.equal(blocked?.[0]?.allowed, false);

    await backdateEvents("forgot_password", "email", h, 16);

    const { data: afterWindow, error } = await reserve("forgot_password", "email", h, 3, 15);
    assert.equal(error, null);
    assert.equal(afterWindow?.[0]?.allowed, true, "expected success once the window has elapsed");
  });

  test("changing the submitted email cannot bypass the session-keyed signup gate", async () => {
    // Simulates src/app/api/auth/signup/route.ts's two-gate design directly
    // at the RPC level: a fixed session hash (one browser) submitting a
    // fresh email hash (rotated) on every attempt still gets blocked by its
    // own, email-independent session budget.
    const sessionHash = trackedHash("rotation-session");
    for (let i = 0; i < 8; i++) {
      const emailHash = trackedHash(`rotation-email-${i}`);
      await reserve("signup", "email", emailHash, 5, 15); // each email's own gate, always allowed (fresh)
      await reserve("signup", "session", sessionHash, 8, 15);
    }
    // The 9th distinct email still passes its own (fresh) email gate...
    const freshEmailHash = trackedHash("rotation-email-fresh");
    const { data: emailGate } = await reserve("signup", "email", freshEmailHash, 5, 15);
    assert.equal(emailGate?.[0]?.allowed, true, "a brand-new email's own gate is unaffected");
    // ...but the shared session gate is exhausted regardless of which email was submitted.
    const { data: sessionGate, error } = await reserve("signup", "session", sessionHash, 8, 15);
    assert.equal(error, null);
    assert.equal(sessionGate?.[0]?.allowed, false, "rotating the email must not reset the session-keyed budget");
  });

  test("invalid action, identifier_kind, identifier, limit, and window are all rejected", async () => {
    const h = trackedHash("validation");
    const { error: badAction } = await reserve("delete_account", "email", h, 5, 15);
    assert.ok(badAction, "an unrecognized action must be rejected");

    const { error: badKind } = await reserve("login", "phone", h, 5, 15);
    assert.ok(badKind, "an unrecognized identifier_kind must be rejected");

    const { error: badHashShort } = await reserve("login", "email", "not-a-hash", 5, 15);
    assert.ok(badHashShort, "a non-64-char identifier must be rejected");

    const { error: badHashUpper } = await reserve("login", "email", "A".repeat(64), 5, 15);
    assert.ok(badHashUpper, "an uppercase-hex identifier must be rejected");

    const { error: badLimitZero } = await reserve("login", "email", h, 0, 15);
    assert.ok(badLimitZero, "limit=0 must be rejected");

    const { error: badLimitHuge } = await reserve("login", "email", h, 1000, 15);
    assert.ok(badLimitHuge, "an absurdly large limit must be rejected");

    const { error: badWindowZero } = await reserve("login", "email", h, 5, 0);
    assert.ok(badWindowZero, "window=0 must be rejected");

    const { error: badWindowHuge } = await reserve("login", "email", h, 5, 999999);
    assert.ok(badWindowHuge, "an absurdly large window must be rejected");

    assert.equal(await countEvents("delete_account", "email", h), 0);
  });

  test("concurrent reservations for one identifier allow at most the configured limit", async () => {
    const h = trackedHash("concurrent");
    const results = await Promise.all(Array.from({ length: 8 }, () => reserve("oauth_init", "session", h, 5, 15)));
    const allowedCount = results.filter((r) => r.data?.[0]?.allowed).length;
    assert.equal(allowedCount, 5, "exactly 5 of 8 concurrent reservations must succeed");
    assert.equal(await countEvents("oauth_init", "session", h), 5);
  });

  test("clear_auth_attempts on an identifier with no recorded attempts is a safe no-op", async () => {
    const h = trackedHash("clear-noop");
    const { error } = await clear("login", "email", h);
    assert.equal(error, null);
  });

  describe("oauth_callback (session) and password_update (user) actions", () => {
    // Added by 20260822150000_add_oauth_callback_and_password_update_rate_
    // limits.sql to close the /auth/callback and post-recovery
    // password-update gaps found during the rate-limiting review. These
    // reuse the same reserve_auth_attempt/clear_auth_attempts RPCs and
    // advisory-lock/atomic-count-then-insert mechanism already proven
    // above for the original four actions — these tests only prove the
    // two new actions and the new 'user' identifier_kind were actually
    // wired into the allowlists, not re-prove the shared mechanism.

    test("oauth_callback (session-keyed) accepts reservations up to the limit, then blocks", async () => {
      const h = trackedHash("oauth-callback");
      for (let i = 0; i < 20; i++) {
        const { data, error } = await reserve("oauth_callback", "session", h, 20, 15);
        assert.equal(error, null, `reservation ${i} must not error: ${error?.message}`);
        assert.equal(data?.[0]?.allowed, true, `reservation ${i} must be allowed`);
      }
      const { data: blocked, error } = await reserve("oauth_callback", "session", h, 20, 15);
      assert.equal(error, null);
      assert.equal(blocked?.[0]?.allowed, false, "the 21st reservation must be rejected");
      assert.ok(blocked?.[0]?.retry_after_seconds > 0);
    });

    test("password_update (user-keyed) accepts reservations up to the limit, then blocks, then clears", async () => {
      const h = trackedHash("password-update");
      for (let i = 0; i < 8; i++) {
        const { data, error } = await reserve("password_update", "user", h, 8, 15);
        assert.equal(error, null, `reservation ${i} must not error: ${error?.message}`);
        assert.equal(data?.[0]?.allowed, true, `reservation ${i} must be allowed`);
      }
      const { data: blocked } = await reserve("password_update", "user", h, 8, 15);
      assert.equal(blocked?.[0]?.allowed, false, "the 9th reservation must be rejected");

      const { error: clearError } = await clear("password_update", "user", h);
      assert.equal(clearError, null);
      const { data: afterClear, error } = await reserve("password_update", "user", h, 8, 15);
      assert.equal(error, null);
      assert.equal(afterClear?.[0]?.allowed, true, "a reservation right after clearing must succeed");
    });

    test("password_update and oauth_callback are independent actions, even reusing the same hash", async () => {
      const h = trackedHash("cross-action");
      for (let i = 0; i < 8; i++) await reserve("password_update", "user", h, 8, 15);
      const { data: pwBlocked } = await reserve("password_update", "user", h, 8, 15);
      assert.equal(pwBlocked?.[0]?.allowed, false);

      const { data: callbackAllowed, error } = await reserve("oauth_callback", "session", h, 20, 15);
      assert.equal(error, null);
      assert.equal(callbackAllowed?.[0]?.allowed, true, "oauth_callback must be unaffected by password_update's exhausted budget for the same hash");
    });

    test("anon still cannot call reserve_auth_attempt/clear_auth_attempts for the new actions", async () => {
      const anon = createAnonClient();
      const h = hashIdentifier(`victim-new-action-${randomUUID()}@test.local`);
      const { data, error } = await anon.rpc("reserve_auth_attempt", {
        p_action: "password_update",
        p_identifier_kind: "user",
        p_identifier_hash: h,
        p_limit: 8,
        p_window_minutes: 15,
      });
      assert.equal(data, null);
      assert.ok(error, "anon must be rejected regardless of which action is requested");
    });
  });

  describe("vulnerability regression: anon/authenticated cannot call these functions directly", () => {
    // This is the exact issue found and fixed by
    // 20260822130000_generalize_auth_rate_limits.sql: the prior revision
    // granted EXECUTE to anon/authenticated, so any unauthenticated caller
    // could compute sha256(lower('victim@example.com')) themselves and call
    // reserve_login_attempt directly, repeatedly, to pre-exhaust one
    // specific victim's login quota — a targeted DoS bypassing the actual
    // login route entirely. Proven fixed: an anon client gets a permission
    // error, not a result, for both functions.
    const anon = createAnonClient();

    test("anon cannot call reserve_auth_attempt", async () => {
      const h = hashIdentifier(`victim-${randomUUID()}@test.local`);
      const { data, error } = await anon.rpc("reserve_auth_attempt", {
        p_action: "login",
        p_identifier_kind: "email",
        p_identifier_hash: h,
        p_limit: 5,
        p_window_minutes: 15,
      });
      assert.equal(data, null, "anon must never receive a result from this RPC");
      assert.ok(error, "anon must be rejected (no EXECUTE grant)");
      // Also confirms no row was actually written despite the attempted call.
      assert.equal(await countEvents("login", "email", h), 0);
    });

    test("anon cannot call clear_auth_attempts", async () => {
      const h = hashIdentifier(`victim-clear-${randomUUID()}@test.local`);
      const { error } = await anon.rpc("clear_auth_attempts", {
        p_action: "login",
        p_identifier_kind: "email",
        p_identifier_hash: h,
      });
      assert.ok(error, "anon must be rejected (no EXECUTE grant)");
    });

    test("the old 1-argument functions no longer exist at all", async () => {
      const { error: loginErr } = await anon.rpc("reserve_login_attempt", { p_identifier_hash: hashIdentifier("x@test.local") });
      assert.ok(loginErr, "reserve_login_attempt(text) must no longer be callable — replaced by reserve_auth_attempt");

      const { error: clearErr } = await anon.rpc("clear_login_attempts", { p_identifier_hash: hashIdentifier("x@test.local") });
      assert.ok(clearErr, "clear_login_attempts(text) must no longer be callable — replaced by clear_auth_attempts");
    });
  });
});
