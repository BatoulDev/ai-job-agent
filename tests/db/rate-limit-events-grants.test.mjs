// Integration tests for the grant hardening added by
// supabase/migrations/20260822140000_harden_rate_limit_events_grants.sql,
// found during the rate-limiting review: anon previously retained
// TRUNCATE/REFERENCES/TRIGGER on public.rate_limit_events (the original
// 20260821090000_add_ai_task_and_cv_replace_rate_limits.sql revoked only
// `from public, authenticated`, omitting anon). These tests prove neither
// anon nor authenticated can read or write this table through the
// standard PostgREST/client surface at all, and that the trusted paths
// (service_role directly, and the SECURITY DEFINER functions that read/
// write it as their owner) are unaffected.
//
// Run: npm run test:db
// Requires: local Supabase running with 20260822140000 applied.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createAnonClient,
  createTestUser,
  deleteTestUsers,
  resetRateLimits,
  uploadFakeCv,
} from "./helpers.mjs";

describe("public.rate_limit_events grants", () => {
  const users = [];

  after(async () => {
    await deleteTestUsers(users);
  });

  test("anon cannot SELECT rate_limit_events", async () => {
    await assertExpectedLocalProject();
    const anon = createAnonClient();
    const { data, error } = await anon.from("rate_limit_events").select("id").limit(1);
    assert.equal(data, null);
    assert.ok(error, "anon SELECT must be rejected");
  });

  test("anon cannot INSERT into rate_limit_events", async () => {
    const anon = createAnonClient();
    const { error } = await anon
      .from("rate_limit_events")
      .insert({ user_id: "00000000-0000-0000-0000-000000000000", action: "cv_replace" });
    assert.ok(error, "anon INSERT must be rejected");
  });

  test("anon cannot UPDATE or DELETE rate_limit_events", async () => {
    const anon = createAnonClient();
    const { error: updateError } = await anon
      .from("rate_limit_events")
      .update({ action: "feedback_task_create" })
      .eq("action", "cv_replace");
    assert.ok(updateError, "anon UPDATE must be rejected");

    const { error: deleteError } = await anon.from("rate_limit_events").delete().eq("action", "cv_replace");
    assert.ok(deleteError, "anon DELETE must be rejected");
  });

  test("an authenticated user cannot SELECT, INSERT, UPDATE, or DELETE rate_limit_events directly", async () => {
    const user = await createTestUser("rle-grants-auth");
    users.push(user);

    const { data, error: selectError } = await user.client.from("rate_limit_events").select("id").limit(1);
    assert.equal(data, null);
    assert.ok(selectError, "authenticated SELECT must be rejected");

    const { error: insertError } = await user.client
      .from("rate_limit_events")
      .insert({ user_id: user.id, action: "cv_replace" });
    assert.ok(insertError, "authenticated INSERT must be rejected — even inserting their own user_id");

    const { error: updateError } = await user.client
      .from("rate_limit_events")
      .update({ action: "feedback_task_create" })
      .eq("user_id", user.id);
    assert.ok(updateError, "authenticated UPDATE must be rejected");

    const { error: deleteError } = await user.client.from("rate_limit_events").delete().eq("user_id", user.id);
    assert.ok(deleteError, "authenticated DELETE must be rejected — cannot erase their own rate-limit history");
  });

  test("service_role can read/write rate_limit_events directly, and the trusted RPC path (replace_cv) still works end to end", async () => {
    const user = await createTestUser("rle-grants-trusted");
    users.push(user);
    await resetRateLimits(user.id);

    // Trusted SECURITY DEFINER path: replace_cv() must still be able to
    // write this table as its owner, unaffected by the grant hardening
    // above (which only touched direct table-level grants, not function
    // ownership/execution rights).
    await uploadFakeCv(user);
    const { data: rows, error } = await adminClient
      .from("rate_limit_events")
      .select("id, action")
      .eq("user_id", user.id)
      .eq("action", "cv_replace");
    assert.equal(error, null, `service_role SELECT must succeed: ${error?.message}`);
    assert.equal(rows.length, 1, "replace_cv must still record exactly one cv_replace event via its SECURITY DEFINER path");
  });
});
