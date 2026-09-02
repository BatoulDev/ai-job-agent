// Unit tests for src/lib/authValidation/password.ts — the shared password
// policy used by signup and reset-password (both the client pages and their
// API routes: src/app/api/auth/{signup,update-password}/route.ts). Imported
// directly (zero framework dependencies).
//
// Policy: minimum 8 characters, at least one uppercase letter, at least one
// special character. Lowercase letters and digits are NOT required.
//
// MAX_PASSWORD_LENGTH is 72, not an arbitrary generous cap — empirically
// confirmed against real local GoTrue (Supabase Auth): signUp() accepts a
// 72-character password and rejects a 73-character one outright with
// "Password cannot be longer than 72 characters" (a bcrypt limitation,
// independent of minimum_password_length/password_requirements). See
// tests/db/auth-credential-policy.test.mjs for the same boundary proven
// against the real backend, not just this app-level mirror of it.
//
// Run: node --experimental-strip-types --test tests/unit/auth-password-policy.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  PASSWORD_HINT,
  PASSWORD_TOO_LONG_ERROR,
  PASSWORD_COMPOSITION_ERROR,
  PASSWORD_REQUIREMENTS,
  getUnmetPasswordRequirements,
  isPasswordCompositionValid,
  getPasswordValidationError,
} from "../../src/lib/authValidation/password.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

describe("password length policy", () => {
  test("minimum is 8 characters", () => {
    assert.equal(MIN_PASSWORD_LENGTH, 8);
  });

  test("maximum is 72 characters, matching real GoTrue's hard bcrypt ceiling", () => {
    assert.equal(MAX_PASSWORD_LENGTH, 72);
  });

  test("a long (64+ character) password under the maximum is accepted and never truncated", () => {
    const password = `Aa1#${"x".repeat(60)}`; // 64 chars
    assert.equal(password.length, 64);
    assert.ok(password.length <= MAX_PASSWORD_LENGTH);
    assert.equal(isPasswordCompositionValid(password), true);
  });

  test("exactly 72 characters is accepted", () => {
    const password = `Aa#${"x".repeat(69)}`; // 72 chars
    assert.equal(password.length, 72);
    assert.equal(isPasswordCompositionValid(password), true);
    assert.equal(getPasswordValidationError(password), null);
  });

  test("exactly 73 characters is rejected — never silently truncated to fit", () => {
    const password = `Aa#${"x".repeat(70)}`; // 73 chars
    assert.equal(password.length, 73);
    assert.equal(isPasswordCompositionValid(password), false);
    assert.equal(getPasswordValidationError(password), PASSWORD_TOO_LONG_ERROR);
  });
});

describe("password composition policy (isPasswordCompositionValid)", () => {
  test("7 characters with uppercase and special character is rejected (too short)", () => {
    assert.equal(isPasswordCompositionValid("Ab1#bcd"), false);
  });

  test("8 characters with uppercase and special character is accepted", () => {
    assert.equal(isPasswordCompositionValid("Abcdef#1"), true);
    assert.equal(isPasswordCompositionValid("A#bcdefg"), true);
  });

  test("8+ characters without an uppercase letter is rejected", () => {
    assert.equal(isPasswordCompositionValid("abcdefg#"), false);
    assert.equal(isPasswordCompositionValid("abcdefgh#12345"), false);
  });

  test("8+ characters without a special character is rejected", () => {
    assert.equal(isPasswordCompositionValid("Abcdefgh"), false);
    assert.equal(isPasswordCompositionValid("Abcdefgh12345"), false);
  });

  test("a password without a lowercase letter is accepted if the other rules pass", () => {
    assert.equal(isPasswordCompositionValid("ABCDEFG#"), true);
    assert.equal(isPasswordCompositionValid("PASS123#WORD"), true);
  });

  test("a password without a number is accepted if the other rules pass", () => {
    assert.equal(isPasswordCompositionValid("Abcdefg#"), true);
    assert.equal(isPasswordCompositionValid("Password#Ok"), true);
  });

  test("spaces are supported and don't themselves satisfy or block any rule", () => {
    assert.equal(isPasswordCompositionValid("A #bcdef"), true);
    assert.equal(isPasswordCompositionValid("a b c d e f"), false, "no uppercase, no special char");
  });

  test("Unicode content is supported", () => {
    assert.equal(isPasswordCompositionValid("Pässwörd#密码🔒"), true);
  });

  test("a long password (64+ chars) that meets both composition rules is accepted, not just length", () => {
    const password = `Aa#${"x".repeat(64)}`;
    assert.ok(password.length >= 64);
    assert.equal(isPasswordCompositionValid(password), true);
  });

  test("special-character requirement is not limited to #, $, or % — common punctuation all qualifies", () => {
    for (const symbol of ["!", "@", "*", "(", ")", "_", "-", "=", "[", "]", "{", "}", ";", ":", "'", '"', ",", ".", "<", ">", "/", "?", "`", "|"]) {
      const password = `Abcdefgh${symbol}`;
      assert.equal(isPasswordCompositionValid(password), true, `expected "${symbol}" to qualify as a special character`);
    }
  });

  test("getUnmetPasswordRequirements reports exactly the missing pieces", () => {
    assert.deepEqual(getUnmetPasswordRequirements(""), ["length", "uppercase", "special"]);
    assert.deepEqual(getUnmetPasswordRequirements("abcdefgh"), ["uppercase", "special"]);
    assert.deepEqual(getUnmetPasswordRequirements("Ab#cdefg"), []);
  });

  test("PASSWORD_REQUIREMENTS has exactly the three documented rules — no lowercase or number entry", () => {
    assert.deepEqual(
      PASSWORD_REQUIREMENTS.map((r) => r.id),
      ["length", "uppercase", "special"]
    );
  });

  test("PASSWORD_HINT is the single compact line the UI shows, and names only the two required rules", () => {
    assert.equal(PASSWORD_HINT, "8+ characters, including 1 uppercase letter and 1 special character.");
  });

  test("PASSWORD_HINT never mentions the 72-character maximum — that only appears in the field-level error when exceeded", () => {
    assert.ok(!PASSWORD_HINT.includes("72"));
  });
});

describe("getPasswordValidationError — field-level error message selection", () => {
  test("returns null for a fully valid password", () => {
    assert.equal(getPasswordValidationError("Ab#cdefg"), null);
  });

  test("returns the composition message (not the length-maximum message) for a too-short or missing-class password", () => {
    assert.equal(getPasswordValidationError("Ab1#bcd"), PASSWORD_COMPOSITION_ERROR);
    assert.equal(getPasswordValidationError("abcdefgh#"), PASSWORD_COMPOSITION_ERROR);
    assert.equal(getPasswordValidationError("Abcdefgh"), PASSWORD_COMPOSITION_ERROR);
  });

  test("returns the 72-character-maximum message only when the password actually exceeds it, never otherwise", () => {
    const tooLong = `Aa#${"x".repeat(70)}`; // 73 chars, otherwise fully compliant
    assert.equal(getPasswordValidationError(tooLong), PASSWORD_TOO_LONG_ERROR);
    assert.ok(PASSWORD_TOO_LONG_ERROR.includes("72"));
    assert.ok(!PASSWORD_COMPOSITION_ERROR.includes("72"), "the composition message must never mention the length maximum");
  });

  test("a too-long password that also fails composition still gets the length message, not the composition one", () => {
    const tooLongAndWeak = "x".repeat(80); // no uppercase, no special, AND too long
    assert.equal(getPasswordValidationError(tooLongAndWeak), PASSWORD_TOO_LONG_ERROR);
  });
});

describe("signup and reset-password import the same shared policy module (no drift)", () => {
  function fileImportsSharedPasswordPolicy(relativePath) {
    const source = readFileSync(path.join(projectRoot, relativePath), "utf8");
    return source.includes('from "@/lib/authValidation/password"');
  }

  test("signup page imports the shared module", () => {
    assert.ok(fileImportsSharedPasswordPolicy("src/app/signup/page.tsx"));
  });

  test("reset-password page imports the shared module", () => {
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

  test("login API route never imports the composition validator — an existing password set under an older policy must still authenticate", () => {
    const source = readFileSync(path.join(projectRoot, "src/app/api/auth/login/route.ts"), "utf8");
    assert.ok(!source.includes("isPasswordCompositionValid"));
    assert.ok(!source.includes("getPasswordValidationError"));
  });

  test("supabase/config.toml leaves password_requirements unset — no built-in GoTrue option matches this policy without over-requiring lowercase/digit", () => {
    const source = readFileSync(path.join(projectRoot, "supabase/config.toml"), "utf8");
    assert.match(source, /password_requirements\s*=\s*""/);
  });

  test("supabase/config.toml's minimum_password_length still matches MIN_PASSWORD_LENGTH", () => {
    const source = readFileSync(path.join(projectRoot, "supabase/config.toml"), "utf8");
    assert.match(source, new RegExp(`minimum_password_length\\s*=\\s*${MIN_PASSWORD_LENGTH}\\b`));
  });
});

describe("no five-rule checklist component remains", () => {
  test("PasswordChecklist.tsx was removed", () => {
    assert.throws(() => readFileSync(path.join(projectRoot, "src/components/auth/PasswordChecklist.tsx")));
  });

  test("signup and reset-password no longer import PasswordChecklist", () => {
    for (const file of ["src/app/signup/page.tsx", "src/app/reset-password/page.tsx"]) {
      const source = readFileSync(path.join(projectRoot, file), "utf8");
      assert.ok(!source.includes("PasswordChecklist"), `${file} must not reference the removed checklist component`);
    }
  });

  test("signup and reset-password render the single compact PASSWORD_HINT as PasswordField helperText", () => {
    for (const file of ["src/app/signup/page.tsx", "src/app/reset-password/page.tsx"]) {
      const source = readFileSync(path.join(projectRoot, file), "utf8");
      assert.ok(source.includes("helperText={PASSWORD_HINT}"), `${file} must pass PASSWORD_HINT as helperText`);
    }
  });
});
