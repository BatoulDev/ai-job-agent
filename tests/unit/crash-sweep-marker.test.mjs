// Unit tests for scripts/db-test-crash-recovery-sweep.mjs's fixture-email
// marker matching (isCrashSweepFixtureEmail). Pure regex logic, no database
// required — proves the marker matches every real automated-fixture email
// shape tests/db/helpers.mjs and tests/db/*.test.mjs actually produce
// (including the plus-tagged form from auth-credential-policy.test.mjs),
// while never matching a real/manual user's email, a seeded persona from
// scripts/seed-local-automation-users.mjs, or a lookalike outside the exact
// "db-test-...@test.local" shape.
//
// Run: node --test tests/unit/crash-sweep-marker.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isCrashSweepFixtureEmail } from "../../scripts/db-test-crash-recovery-sweep.mjs";

describe("isCrashSweepFixtureEmail", () => {
  describe("accepted: real fixture email shapes this codebase actually produces", () => {
    for (const email of [
      "db-test-cred-7-char-1a2b3c4d-e5f6-7890-abcd-ef1234567890@test.local",
      "db-test-onboarding-a1b2c3d4-e5f67890@test.local",
      "db-test-rate-limit-00000000@test.local",
      // tests/db/auth-credential-policy.test.mjs's plus-tagged fixture:
      "db-test-plus-1a2b3c4d-e5f6-7890-abcd-ef1234567890+test@test.local",
      "DB-TEST-UPPER-CASE-OK@TEST.LOCAL",
    ]) {
      test(`matches "${email}"`, () => {
        assert.equal(isCrashSweepFixtureEmail(email), true);
      });
    }
  });

  describe("rejected: real/manual users and seeded personas must never match", () => {
    for (const email of [
      "batoul.abdelrahman@gmail.com",
      "batoul+test@gmail.com",
      // scripts/seed-local-automation-users.mjs's fixed personas — @test.local
      // but deliberately do not start with "db-test-":
      "maya.haddad@test.local",
      "karim.nassar@test.local",
      "lina.mansour@test.local",
      "zain.khalil@test.local",
    ]) {
      test(`does not match "${email}"`, () => {
        assert.equal(isCrashSweepFixtureEmail(email), false);
      });
    }
  });

  describe("rejected: lookalikes outside the exact db-test-...@test.local shape", () => {
    for (const email of [
      "db-test-@test.local", // no content between prefix and domain
      "db-test-foo@test.localhost", // domain suffix, not exact match
      "db-test-foo@evil.com", // right prefix, wrong domain entirely
      "not-db-test-foo@test.local", // prefix not at the start
      "db-test-foo@test.local.evil.com", // domain-confusion suffix
      "db-test-foo bar@test.local", // space is not in the allowed character class
    ]) {
      test(`does not match "${email}"`, () => {
        assert.equal(isCrashSweepFixtureEmail(email), false);
      });
    }
  });

  test("rejected: null, undefined, non-string", () => {
    assert.equal(isCrashSweepFixtureEmail(null), false);
    assert.equal(isCrashSweepFixtureEmail(undefined), false);
    assert.equal(isCrashSweepFixtureEmail(42), false);
  });
});
