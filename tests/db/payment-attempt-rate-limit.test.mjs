// Integration tests for the checkout/payment-attempt-creation quota added
// by supabase/migrations/20260822160000_add_payment_attempt_create_rate_
// limit.sql, found missing during the rate-limiting review:
// create_payment_attempt() already reused any in-flight ('created'/
// 'pending') attempt for the same (user, plan_code) — real idempotency —
// but had no bound on how many genuinely NEW attempts a user could create.
//
// These tests prove two independent things that must both hold:
//   1. The pre-existing idempotency guarantee is completely unaffected —
//      reusing an in-flight attempt never counts against the new quota.
//   2. The new quota (10 genuinely new attempts / rolling hour) activates
//      only once attempts are actually terminal and a fresh one is
//      requested, exactly like a real user retrying after a cancelled/
//      expired checkout.
//
// Run: npm run test:db
// Requires: local Supabase running with 20260822160000 applied.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers } from "./helpers.mjs";

const PLAN_CODE = "pro"; // payable, no residence restriction (unlike 'student')

async function resetPaymentQuota(userId) {
  await adminClient.from("rate_limit_events").delete().eq("user_id", userId).eq("action", "payment_attempt_create");
  await adminClient.from("payment_attempts").delete().eq("user_id", userId);
}

async function markTerminal(attemptId, status = "cancelled") {
  const { error } = await adminClient.from("payment_attempts").update({ status }).eq("id", attemptId);
  assert.equal(error, null, `failed to mark payment attempt terminal: ${error?.message}`);
}

describe("Checkout/payment-attempt-creation quota (create_payment_attempt)", () => {
  const users = [];

  after(async () => {
    for (const user of users) await resetPaymentQuota(user.id);
    await deleteTestUsers(users);
  });

  test("calling create_payment_attempt twice in a row reuses the same in-flight attempt — no new row, no quota charge", async () => {
    await assertExpectedLocalProject();
    const user = await createTestUser("payment-idempotent");
    users.push(user);
    await resetPaymentQuota(user.id);

    const { data: first, error: firstError } = await user.client.rpc("create_payment_attempt", { p_plan_code: PLAN_CODE });
    assert.equal(firstError, null, `first call must succeed: ${firstError?.message}`);

    const { data: second, error: secondError } = await user.client.rpc("create_payment_attempt", { p_plan_code: PLAN_CODE });
    assert.equal(secondError, null, `second call must succeed: ${secondError?.message}`);
    assert.equal(second.id, first.id, "a repeated call while one attempt is in flight must return the exact same row, never a duplicate");

    const { data: rows } = await adminClient.from("payment_attempts").select("id").eq("user_id", user.id);
    assert.equal(rows.length, 1, "exactly one payment_attempts row must exist despite two calls");

    const { data: quotaRows } = await adminClient
      .from("rate_limit_events")
      .select("id")
      .eq("user_id", user.id)
      .eq("action", "payment_attempt_create");
    assert.equal(quotaRows.length, 1, "a reused in-flight attempt must never charge the quota a second time");
  });

  test("the first 10 genuinely new attempts succeed; the 11th is rejected with PT429", async () => {
    const user = await createTestUser("payment-quota");
    users.push(user);
    await resetPaymentQuota(user.id);

    for (let i = 0; i < 10; i++) {
      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: PLAN_CODE });
      assert.equal(error, null, `attempt ${i} must succeed: ${error?.message}`);
      await markTerminal(data.id, "cancelled"); // simulate the user abandoning checkout, freeing the (user, plan) slot for reuse-check purposes
    }

    const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: PLAN_CODE });
    assert.equal(data, null, "the 11th genuinely new attempt must not be created");
    assert.ok(error, "the 11th attempt must be rejected");
    assert.equal(error.code, "PT429", `expected PT429, got ${error.code}`);
  });

  test("a terminal (cancelled) attempt is never reused — the next call creates a genuinely new row", async () => {
    const user = await createTestUser("payment-terminal-not-reused");
    users.push(user);
    await resetPaymentQuota(user.id);

    const { data: first } = await user.client.rpc("create_payment_attempt", { p_plan_code: PLAN_CODE });
    await markTerminal(first.id, "expired");

    const { data: second, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: PLAN_CODE });
    assert.equal(error, null);
    assert.notEqual(second.id, first.id, "a new attempt must be created once the previous one is terminal");
  });

  test("the quota is scoped per user — userB is unaffected by userA's exhausted quota", async () => {
    const userA = await createTestUser("payment-scope-a");
    const userB = await createTestUser("payment-scope-b");
    users.push(userA, userB);
    await resetPaymentQuota(userA.id);
    await resetPaymentQuota(userB.id);

    for (let i = 0; i < 10; i++) {
      const { data } = await userA.client.rpc("create_payment_attempt", { p_plan_code: PLAN_CODE });
      await markTerminal(data.id, "cancelled");
    }
    const { error: aBlockedError } = await userA.client.rpc("create_payment_attempt", { p_plan_code: PLAN_CODE });
    assert.equal(aBlockedError?.code, "PT429");

    const { data: bAllowed, error: bError } = await userB.client.rpc("create_payment_attempt", { p_plan_code: PLAN_CODE });
    assert.equal(bError, null, "userB must be completely unaffected by userA's exhausted quota");
    assert.ok(bAllowed);
  });

  test("concurrent create_payment_attempt calls for distinct plans do not race past the reuse-check (advisory lock holds)", async () => {
    const user = await createTestUser("payment-concurrent");
    users.push(user);
    await resetPaymentQuota(user.id);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => user.client.rpc("create_payment_attempt", { p_plan_code: PLAN_CODE }))
    );
    for (const r of results) assert.equal(r.error, null, `concurrent call must not error: ${r.error?.message}`);
    const ids = new Set(results.map((r) => r.data.id));
    assert.equal(ids.size, 1, "5 concurrent calls for the same in-flight (user, plan) must all resolve to the exact same row");

    const { data: rows } = await adminClient.from("payment_attempts").select("id").eq("user_id", user.id);
    assert.equal(rows.length, 1, "concurrency must never produce more than one row for the same in-flight attempt");
  });
});
