// DB-level checkout-tampering tests: proves the SERVER (not just the
// Next.js route's own body validation — see
// tests/unit/checkout-request-tampering.test.mjs for that half) can never
// be made to charge a client-supplied amount/currency/price-version, no
// matter how the RPC is called.
//
// public.create_payment_attempt(p_plan_code text) has exactly ONE
// parameter — there is structurally no argument name a caller could use
// to pass an amount, currency, discount, or price-version id even if they
// bypassed the Next.js API route entirely and called the REST endpoint
// directly with a stolen/leaked anon key. This suite proves that
// empirically against the real PostgREST/Postgres RPC surface, not by
// re-implementing the check in JS.
//
// Run: npm run test:db
// Requires: local Supabase running with 20260914100000 applied.

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  supabaseUrl,
  supabaseAnonKey,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
} from "./helpers.mjs";

let activeVersionId;
let launchStudentPrice;
let launchProPrice;

before(async () => {
  await assertExpectedLocalProject();
  const { data: active, error } = await adminClient
    .from("price_versions")
    .select("id")
    .eq("is_active", true)
    .single();
  assert.equal(error, null);
  activeVersionId = active.id;

  const { data: prices, error: priceErr } = await adminClient
    .from("plan_prices")
    .select("plan_code, price_amount")
    .eq("price_version_id", activeVersionId);
  assert.equal(priceErr, null);
  launchStudentPrice = Number(prices.find((p) => p.plan_code === "student").price_amount);
  launchProPrice = Number(prices.find((p) => p.plan_code === "pro").price_amount);
});

// A raw REST call, bypassing supabase-js's typed .rpc() wrapper entirely —
// the only way to actually attempt smuggling an extra parameter name into
// the RPC call, since supabase-js's own TypeScript types (generated from
// the real function signature) would refuse to compile a call with an
// extra argument.
async function rawRpc(userAccessToken, fnName, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${userAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, body: json };
}

describe("Checkout tampering — valid requests succeed and are server-priced", () => {
  test("a valid Student checkout is priced from plan_prices, never a caller value", async () => {
    const user = await createTestUser("tamper-student-valid");
    try {
      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "student" });
      assert.equal(error, null, `checkout failed: ${error?.message}`);
      assert.equal(Number(data.amount), launchStudentPrice);
      assert.equal(data.price_version_id, activeVersionId);
      assert.equal(data.plan_code, "student");
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("a valid Pro checkout is priced from plan_prices, never a caller value", async () => {
    const user = await createTestUser("tamper-pro-valid");
    try {
      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(error, null, `checkout failed: ${error?.message}`);
      assert.equal(Number(data.amount), launchProPrice);
      assert.equal(data.price_version_id, activeVersionId);
      assert.equal(data.plan_code, "pro");
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

describe("Checkout tampering — invalid/unexpected input is rejected", () => {
  test("an unknown plan code is rejected", async () => {
    const user = await createTestUser("tamper-unknown-plan");
    try {
      const { error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "enterprise" });
      assert.notEqual(error, null);
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("an inactive plan is rejected", async () => {
    const { error: deactivateErr } = await adminClient.from("plans").update({ is_active: false }).eq("plan_code", "pro");
    assert.equal(deactivateErr, null);

    const user = await createTestUser("tamper-inactive-plan");
    try {
      const { error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.notEqual(error, null, "an inactive plan must never be payable");
    } finally {
      await adminClient.from("plans").update({ is_active: true }).eq("plan_code", "pro");
      await deleteTestUsers([user]);
    }
  });

  test("raw REST call with an extra p_amount parameter is rejected outright by PostgREST — no such argument exists", async () => {
    const user = await createTestUser("tamper-extra-amount");
    try {
      const { status } = await rawRpc(user.session.access_token, "create_payment_attempt", {
        p_plan_code: "pro",
        p_amount: 0.01,
      });
      assert.notEqual(status, 200, "an extra, unrecognized RPC parameter must not be silently accepted");
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("raw REST call with an extra p_price_version_id parameter is rejected outright — no such argument exists", async () => {
    const user = await createTestUser("tamper-extra-version");
    try {
      const { status } = await rawRpc(user.session.access_token, "create_payment_attempt", {
        p_plan_code: "pro",
        p_price_version_id: "00000000-0000-0000-0000-000000000001",
      });
      assert.notEqual(status, 200);
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("raw REST call with extra currency/is_admin fields is rejected outright — no such arguments exist", async () => {
    const user = await createTestUser("tamper-extra-misc");
    try {
      const { status } = await rawRpc(user.session.access_token, "create_payment_attempt", {
        p_plan_code: "pro",
        currency: "EUR",
        is_admin: true,
      });
      assert.notEqual(status, 200);
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("changing frontend/display data cannot alter what create_payment_attempt charges", async () => {
    // There is no "display" input to this RPC at all — it takes only
    // p_plan_code. This test documents and re-confirms that fact: calling
    // it twice for the same plan, with nothing else ever supplied, always
    // returns the same server-resolved amount regardless of anything a
    // compromised frontend might have shown the user beforehand.
    const user = await createTestUser("tamper-frontend-data");
    try {
      const first = await user.client.rpc("create_payment_attempt", { p_plan_code: "student" });
      assert.equal(first.error, null);
      const second = await user.client.rpc("create_payment_attempt", { p_plan_code: "student" });
      assert.equal(second.error, null);
      assert.equal(Number(first.data.amount), Number(second.data.amount));
      assert.equal(Number(second.data.amount), launchStudentPrice);
    } finally {
      await deleteTestUsers([user]);
    }
  });
});
