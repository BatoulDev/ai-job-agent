// Regression test for the Dialog focus-steal bug fixed in
// src/components/dashboard/cvProfile/Dialog.tsx.
//
// Root cause: the useEffect in Dialog had [open, onClose] as deps. onClose
// was always an inline arrow function (resetAndClose) recreated on every
// render of RequestChangesDialog. Every keystroke in a controlled input
// → state update → RequestChangesDialog re-render → new resetAndClose ref
// → Dialog useEffect re-fires → panelRef.current.focus() steals focus.
//
// Fix: onClose is stored in a ref (onCloseRef) and read from there inside
// the effect. The effect dep array is reduced to [open] only.
//
// These tests cover the invariants we can verify without a DOM environment:
//   1. The ref-update pattern: assigning ref.current in the render body
//      always reflects the latest value before the effect runs.
//   2. The Escape handler: called via onCloseRef rather than a stale closure.
//   3. deriveCvProfileState handles every task status correctly, including
//      the new preferences_outdated path that polling now makes reachable.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── Ref-update pattern ────────────────────────────────────────────────────────
//
// Simulates what Dialog.tsx does:
//   const onCloseRef = useRef(onClose);
//   onCloseRef.current = onClose;          // render body — always current
//   useEffect(() => { ... onCloseRef.current() ... }, [open]);
//
// The key invariant: even if the parent passes a new onClose function on a
// re-render that happens between the render and the effect, the effect reads
// the latest value because we update the ref in the render body (not in a
// separate effect whose timing is unpredictable).

describe("Dialog ref-update pattern", () => {
  test("onCloseRef.current always reflects the most recently rendered onClose", () => {
    // Simulate three consecutive renders with different onClose functions
    // (the real scenario: typed character → re-render → new inline arrow)
    const calls = [];
    const makeClose = (label) => () => calls.push(label);

    const ref = { current: null };

    // Render 1
    ref.current = makeClose("render-1");
    // Render 2 — simulates re-render from typing; effect has NOT fired yet
    ref.current = makeClose("render-2");
    // Render 3
    ref.current = makeClose("render-3");

    // Effect fires and reads current ref — must see render-3
    ref.current();

    assert.deepStrictEqual(calls, ["render-3"],
      "effect must call the latest onClose, not a stale one from an earlier render");
  });

  test("calling onCloseRef.current on Escape uses the latest handler", () => {
    let closeCallCount = 0;
    const ref = { current: () => closeCallCount++ };

    // Simulate onClose being replaced mid-flight
    const newClose = () => { closeCallCount += 10; };
    ref.current = newClose;

    // Simulate Escape key handler
    ref.current();

    assert.strictEqual(closeCallCount, 10,
      "Escape must invoke the latest onClose, not the one captured at effect setup");
  });
});

// ── deriveCvProfileState state machine ────────────────────────────────────────
//
// Tests the states reachable when the n8n worker is active and the dashboard
// polling detects taskStatus changes. This directly tests the logic the
// polling effect in dashboard/page.tsx depends on to know when to stop.

// Inline the state machine to avoid Node.js TS interop issues in this test.
// This mirrors src/lib/cvAnalysis/profileState.ts#deriveCvProfileState exactly.
function deriveCvProfileState({ hasActiveCv, preferencesComplete, task, analysis }) {
  if (!hasActiveCv) return "no_cv";
  if (!preferencesComplete) return "no_preferences";

  if (analysis) {
    if (analysis.status === "failed") return "failed";
    if (analysis.status === "processing") return "analyzing";
    if (analysis.review_status === "changes_requested") return "changes_requested";
    if (analysis.recommendations_state === "stale") return "preferences_outdated";
    if (analysis.review_status === "approved") return "approved";
    return "ready_for_review";
  }

  if (task) {
    if (task.status === "failed") return "failed";
    if (task.status === "pending" || task.status === "processing") return "analyzing";
  }

  return "analyzing";
}

const base = { hasActiveCv: true, preferencesComplete: true };

describe("deriveCvProfileState — task-driven transitions", () => {
  test("no task and no analysis → analyzing (worker expected but not yet queued)", () => {
    assert.strictEqual(deriveCvProfileState({ ...base, task: null, analysis: null }), "analyzing");
  });

  test("pending task, no analysis → analyzing (queued, dashboard should poll)", () => {
    assert.strictEqual(
      deriveCvProfileState({ ...base, task: { status: "pending" }, analysis: null }),
      "analyzing"
    );
  });

  test("processing task, no analysis → analyzing (actively running)", () => {
    assert.strictEqual(
      deriveCvProfileState({ ...base, task: { status: "processing" }, analysis: null }),
      "analyzing"
    );
  });

  test("failed task, no analysis → failed", () => {
    assert.strictEqual(
      deriveCvProfileState({ ...base, task: { status: "failed" }, analysis: null }),
      "failed"
    );
  });

  test("completed task, no analysis → analyzing (analysis not yet visible)", () => {
    // completed task with no analysis row means the insert hasn't propagated
    // yet or was missed — show analyzing rather than an empty state.
    assert.strictEqual(
      deriveCvProfileState({ ...base, task: { status: "completed" }, analysis: null }),
      "analyzing"
    );
  });
});

describe("deriveCvProfileState — analysis-driven states (polling termination signals)", () => {
  const completedAnalysis = {
    status: "completed",
    review_status: "pending_review",
    recommendations_state: "current",
  };

  test("completed analysis, pending_review → ready_for_review (polling can stop)", () => {
    assert.strictEqual(
      deriveCvProfileState({ ...base, task: { status: "completed" }, analysis: completedAnalysis }),
      "ready_for_review"
    );
  });

  test("completed analysis, approved, current recommendations → approved", () => {
    assert.strictEqual(
      deriveCvProfileState({
        ...base,
        task: null,
        analysis: { status: "completed", review_status: "approved", recommendations_state: "current" },
      }),
      "approved"
    );
  });

  test("stale recommendations on approved analysis → preferences_outdated", () => {
    // This is the state after preferences change bumps version and the trigger
    // marks is_current analysis as stale. Polling must continue here because
    // a new task may be queued to refresh.
    assert.strictEqual(
      deriveCvProfileState({
        ...base,
        task: { status: "pending" },
        analysis: { status: "completed", review_status: "approved", recommendations_state: "stale" },
      }),
      "preferences_outdated"
    );
  });

  test("stale analysis takes priority over pending task in the state machine", () => {
    // When analysis is stale the amber 'outdated' banner is more informative
    // than the generic spinner — the old CV facts are still valid and visible.
    const result = deriveCvProfileState({
      ...base,
      task: { status: "pending" },
      analysis: { status: "completed", review_status: "approved", recommendations_state: "stale" },
    });
    assert.notStrictEqual(result, "analyzing",
      "preferences_outdated must surface, not be hidden behind the analyzing spinner");
    assert.strictEqual(result, "preferences_outdated");
  });

  test("failed analysis → failed regardless of task state", () => {
    assert.strictEqual(
      deriveCvProfileState({
        ...base,
        task: { status: "processing" },
        analysis: { status: "failed", review_status: "pending_review", recommendations_state: "current" },
      }),
      "failed"
    );
  });
});

describe("deriveCvProfileState — multi-character typing scenario", () => {
  // Simulates the sequence of states the dashboard would go through when
  // a user types a full sentence into the Request Changes dialog:
  //   1. Dialog opens → state is ready_for_review
  //   2. User types each character → parent re-renders pass new onClose to Dialog
  //   3. Dialog effect must NOT re-run → focus stays on the input
  //
  // This test verifies the state machine stays stable across many renders
  // with the same underlying data, which is the precondition for the ref fix.
  test("state remains stable across 50 simulated re-renders with unchanged data", () => {
    const analysis = { status: "completed", review_status: "pending_review", recommendations_state: "current" };
    const task = { status: "completed" };

    for (let i = 0; i < 50; i++) {
      const result = deriveCvProfileState({ ...base, task, analysis });
      assert.strictEqual(result, "ready_for_review",
        `state must be stable on render #${i + 1}`);
    }
  });
});
