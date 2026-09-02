// Unit tests for src/lib/cvAnalysis/matchingEligibility.ts — the dashboard's
// mirror of the canonical backend matching-eligibility gate
// (is_cv_analysis_matching_eligible() / confirm_cv_analysis()). Regression
// coverage for the Automation-1 audit's headline finding: checking only
// review_status/is_current previously let a stale-but-approved profile keep
// showing as unlocked on the dashboard, reproduced live against a real
// fixture user before being fixed.
//
// Run: node --experimental-strip-types --test tests/unit/matching-eligibility.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isProfileMatchingEligible } from "../../src/lib/cvAnalysis/matchingEligibility.ts";

function eligibleAnalysis(overrides = {}) {
  return {
    review_status: "approved",
    is_current: true,
    recommendations_state: "current",
    preferences_version: 3,
    ...overrides,
  };
}

describe("isProfileMatchingEligible", () => {
  test("true when every freshness condition holds", () => {
    assert.equal(isProfileMatchingEligible(eligibleAnalysis(), 3), true);
  });

  test("null analysis is never eligible", () => {
    assert.equal(isProfileMatchingEligible(null, 3), false);
  });

  test("not approved -> not eligible", () => {
    assert.equal(
      isProfileMatchingEligible(eligibleAnalysis({ review_status: "pending_review" }), 3),
      false
    );
  });

  test("not is_current -> not eligible", () => {
    assert.equal(isProfileMatchingEligible(eligibleAnalysis({ is_current: false }), 3), false);
  });

  test("recommendations_state stale (the reproduced bug) -> not eligible", () => {
    // This is the exact live-reproduced scenario: approved + is_current
    // stayed true after a preference change, only recommendations_state
    // flipped to 'stale'. The old dashboard condition
    // (review_status==='approved' && is_current===true) missed this.
    assert.equal(
      isProfileMatchingEligible(eligibleAnalysis({ recommendations_state: "stale" }), 3),
      false
    );
  });

  test("recommendations_state superseded -> not eligible", () => {
    assert.equal(
      isProfileMatchingEligible(eligibleAnalysis({ recommendations_state: "superseded" }), 3),
      false
    );
  });

  test("null preferences_version -> not eligible", () => {
    assert.equal(
      isProfileMatchingEligible(eligibleAnalysis({ preferences_version: null }), 3),
      false
    );
  });

  test("preferences_version mismatched against the live version -> not eligible", () => {
    assert.equal(isProfileMatchingEligible(eligibleAnalysis({ preferences_version: 2 }), 3), false);
  });

  test("null latestPreferencesVersion (not yet loaded) -> not eligible", () => {
    assert.equal(isProfileMatchingEligible(eligibleAnalysis(), null), false);
  });
});
