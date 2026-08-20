// Unit tests for deriveCvProfileState (src/lib/cvAnalysis/profileState.ts).
// Run: node --experimental-strip-types --test tests/unit/derive-cv-profile-state.test.mjs
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveCvProfileState } from "../../src/lib/cvAnalysis/profileState.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function derive(overrides = {}) {
  return deriveCvProfileState({
    hasActiveCv: true,
    preferencesComplete: true,
    task: null,
    analysis: null,
    ...overrides,
  });
}

function analysis(overrides = {}) {
  return {
    status: "completed",
    review_status: "pending_review",
    recommendations_state: "current",
    ...overrides,
  };
}

// ── Prerequisites ─────────────────────────────────────────────────────────────

describe("prerequisites", () => {
  test("no CV → no_cv", () => {
    assert.equal(derive({ hasActiveCv: false }), "no_cv");
  });

  test("no preferences → no_preferences", () => {
    assert.equal(derive({ preferencesComplete: false }), "no_preferences");
  });

  test("no CV takes priority over no preferences", () => {
    assert.equal(
      derive({ hasActiveCv: false, preferencesComplete: false }),
      "no_cv"
    );
  });
});

// ── Active task: takes priority over analysis state ───────────────────────────

describe("active task priority", () => {
  test("pending task → analyzing", () => {
    assert.equal(derive({ task: { status: "pending" } }), "analyzing");
  });

  test("processing task → analyzing", () => {
    assert.equal(derive({ task: { status: "processing" } }), "analyzing");
  });

  // This is the fix for the Marketing test: before the fix, `recommendations_state === "stale"`
  // was checked before the task check, causing the stale banner to show instead of the spinner.
  test("pending task + stale analysis → analyzing (not preferences_outdated)", () => {
    assert.equal(
      derive({
        task: { status: "pending" },
        analysis: analysis({ recommendations_state: "stale" }),
      }),
      "analyzing",
      "active task must win over stale analysis — shows spinner, not outdated banner"
    );
  });

  test("processing task + stale analysis → analyzing", () => {
    assert.equal(
      derive({
        task: { status: "processing" },
        analysis: analysis({ recommendations_state: "stale" }),
      }),
      "analyzing"
    );
  });

  test("pending task + changes_requested analysis → analyzing (task wins)", () => {
    assert.equal(
      derive({
        task: { status: "pending" },
        analysis: analysis({ review_status: "changes_requested" }),
      }),
      "analyzing"
    );
  });

  test("pending task + approved analysis → analyzing (task wins)", () => {
    assert.equal(
      derive({
        task: { status: "pending" },
        analysis: analysis({ review_status: "approved" }),
      }),
      "analyzing"
    );
  });

  test("pending task + failed analysis → analyzing (task wins)", () => {
    assert.equal(
      derive({
        task: { status: "pending" },
        analysis: analysis({ status: "failed" }),
      }),
      "analyzing"
    );
  });
});

// ── Analysis states (no active task) ─────────────────────────────────────────

describe("analysis states", () => {
  test("completed analysis with pending_review → ready_for_review", () => {
    assert.equal(derive({ analysis: analysis() }), "ready_for_review");
  });

  test("analysis with changes_requested → changes_requested", () => {
    assert.equal(
      derive({ analysis: analysis({ review_status: "changes_requested" }) }),
      "changes_requested"
    );
  });

  test("analysis with stale recommendations → preferences_outdated", () => {
    assert.equal(
      derive({ analysis: analysis({ recommendations_state: "stale" }) }),
      "preferences_outdated"
    );
  });

  test("approved analysis → approved", () => {
    assert.equal(
      derive({ analysis: analysis({ review_status: "approved" }) }),
      "approved"
    );
  });

  test("failed analysis → failed", () => {
    assert.equal(
      derive({ analysis: analysis({ status: "failed" }) }),
      "failed"
    );
  });

  // Priority: failed > changes_requested > stale > approved > ready_for_review.
  test("failed status wins over changes_requested review_status", () => {
    assert.equal(
      derive({
        analysis: analysis({ status: "failed", review_status: "changes_requested" }),
      }),
      "failed"
    );
  });

  test("changes_requested wins over stale recommendations", () => {
    assert.equal(
      derive({
        analysis: analysis({
          review_status: "changes_requested",
          recommendations_state: "stale",
        }),
      }),
      "changes_requested"
    );
  });

  test("stale recommendations wins over approved review_status", () => {
    assert.equal(
      derive({
        analysis: analysis({
          review_status: "approved",
          recommendations_state: "stale",
        }),
      }),
      "preferences_outdated"
    );
  });
});

// ── No analysis, no active task ───────────────────────────────────────────────

describe("no analysis, no active task", () => {
  test("nothing queued or analyzed → analyzing (expected-imminently framing)", () => {
    assert.equal(derive(), "analyzing");
  });

  test("failed task and no analysis → failed", () => {
    assert.equal(
      derive({ task: { status: "failed" } }),
      "failed"
    );
  });

  test("completed task and no analysis → analyzing (worker may have just inserted the row)", () => {
    // A completed task with no analysis row would be a brief transient state;
    // "analyzing" is a reasonable honest fallback.
    assert.equal(
      derive({ task: { status: "completed" } }),
      "analyzing"
    );
  });
});
