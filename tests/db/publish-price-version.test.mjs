// DB integration tests for public.publish_price_version() — the single
// protected operation for activating a new price schedule
// (supabase/migrations/20260914100000_add_public_plan_catalog_and_price_publishing.sql).
//
// Proves, against the real function (never re-implemented in JS):
//   - service_role can publish a complete, valid new version.
//   - Ordinary authenticated/anon callers cannot call it at all (no EXECUTE grant).
//   - Every validation branch (negative/invalid price, duplicate plan code,
//     unknown plan code, missing required active plan, invalid currency,
//     invalid billing_period) rejects BEFORE writing anything.
//   - A rejected call leaves zero trace — no orphaned price_versions row.
//   - Exactly one price_versions row is ever active, including immediately
//     after two concurrent publish calls.
//   - One audit_events row is written, with safe metadata only.
//   - public.get_public_plan_catalog() reflects the newly active version.
//   - public.plans' display columns are synced to the new version.
//   - An existing subscription's locked price_version_id is never touched
//     by publishing a new version (the core guarantee from
//     20260903090000_add_price_versioning_and_upgrade_locking.sql, which
//     this migration must not regress).
//
// Run: npm run test:db
// Requires: local Supabase running with 20260914100000 applied.

import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createAnonClient,
  createTestUser,
  deleteTestUsers,
} from "./helpers.mjs";

const VALID_PRICES = [
  { plan_code: "free", price_amount: 0, currency: "USD", billing_period: "forever" },
  { plan_code: "student", price_amount: 9, currency: "USD", billing_period: "monthly" },
  { plan_code: "pro", price_amount: 18, currency: "USD", billing_period: "monthly" },
];

let originalActiveVersionId;
// price_versions/plan_prices rows this file creates — unlike
// createTestUser/insertFakeJob, publish_price_version's output isn't
// tracked by helpers.mjs's fixture manifest, so this file owns its own
// cleanup list, mirroring the pattern already used by
// tests/db/price-versioning-and-upgrade.test.mjs for the same tables.
const createdVersionIds = new Set();

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

  // publish_price_version syncs public.plans display columns to whatever
  // it just activated — restore those too so later test files (and manual
  // local dev) see the real launch prices, not a leftover test value.
  const { data: launchPrices } = await adminClient
    .from("plan_prices")
    .select("plan_code, price_amount, currency, billing_period")
    .eq("price_version_id", originalActiveVersionId);
  for (const row of launchPrices ?? []) {
    await adminClient
      .from("plans")
      .update({ price_amount: row.price_amount, currency: row.currency, billing_period: row.billing_period })
      .eq("plan_code", row.plan_code);
  }
}

async function cleanupCreatedVersions() {
  for (const id of createdVersionIds) {
    await adminClient.from("plan_prices").delete().eq("price_version_id", id);
    await adminClient.from("price_versions").delete().eq("id", id);
  }
  createdVersionIds.clear();
}

afterEach(async () => {
  await restoreOriginalActiveVersion();
  await cleanupCreatedVersions();
});

after(async () => {
  await restoreOriginalActiveVersion();
  await cleanupCreatedVersions();
});

describe("publish_price_version — authorization", () => {
  test("service_role can publish a complete, valid new version", async () => {
    const { data, error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-authz-service-role",
      p_prices: VALID_PRICES,
    });
    assert.equal(error, null, `publish failed: ${error?.message}`);
    createdVersionIds.add(data.id);
    assert.equal(data.is_active, true);
    assert.equal(data.label, "test-authz-service-role");
  });

  test("anon cannot call publish_price_version at all", async () => {
    const anon = createAnonClient();
    const { error } = await anon.rpc("publish_price_version", {
      p_label: "anon-attack",
      p_prices: VALID_PRICES,
    });
    assert.notEqual(error, null, "anon must be rejected outright (no EXECUTE grant)");
  });

  test("an ordinary authenticated user cannot call publish_price_version", async () => {
    const user = await createTestUser("publish-authz");
    try {
      const { error } = await user.client.rpc("publish_price_version", {
        p_label: "authed-attack",
        p_prices: VALID_PRICES,
      });
      assert.notEqual(error, null, "an ordinary authenticated user must be rejected outright");
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

describe("publish_price_version — validation rejects before any write", () => {
  test("rejects a negative price", async () => {
    const { error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-negative",
      p_prices: [
        { plan_code: "free", price_amount: 0, currency: "USD", billing_period: "forever" },
        { plan_code: "student", price_amount: -5, currency: "USD", billing_period: "monthly" },
        { plan_code: "pro", price_amount: 18, currency: "USD", billing_period: "monthly" },
      ],
    });
    assert.equal(error?.code, "PT400");
  });

  test("rejects a duplicate plan code", async () => {
    const { error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-dup",
      p_prices: [...VALID_PRICES, { plan_code: "student", price_amount: 10, currency: "USD", billing_period: "monthly" }],
    });
    assert.equal(error?.code, "PT400");
  });

  test("rejects an unknown plan code", async () => {
    const { error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-unknown",
      p_prices: [...VALID_PRICES, { plan_code: "enterprise", price_amount: 99, currency: "USD", billing_period: "monthly" }],
    });
    assert.equal(error?.code, "PT400");
  });

  test("rejects a schedule missing a required active plan (no free)", async () => {
    const { error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-missing-plan",
      p_prices: [
        { plan_code: "student", price_amount: 9, currency: "USD", billing_period: "monthly" },
        { plan_code: "pro", price_amount: 18, currency: "USD", billing_period: "monthly" },
      ],
    });
    assert.equal(error?.code, "PT400");
  });

  test("rejects an invalid (non-3-letter) currency code", async () => {
    const { error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-currency",
      p_prices: [
        { plan_code: "free", price_amount: 0, currency: "US", billing_period: "forever" },
        { plan_code: "student", price_amount: 9, currency: "USD", billing_period: "monthly" },
        { plan_code: "pro", price_amount: 18, currency: "USD", billing_period: "monthly" },
      ],
    });
    assert.equal(error?.code, "PT400");
  });

  test("rejects an invalid billing_period", async () => {
    const { error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-billing-period",
      p_prices: [
        { plan_code: "free", price_amount: 0, currency: "USD", billing_period: "forever" },
        { plan_code: "student", price_amount: 9, currency: "USD", billing_period: "weekly" },
        { plan_code: "pro", price_amount: 18, currency: "USD", billing_period: "monthly" },
      ],
    });
    assert.equal(error?.code, "PT400");
  });

  test("rejects an empty label", async () => {
    const { error } = await adminClient.rpc("publish_price_version", {
      p_label: "   ",
      p_prices: VALID_PRICES,
    });
    assert.equal(error?.code, "PT400");
  });

  test("rejects an empty prices array", async () => {
    const { error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-empty-prices",
      p_prices: [],
    });
    assert.equal(error?.code, "PT400");
  });

  test("a failed validation leaves no orphaned price_versions row", async () => {
    const { count: beforeCount } = await adminClient
      .from("price_versions")
      .select("id", { count: "exact", head: true });

    const { error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-rollback-check",
      p_prices: [
        { plan_code: "free", price_amount: 0, currency: "USD", billing_period: "forever" },
        { plan_code: "student", price_amount: -1, currency: "USD", billing_period: "monthly" },
        { plan_code: "pro", price_amount: 18, currency: "USD", billing_period: "monthly" },
      ],
    });
    assert.notEqual(error, null);

    const { count: afterCount } = await adminClient
      .from("price_versions")
      .select("id", { count: "exact", head: true });
    assert.equal(afterCount, beforeCount, "a rejected publish attempt must not create any row");

    const { data: orphan } = await adminClient
      .from("price_versions")
      .select("id")
      .eq("label", "test-rollback-check")
      .maybeSingle();
    assert.equal(orphan, null);
  });
});

describe("publish_price_version — happy-path effects", () => {
  test("exactly one price_versions row is active immediately after a successful publish", async () => {
    const { data, error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-single-active",
      p_prices: VALID_PRICES,
    });
    assert.equal(error, null);
    createdVersionIds.add(data.id);

    const { data: activeRows, error: activeErr } = await adminClient
      .from("price_versions")
      .select("id")
      .eq("is_active", true);
    assert.equal(activeErr, null);
    assert.equal(activeRows.length, 1);
    assert.equal(activeRows[0].id, data.id);
  });

  test("writes one audit_events row with safe, non-sensitive metadata", async () => {
    const { data, error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-audit",
      p_prices: VALID_PRICES,
    });
    assert.equal(error, null);
    createdVersionIds.add(data.id);

    const { data: events, error: eventsErr } = await adminClient
      .from("audit_events")
      .select("event_type, entity_type, entity_id, metadata")
      .eq("event_type", "price_version_published")
      .eq("entity_id", data.id);
    assert.equal(eventsErr, null);
    assert.equal(events.length, 1);
    assert.equal(events[0].entity_type, "price_versions");
    assert.equal(events[0].metadata.label, "test-audit");
    assert.deepEqual([...events[0].metadata.plan_codes].sort(), ["free", "pro", "student"]);
  });

  test("get_public_plan_catalog reflects the newly published version", async () => {
    const { data, error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-catalog-reflects",
      p_prices: VALID_PRICES,
    });
    assert.equal(error, null);
    createdVersionIds.add(data.id);

    const { data: catalog, error: catalogErr } = await adminClient.rpc("get_public_plan_catalog");
    assert.equal(catalogErr, null);
    const student = catalog.find((row) => row.plan_code === "student");
    assert.equal(Number(student.price_amount), 9);
  });

  test("syncs public.plans display columns to the newly published version", async () => {
    const { data, error } = await adminClient.rpc("publish_price_version", {
      p_label: "test-plans-sync",
      p_prices: VALID_PRICES,
    });
    assert.equal(error, null);
    createdVersionIds.add(data.id);

    const { data: plan, error: planErr } = await adminClient
      .from("plans")
      .select("price_amount, currency, billing_period")
      .eq("plan_code", "pro")
      .single();
    assert.equal(planErr, null);
    assert.equal(Number(plan.price_amount), 18);
    assert.equal(plan.currency, "USD");
    assert.equal(plan.billing_period, "monthly");
  });

  test("never rebills or relocates an existing subscription's locked price_version_id", async () => {
    const user = await createTestUser("publish-lock-check");
    try {
      const periodStart = new Date();
      const periodEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      const { error: subErr } = await adminClient
        .from("subscriptions")
        .update({
          plan_code: "student",
          status: "active",
          provider: "whish",
          price_version_id: originalActiveVersionId,
          current_period_start: periodStart.toISOString(),
          current_period_end: periodEnd.toISOString(),
        })
        .eq("user_id", user.id);
      assert.equal(subErr, null);

      const { data, error } = await adminClient.rpc("publish_price_version", {
        p_label: "test-lock-check",
        p_prices: VALID_PRICES,
      });
      assert.equal(error, null);
      createdVersionIds.add(data.id);

      const { data: sub, error: readErr } = await adminClient
        .from("subscriptions")
        .select("price_version_id, current_period_start, current_period_end")
        .eq("user_id", user.id)
        .single();
      assert.equal(readErr, null);
      assert.equal(
        sub.price_version_id,
        originalActiveVersionId,
        "an existing subscription's locked price_version_id must never change when a new version is published"
      );
      assert.equal(new Date(sub.current_period_end).getTime(), periodEnd.getTime());
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

describe("publish_price_version — concurrency", () => {
  test("two concurrent publish attempts never leave more than one active version", async () => {
    const [resultA, resultB] = await Promise.all([
      adminClient.rpc("publish_price_version", { p_label: "concurrent-a", p_prices: VALID_PRICES }),
      adminClient.rpc("publish_price_version", { p_label: "concurrent-b", p_prices: VALID_PRICES }),
    ]);

    assert.equal(resultA.error, null, `A failed: ${resultA.error?.message}`);
    assert.equal(resultB.error, null, `B failed: ${resultB.error?.message}`);
    createdVersionIds.add(resultA.data.id);
    createdVersionIds.add(resultB.data.id);

    const { data: activeRows, error } = await adminClient
      .from("price_versions")
      .select("id")
      .eq("is_active", true);
    assert.equal(error, null);
    assert.equal(activeRows.length, 1, "exactly one price version must be active after two concurrent publishes");
  });
});
