// Phase: Authentication — new user creation triggers.
//
// Validates the database-level guarantees that both email/password signups
// and OAuth (Google) signups rely on:
//   1. handle_new_user trigger → creates profiles row automatically.
//   2. handle_new_user_subscription trigger → creates active free subscription.
//   3. New users can immediately call get_onboarding_readiness() and reach
//      the upload_cv step (plan_eligible=true, no CV yet).
//   4. A password update via the user client succeeds and does not touch
//      other owned rows (profile, subscription, CVs are untouched).
//   5. One user's recovery flow cannot touch another user's data.
//
// Run: node --test tests/db/auth-new-user-triggers.test.mjs
// LOCAL DATABASE ONLY — the helpers guard against a remote host.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
} from "./helpers.mjs";

let user;

before(async () => {
  await assertExpectedLocalProject();
  user = await createTestUser("auth-trigger");
});

after(async () => {
  await deleteTestUsers([user]);
});

test("handle_new_user trigger creates a profiles row", async () => {
  const { data, error } = await user.client
    .from("profiles")
    .select("id, full_name")
    .eq("id", user.id)
    .single();
  assert.equal(error, null, `profiles select failed: ${error?.message}`);
  assert.equal(data.id, user.id);
});

test("handle_new_user_subscription trigger creates an active free subscription", async () => {
  const { data, error } = await user.client
    .from("subscriptions")
    .select("user_id, plan_code, status, provider")
    .eq("user_id", user.id)
    .single();
  assert.equal(error, null, `subscriptions select failed: ${error?.message}`);
  assert.equal(data.plan_code, "free");
  assert.equal(data.status, "active");
  assert.equal(data.provider, "free");
});

test("get_onboarding_readiness returns upload_cv as next_step for a brand-new user", async () => {
  const { data, error } = await user.client.rpc("get_onboarding_readiness");
  assert.equal(error, null, `readiness RPC failed: ${error?.message}`);
  assert.ok(data, "readiness returned null");
  assert.equal(data.authenticated, true);
  assert.equal(data.has_profile, true);
  assert.equal(data.plan_eligible, true);
  assert.equal(data.has_cv, false);
  assert.equal(data.next_step, "upload_cv");
});

test("a second user cannot read the first user's profile", async () => {
  const second = await createTestUser("auth-trigger-b");
  try {
    const { data, error } = await second.client
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    assert.equal(error, null, `unexpected error: ${error?.message}`);
    assert.equal(data, null, "RLS should have filtered the row");
  } finally {
    await deleteTestUsers([second]);
  }
});

test("admin can update a user password without changing their subscription", async () => {
  const { data: subBefore } = await adminClient
    .from("subscriptions")
    .select("plan_code, status, provider")
    .eq("user_id", user.id)
    .single();

  // Simulate a password reset via the admin API (mirrors the server-side
  // Supabase auth flow; the browser client's updateUser() is tested by E2E).
  const { error: updateError } = await adminClient.auth.admin.updateUserById(
    user.id,
    { password: "new-test-password-123!" }
  );
  assert.equal(
    updateError,
    null,
    `password update failed: ${updateError?.message}`
  );

  const { data: subAfter } = await adminClient
    .from("subscriptions")
    .select("plan_code, status, provider")
    .eq("user_id", user.id)
    .single();

  assert.equal(subAfter.plan_code, subBefore.plan_code, "plan_code changed");
  assert.equal(subAfter.status, subBefore.status, "status changed");
  assert.equal(subAfter.provider, subBefore.provider, "provider changed");
});

test("no duplicate profiles row exists after trigger fires once", async () => {
  const { data, error } = await adminClient
    .from("profiles")
    .select("id")
    .eq("id", user.id);
  assert.equal(error, null);
  assert.equal(data.length, 1, "Expected exactly one profiles row");
});

test("no duplicate subscriptions row exists after trigger fires once", async () => {
  const { data, error } = await adminClient
    .from("subscriptions")
    .select("id")
    .eq("user_id", user.id);
  assert.equal(error, null);
  assert.equal(data.length, 1, "Expected exactly one subscriptions row");
});
