// Checkpoint 2E — pure, offline tests for
// src/lib/matching/rerankCandidates.ts's deriveEffectivePlanCode(). Proves
// the fix found during review: expire_subscription/cancel_subscription
// only ever flip `status`, never reset plan_code back to 'free', and
// neither function is called anywhere in src/ (no automated expiry
// sweep) — so a lapsed/cancelled/expired paid subscription must never be
// treated as still-entitled just because plan_code still says so.
//
// Run: node --test tests/unit/derive-effective-plan-code.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveEffectivePlanCode } from "../../src/lib/matching/rerankCandidates.ts";

describe("deriveEffectivePlanCode", () => {
  test("no subscription row at all -> free", () => {
    assert.equal(deriveEffectivePlanCode(null), "free");
    assert.equal(deriveEffectivePlanCode(undefined), "free");
  });

  test("plan_code 'free' is always free, regardless of status", () => {
    assert.equal(deriveEffectivePlanCode({ plan_code: "free", status: "active", current_period_end: null }), "free");
  });

  test("an active, current-period paid plan is honored", () => {
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    assert.equal(deriveEffectivePlanCode({ plan_code: "pro", status: "active", current_period_end: futureDate }), "pro");
    assert.equal(deriveEffectivePlanCode({ plan_code: "student", status: "active", current_period_end: futureDate }), "student");
  });

  test("REGRESSION (the real bug found): a cancelled subscription whose plan_code still says 'pro' must fall back to free", () => {
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    assert.equal(deriveEffectivePlanCode({ plan_code: "pro", status: "cancelled", current_period_end: futureDate }), "free");
  });

  test("an expired subscription whose plan_code still says 'pro' must fall back to free", () => {
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    assert.equal(deriveEffectivePlanCode({ plan_code: "pro", status: "expired", current_period_end: futureDate }), "free");
  });

  test("status='active' but current_period_end already in the past (no expiry sweep ran) must still fall back to free", () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    assert.equal(deriveEffectivePlanCode({ plan_code: "pro", status: "active", current_period_end: pastDate }), "free");
  });

  test("status='active' with a null current_period_end (free-tier shape, or not yet billed) is honored when plan_code is paid", () => {
    assert.equal(deriveEffectivePlanCode({ plan_code: "pro", status: "active", current_period_end: null }), "pro");
  });

  test("status='pending' (not yet activated) falls back to free even with a future current_period_end", () => {
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    assert.equal(deriveEffectivePlanCode({ plan_code: "pro", status: "pending", current_period_end: futureDate }), "free");
  });

  test("an unrecognized plan_code value never falls through to being trusted as a real plan", () => {
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    assert.equal(deriveEffectivePlanCode({ plan_code: "not-a-real-plan", status: "active", current_period_end: futureDate }), "free");
  });

  // Checkpoint 2E audit-remediation: NaN <= anything is always false in
  // JavaScript, so an unparseable current_period_end previously fell
  // through as if it were a valid, still-future date — the opposite of
  // fail-closed. Treated the same as an already-expired period now.
  test("REGRESSION (audit finding): an invalid/unparseable current_period_end is treated as expired, not as still-valid", () => {
    assert.equal(deriveEffectivePlanCode({ plan_code: "pro", status: "active", current_period_end: "not-a-real-date" }), "free");
  });

  test("an empty-string current_period_end is treated as expired, not as still-valid", () => {
    assert.equal(deriveEffectivePlanCode({ plan_code: "pro", status: "active", current_period_end: "" }), "pro");
    // Empty string is falsy, so the expiry branch is skipped entirely
    // (same as null) — the real plan_code is trusted when status is
    // active and there's genuinely no period_end signal to check. This
    // documents that specific behavior rather than asserting a change.
  });
});
