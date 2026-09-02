// DB/GoTrue integration tests for the password-length/composition and
// email-casing policy described in src/lib/authValidation/{email,password}.ts
// and supabase/config.toml's minimum_password_length /
// password_requirements. These exercise the real local GoTrue instance
// directly (not app-level validation, which is covered by
// tests/unit/auth-password-policy.test.mjs and
// tests/unit/auth-email-validation.test.mjs) — proving the server-side
// policy actually matches what the app claims.
//
// Run: node --test tests/db/auth-credential-policy.test.mjs
// Requires the local Supabase stack to have been (re)started after any
// change to supabase/config.toml's minimum_password_length (currently 8) —
// GoTrue only reads this at container startup. password_requirements is
// deliberately left unset (""): this app's policy (uppercase + special
// character required, lowercase/digit optional) doesn't match any of
// GoTrue's built-in composition options, which all require both a
// lowercase letter and a digit — composition is enforced at the app layer
// only (src/lib/authValidation/password.ts, both client and API routes).
//
// MAX_PASSWORD_LENGTH correction: an earlier revision of this suite flagged
// a discrepancy — real GoTrue hard-rejects any password over 72 characters
// ("Password cannot be longer than 72 characters", a bcrypt limitation,
// independent of minimum_password_length/password_requirements) while
// src/lib/authValidation/password.ts's MAX_PASSWORD_LENGTH was 200, so a
// 73-200 character password reached GoTrue and failed with a generic
// fallback error instead of a clear one. Resolved: MAX_PASSWORD_LENGTH is
// now 72, matching this real ceiling exactly (see the "MAX_PASSWORD_LENGTH
// boundary" describe block below for the empirical 72-accepted/73-rejected
// proof against this real backend, and getPasswordValidationError() for the
// specific "no more than 72 characters" message the app now shows).

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertExpectedLocalProject, createAnonClient, supabaseUrl, supabaseAnonKey } from "./helpers.mjs";
import { deleteFixtureUsers } from "./fixtureCleanup.mjs";

// These fixtures are created via anon.auth.signUp() directly (not
// helpers.mjs's createTestUser, which uses admin.createUser and so never
// exercises GoTrue's own client-facing password/email validation — the
// exact thing these tests prove) — so they're outside helpers.mjs's
// tracked-fixture manifest/safety net. This file's own after() below is
// therefore their only cleanup path, and must use the same
// retry-with-backoff, delete, and **verify** logic as every other fixture
// in this suite (tests/db/fixtureCleanup.mjs) — never a fire-and-forget
// `.catch(() => {})` that can silently leak a fixture into the shared
// local database on a transient failure.
const createdUserIds = [];

after(async () => {
  if (createdUserIds.length === 0) return;
  await deleteFixtureUsers(createdUserIds.map((id) => ({ id })));
});

function freshEmail(label) {
  return `db-test-cred-${label}-${randomUUID()}@test.local`;
}

describe("Supabase Auth password-length policy (minimum_password_length)", () => {
  test("a 7-character password is rejected by GoTrue itself, not just the app", async () => {
    await assertExpectedLocalProject();
    const anon = createAnonClient();
    const { data, error } = await anon.auth.signUp({
      email: freshEmail("7-char"),
      password: "short7c", // exactly 7 chars — one under the 8-char minimum
    });
    if (data?.user?.id) createdUserIds.push(data.user.id);
    assert.ok(error, "expected GoTrue to reject a 7-character password");
    assert.equal(error.status, 422);
  });

  test("a password of exactly 8 characters is accepted (when it also satisfies the app's composition rules)", async () => {
    const anon = createAnonClient();
    const { data, error } = await anon.auth.signUp({
      email: freshEmail("exact-8"),
      password: "Exactl#8", // exactly 8 chars, meets both composition rules
    });
    if (data?.user?.id) createdUserIds.push(data.user.id);
    assert.equal(error, null, `expected an 8-char password to be accepted, got: ${error?.message}`);
    assert.ok(data.user, "expected a user to be created");
  });

  test("a long (64+ character) password is accepted and never silently truncated", async () => {
    const anon = createAnonClient();
    // Prefixed with "Aa#" so this stays a pure length test — the
    // composition rules are already covered by their own describe block
    // below. Kept under the real 72-char ceiling (see the "MAX_PASSWORD_
    // LENGTH boundary" describe block below for the exact 72/73 proof) —
    // this test is about the mid-range "long but not at the edge" case.
    const longPassword = `Aa#${"pw-".repeat(20)}end`; // 66 chars
    assert.ok(longPassword.length >= 64);
    assert.ok(longPassword.length <= 72);
    const email = freshEmail("long-pw");
    const { data: signUpData, error: signUpError } = await anon.auth.signUp({
      email,
      password: longPassword,
    });
    if (signUpData?.user?.id) createdUserIds.push(signUpData.user.id);
    assert.equal(signUpError, null, `expected a long password to be accepted, got: ${signUpError?.message}`);

    // Prove it wasn't truncated: signing in with the FULL string must
    // succeed, and signing in with a truncated prefix must fail.
    const signInClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: fullSignInError } = await signInClient.auth.signInWithPassword({
      email,
      password: longPassword,
    });
    assert.equal(fullSignInError, null, "the exact long password must sign in successfully");

    const { error: truncatedSignInError } = await signInClient.auth.signInWithPassword({
      email,
      password: longPassword.slice(0, 40),
    });
    assert.ok(truncatedSignInError, "a truncated prefix of the password must be rejected");
  });
});

describe("MAX_PASSWORD_LENGTH boundary (72 accepted, 73 rejected) — real GoTrue, not just the app mirror", () => {
  test("exactly 72 characters is accepted by GoTrue", async () => {
    const anon = createAnonClient();
    const password = `Aa#${"x".repeat(69)}`; // 72 chars, composition-valid
    assert.equal(password.length, 72);
    const { data, error } = await anon.auth.signUp({
      email: freshEmail("max-72"),
      password,
    });
    if (data?.user?.id) createdUserIds.push(data.user.id);
    assert.equal(error, null, `expected a 72-char password to be accepted, got: ${error?.message}`);
    assert.ok(data.user, "expected a user to be created");
  });

  test("exactly 73 characters is rejected by GoTrue itself, not just the app", async () => {
    const anon = createAnonClient();
    const password = `Aa#${"x".repeat(70)}`; // 73 chars, otherwise composition-valid
    assert.equal(password.length, 73);
    const { data, error } = await anon.auth.signUp({
      email: freshEmail("max-73"),
      password,
    });
    if (data?.user?.id) createdUserIds.push(data.user.id);
    assert.ok(error, "expected GoTrue to reject a 73-character password");
    assert.equal(error.status, 400);
  });
});

describe("Supabase Auth password composition is deliberately app-only (GoTrue's password_requirements is unset)", () => {
  test("GoTrue itself accepts a password missing both an uppercase letter and a special character — composition is enforced only by the app layer, not GoTrue", async () => {
    const anon = createAnonClient();
    const { data, error } = await anon.auth.signUp({
      email: freshEmail("gotrue-no-composition"),
      password: "alllowercasenospecial123",
    });
    if (data?.user?.id) createdUserIds.push(data.user.id);
    assert.equal(
      error,
      null,
      `expected GoTrue to accept a composition-free password (only the app rejects it) — password_requirements may have been re-enabled: ${error?.message}`
    );
    assert.ok(data.user, "expected a user to be created");
  });

  test("a password satisfying the app's composition rules (uppercase + special) is accepted by GoTrue too", async () => {
    const email = freshEmail("valid-composition");
    const anon = createAnonClient();
    const { data, error } = await anon.auth.signUp({
      email,
      password: "Israa123#",
    });
    if (data?.user?.id) createdUserIds.push(data.user.id);
    assert.equal(error, null, `expected a fully-compliant password to be accepted, got: ${error?.message}`);
    assert.ok(data.user, "expected a user to be created");
  });

  test("login (signInWithPassword) never re-validates composition — an account can still sign in normally once created", async () => {
    const email = freshEmail("login-after-composition");
    const password = "StrongPass8%";
    const anon = createAnonClient();
    const { data: signUpData, error: signUpError } = await anon.auth.signUp({ email, password });
    if (signUpData?.user?.id) createdUserIds.push(signUpData.user.id);
    assert.equal(signUpError, null, `signUp failed: ${signUpError?.message}`);

    const signInClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: signInData, error: signInError } = await signInClient.auth.signInWithPassword({ email, password });
    assert.equal(signInError, null, `sign-in failed: ${signInError?.message}`);
    assert.equal(signInData.user.id, signUpData.user.id);
  });
});

describe("Email casing is handled consistently by Supabase Auth", () => {
  test("signing up with a mixed-case email and signing in with the lowercase form resolves to the same account", async () => {
    const localPart = `db-test-cred-casing-${randomUUID()}`;
    const mixedCaseEmail = `${localPart}@Test.Local`.replace(/^./, (c) => c.toUpperCase());
    const password = "Case-Test-Password-123";

    const anon = createAnonClient();
    const { data: signUpData, error: signUpError } = await anon.auth.signUp({
      email: mixedCaseEmail,
      password,
    });
    if (signUpData?.user?.id) createdUserIds.push(signUpData.user.id);
    assert.equal(signUpError, null, `signUp failed: ${signUpError?.message}`);

    const signInClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: signInData, error: signInError } = await signInClient.auth.signInWithPassword({
      email: mixedCaseEmail.toLowerCase(),
      password,
    });
    assert.equal(signInError, null, `sign-in with the normalized (lowercase) email failed: ${signInError?.message}`);
    assert.equal(signInData.user.id, signUpData.user.id, "must resolve to the exact same account, not a separate one");
  });
});

describe("Plus-addressed emails are accepted and preserved end-to-end", () => {
  test("a plus-tag address (e.g. batoul+test@gmail.com) signs up and signs back in as the same, untouched address", async () => {
    // Same shape as the reported real-world example (batoul+test@gmail.com)
    // — randomized so repeated test runs never collide, but with the same
    // "+tag" structure. test.local, not gmail.com: this is a real signUp()
    // against local GoTrue, and no email is ever actually sent locally
    // (enable_confirmations = false), but there's no reason to route it
    // through a real provider's domain either.
    const email = `db-test-plus-${randomUUID()}+test@test.local`;
    const password = "Plus-Address-Test-Pw1";

    const anon = createAnonClient();
    const { data: signUpData, error: signUpError } = await anon.auth.signUp({ email, password });
    if (signUpData?.user?.id) createdUserIds.push(signUpData.user.id);
    assert.equal(signUpError, null, `signUp with a plus-tag address failed: ${signUpError?.message}`);
    assert.equal(signUpData.user.email, email, "the +tag must be preserved exactly, not stripped or canonicalized");

    const signInClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: signInData, error: signInError } = await signInClient.auth.signInWithPassword({ email, password });
    assert.equal(signInError, null, `sign-in with the same plus-tag address failed: ${signInError?.message}`);
    assert.equal(signInData.user.id, signUpData.user.id);
    assert.equal(signInData.user.email, email, "the +tag must still be intact on sign-in, not just sign-up");
  });
});
