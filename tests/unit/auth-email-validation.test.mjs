// Unit tests for src/lib/authValidation/email.ts — the shared
// trim/normalize/validate logic used by signup, login, and forgot-password
// (both the client pages and their API routes). Imported directly (this
// module has zero framework dependencies — no next/headers, no Supabase —
// so it's safe to import into the plain `node --test` runner, same
// approach as tests/unit/derive-cv-profile-state.test.mjs).
//
// Run: node --experimental-strip-types --test tests/unit/auth-email-validation.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, isValidEmailFormat, MAX_EMAIL_LENGTH } from "../../src/lib/authValidation/email.ts";

describe("normalizeEmail", () => {
  test("trims leading and trailing whitespace", () => {
    assert.equal(normalizeEmail("  jane@example.com  "), "jane@example.com");
  });

  test("lowercases the whole address", () => {
    assert.equal(normalizeEmail("Jane.Doe@Example.COM"), "jane.doe@example.com");
  });

  test("trims and lowercases together", () => {
    assert.equal(normalizeEmail("  Jane@Example.COM\t"), "jane@example.com");
  });

  test("never strips a plus-tag — Gmail-style canonicalization is deliberately not performed", () => {
    assert.equal(normalizeEmail("Jane+Jobs@Example.com"), "jane+jobs@example.com");
  });

  test("never strips dots from the local part — no Gmail-specific canonicalization", () => {
    assert.equal(normalizeEmail("j.a.n.e@example.com"), "j.a.n.e@example.com");
  });

  test("a real-world plus-tag Gmail address is trimmed/lowercased but the +tag is kept intact", () => {
    assert.equal(normalizeEmail("  Batoul+Test@Gmail.com  "), "batoul+test@gmail.com");
  });
});

describe("isValidEmailFormat", () => {
  test("accepts a normal email", () => {
    assert.ok(isValidEmailFormat("jane@example.com"));
  });

  test("accepts a plus-addressed email", () => {
    assert.ok(isValidEmailFormat("jane+jobs@example.com"));
  });

  test("accepts the exact reported real-world example (batoul+test@gmail.com) — plus-addressing must never produce a format error", () => {
    assert.ok(isValidEmailFormat("batoul+test@gmail.com"));
    assert.equal(normalizeEmail("batoul+test@gmail.com"), "batoul+test@gmail.com");
  });

  test("accepts a non-Gmail domain (no provider-specific restriction)", () => {
    assert.ok(isValidEmailFormat("jane@some-company.co.uk"));
    assert.ok(isValidEmailFormat("jane@sub.domain.example"));
  });

  test("rejects a missing domain", () => {
    assert.ok(!isValidEmailFormat("jane@"));
    assert.ok(!isValidEmailFormat("jane"));
  });

  test("rejects a domain with no dot (no TLD)", () => {
    assert.ok(!isValidEmailFormat("jane@localhost"));
  });

  test("rejects a missing local part", () => {
    assert.ok(!isValidEmailFormat("@example.com"));
  });

  test("rejects embedded whitespace", () => {
    assert.ok(!isValidEmailFormat("jane doe@example.com"));
    assert.ok(!isValidEmailFormat("jane@exa mple.com"));
  });

  test("rejects more than one @", () => {
    assert.ok(!isValidEmailFormat("jane@@example.com"));
  });

  test("rejects an empty string", () => {
    assert.ok(!isValidEmailFormat(""));
  });

  test("rejects an address over MAX_EMAIL_LENGTH", () => {
    const tooLong = `${"a".repeat(MAX_EMAIL_LENGTH)}@example.com`;
    assert.ok(!isValidEmailFormat(tooLong));
  });

  test("accepts an address right at MAX_EMAIL_LENGTH", () => {
    const localLength = MAX_EMAIL_LENGTH - "@example.com".length;
    const atLimit = `${"a".repeat(localLength)}@example.com`;
    assert.equal(atLimit.length, MAX_EMAIL_LENGTH);
    assert.ok(isValidEmailFormat(atLimit));
  });
});
