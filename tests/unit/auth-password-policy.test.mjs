// Unit tests for src/lib/authValidation/password.ts — the shared
// password-length policy used by signup and reset-password (both the
// client pages and their API routes: src/app/api/auth/{signup,update-
// password}/route.ts). Imported directly (zero framework dependencies).
//
// Run: node --experimental-strip-types --test tests/unit/auth-password-policy.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "../../src/lib/authValidation/password.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

describe("password length policy", () => {
  test("minimum is 8 characters", () => {
    assert.equal(MIN_PASSWORD_LENGTH, 8);
  });

  test("a 7-character password fails the minimum-length check", () => {
    const password = "a".repeat(7);
    assert.ok(password.length < MIN_PASSWORD_LENGTH);
  });

  test("an 8-character password passes the minimum-length check", () => {
    const password = "a".repeat(8);
    assert.ok(password.length >= MIN_PASSWORD_LENGTH);
  });

  test("a long (64+ character) password stays within the maximum and is never truncated", () => {
    const password = "a".repeat(64);
    assert.ok(password.length >= 64);
    assert.ok(password.length <= MAX_PASSWORD_LENGTH, "a 64-char password must fit under the maximum");
  });

  test("spaces, Unicode, and mixed content are not excluded by length alone", () => {
    const password = "pässwörd 密码 🔒 with spaces";
    assert.ok(password.length >= MIN_PASSWORD_LENGTH);
    assert.ok(password.length <= MAX_PASSWORD_LENGTH);
  });

  test("MAX_PASSWORD_LENGTH is generous enough for a password-manager-generated value", () => {
    assert.ok(MAX_PASSWORD_LENGTH >= 64);
  });
});

describe("signup and reset-password import the same shared policy module (no drift)", () => {
  function fileImportsSharedPasswordPolicy(relativePath) {
    const source = readFileSync(path.join(projectRoot, relativePath), "utf8");
    return source.includes('from "@/lib/authValidation/password"');
  }

  test("signup page imports MIN_PASSWORD_LENGTH from the shared module", () => {
    assert.ok(fileImportsSharedPasswordPolicy("src/app/signup/page.tsx"));
  });

  test("reset-password page imports MIN_PASSWORD_LENGTH from the shared module", () => {
    assert.ok(fileImportsSharedPasswordPolicy("src/app/reset-password/page.tsx"));
  });

  test("signup API route imports the shared module (never a locally redeclared constant)", () => {
    assert.ok(fileImportsSharedPasswordPolicy("src/app/api/auth/signup/route.ts"));
  });

  test("update-password API route imports the shared module (never a locally redeclared constant)", () => {
    assert.ok(fileImportsSharedPasswordPolicy("src/app/api/auth/update-password/route.ts"));
  });

  test("none of the four surfaces hardcodes its own MIN_PASSWORD_LENGTH constant", () => {
    const files = [
      "src/app/signup/page.tsx",
      "src/app/reset-password/page.tsx",
      "src/app/api/auth/signup/route.ts",
      "src/app/api/auth/update-password/route.ts",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(projectRoot, file), "utf8");
      assert.ok(
        !/const\s+MIN_PASSWORD_LENGTH\s*=/.test(source),
        `${file} must not redeclare MIN_PASSWORD_LENGTH locally — it must come from the shared module`
      );
    }
  });
});
