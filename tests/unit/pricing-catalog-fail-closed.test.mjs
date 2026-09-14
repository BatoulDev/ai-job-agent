// Unit tests for the fail-closed plan-selection logic in
// src/components/landing/Pricing.tsx (the `pricingAvailable`/`plans`
// computation). Pricing.tsx is an async Server Component (no "use client"),
// so it can't be rendered directly under `node --test` — mirrors the exact
// logic inline instead, matching the established convention already used
// by tests/unit/cv-analysis-defensive-rendering.test.mjs and
// tests/unit/ai-career-profile-popup.test.mjs for the same reason.
//
// What this guards: a backend price change, an RPC error, or a
// misconfigured/deactivated plan must never make the landing page render a
// stale, partial, or invented price — see AGENTS.md's Phase 3 requirement
// ("Unknown or inactive plan codes must fail closed... Do not silently
// fall back to old hard-coded prices").
//
// Run: node --test tests/unit/pricing-catalog-fail-closed.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const EXPECTED_PLAN_CODES = ["free", "student", "pro"];

// Mirror of Pricing.tsx's inline computation.
function selectPricingPlans(catalog) {
  const catalogByPlanCode = new Map((catalog ?? []).map((entry) => [entry.planCode, entry]));
  const pricingAvailable =
    catalog !== null && EXPECTED_PLAN_CODES.every((code) => catalogByPlanCode.has(code));

  const plans = pricingAvailable
    ? EXPECTED_PLAN_CODES.map((planCode) => catalogByPlanCode.get(planCode))
    : [];

  return { pricingAvailable, plans };
}

function entry(planCode, priceAmount) {
  return { planCode, priceAmount, currency: "USD", billingPeriod: "monthly" };
}

describe("Pricing.tsx fail-closed catalog selection", () => {
  test("a complete catalog (all 3 plans) renders normally, using the server-supplied prices", () => {
    const { pricingAvailable, plans } = selectPricingPlans([
      entry("free", 0),
      entry("student", 9),
      entry("pro", 18),
    ]);
    assert.equal(pricingAvailable, true);
    assert.equal(plans.length, 3);
    assert.equal(plans.find((p) => p.planCode === "pro").priceAmount, 18);
  });

  test("catalog === null (RPC/network failure) fails closed — no plans, no invented price", () => {
    const { pricingAvailable, plans } = selectPricingPlans(null);
    assert.equal(pricingAvailable, false);
    assert.deepEqual(plans, []);
  });

  test("an empty catalog fails closed", () => {
    const { pricingAvailable, plans } = selectPricingPlans([]);
    assert.equal(pricingAvailable, false);
    assert.deepEqual(plans, []);
  });

  test("a partial catalog (one expected plan missing) fails closed entirely, not partially", () => {
    const { pricingAvailable, plans } = selectPricingPlans([entry("free", 0), entry("student", 9)]);
    assert.equal(pricingAvailable, false, "missing 'pro' must fail the whole section closed");
    assert.deepEqual(plans, []);
  });

  test("an extra/unrecognized plan code in the catalog is ignored, not rendered", () => {
    const { pricingAvailable, plans } = selectPricingPlans([
      entry("free", 0),
      entry("student", 9),
      entry("pro", 18),
      entry("enterprise", 999),
    ]);
    assert.equal(pricingAvailable, true);
    assert.equal(plans.length, 3, "only the 3 expected plan codes are ever rendered");
    assert.equal(
      plans.some((p) => p.planCode === "enterprise"),
      false
    );
  });

  test("a stale price change is reflected immediately once the catalog updates (no client-side caching of the old value)", () => {
    const before = selectPricingPlans([entry("free", 0), entry("student", 9), entry("pro", 18)]);
    const after = selectPricingPlans([entry("free", 0), entry("student", 9), entry("pro", 25)]);
    assert.equal(before.plans.find((p) => p.planCode === "pro").priceAmount, 18);
    assert.equal(after.plans.find((p) => p.planCode === "pro").priceAmount, 25);
  });
});
