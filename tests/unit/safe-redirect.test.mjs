// Unit tests for src/lib/safeRedirect.ts — the shared guard used before any
// `next`-style, user-controlled query value is turned into a redirect
// target (src/app/auth/callback/route.ts, src/lib/supabase/session.ts,
// src/app/login/page.tsx, src/app/signup/page.tsx).
//
// Regression coverage for a confirmed open-redirect bypass: the WHATWG URL
// parser strips ASCII tab/CR/LF during preprocessing, so a value like
// "/\t/evil.com" satisfied the old startsWith("/")/("//")/("/\\") checks
// yet collapsed to "//evil.com" (a different origin) once passed through
// `new URL(next, origin)` — the exact call every real consumer uses. Every
// "accepted" case below re-resolves the value through that same call and
// asserts the origin never changes, so this test would fail again if the
// control-character guard were ever removed.
//
// Run: node --experimental-strip-types --test tests/unit/safe-redirect.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isSafeRedirectPath } from "../../src/lib/safeRedirect.ts";

const APP_ORIGIN = "https://app.example.com";
const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

// Mirrors exactly how every real consumer turns an accepted value into a
// redirect target (NextResponse.redirect(new URL(next, origin))).
function resolvedOrigin(value) {
  return new URL(value, APP_ORIGIN).origin;
}

describe("isSafeRedirectPath", () => {
  describe("accepted: normal internal paths", () => {
    for (const path of ["/dashboard", "/onboarding/upload-cv", "/reset-password", "/"]) {
      test(`accepts "${path}" and it resolves to the app's own origin`, () => {
        assert.equal(isSafeRedirectPath(path), true);
        assert.equal(resolvedOrigin(path), APP_ORIGIN);
      });
    }
  });

  describe("accepted: internal paths with query strings and fragments", () => {
    for (const path of [
      "/dashboard?tab=applications",
      "/onboarding/preferences?gift=1&ref=email",
      "/reset-password#form",
      "/dashboard?next=%2Fsettings#section-2",
    ]) {
      test(`accepts "${path}" and it resolves to the app's own origin`, () => {
        assert.equal(isSafeRedirectPath(path), true);
        assert.equal(resolvedOrigin(path), APP_ORIGIN);
      });
    }
  });

  test("accepted: safe password-recovery destination", () => {
    const next = "/reset-password";
    assert.equal(isSafeRedirectPath(next), true);
    assert.equal(resolvedOrigin(next), APP_ORIGIN);
  });

  describe("rejected: protocol-relative URLs", () => {
    for (const path of ["//evil.com", "//evil.com/dashboard", "///evil.com"]) {
      test(`rejects "${path}"`, () => {
        assert.equal(isSafeRedirectPath(path), false);
      });
    }
  });

  describe("rejected: backslash variants", () => {
    for (const path of ["/\\evil.com", "/\\\\evil.com", "\\\\evil.com", "\\/evil.com"]) {
      test(`rejects ${JSON.stringify(path)}`, () => {
        assert.equal(isSafeRedirectPath(path), false);
      });
    }
  });

  describe("rejected: external / absolute URLs", () => {
    for (const path of [
      "https://evil.com",
      "http://evil.com/dashboard",
      "evil.com",
      "javascript:alert(1)",
    ]) {
      test(`rejects "${path}"`, () => {
        assert.equal(isSafeRedirectPath(path), false);
      });
    }
  });

  describe("rejected: control-character payloads that the WHATWG URL parser strips, changing origin", () => {
    // Per the URL spec, the parser removes every ASCII tab (0x09), CR
    // (0x0D), and LF (0x0A) from the input *before* parsing — anywhere in
    // the string, not just at the start. That's what makes these three
    // specific bytes exploitable: stripping a leading one can turn
    // "/<tab>/evil.com" into "//evil.com", a protocol-relative URL. Each
    // case here proves the guard is load-bearing by showing the origin
    // really would change if the value were ever accepted un-guarded.
    const ORIGIN_CHANGING_PAYLOADS = {
      "leading tab (the reproduced /\\t/evil.com bypass)": `/${TAB}/evil.com`,
      "leading CR": `/${CR}/evil.com`,
      "leading LF": `/${LF}/evil.com`,
      "CRLF pair": `/${CR}${LF}/evil.com`,
    };

    for (const [label, payload] of Object.entries(ORIGIN_CHANGING_PAYLOADS)) {
      test(`rejects ${label}`, () => {
        assert.equal(isSafeRedirectPath(payload), false);
      });

      test(`${label}: if it had been accepted, it would have changed origin (proves the guard is load-bearing)`, () => {
        assert.notEqual(resolvedOrigin(payload), APP_ORIGIN);
      });
    }

    test("rejects a tab appearing mid-path, not just a leading one (the parser strips every occurrence)", () => {
      // Stripped to "/dashboard//evil.com" here, which stays same-origin
      // (the "//" isn't at the very start, so it isn't parsed as
      // protocol-relative) — included to prove the guard rejects on
      // presence of the character alone, not only when it happens to be
      // exploitable in a given position.
      assert.equal(isSafeRedirectPath(`/dashboard/${TAB}/evil.com`), false);
    });
  });

  describe("rejected: other ASCII control characters (defense in depth)", () => {
    // NUL (0x00) and DEL (0x7F) are not part of the URL parser's
    // tab/CR/LF-stripping step, so accepting them would not by itself
    // change origin the way tab/CR/LF do — but the app's redirect target
    // should never contain a raw control byte at all, so the guard rejects
    // the full C0 range (0x00-0x1F) plus DEL (0x7F), not just the three
    // bytes known to be independently exploitable.
    test("rejects a leading NUL byte", () => {
      assert.equal(isSafeRedirectPath(`/${NUL}/evil.com`), false);
    });

    test("rejects a leading DEL byte", () => {
      assert.equal(isSafeRedirectPath(`/${DEL}/evil.com`), false);
    });

    test("rejects every byte in the C0 control range (0x00-0x1F)", () => {
      for (let code = 0; code <= 0x1f; code++) {
        const payload = `/${String.fromCharCode(code)}safe-looking-path`;
        assert.equal(isSafeRedirectPath(payload), false, `code 0x${code.toString(16)} was not rejected`);
      }
    });
  });

  describe("rejected: URL-encoded control-character payloads, as they arrive via searchParams.get()", () => {
    // searchParams.get() decodes percent-encoding before the app ever sees
    // the value, so the guard must reject the *decoded* string — this
    // mirrors exactly what src/app/auth/callback/route.ts and
    // src/lib/supabase/session.ts receive from a real request URL.
    const ENCODED_QUERY_VALUES = {
      "%2F%09%2Fevil.com (encoded tab)": { encoded: "%2F%09%2Fevil.com", originChanges: true },
      "%2F%0D%2Fevil.com (encoded CR)": { encoded: "%2F%0D%2Fevil.com", originChanges: true },
      "%2F%0A%2Fevil.com (encoded LF)": { encoded: "%2F%0A%2Fevil.com", originChanges: true },
      "%2F%00%2Fevil.com (encoded NUL)": { encoded: "%2F%00%2Fevil.com", originChanges: false },
    };

    for (const [label, { encoded, originChanges }] of Object.entries(ENCODED_QUERY_VALUES)) {
      test(`rejects the decoded payload for ${label}`, () => {
        const requestUrl = `${APP_ORIGIN}/auth/callback?code=test-code&next=${encoded}`;
        const { searchParams, origin } = new URL(requestUrl);
        const next = searchParams.get("next");

        assert.equal(isSafeRedirectPath(next), false);

        if (originChanges) {
          // Defense in depth: prove the underlying resolution would have
          // escaped the app's origin if the guard hadn't caught it — this
          // is what made the original bypass exploitable.
          assert.notEqual(new URL(next, origin).origin, APP_ORIGIN);
        }
      });
    }
  });

  test("rejected: null, undefined, empty string", () => {
    assert.equal(isSafeRedirectPath(null), false);
    assert.equal(isSafeRedirectPath(undefined), false);
    assert.equal(isSafeRedirectPath(""), false);
  });

  test("rejected: relative path without a leading slash", () => {
    assert.equal(isSafeRedirectPath("dashboard"), false);
    assert.equal(isSafeRedirectPath("../evil.com"), false);
  });
});
