// Phase 10 — Authentication and tenant isolation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
  createAnonClient,
} from "./helpers.mjs";

let userA;
let userB;
let anon;

before(async () => {
  await assertExpectedLocalProject();
  userA = await createTestUser("tenant-a");
  userB = await createTestUser("tenant-b");
  anon = createAnonClient();
});

after(async () => {
  await deleteTestUsers([userA, userB]);
});

test("anonymous access to profiles is rejected", async () => {
  // anon has no GRANT at all on profiles (stronger than RLS-only
  // filtering — blocked at the Postgres grant layer before RLS even
  // applies), so PostgREST correctly returns a permission-denied error
  // rather than a silently empty result.
  const { data, error } = await anon.from("profiles").select("id").limit(5);
  assert.notEqual(error, null);
  assert.equal(data, null);
});

test("user A can read their own profile", async () => {
  const { data, error } = await userA.client.from("profiles").select("id, role").eq("id", userA.id).single();
  assert.equal(error, null);
  assert.equal(data.id, userA.id);
  assert.equal(data.role, "user");
});

test("user A cannot read user B's profile", async () => {
  const { data, error } = await userA.client.from("profiles").select("id").eq("id", userB.id).maybeSingle();
  assert.equal(error, null);
  assert.equal(data, null);
});

test("user A cannot update user B's profile", async () => {
  const { error } = await userA.client
    .from("profiles")
    .update({ custom_university: "Hacked University" })
    .eq("id", userB.id);
  // RLS silently matches zero rows rather than erroring; verify no change occurred.
  assert.equal(error, null);
  const { data } = await adminClient.from("profiles").select("custom_university").eq("id", userB.id).single();
  assert.notEqual(data.custom_university, "Hacked University");
});

test("client-supplied user_id cannot impersonate another user on insert-shaped tables", async () => {
  // job_preferences has no direct authenticated insert path other than
  // save_job_preferences(), which derives auth.uid() itself — confirm a
  // raw insert attempting to claim user_id = userB is rejected by RLS.
  const { error } = await userA.client.from("job_preferences").insert({
    user_id: userB.id,
    work_arrangement: "remote",
    job_type: "full-time",
    experience_level: "entry-level",
  });
  assert.notEqual(error, null);
});

test("ordinary user cannot self-promote to admin via direct update", async () => {
  const { error } = await userA.client.from("profiles").update({ role: "admin" }).eq("id", userA.id);
  // Column-level grant excludes `role` entirely — expect a permission error.
  assert.notEqual(error, null);
  const { data } = await adminClient.from("profiles").select("role").eq("id", userA.id).single();
  assert.equal(data.role, "user");
});

test("ordinary user is rejected from admin-only job mutations", async () => {
  const { error } = await userA.client.from("jobs").insert({
    title: "Should not be allowed",
    company_name: "Nope",
    description: "x",
    application_method: "external_link",
    application_url: "https://example.test",
    source_type: "admin_manual",
  });
  assert.notEqual(error, null);
});

test("is_admin() reflects the caller's own role only", async () => {
  const { data, error } = await userA.client.rpc("is_admin");
  assert.equal(error, null);
  assert.equal(data, false);

  await adminClient.from("profiles").update({ role: "admin" }).eq("id", userA.id);
  const { data: afterPromote } = await userA.client.rpc("is_admin");
  assert.equal(afterPromote, true);
  // Restore for subsequent tests/cleanup hygiene.
  await adminClient.from("profiles").update({ role: "user" }).eq("id", userA.id);
});
