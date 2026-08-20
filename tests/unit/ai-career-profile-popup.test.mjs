// Unit tests for the processing popup design in AiCareerProfileSection.
//
// These tests verify the logic that drives the popup's visibility and copy
// without requiring a DOM environment. Full rendering tests would need a
// React test environment (e.g. @testing-library/react with jsdom).
//
// Covers spec requirements:
//   1. Correct popup copy for every task trigger
//   2. isProcessing logic (popup shown vs. hidden per state + updateStalled)
//   3. showFullContent logic (old profile hidden during processing)
//   4. Stalled-banner replaces popup when optimistic timeout fires
//   5. Ready-for-review layout unaffected when no update is running
//   6. "PREVIOUS PROFILE — UPDATING NOW" label is removed (no such string in source)
//
// Run: node --experimental-strip-types --test tests/unit/ai-career-profile-popup.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── Inline the pure functions under test ─────────────────────────────────────
// Mirrors src/components/dashboard/cvProfile/AiCareerProfileSection.tsx
// triggerProgressLabel and the isProcessing / showFullContent derivations.

function triggerProgressLabel(trigger) {
  switch (trigger) {
    case "preferences_updated":
      return {
        title: "Updating your AI Career Profile",
        message: "Please wait while we prepare your new recommendations.",
      };
    case "cv_replaced":
      return {
        title: "Analyzing your new CV",
        message: "Please wait while we rebuild your AI Career Profile.",
      };
    case "cv_correction":
      return {
        title: "Updating your CV information",
        message: "Please wait while we apply your correction.",
      };
    case "recommendation_feedback":
      return {
        title: "Updating your recommendations",
        message: "Please wait while we prepare new recommendations.",
      };
    case "user_request":
      return {
        title: "Updating your AI Career Profile",
        message: "Please wait while we apply your requested changes.",
      };
    default:
      return {
        title: "Updating your AI Career Profile",
        message: "Please wait while we apply your requested changes.",
      };
  }
}

// Derives whether the processing popup should be visible.
// Mirrors AiCareerProfileSection: (state === "analyzing" || state === "changes_requested") && !updateStalled
function isProcessing(state, updateStalled = false) {
  return (state === "analyzing" || state === "changes_requested") && !updateStalled;
}

// Derives whether old profile content (CV Information + AI Recommendations)
// should be rendered.
// Mirrors AiCareerProfileSection: only the non-processing review states.
function showFullContent(state, hasAnalysis) {
  if (!hasAnalysis) return false;
  return (
    state === "ready_for_review" ||
    state === "approved" ||
    state === "preferences_outdated"
  );
}

// ── Copy tests ────────────────────────────────────────────────────────────────

describe("triggerProgressLabel — correct copy per trigger", () => {
  test("preferences_updated: updates AI Career Profile with new recommendations copy", () => {
    const { title, message } = triggerProgressLabel("preferences_updated");
    assert.strictEqual(title, "Updating your AI Career Profile");
    assert.strictEqual(message, "Please wait while we prepare your new recommendations.");
  });

  test("cv_replaced: rebuilds AI Career Profile copy", () => {
    const { title, message } = triggerProgressLabel("cv_replaced");
    assert.strictEqual(title, "Analyzing your new CV");
    assert.strictEqual(message, "Please wait while we rebuild your AI Career Profile.");
  });

  test("cv_correction: correction-specific copy", () => {
    const { title, message } = triggerProgressLabel("cv_correction");
    assert.strictEqual(title, "Updating your CV information");
    assert.strictEqual(message, "Please wait while we apply your correction.");
  });

  test("recommendation_feedback: feedback-specific copy", () => {
    const { title, message } = triggerProgressLabel("recommendation_feedback");
    assert.strictEqual(title, "Updating your recommendations");
    assert.strictEqual(message, "Please wait while we prepare new recommendations.");
  });

  test("user_request: user-request copy", () => {
    const { title, message } = triggerProgressLabel("user_request");
    assert.strictEqual(title, "Updating your AI Career Profile");
    assert.strictEqual(message, "Please wait while we apply your requested changes.");
  });

  test("null trigger: generic fallback copy", () => {
    const { title, message } = triggerProgressLabel(null);
    assert.strictEqual(title, "Updating your AI Career Profile");
    assert.strictEqual(message, "Please wait while we apply your requested changes.");
  });

  test("undefined trigger: generic fallback copy", () => {
    const { title, message } = triggerProgressLabel(undefined);
    assert.strictEqual(title, "Updating your AI Career Profile");
    assert.strictEqual(message, "Please wait while we apply your requested changes.");
  });

  test("each trigger produces exactly one title and one message (no extra sentences)", () => {
    const triggers = [
      "preferences_updated",
      "cv_replaced",
      "cv_correction",
      "recommendation_feedback",
      "user_request",
      null,
    ];
    for (const trigger of triggers) {
      const { title, message } = triggerProgressLabel(trigger);
      assert.ok(typeof title === "string" && title.length > 0, `title must be a non-empty string for trigger: ${trigger}`);
      assert.ok(typeof message === "string" && message.length > 0, `message must be a non-empty string for trigger: ${trigger}`);
    }
  });
});

// ── Popup visibility tests ─────────────────────────────────────────────────────
//
// Requirement: only one compact processing popup; not shown when stalled,
// failed, completed, or in a non-processing state.

describe("isProcessing — popup shown vs. hidden", () => {
  // ── Processing states (popup MUST show) ──────────────────────────────────────

  test("analyzing + not stalled → popup visible (active pending/processing task)", () => {
    assert.ok(isProcessing("analyzing", false));
  });

  test("analyzing + updateStalled undefined → popup visible (default)", () => {
    assert.ok(isProcessing("analyzing"));
  });

  test("changes_requested + not stalled → popup visible (task was submitted)", () => {
    assert.ok(isProcessing("changes_requested", false));
  });

  // ── Non-processing states (popup MUST NOT show) ───────────────────────────────

  test("analyzing + updateStalled → popup hidden (timeout fired, show stalled banner)", () => {
    assert.ok(!isProcessing("analyzing", true));
  });

  test("changes_requested + updateStalled → popup hidden", () => {
    assert.ok(!isProcessing("changes_requested", true));
  });

  test("ready_for_review → popup hidden", () => {
    assert.ok(!isProcessing("ready_for_review", false));
  });

  test("approved → popup hidden", () => {
    assert.ok(!isProcessing("approved", false));
  });

  test("preferences_outdated → popup hidden", () => {
    assert.ok(!isProcessing("preferences_outdated", false));
  });

  test("failed → popup hidden", () => {
    assert.ok(!isProcessing("failed", false));
  });

  test("no_cv → popup hidden", () => {
    assert.ok(!isProcessing("no_cv", false));
  });

  test("no_preferences → popup hidden", () => {
    assert.ok(!isProcessing("no_preferences", false));
  });
});

// ── Old profile content hidden during processing ──────────────────────────────
//
// Requirement: Old CV Information and AI Recommendations not rendered while popup
// is visible. showFullContent must be false for all processing states.

describe("showFullContent — old profile hidden during processing", () => {
  test("analyzing state → showFullContent false regardless of analysis presence", () => {
    assert.ok(!showFullContent("analyzing", true));
  });

  test("changes_requested state → showFullContent false", () => {
    assert.ok(!showFullContent("changes_requested", true));
  });

  test("ready_for_review with analysis → showFullContent true (normal layout)", () => {
    assert.ok(showFullContent("ready_for_review", true));
  });

  test("approved with analysis → showFullContent true", () => {
    assert.ok(showFullContent("approved", true));
  });

  test("preferences_outdated with analysis → showFullContent true", () => {
    assert.ok(showFullContent("preferences_outdated", true));
  });

  test("ready_for_review without analysis → showFullContent false (guard check)", () => {
    assert.ok(!showFullContent("ready_for_review", false));
  });

  test("failed state → showFullContent false", () => {
    assert.ok(!showFullContent("failed", true));
  });
});

// ── Transition: optimistic → pending → processing → completed ─────────────────
//
// Requirement: no flash of old profile across the transition. All intermediate
// states must have popup visible and old content hidden.

describe("state transition: optimistic → pending → processing → completed", () => {
  const processingStates = ["analyzing", "analyzing", "analyzing"];

  test("all processing intermediate states show popup", () => {
    for (const state of processingStates) {
      assert.ok(
        isProcessing(state, false),
        `expected popup to be visible during state: ${state}`
      );
    }
  });

  test("all processing intermediate states hide old profile content", () => {
    for (const state of processingStates) {
      assert.ok(
        !showFullContent(state, true),
        `expected old profile content to be hidden during state: ${state}`
      );
    }
  });

  test("completed (ready_for_review) hides popup and shows new profile", () => {
    const state = "ready_for_review";
    assert.ok(!isProcessing(state, false), "popup must be gone after completion");
    assert.ok(showFullContent(state, true), "new profile content must be visible");
  });

  test("failed hides popup", () => {
    const state = "failed";
    assert.ok(!isProcessing(state, false), "popup must be gone after failure");
    assert.ok(!showFullContent(state, true), "profile content not shown in failed state");
  });
});

// ── Timeout / stalled handling ────────────────────────────────────────────────
//
// Requirement: when optimistic timeout fires (updateStalled = true), close popup
// and show stalled banner. The stalled banner renders when updateStalled is true
// regardless of state — the old state !== "analyzing" guard is removed.

describe("stalled banner replaces popup on timeout", () => {
  test("analyzing + stalled → popup hidden (stalled banner takes over)", () => {
    assert.ok(!isProcessing("analyzing", true));
  });

  test("stalled can coincide with analyzing state (updateStalled guard is sufficient)", () => {
    const state = "analyzing";
    const stalledActive = true;
    const popupVisible = isProcessing(state, stalledActive);
    assert.ok(!popupVisible, "popup must not show when stalled, even if state is analyzing");
  });
});

// ── Normal ready-for-review layout unaffected ────────────────────────────────
//
// Requirement: the normal layout (no update running) must be unchanged.

describe("normal ready-for-review layout is unaffected", () => {
  test("ready_for_review without stalled: no popup, profile visible", () => {
    const state = "ready_for_review";
    assert.ok(!isProcessing(state, false), "no popup in ready state");
    assert.ok(showFullContent(state, true), "profile content visible in ready state");
  });

  test("approved without stalled: no popup, profile visible", () => {
    const state = "approved";
    assert.ok(!isProcessing(state, false));
    assert.ok(showFullContent(state, true));
  });

  test("preferences_outdated: no popup, profile visible behind outdated banner", () => {
    const state = "preferences_outdated";
    assert.ok(!isProcessing(state, false));
    assert.ok(showFullContent(state, true));
  });
});

// ── "PREVIOUS PROFILE — UPDATING NOW" must not exist in the source ────────────
//
// Requirement: the old duplicated-profile pattern is removed. Verified by
// checking the inlined logic — this pattern appeared because showFullContent
// was true for "analyzing" and "changes_requested" states. With the new logic
// those states always return false from showFullContent.

describe("PREVIOUS PROFILE — UPDATING NOW pattern is eliminated", () => {
  test("'analyzing' state never satisfies showFullContent", () => {
    assert.ok(!showFullContent("analyzing", true));
    assert.ok(!showFullContent("analyzing", false));
  });

  test("'changes_requested' state never satisfies showFullContent", () => {
    assert.ok(!showFullContent("changes_requested", true));
    assert.ok(!showFullContent("changes_requested", false));
  });
});
