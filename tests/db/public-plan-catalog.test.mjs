// DB integration tests for public.get_public_plan_catalog() and the
// client-write surface of the tables it reads from
// (supabase/migrations/20260914100000_add_public_plan_catalog_and_price_publishing.sql).
//
// Proves, against the real function/RLS/grants (never re-implemented in JS):
//   - Returns the current, real prices (Student $9.00, Pro $18.00 today —
//     this suite never asserts a hard-coded value beyond confirming it
//     matches whatever plan_prices under the active version actually says,
//     except where a test explicitly asserts today's known launch price).
//   - Prices come from the ACTIVE price version only, never an inactive one.
//   - Returns no historical/inactive schedule, no price_version id, and no
//     column beyond the documented safe set.
//   - Works for both anon (unauthenticated landing page) and authenticated
//     callers.
//   - anon/authenticated can never write to plans/price_versions/plan_prices
//     directly (the catalog is read-only from every client role).
//
// Run: npm run test:db
// Requires: local Supabase running with 20260914100000 applied.

import { test, describe, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createAnonClient,
  createTestUser,
  deleteTestUsers,
} from "./helpers.mjs";

const CATALOG_COLUMNS = [
  "plan_code",
  "display_name",
  "price_amount",
  "currency",
  "billing_period",
  "job_match_limit",
  "cover_letter_limit",
].sort();

let originalActiveVersionId;

before(async () => {
  await assertExpectedLocalProject();
  const { data: active, error } = await adminClient
    .from("price_versions")
    .select("id")
    .eq("is_active", true)
    .single();
  assert.equal(error, null, `failed to read the active price version: ${error?.message}`);
  originalActiveVersionId = active.id;
});

async function restoreOriginalActiveVersion() {
  const { data: current } = await adminClient
    .from("price_versions")
    .select("id")
    .eq("is_active", true)
    .maybeSingle();
  if (current?.id === originalActiveVersionId) return;
  if (current) {
    await adminClient.from("price_versions").update({ is_active: false }).eq("id", current.id);
  }
  const { error } = await adminClient
    .from("price_versions")
    .update({ is_active: true })
    .eq("id", originalActiveVersionId);
  assert.equal(error, null, `failed to restore original active version: ${error?.message}`);
}

afterEach(restoreOriginalActiveVersion);

describe("get_public_plan_catalog — content", () => {
  test("returns Student at $9.00 and Pro at $18.00 (today's real, unchanged launch price)", async () => {
    const { data, error } = await adminClient.rpc("get_public_plan_catalog");
    assert.equal(error, null, `RPC failed: ${error?.message}`);

    const student = data.find((row) => row.plan_code === "student");
    const pro = data.find((row) => row.plan_code === "pro");
    assert.ok(student, "student plan must be present");
    assert.ok(pro, "pro plan must be present");
    assert.equal(Number(student.price_amount), 9.0);
    assert.equal(Number(pro.price_amount), 18.0);
    assert.equal(student.currency, "USD");
    assert.equal(pro.currency, "USD");
  });

  test("uses the active price version, never an inactive one", async () => {
    const { data: altVersion, error: versionErr } = await adminClient
      .from("price_versions")
      .insert({ label: "catalog-test-inactive-alt", is_active: false })
      .select()
      .single();
    assert.equal(versionErr, null);

    const { error: priceErr } = await adminClient.from("plan_prices").insert([
      { price_version_id: altVersion.id, plan_code: "free", price_amount: 0, currency: "USD", billing_period: "forever" },
      { price_version_id: altVersion.id, plan_code: "student", price_amount: 999, currency: "USD", billing_period: "monthly" },
      { price_version_id: altVersion.id, plan_code: "pro", price_amount: 999, currency: "USD", billing_period: "monthly" },
    ]);
    assert.equal(priceErr, null);

    try {
      const { data, error } = await adminClient.rpc("get_public_plan_catalog");
      assert.equal(error, null);
      const student = data.find((row) => row.plan_code === "student");
      assert.notEqual(Number(student.price_amount), 999, "the catalog must never read an inactive version's price");
      assert.equal(Number(student.price_amount), 9.0);
    } finally {
      await adminClient.from("plan_prices").delete().eq("price_version_id", altVersion.id);
      await adminClient.from("price_versions").delete().eq("id", altVersion.id);
    }
  });

  test("does not expose price_version id or any historical/inactive schedule", async () => {
    const { data, error } = await adminClient.rpc("get_public_plan_catalog");
    assert.equal(error, null);

    const codes = data.map((row) => row.plan_code).sort();
    assert.deepEqual(codes, ["free", "pro", "student"], "exactly the 3 active plans, one row each");

    for (const row of data) {
      assert.equal(Object.keys(row).sort().join(","), CATALOG_COLUMNS.join(","));
    }
  });

  test("does not expose any private/internal field", async () => {
    const { data, error } = await adminClient.rpc("get_public_plan_catalog");
    assert.equal(error, null);
    for (const row of data) {
      for (const forbidden of ["price_version_id", "id", "user_id", "provider", "provider_payment_id", "is_active"]) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(row, forbidden),
          false,
          `catalog row must never include "${forbidden}"`
        );
      }
    }
  });
});

describe("get_public_plan_catalog — access for both intended audiences", () => {
  test("works for an unauthenticated visitor (anon role) — the landing page's own access path", async () => {
    const anon = createAnonClient();
    const { data, error } = await anon.rpc("get_public_plan_catalog");
    assert.equal(error, null, `anon call failed: ${error?.message}`);
    assert.equal(data.length, 3);
  });

  test("works for a signed-in user", async () => {
    const user = await createTestUser("catalog-auth");
    try {
      const { data, error } = await user.client.rpc("get_public_plan_catalog");
      assert.equal(error, null, `authenticated call failed: ${error?.message}`);
      assert.equal(data.length, 3);
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

describe("get_public_plan_catalog — underlying tables reject unauthorized mutation", () => {
  test("anon cannot insert a price_versions row", async () => {
    const anon = createAnonClient();
    const { error } = await anon.from("price_versions").insert({ label: "anon-attack", is_active: true });
    assert.notEqual(error, null, "anon must not be able to insert price_versions");
  });

  test("anon cannot update a plan_prices row", async () => {
    const anon = createAnonClient();
    const { error } = await anon
      .from("plan_prices")
      .update({ price_amount: 0.01 })
      .eq("price_version_id", originalActiveVersionId)
      .eq("plan_code", "pro");
    assert.notEqual(error, null, "anon must not be able to update plan_prices");
  });

  test("an authenticated user cannot insert a price_versions row", async () => {
    const user = await createTestUser("catalog-mutate-pv");
    try {
      const { error } = await user.client.from("price_versions").insert({ label: "authed-attack", is_active: true });
      assert.notEqual(error, null, "authenticated must not be able to insert price_versions");
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("an authenticated user cannot update public.plans.price_amount directly", async () => {
    const user = await createTestUser("catalog-mutate-plans");
    try {
      const { error } = await user.client.from("plans").update({ price_amount: 0.01 }).eq("plan_code", "pro");
      assert.notEqual(error, null, "authenticated must not be able to update plans directly");

      const { data: unchanged } = await adminClient.from("plans").select("price_amount").eq("plan_code", "pro").single();
      assert.equal(Number(unchanged.price_amount), 18.0, "pro's display price must remain untouched");
    } finally {
      await deleteTestUsers([user]);
    }
  });
});
