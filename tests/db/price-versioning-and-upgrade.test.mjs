// DB integration tests for price versioning and the Student-to-Pro
// upgrade pricing added by
// supabase/migrations/20260903090000_add_price_versioning_and_upgrade_locking.sql
// (which itself corrects a gap left by
// 20260902090020_add_student_to_pro_upgrade_support.sql — see that
// migration's header for the exact bug: an upgrade's destination Pro
// price was read from the LIVE public.plans row instead of the
// customer's locked price schedule, so a public price change between a
// Student's purchase and their upgrade would silently change the upgrade
// amount).
//
// Proves, end to end, against the real create_payment_attempt /
// quote_student_to_pro_upgrade / mark_payment_verified / activate_subscription
// RPCs (never re-implemented in JS):
//   - A fresh Student/Pro purchase is priced from the active price version.
//   - The purchase stores an immutable snapshot (price_version_id,
//     purchase_type, billing_period, amount/currency) that a later public
//     price change never mutates.
//   - An in-period Student-to-Pro upgrade is priced from the SAME locked
//     price_version_id as the customer's current subscription — both
//     before AND after the public price changes mid-period.
//   - A customer whose period is locked to a NEWER version gets the
//     upgrade math for THAT version, not the launch version.
//   - The upgrade amount can never go negative (floors at 0).
//   - A locked version with no compatible Pro price fails safely — no
//     attempt is created.
//   - A Pro customer can never purchase Student (no downgrade path).
//   - An already-Pro "upgrade" request is billed as an ordinary renewal,
//     never a repeated discount.
//   - A same-plan repeat purchase for an already-active subscription is
//     classified purchase_type = 'renewal' and priced from the CURRENT
//     active version (this is how a future renewal is priced today, since
//     no automated recurring-billing path exists yet).
//   - mark_payment_verified is idempotent: a duplicate verification never
//     re-activates or changes the stored snapshot.
//   - price_versions/plan_prices are read-only to authenticated users
//     (RLS) and payment_attempts stay cross-user-private.
//
// Run: npm run test:db
// Requires: local Supabase running with 20260903090000 applied.

import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  adminClient,
  assertExpectedLocalProject,
  createAnonClient,
  createTestUser,
  deleteTestUsers,
} from "./helpers.mjs";

const LAUNCH_VERSION_ID = "00000000-0000-0000-0000-000000000001";

let originalActiveVersionId;
let launchStudentPrice;
let launchProPrice;

before(async () => {
  await assertExpectedLocalProject();

  const { data: active, error: activeErr } = await adminClient
    .from("price_versions")
    .select("id")
    .eq("is_active", true)
    .single();
  assert.equal(activeErr, null, `failed to read the active price version: ${activeErr?.message}`);
  originalActiveVersionId = active.id;

  const { data: launchPrices, error: pricesErr } = await adminClient
    .from("plan_prices")
    .select("plan_code, price_amount")
    .eq("price_version_id", LAUNCH_VERSION_ID);
  assert.equal(pricesErr, null, `failed to read launch plan_prices: ${pricesErr?.message}`);
  launchStudentPrice = Number(launchPrices.find((p) => p.plan_code === "student").price_amount);
  launchProPrice = Number(launchPrices.find((p) => p.plan_code === "pro").price_amount);
});

// Restores the original active price version after EVERY test in this
// file, regardless of whether the test passed, failed, or threw partway
// through — never only at the end. Without this, a failed assertion
// inside a test that had already activated a different version would
// skip that test's own cleanup line and leak the wrong active version
// into every subsequent test (and, via the top-level after() below, into
// other test files/manual local dev too).
afterEach(async () => {
  await activatePriceVersion(originalActiveVersionId);
});

after(async () => {
  await activatePriceVersion(originalActiveVersionId);
});

async function activatePriceVersion(versionId) {
  const { data: current } = await adminClient.from("price_versions").select("id").eq("is_active", true).maybeSingle();
  if (current && current.id !== versionId) {
    const { error: deactivateErr } = await adminClient
      .from("price_versions")
      .update({ is_active: false })
      .eq("id", current.id);
    assert.equal(deactivateErr, null, `failed to deactivate ${current.id}: ${deactivateErr?.message}`);
  }
  const { error } = await adminClient.from("price_versions").update({ is_active: true }).eq("id", versionId);
  assert.equal(error, null, `failed to activate ${versionId}: ${error?.message}`);
}

// Creates a new, initially-inactive price_versions row plus its
// plan_prices rows. `prices` maps plan_code -> price_amount; a plan_code
// omitted from `prices` (e.g. to simulate a schedule missing a Pro price)
// simply gets no plan_prices row.
async function createPriceVersion(label, prices) {
  const { data: version, error } = await adminClient
    .from("price_versions")
    .insert({ label, is_active: false })
    .select()
    .single();
  assert.equal(error, null, `failed to create price version ${label}: ${error?.message}`);

  const rows = Object.entries(prices).map(([plan_code, price_amount]) => ({
    price_version_id: version.id,
    plan_code,
    price_amount,
    currency: "USD",
    billing_period: "monthly",
  }));
  if (rows.length > 0) {
    const { error: priceErr } = await adminClient.from("plan_prices").insert(rows);
    assert.equal(priceErr, null, `failed to insert plan_prices for ${label}: ${priceErr?.message}`);
  }
  return version.id;
}

async function setSubscription(userId, overrides) {
  const { error } = await adminClient
    .from("subscriptions")
    .update({ provider: overrides.plan_code === "free" ? "free" : "whish", ...overrides })
    .eq("user_id", userId);
  assert.equal(error, null, `failed to set subscription: ${error?.message}`);
}

// Simulates a real, previously-verified paid attempt exactly as
// mark_payment_verified would have left it — never fabricated through any
// client-writable path.
async function insertPaidAttempt(userId, { planCode, amount, priceVersionId, verifiedAt }) {
  const { data, error } = await adminClient
    .from("payment_attempts")
    .insert({
      user_id: userId,
      plan_code: planCode,
      amount,
      currency: "USD",
      provider: "whish",
      status: "paid",
      idempotency_key: `fixture-${userId}-${planCode}-${Date.now()}-${Math.random()}`,
      verified_at: verifiedAt ?? new Date().toISOString(),
      price_version_id: priceVersionId,
      purchase_type: "initial",
      billing_period: "monthly",
    })
    .select()
    .single();
  assert.equal(error, null, `failed to insert fixture paid attempt: ${error?.message}`);
  return data;
}

describe("Fresh purchases quote from the active price version", () => {
  test("a Free user requesting Pro pays the active Pro price, purchase_type = initial", async () => {
    const user = await createTestUser("pv-fresh-pro");
    try {
      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(error, null, `create_payment_attempt failed: ${error?.message}`);
      assert.equal(data.is_upgrade, false);
      assert.equal(data.credit_amount, null);
      assert.equal(data.purchase_type, "initial");
      assert.equal(data.source_plan_code, null);
      assert.equal(data.price_version_id, LAUNCH_VERSION_ID);
      assert.equal(Number(data.amount), launchProPrice);
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("a Free user requesting Student pays the active Student price", async () => {
    const user = await createTestUser("pv-fresh-student");
    try {
      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "student" });
      assert.equal(error, null, `create_payment_attempt failed: ${error?.message}`);
      assert.equal(data.purchase_type, "initial");
      assert.equal(data.price_version_id, LAUNCH_VERSION_ID);
      assert.equal(Number(data.amount), launchStudentPrice);
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("an already-active same-plan purchase is classified as a renewal, priced from the CURRENT active version", async () => {
    const user = await createTestUser("pv-renewal");
    try {
      await setSubscription(user.id, {
        plan_code: "pro",
        status: "active",
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        price_version_id: LAUNCH_VERSION_ID,
      });

      const newVersionId = await createPriceVersion("renewal-test", { student: 15, pro: 25 });
      await activatePriceVersion(newVersionId);

      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(error, null, `create_payment_attempt failed: ${error?.message}`);
      assert.equal(data.purchase_type, "renewal", "an already-active same-plan purchase must be a renewal, not initial or upgrade");
      assert.equal(data.is_upgrade, false);
      assert.equal(data.price_version_id, newVersionId, "a renewal must quote from the CURRENT active version, not the old locked one");
      assert.equal(Number(data.amount), 25);
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

describe("Student-to-Pro upgrade: locked to the customer's own price version", () => {
  test("an active, in-period Student with a real paid attempt gets a verified discount from the launch version", async () => {
    const user = await createTestUser("pv-upgrade-launch");
    try {
      const periodStart = new Date(Date.now() - 3600 * 1000).toISOString();
      const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();

      await setSubscription(user.id, {
        plan_code: "student",
        status: "active",
        current_period_start: periodStart,
        current_period_end: periodEnd,
        price_version_id: LAUNCH_VERSION_ID,
      });
      await insertPaidAttempt(user.id, { planCode: "student", amount: launchStudentPrice, priceVersionId: LAUNCH_VERSION_ID });

      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(error, null, `create_payment_attempt failed: ${error?.message}`);
      assert.equal(data.is_upgrade, true);
      assert.equal(data.purchase_type, "upgrade");
      assert.equal(data.source_plan_code, "student");
      assert.equal(data.price_version_id, LAUNCH_VERSION_ID);
      assert.equal(Number(data.credit_amount), launchStudentPrice);
      assert.equal(Number(data.amount), Math.max(launchProPrice - launchStudentPrice, 0));
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("REGRESSION: a public price change mid-period does NOT change an already-locked upgrade's amount", async () => {
    const user = await createTestUser("pv-upgrade-price-change");
    try {
      const periodStart = new Date(Date.now() - 3600 * 1000).toISOString();
      const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();

      // Customer's period is locked to the LAUNCH version (Student $9 /
      // credit launchStudentPrice, Pro launchProPrice) — exactly the
      // 20260902090020 example (Student $9 / Pro $18).
      await setSubscription(user.id, {
        plan_code: "student",
        status: "active",
        current_period_start: periodStart,
        current_period_end: periodEnd,
        price_version_id: LAUNCH_VERSION_ID,
      });
      await insertPaidAttempt(user.id, { planCode: "student", amount: launchStudentPrice, priceVersionId: LAUNCH_VERSION_ID });

      // The public price changes mid-period: new active version raises
      // BOTH Student and Pro (e.g. Student $15 / Pro $25 from the AGENTS.md
      // example) — this must never be read by this customer's upgrade.
      const newVersionId = await createPriceVersion("mid-period-change", { student: 15, pro: 25 });
      await activatePriceVersion(newVersionId);

      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(error, null, `create_payment_attempt failed: ${error?.message}`);
      assert.equal(data.is_upgrade, true);
      assert.equal(data.price_version_id, LAUNCH_VERSION_ID, "the upgrade must stay locked to the customer's original version, not the new active one");
      assert.equal(Number(data.credit_amount), launchStudentPrice);
      // Must equal (OLD Pro price - OLD Student credit), never (NEW Pro
      // price ($25) - OLD credit) — that was the exact bug this migration
      // fixes.
      assert.equal(Number(data.amount), Math.max(launchProPrice - launchStudentPrice, 0));
      assert.notEqual(Number(data.amount), Math.max(25 - launchStudentPrice, 0));
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("a customer whose period is locked to a NEWER version upgrades using that version's prices", async () => {
    const user = await createTestUser("pv-upgrade-new-version");
    try {
      const newVersionId = await createPriceVersion("new-version-upgrade", { student: 15, pro: 25 });

      const periodStart = new Date(Date.now() - 3600 * 1000).toISOString();
      const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
      await setSubscription(user.id, {
        plan_code: "student",
        status: "active",
        current_period_start: periodStart,
        current_period_end: periodEnd,
        price_version_id: newVersionId,
      });
      await insertPaidAttempt(user.id, { planCode: "student", amount: 15, priceVersionId: newVersionId });

      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(error, null, `create_payment_attempt failed: ${error?.message}`);
      assert.equal(data.is_upgrade, true);
      assert.equal(data.price_version_id, newVersionId);
      assert.equal(Number(data.credit_amount), 15);
      assert.equal(Number(data.amount), 10, "Pro $25 - Student $15 credit = $10");
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("the upgrade amount floors at 0 and never goes negative", async () => {
    const user = await createTestUser("pv-upgrade-floor-zero");
    try {
      // A deliberately misconfigured version where the credit (what the
      // customer actually paid) exceeds the locked Pro price.
      const cheapVersionId = await createPriceVersion("cheap-pro", { student: 9, pro: 5 });

      const periodStart = new Date(Date.now() - 3600 * 1000).toISOString();
      const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
      await setSubscription(user.id, {
        plan_code: "student",
        status: "active",
        current_period_start: periodStart,
        current_period_end: periodEnd,
        price_version_id: cheapVersionId,
      });
      await insertPaidAttempt(user.id, { planCode: "student", amount: 9, priceVersionId: cheapVersionId });

      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(error, null, `create_payment_attempt failed: ${error?.message}`);
      assert.equal(data.is_upgrade, true);
      assert.equal(Number(data.amount), 0, "amount must floor at 0, never go negative");
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("a locked version with no compatible Pro price fails safely — no payment attempt is created", async () => {
    const user = await createTestUser("pv-upgrade-missing-pro-price");
    try {
      const studentOnlyVersionId = await createPriceVersion("student-only", { student: 9 });

      const periodStart = new Date(Date.now() - 3600 * 1000).toISOString();
      const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
      await setSubscription(user.id, {
        plan_code: "student",
        status: "active",
        current_period_start: periodStart,
        current_period_end: periodEnd,
        price_version_id: studentOnlyVersionId,
      });
      await insertPaidAttempt(user.id, { planCode: "student", amount: 9, priceVersionId: studentOnlyVersionId });

      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(data, null, "no payment attempt row should be returned");
      assert.ok(error, "expected a safe failure");

      const { data: attempts } = await adminClient.from("payment_attempts").select("id").eq("user_id", user.id).eq("plan_code", "pro");
      assert.equal(attempts.length, 0, "no pro payment_attempts row must have been created");
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("an already-Pro user gets no discount — billed as an ordinary renewal instead", async () => {
    const user = await createTestUser("pv-already-pro");
    try {
      await setSubscription(user.id, {
        plan_code: "pro",
        status: "active",
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        price_version_id: LAUNCH_VERSION_ID,
      });

      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(error, null, `create_payment_attempt failed: ${error?.message}`);
      assert.equal(data.is_upgrade, false, "an already-Pro user must never receive the Student-upgrade discount");
      assert.equal(data.purchase_type, "renewal");
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("an expired Student subscription gets no discount", async () => {
    const user = await createTestUser("pv-expired-student");
    try {
      await setSubscription(user.id, {
        plan_code: "student",
        status: "active",
        current_period_start: new Date(Date.now() - 60 * 86400000).toISOString(),
        current_period_end: new Date(Date.now() - 30 * 86400000).toISOString(), // in the past
        price_version_id: LAUNCH_VERSION_ID,
      });
      await insertPaidAttempt(user.id, {
        planCode: "student",
        amount: launchStudentPrice,
        priceVersionId: LAUNCH_VERSION_ID,
        verifiedAt: new Date(Date.now() - 45 * 86400000).toISOString(),
      });

      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(error, null, `create_payment_attempt failed: ${error?.message}`);
      assert.equal(data.is_upgrade, false, "an expired Student entitlement must never receive a credit");
      assert.equal(data.purchase_type, "initial", "an expired Student has no active plan to renew and is not upgrading — this is a fresh initial purchase");
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

describe("No Pro-to-Student downgrade path", () => {
  test("an active Pro customer cannot create a Student payment attempt", async () => {
    const user = await createTestUser("pv-no-downgrade");
    try {
      await setSubscription(user.id, {
        plan_code: "pro",
        status: "active",
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        price_version_id: LAUNCH_VERSION_ID,
      });

      const { data, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "student" });
      assert.equal(data, null);
      assert.ok(error, "expected rejection");
      assert.match(error.message, /cannot purchase the Student plan/i);

      const { data: attempts } = await adminClient.from("payment_attempts").select("id").eq("user_id", user.id).eq("plan_code", "student");
      assert.equal(attempts.length, 0, "no Student payment_attempts row must have been created");
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

describe("Public price changes never mutate an already-verified purchase", () => {
  test("a verified payment's amount/price_version_id/period stay unchanged after the public price changes", async () => {
    const user = await createTestUser("pv-immutable-snapshot");
    try {
      const { data: attempt, error: createErr } = await user.client.rpc("create_payment_attempt", { p_plan_code: "student" });
      assert.equal(createErr, null, `create_payment_attempt failed: ${createErr?.message}`);
      assert.equal(Number(attempt.amount), launchStudentPrice);
      assert.equal(attempt.price_version_id, LAUNCH_VERSION_ID);

      const periodStart = new Date().toISOString();
      const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
      const { data: verified, error: verifyErr } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attempt.id,
        p_provider_payment_id: "fixture-provider-ref-1",
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });
      assert.equal(verifyErr, null, `mark_payment_verified failed: ${verifyErr?.message}`);
      assert.equal(verified.status, "paid");
      // Compare as instants, not strings — Postgres returns timestamptz
      // as "...+00:00", not the "...Z" suffix Date#toISOString() produces.
      assert.equal(new Date(verified.period_start).getTime(), new Date(periodStart).getTime());
      assert.equal(new Date(verified.period_end).getTime(), new Date(periodEnd).getTime());

      const { data: sub } = await adminClient.from("subscriptions").select("plan_code, status, price_version_id").eq("user_id", user.id).single();
      assert.equal(sub.plan_code, "student");
      assert.equal(sub.status, "active");
      assert.equal(sub.price_version_id, LAUNCH_VERSION_ID);

      // The public price changes.
      const newVersionId = await createPriceVersion("post-purchase-change", { student: 15, pro: 25 });
      await activatePriceVersion(newVersionId);

      const { data: reread, error: rereadErr } = await adminClient
        .from("payment_attempts")
        .select("amount, currency, price_version_id, purchase_type, period_start, period_end")
        .eq("id", attempt.id)
        .single();
      assert.equal(rereadErr, null);
      assert.equal(Number(reread.amount), launchStudentPrice, "a historical payment amount must never change");
      assert.equal(reread.price_version_id, LAUNCH_VERSION_ID, "a historical payment's price version must never change");
      assert.equal(reread.purchase_type, "initial");
      assert.equal(new Date(reread.period_start).getTime(), new Date(periodStart).getTime());
      assert.equal(new Date(reread.period_end).getTime(), new Date(periodEnd).getTime());
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("mark_payment_verified is idempotent: a duplicate verification never re-activates or changes the stored snapshot", async () => {
    const user = await createTestUser("pv-idempotent-verify");
    try {
      const { data: attempt } = await user.client.rpc("create_payment_attempt", { p_plan_code: "student" });

      const periodStart = new Date().toISOString();
      const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
      const { data: first, error: firstErr } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attempt.id,
        p_provider_payment_id: "fixture-provider-ref-first",
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });
      assert.equal(firstErr, null);

      // A duplicate provider callback/webhook, with a DIFFERENT provider
      // reference and period — must be a true no-op, proving the second
      // call never reprocesses.
      const { data: second, error: secondErr } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attempt.id,
        p_provider_payment_id: "fixture-provider-ref-SECOND-different",
        p_period_start: new Date(Date.now() + 999 * 86400000).toISOString(),
        p_period_end: new Date(Date.now() + 1999 * 86400000).toISOString(),
      });
      assert.equal(secondErr, null);
      assert.equal(second.provider_payment_id, first.provider_payment_id, "a duplicate verification must never overwrite the original provider reference");
      assert.equal(second.period_start, first.period_start);
      assert.equal(second.period_end, first.period_end);

      const { data: sub } = await adminClient.from("subscriptions").select("current_period_start, current_period_end").eq("user_id", user.id).single();
      assert.equal(sub.current_period_start, first.period_start, "a duplicate callback must never move the active period");
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

describe("price_versions / plan_prices RLS: read-only to clients", () => {
  test("anon and authenticated can SELECT price_versions and plan_prices", async () => {
    const anon = createAnonClient();
    const { data: anonVersions, error: anonErr } = await anon.from("price_versions").select("id");
    // anon has no grant at all per the plans-table precedent (select is
    // only granted to authenticated) — anon SELECT must be rejected.
    assert.equal(anonVersions, null);
    assert.ok(anonErr, "anon SELECT on price_versions must be rejected (no grant, same as public.plans)");

    const user = await createTestUser("pv-rls-select");
    try {
      const { data: versions, error } = await user.client.from("price_versions").select("id, is_active");
      assert.equal(error, null, `authenticated SELECT on price_versions must succeed: ${error?.message}`);
      assert.ok(versions.length >= 1);

      const { data: prices, error: pricesErr } = await user.client.from("plan_prices").select("plan_code, price_amount");
      assert.equal(pricesErr, null, `authenticated SELECT on plan_prices must succeed: ${pricesErr?.message}`);
      assert.ok(prices.length >= 1);
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("an authenticated user cannot INSERT, UPDATE, or DELETE price_versions or plan_prices", async () => {
    const user = await createTestUser("pv-rls-write");
    try {
      const { error: insertVersionErr } = await user.client.from("price_versions").insert({ label: "hacked", is_active: false });
      assert.ok(insertVersionErr, "authenticated INSERT on price_versions must be rejected");

      const { error: updateVersionErr } = await user.client.from("price_versions").update({ is_active: true }).eq("id", LAUNCH_VERSION_ID);
      assert.ok(updateVersionErr, "authenticated UPDATE on price_versions must be rejected");

      const { error: deleteVersionErr } = await user.client.from("price_versions").delete().eq("id", LAUNCH_VERSION_ID);
      assert.ok(deleteVersionErr, "authenticated DELETE on price_versions must be rejected");

      const { error: updatePriceErr } = await user.client
        .from("plan_prices")
        .update({ price_amount: 0 })
        .eq("price_version_id", LAUNCH_VERSION_ID)
        .eq("plan_code", "pro");
      assert.ok(updatePriceErr, "authenticated UPDATE on plan_prices must be rejected — a user must never set their own price to 0");

      const { data: proPrice } = await adminClient
        .from("plan_prices")
        .select("price_amount")
        .eq("price_version_id", LAUNCH_VERSION_ID)
        .eq("plan_code", "pro")
        .single();
      assert.equal(Number(proPrice.price_amount), launchProPrice, "the crafted update must never have taken effect");
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

describe("payment_attempts stay cross-user private", () => {
  test("user A cannot read user B's payment_attempts", async () => {
    const userA = await createTestUser("pv-cross-user-a");
    const userB = await createTestUser("pv-cross-user-b");
    try {
      const { data: attemptB, error } = await userB.client.rpc("create_payment_attempt", { p_plan_code: "student" });
      assert.equal(error, null);

      const { data: seenByA } = await userA.client.from("payment_attempts").select("id").eq("id", attemptB.id);
      assert.equal(seenByA.length, 0, "user A must never see user B's payment_attempts row");

      const { data: seenByB } = await userB.client.from("payment_attempts").select("id").eq("id", attemptB.id);
      assert.equal(seenByB.length, 1, "user B must see their own payment_attempts row");
    } finally {
      await deleteTestUsers([userA, userB]);
    }
  });
});

describe("create_payment_attempt has no client-controllable price/credit surface", () => {
  test("passing unexpected extra arguments (e.g. a forged price or credit) is rejected outright", async () => {
    const user = await createTestUser("pv-no-forged-args");
    try {
      const { data, error } = await user.client.rpc("create_payment_attempt", {
        p_plan_code: "pro",
        p_amount: 0.01,
        p_credit_amount: 999999,
      });
      assert.equal(data, null);
      assert.ok(error, "an RPC call with unknown parameters must be rejected — the function accepts only p_plan_code, nothing price-related");
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

// mark_payment_verified's billing-period computation added by
// 20260903090000 (see that migration's mark_payment_verified body): the
// period is derived server-side from purchase_type, never trusted
// verbatim from the caller's p_period_start/p_period_end — these tests
// deliberately pass WRONG caller-supplied dates (what a buggy future
// webhook handler might send) to prove the database itself, not caller
// discipline, is what keeps the period correct.
describe("mark_payment_verified: server-computed billing period (renewal/upgrade)", () => {
  test("an on-time/late renewal (current_period_end already passed) begins exactly at the old current_period_end and runs one billing_period, even when the caller passes wrong dates", async () => {
    const user = await createTestUser("pv-renewal-period");
    try {
      const oldPeriodStart = new Date(Date.now() - 31 * 86400000).toISOString();
      const oldPeriodEnd = new Date(Date.now() - 3600 * 1000).toISOString(); // already ended 1 hour ago — not early
      await setSubscription(user.id, {
        plan_code: "pro",
        status: "active",
        current_period_start: oldPeriodStart,
        current_period_end: oldPeriodEnd,
        price_version_id: LAUNCH_VERSION_ID,
      });

      const { data: attempt, error: createErr } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(createErr, null, `create_payment_attempt failed: ${createErr?.message}`);
      assert.equal(attempt.purchase_type, "renewal");

      // Deliberately wrong: "now" instead of the old period's end. A
      // caller bug like this must never shorten or gap the customer's
      // paid access.
      const wrongStart = new Date().toISOString();
      const wrongEnd = new Date(Date.now() + 30 * 86400000).toISOString();
      const { data: verified, error: verifyErr } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attempt.id,
        p_provider_payment_id: `fixture-renewal-${user.id}`,
        p_period_start: wrongStart,
        p_period_end: wrongEnd,
      });
      assert.equal(verifyErr, null, `mark_payment_verified failed: ${verifyErr?.message}`);

      const expectedStart = new Date(oldPeriodEnd);
      const expectedEnd = new Date(expectedStart);
      expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 1);

      assert.equal(
        new Date(verified.period_start).getTime(),
        expectedStart.getTime(),
        "the renewal must start exactly at the OLD current_period_end, not the caller-supplied (wrong) date"
      );
      assert.equal(
        new Date(verified.period_end).getTime(),
        expectedEnd.getTime(),
        "the renewal must run exactly one billing_period (1 month) from the old period's end"
      );
      assert.notEqual(new Date(verified.period_start).getTime(), new Date(wrongStart).getTime());

      const { data: sub } = await adminClient
        .from("subscriptions")
        .select("current_period_start, current_period_end, next_period_start, next_period_end")
        .eq("user_id", user.id)
        .single();
      assert.equal(new Date(sub.current_period_start).getTime(), expectedStart.getTime());
      assert.equal(new Date(sub.current_period_end).getTime(), expectedEnd.getTime());
      assert.equal(sub.next_period_start, null, "an on-time/late renewal must never populate next_period_* — it activates immediately");
      assert.equal(sub.next_period_end, null);
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("an upgrade preserves the original current_period_start/end exactly, even when the caller passes wrong dates", async () => {
    const user = await createTestUser("pv-upgrade-period-preserve");
    try {
      const originalStart = new Date(Date.now() - 3600 * 1000).toISOString();
      const originalEnd = new Date(Date.now() + 25 * 86400000).toISOString();
      await setSubscription(user.id, {
        plan_code: "student",
        status: "active",
        current_period_start: originalStart,
        current_period_end: originalEnd,
        price_version_id: LAUNCH_VERSION_ID,
      });
      await insertPaidAttempt(user.id, { planCode: "student", amount: launchStudentPrice, priceVersionId: LAUNCH_VERSION_ID });

      const { data: attempt, error: createErr } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(createErr, null, `create_payment_attempt failed: ${createErr?.message}`);
      assert.equal(attempt.purchase_type, "upgrade");

      // Deliberately wrong: a caller bug that would reset/extend the
      // period must never be allowed to take effect.
      const wrongStart = new Date().toISOString();
      const wrongEnd = new Date(Date.now() + 999 * 86400000).toISOString();
      const { data: verified, error: verifyErr } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attempt.id,
        p_provider_payment_id: `fixture-upgrade-${user.id}`,
        p_period_start: wrongStart,
        p_period_end: wrongEnd,
      });
      assert.equal(verifyErr, null, `mark_payment_verified failed: ${verifyErr?.message}`);

      assert.equal(new Date(verified.period_start).getTime(), new Date(originalStart).getTime(), "an upgrade must preserve the ORIGINAL period_start exactly");
      assert.equal(new Date(verified.period_end).getTime(), new Date(originalEnd).getTime(), "an upgrade must preserve the ORIGINAL period_end exactly — never extend or reset it");

      const { data: sub } = await adminClient
        .from("subscriptions")
        .select("plan_code, current_period_start, current_period_end")
        .eq("user_id", user.id)
        .single();
      assert.equal(sub.plan_code, "pro");
      assert.equal(new Date(sub.current_period_start).getTime(), new Date(originalStart).getTime());
      assert.equal(new Date(sub.current_period_end).getTime(), new Date(originalEnd).getTime());
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("an upgrade cannot be verified when the subscription has no existing period to preserve", async () => {
    const user = await createTestUser("pv-upgrade-no-period");
    try {
      await setSubscription(user.id, {
        plan_code: "student",
        status: "active",
        current_period_start: null,
        current_period_end: null,
        price_version_id: LAUNCH_VERSION_ID,
      });
      // Fixture-insert a "created" attempt directly with purchase_type =
      // upgrade (bypassing create_payment_attempt, which would never
      // reach this state itself since quote_student_to_pro_upgrade
      // already requires a non-null current_period_end) to prove
      // mark_payment_verified independently guards against it too —
      // defense in depth, not relying solely on the creation-time check.
      const { data: attempt, error: insertErr } = await adminClient
        .from("payment_attempts")
        .insert({
          user_id: user.id,
          plan_code: "pro",
          amount: 9,
          currency: "USD",
          provider: "whish",
          status: "created",
          idempotency_key: `fixture-no-period-${user.id}`,
          price_version_id: LAUNCH_VERSION_ID,
          purchase_type: "upgrade",
          source_plan_code: "student",
          billing_period: "monthly",
        })
        .select()
        .single();
      assert.equal(insertErr, null, `fixture insert failed: ${insertErr?.message}`);

      const { data, error } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attempt.id,
        p_provider_payment_id: "fixture-no-period-ref",
        p_period_start: new Date().toISOString(),
        p_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      });
      assert.equal(data, null);
      assert.ok(error, "verifying an upgrade with no existing period to preserve must fail safely, not silently invent one");
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("an initial purchase still uses the caller-supplied period (no prior period exists to derive from)", async () => {
    const user = await createTestUser("pv-initial-period");
    try {
      const { data: attempt } = await user.client.rpc("create_payment_attempt", { p_plan_code: "student" });
      assert.equal(attempt.purchase_type, "initial");

      const periodStart = new Date().toISOString();
      const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
      const { data: verified, error } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attempt.id,
        p_provider_payment_id: `fixture-initial-${user.id}`,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });
      assert.equal(error, null, `mark_payment_verified failed: ${error?.message}`);
      assert.equal(new Date(verified.period_start).getTime(), new Date(periodStart).getTime());
      assert.equal(new Date(verified.period_end).getTime(), new Date(periodEnd).getTime());
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

describe("payment_attempts.provider_payment_id is unique per provider", () => {
  test("two different attempts cannot both be verified with the same provider_payment_id", async () => {
    const userA = await createTestUser("pv-provider-unique-a");
    const userB = await createTestUser("pv-provider-unique-b");
    try {
      const { data: attemptA } = await userA.client.rpc("create_payment_attempt", { p_plan_code: "student" });
      const { data: attemptB } = await userB.client.rpc("create_payment_attempt", { p_plan_code: "student" });

      const sharedProviderRef = `fixture-shared-ref-${Date.now()}`;

      const { error: firstErr } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attemptA.id,
        p_provider_payment_id: sharedProviderRef,
        p_period_start: new Date().toISOString(),
        p_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      });
      assert.equal(firstErr, null, `first verification must succeed: ${firstErr?.message}`);

      const { data: second, error: secondErr } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attemptB.id,
        p_provider_payment_id: sharedProviderRef,
        p_period_start: new Date().toISOString(),
        p_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      });
      assert.equal(second, null);
      assert.ok(secondErr, "a second, different attempt must never be verifiable with a provider_payment_id already used by another attempt");

      const { data: bRow } = await adminClient.from("payment_attempts").select("status").eq("id", attemptB.id).single();
      assert.equal(bRow.status, "created", "userB's attempt must remain unverified after the rejected duplicate-reference call");
    } finally {
      await deleteTestUsers([userA, userB]);
    }
  });

  test("multiple never-verified attempts (provider_payment_id still null) are unaffected by the uniqueness constraint", async () => {
    const user = await createTestUser("pv-provider-unique-nulls");
    try {
      const { data: a1 } = await user.client.rpc("create_payment_attempt", { p_plan_code: "student" });
      await adminClient.from("payment_attempts").update({ status: "cancelled" }).eq("id", a1.id);
      const { data: a2, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "student" });
      assert.equal(error, null, `a second null-provider_payment_id attempt must be allowed to coexist: ${error?.message}`);
      assert.notEqual(a2.id, a1.id);
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

describe("payment_attempts / subscriptions: no direct authenticated write path", () => {
  test("an authenticated user cannot UPDATE their own payment_attempts row (amount, status, price_version_id, etc.)", async () => {
    const user = await createTestUser("pv-no-direct-write-attempt");
    try {
      const { data: attempt } = await user.client.rpc("create_payment_attempt", { p_plan_code: "student" });

      const { error: amountErr } = await user.client.from("payment_attempts").update({ amount: 0 }).eq("id", attempt.id);
      assert.ok(amountErr, "an authenticated user must never be able to set their own payment amount to 0");

      const { error: statusErr } = await user.client.from("payment_attempts").update({ status: "paid" }).eq("id", attempt.id);
      assert.ok(statusErr, "an authenticated user must never be able to self-mark a payment as paid");

      const { error: priceVersionErr } = await user.client
        .from("payment_attempts")
        .update({ price_version_id: LAUNCH_VERSION_ID })
        .eq("id", attempt.id);
      assert.ok(priceVersionErr, "an authenticated user must never be able to rewrite price_version_id");

      const { error: purchaseTypeErr } = await user.client.from("payment_attempts").update({ purchase_type: "upgrade" }).eq("id", attempt.id);
      assert.ok(purchaseTypeErr, "an authenticated user must never be able to relabel purchase_type");

      const { data: reread } = await adminClient.from("payment_attempts").select("amount, status, purchase_type").eq("id", attempt.id).single();
      assert.equal(Number(reread.amount), launchStudentPrice, "the crafted amount update must never have taken effect");
      assert.equal(reread.status, "created");
      assert.equal(reread.purchase_type, "initial");
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("an authenticated user cannot UPDATE their own subscriptions row (plan_code, status, price_version_id)", async () => {
    const user = await createTestUser("pv-no-direct-write-sub");
    try {
      const { error: planErr } = await user.client.from("subscriptions").update({ plan_code: "pro" }).eq("user_id", user.id);
      assert.ok(planErr, "an authenticated user must never be able to self-upgrade their plan_code directly");

      const { error: statusErr } = await user.client.from("subscriptions").update({ status: "active" }).eq("user_id", user.id);
      assert.ok(statusErr, "an authenticated user must never be able to self-activate their subscription status");

      const { data: reread } = await adminClient.from("subscriptions").select("plan_code, status").eq("user_id", user.id).single();
      assert.equal(reread.plan_code, "free", "the crafted plan_code update must never have taken effect");
    } finally {
      await deleteTestUsers([user]);
    }
  });
});

// Early renewal: a renewal paid for and verified BEFORE current_period_end
// must never touch current_period_start/end (see mark_payment_verified's
// EARLY branch and promote_due_subscription_period, both added in this
// same migration). Example straight from the requested scenario: an
// active period Sept 1 - Oct 1, renewal verified Sept 20 -> the renewed
// period must be Oct 1 - Nov 1, and access must remain uninterrupted from
// Sept 20 through Oct 1.
describe("Early renewal: deferred period, uninterrupted access, correct promotion", () => {
  function buildActivePeriod({ daysElapsed = 11, daysRemaining = 10 } = {}) {
    return {
      start: new Date(Date.now() - daysElapsed * 86400000).toISOString(),
      end: new Date(Date.now() + daysRemaining * 86400000).toISOString(),
    };
  }

  test("an early renewal (verified before current_period_end) does NOT touch current_period_start/end", async () => {
    const user = await createTestUser("pv-early-renewal-no-overwrite");
    try {
      const { start, end } = buildActivePeriod(); // "Sept 1 - Oct 1", verified "Sept 20"
      await setSubscription(user.id, {
        plan_code: "pro",
        status: "active",
        current_period_start: start,
        current_period_end: end,
        price_version_id: LAUNCH_VERSION_ID,
      });

      const { data: attempt, error: createErr } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(createErr, null, `create_payment_attempt failed: ${createErr?.message}`);
      assert.equal(attempt.purchase_type, "renewal");

      const { data: verified, error: verifyErr } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attempt.id,
        p_provider_payment_id: `fixture-early-${user.id}`,
        p_period_start: new Date().toISOString(), // caller dates ignored either way
        p_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      });
      assert.equal(verifyErr, null, `mark_payment_verified failed: ${verifyErr?.message}`);

      const { data: sub } = await adminClient
        .from("subscriptions")
        .select("plan_code, status, current_period_start, current_period_end, next_period_start, next_period_end, next_price_version_id")
        .eq("user_id", user.id)
        .single();

      assert.equal(new Date(sub.current_period_start).getTime(), new Date(start).getTime(), "current_period_start must be COMPLETELY untouched by an early renewal");
      assert.equal(new Date(sub.current_period_end).getTime(), new Date(end).getTime(), "current_period_end must be COMPLETELY untouched by an early renewal");
      assert.equal(sub.plan_code, "pro");
      assert.equal(sub.status, "active");

      // Correct next period boundary: exactly Oct 1 -> Nov 1 (old
      // current_period_end -> +1 month), never derived from "now"/Sept 20.
      const expectedNextStart = new Date(end);
      const expectedNextEnd = new Date(expectedNextStart);
      expectedNextEnd.setUTCMonth(expectedNextEnd.getUTCMonth() + 1);
      assert.equal(new Date(sub.next_period_start).getTime(), expectedNextStart.getTime(), "the queued next period must start exactly at the OLD current_period_end");
      assert.equal(new Date(sub.next_period_end).getTime(), expectedNextEnd.getTime(), "the queued next period must run exactly one billing_period");
      assert.equal(sub.next_price_version_id, LAUNCH_VERSION_ID);

      // The verified attempt's own immutable snapshot reflects what was
      // actually purchased: the QUEUED period, not the still-active one.
      assert.equal(new Date(verified.period_start).getTime(), expectedNextStart.getTime());
      assert.equal(new Date(verified.period_end).getTime(), expectedNextEnd.getTime());
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("access remains active throughout the remaining current period after an early renewal", async () => {
    const user = await createTestUser("pv-early-renewal-access");
    try {
      const { start, end } = buildActivePeriod();
      await setSubscription(user.id, {
        plan_code: "pro",
        status: "active",
        current_period_start: start,
        current_period_end: end,
        price_version_id: LAUNCH_VERSION_ID,
      });

      const { data: readinessBefore } = await user.client.rpc("get_onboarding_readiness");
      assert.equal(readinessBefore.plan_eligible, true, "must be plan-eligible BEFORE the early renewal");

      const { data: attempt } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      const { error: verifyErr } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attempt.id,
        p_provider_payment_id: `fixture-early-access-${user.id}`,
        p_period_start: new Date().toISOString(),
        p_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      });
      assert.equal(verifyErr, null, `mark_payment_verified failed: ${verifyErr?.message}`);

      const { data: readinessAfter, error: readinessErr } = await user.client.rpc("get_onboarding_readiness");
      assert.equal(readinessErr, null);
      assert.equal(readinessAfter.plan_eligible, true, "must REMAIN plan-eligible immediately after an early renewal — access must never be interrupted");
      assert.equal(readinessAfter.plan_code, "pro");
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("a duplicate early-renewal callback is a true no-op — never re-queues or extends the period again", async () => {
    const user = await createTestUser("pv-early-renewal-duplicate");
    try {
      const { start, end } = buildActivePeriod();
      await setSubscription(user.id, {
        plan_code: "pro",
        status: "active",
        current_period_start: start,
        current_period_end: end,
        price_version_id: LAUNCH_VERSION_ID,
      });

      const { data: attempt } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      const { data: first, error: firstErr } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attempt.id,
        p_provider_payment_id: "fixture-dup-early-first",
        p_period_start: new Date().toISOString(),
        p_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      });
      assert.equal(firstErr, null);

      // A duplicate provider callback for the SAME attempt, with a
      // different reference and dates — must not re-run the early-renewal
      // logic a second time (which would otherwise chain a THIRD period
      // onto next_period_end).
      const { data: second, error: secondErr } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attempt.id,
        p_provider_payment_id: "fixture-dup-early-SECOND-different",
        p_period_start: new Date(Date.now() + 999 * 86400000).toISOString(),
        p_period_end: new Date(Date.now() + 1999 * 86400000).toISOString(),
      });
      assert.equal(secondErr, null);
      assert.equal(second.provider_payment_id, first.provider_payment_id, "a duplicate callback must never overwrite the original provider reference");
      assert.equal(new Date(second.period_start).getTime(), new Date(first.period_start).getTime());
      assert.equal(new Date(second.period_end).getTime(), new Date(first.period_end).getTime());

      const { data: sub } = await adminClient
        .from("subscriptions")
        .select("current_period_start, current_period_end, next_period_start, next_period_end")
        .eq("user_id", user.id)
        .single();
      assert.equal(new Date(sub.current_period_start).getTime(), new Date(start).getTime(), "still untouched after the duplicate callback");
      assert.equal(new Date(sub.current_period_end).getTime(), new Date(end).getTime());
      assert.equal(new Date(sub.next_period_start).getTime(), new Date(first.period_start).getTime(), "the queued period must not have been re-extended by the duplicate callback");
      assert.equal(new Date(sub.next_period_end).getTime(), new Date(first.period_end).getTime());
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("concurrent verification of two different early-renewal attempts chains correctly instead of colliding", async () => {
    const user = await createTestUser("pv-early-renewal-concurrent");
    try {
      const { start, end } = buildActivePeriod();
      await setSubscription(user.id, {
        plan_code: "pro",
        status: "active",
        current_period_start: start,
        current_period_end: end,
        price_version_id: LAUNCH_VERSION_ID,
      });

      // Two genuinely separate renewal attempts for the same user,
      // fixture-inserted directly to stress-test mark_payment_verified's
      // own concurrency safety independent of create_payment_attempt's
      // reuse-check (which would ordinarily prevent two simultaneous
      // in-flight attempts for the same plan through the normal path).
      const makeAttempt = async (suffix) => {
        const { data, error } = await adminClient
          .from("payment_attempts")
          .insert({
            user_id: user.id,
            plan_code: "pro",
            amount: launchProPrice,
            currency: "USD",
            provider: "whish",
            status: "created",
            idempotency_key: `fixture-concurrent-early-${suffix}-${user.id}`,
            price_version_id: LAUNCH_VERSION_ID,
            purchase_type: "renewal",
            billing_period: "monthly",
          })
          .select()
          .single();
        assert.equal(error, null, `fixture attempt insert failed: ${error?.message}`);
        return data;
      };

      const [attemptA, attemptB] = await Promise.all([makeAttempt("a"), makeAttempt("b")]);

      const results = await Promise.all([
        adminClient.rpc("mark_payment_verified", {
          p_payment_attempt_id: attemptA.id,
          p_provider_payment_id: `fixture-concurrent-early-ref-a-${user.id}`,
          p_period_start: new Date().toISOString(),
          p_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        }),
        adminClient.rpc("mark_payment_verified", {
          p_payment_attempt_id: attemptB.id,
          p_provider_payment_id: `fixture-concurrent-early-ref-b-${user.id}`,
          p_period_start: new Date().toISOString(),
          p_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        }),
      ]);
      for (const r of results) assert.equal(r.error, null, `concurrent verification must not error: ${r.error?.message}`);

      const { data: sub } = await adminClient
        .from("subscriptions")
        .select("current_period_start, current_period_end, next_period_start, next_period_end")
        .eq("user_id", user.id)
        .single();

      // current period must still be completely untouched by either.
      assert.equal(new Date(sub.current_period_start).getTime(), new Date(start).getTime());
      assert.equal(new Date(sub.current_period_end).getTime(), new Date(end).getTime());

      // The two renewals must CHAIN (old_end -> +1mo -> +2mo), never both
      // collide on the same [old_end, old_end+1mo) window — proves the
      // per-user advisory lock actually serializes them.
      const oneMonthOut = new Date(end);
      oneMonthOut.setUTCMonth(oneMonthOut.getUTCMonth() + 1);
      const twoMonthsOut = new Date(end);
      twoMonthsOut.setUTCMonth(twoMonthsOut.getUTCMonth() + 2);

      assert.equal(new Date(sub.next_period_start).getTime(), oneMonthOut.getTime(), "the queue's start must remain the first chained boundary");
      assert.equal(new Date(sub.next_period_end).getTime(), twoMonthsOut.getTime(), "two concurrently-verified early renewals must chain into two full months, never both landing on the same window");

      const { data: attempts } = await adminClient
        .from("payment_attempts")
        .select("id, period_start, period_end")
        .in("id", [attemptA.id, attemptB.id])
        .order("period_start", { ascending: true });
      assert.equal(new Date(attempts[0].period_end).getTime(), new Date(attempts[1].period_start).getTime(), "the two attempts' own recorded periods must be back-to-back, not overlapping or gapped");
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("a renewal verified exactly at/after current_period_end promotes immediately (not deferred)", async () => {
    const user = await createTestUser("pv-renewal-at-boundary");
    try {
      const start = new Date(Date.now() - 31 * 86400000).toISOString();
      const end = new Date(Date.now() - 1000).toISOString(); // already elapsed
      await setSubscription(user.id, {
        plan_code: "pro",
        status: "active",
        current_period_start: start,
        current_period_end: end,
        price_version_id: LAUNCH_VERSION_ID,
      });

      const { data: attempt } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      const { data: verified, error } = await adminClient.rpc("mark_payment_verified", {
        p_payment_attempt_id: attempt.id,
        p_provider_payment_id: `fixture-at-boundary-${user.id}`,
        p_period_start: new Date().toISOString(),
        p_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      });
      assert.equal(error, null, `mark_payment_verified failed: ${error?.message}`);

      const expectedStart = new Date(end);
      const expectedEnd = new Date(expectedStart);
      expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 1);
      assert.equal(new Date(verified.period_start).getTime(), expectedStart.getTime());

      const { data: sub } = await adminClient
        .from("subscriptions")
        .select("current_period_start, current_period_end, next_period_start, next_period_end")
        .eq("user_id", user.id)
        .single();
      assert.equal(new Date(sub.current_period_start).getTime(), expectedStart.getTime(), "a renewal at/after the boundary must activate IMMEDIATELY onto current_period_start");
      assert.equal(new Date(sub.current_period_end).getTime(), expectedEnd.getTime());
      assert.equal(sub.next_period_start, null, "no deferral for an on-time/late renewal");
      assert.equal(sub.next_period_end, null);
    } finally {
      await deleteTestUsers([user]);
    }
  });

  test("promote_due_subscription_period physically promotes a queued period once it is actually due, and create_payment_attempt triggers it opportunistically", async () => {
    const user = await createTestUser("pv-early-renewal-promotion");
    try {
      // Simulate: the early renewal already happened, and the ORIGINAL
      // current period has now (from this fixture's point of view)
      // elapsed, with a queued next period still pending promotion.
      const longAgoStart = new Date(Date.now() - 60 * 86400000).toISOString();
      const longAgoEnd = new Date(Date.now() - 1000).toISOString(); // elapsed
      const queuedStart = longAgoEnd;
      const queuedEnd = new Date(Date.now() + 29 * 86400000).toISOString(); // still active

      await setSubscription(user.id, {
        plan_code: "pro",
        status: "active",
        current_period_start: longAgoStart,
        current_period_end: longAgoEnd,
        next_period_start: queuedStart,
        next_period_end: queuedEnd,
        next_price_version_id: LAUNCH_VERSION_ID,
        price_version_id: LAUNCH_VERSION_ID,
      });

      // A plain read (get_onboarding_readiness) must already report
      // eligibility correctly via the read-only effective-period
      // computation, even though the row hasn't been physically promoted.
      const { data: readiness } = await user.client.rpc("get_onboarding_readiness");
      assert.equal(readiness.plan_eligible, true, "get_onboarding_readiness must account for a due-but-unpromoted queued period");

      // Any payment-related call (here, create_payment_attempt for the
      // SAME plan) opportunistically promotes the row.
      const { data: attempt, error } = await user.client.rpc("create_payment_attempt", { p_plan_code: "pro" });
      assert.equal(error, null, `create_payment_attempt failed: ${error?.message}`);
      assert.equal(attempt.purchase_type, "renewal", "after promotion, plan_code still matches pro -> a fresh request is classified as a renewal, not initial");

      const { data: sub } = await adminClient
        .from("subscriptions")
        .select("current_period_start, current_period_end, next_period_start, next_period_end")
        .eq("user_id", user.id)
        .single();
      assert.equal(new Date(sub.current_period_start).getTime(), new Date(queuedStart).getTime(), "the queued period must now be physically promoted into current_period_start");
      assert.equal(new Date(sub.current_period_end).getTime(), new Date(queuedEnd).getTime());
      assert.equal(sub.next_period_start, null, "next_period_* must be cleared once promoted");
      assert.equal(sub.next_period_end, null);
    } finally {
      await deleteTestUsers([user]);
    }
  });
});
