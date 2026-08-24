// DB/GoTrue integration tests for the password-length and email-casing
// policy described in src/lib/authValidation/{email,password}.ts and
// supabase/config.toml's minimum_password_length. These exercise the real
// local GoTrue instance directly (not app-level validation, which is
// covered by tests/unit/auth-email-validation.test.mjs) — proving the
// server-side policy actually matches what the app claims.
//
// Run: node --test tests/db/auth-credential-policy.test.mjs
// Requires the local Supabase stack to have been (re)started after any
// change to supabase/config.toml's minimum_password_length (currently
// 8) — GoTrue only reads this at container startup.

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

  test("a password of exactly 8 characters is accepted", async () => {
    const anon = createAnonClient();
    const { data, error } = await anon.auth.signUp({
      email: freshEmail("exact-8"),
      password: "exactly8", // exactly 8 chars
    });
    if (data?.user?.id) createdUserIds.push(data.user.id);
    assert.equal(error, null, `expected an 8-char password to be accepted, got: ${error?.message}`);
    assert.ok(data.user, "expected a user to be created");
  });

  test("a long (64+ character) password is accepted and never silently truncated", async () => {
    const anon = createAnonClient();
    const longPassword = `${"pw-".repeat(22)}end`; // 69 chars
    assert.ok(longPassword.length >= 64);
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

describe("Email casing is handled consistently by Supabase Auth", () => {
  test("signing up with a mixed-case email and signing in with the lowercase form resolves to the same account", async () => {
    const localPart = `db-test-cred-casing-${randomUUID()}`;
    const mixedCaseEmail = `${localPart}@Test.Local`.replace(/^./, (c) => c.toUpperCase());
    const password = "case-test-password-123";

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
    const password = "plus-address-test-pw";

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
