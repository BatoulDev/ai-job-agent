// Unit tests for src/lib/optimisticProfileUpdate.ts
// Run: node --experimental-strip-types --test tests/unit/optimistic-profile-update.test.mjs
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  setProfileUpdatePending,
  readAndClearProfileUpdatePending,
  computeEffectiveTaskState,
  SESSION_KEY,
  MAX_AGE_MS,
} from "../../src/lib/optimisticProfileUpdate.ts";
import { deriveCvProfileState } from "../../src/lib/cvAnalysis/profileState.ts";

// ── Mock storage factory ───────────────────────────────────────────────────────

function makeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = value; },
    removeItem: (key) => { delete store[key]; },
    _store: store,
  };
}

// ── setProfileUpdatePending ────────────────────────────────────────────────────

describe("setProfileUpdatePending", () => {
  test("stores the trigger and a recent timestamp", () => {
    const storage = makeStorage();
    const before = Date.now();
    setProfileUpdatePending("preferences_updated", storage);
    const after = Date.now();

    const raw = storage.getItem(SESSION_KEY);
    assert.ok(raw, "flag must be stored");
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.trigger, "preferences_updated");
    assert.ok(parsed.setAt >= before && parsed.setAt <= after, "setAt must be within test run");
  });

  test("stores cv_replaced trigger", () => {
    const storage = makeStorage();
    setProfileUpdatePending("cv_replaced", storage);
    const parsed = JSON.parse(storage.getItem(SESSION_KEY));
    assert.strictEqual(parsed.trigger, "cv_replaced");
  });

  test("preferences_updated does not overwrite a recent cv_replaced flag", () => {
    const storage = makeStorage();
    setProfileUpdatePending("cv_replaced", storage);
    setProfileUpdatePending("preferences_updated", storage);
    // The cv_replaced flag should be preserved
    const parsed = JSON.parse(storage.getItem(SESSION_KEY));
    assert.strictEqual(
      parsed.trigger,
      "cv_replaced",
      "preferences_updated must not overwrite a recent cv_replaced flag"
    );
  });

  test("preferences_updated overwrites an expired cv_replaced flag", () => {
    const oldSetAt = Date.now() - (MAX_AGE_MS + 1_000);
    const storage = makeStorage({
      [SESSION_KEY]: JSON.stringify({ trigger: "cv_replaced", setAt: oldSetAt }),
    });
    setProfileUpdatePending("preferences_updated", storage);
    const parsed = JSON.parse(storage.getItem(SESSION_KEY));
    assert.strictEqual(parsed.trigger, "preferences_updated");
  });

  test("cv_replaced always overwrites any existing flag", () => {
    const storage = makeStorage();
    setProfileUpdatePending("preferences_updated", storage);
    setProfileUpdatePending("cv_replaced", storage);
    const parsed = JSON.parse(storage.getItem(SESSION_KEY));
    assert.strictEqual(parsed.trigger, "cv_replaced");
  });
});

// ── readAndClearProfileUpdatePending ─────────────────────────────────────────

describe("readAndClearProfileUpdatePending — immediate progress after successful save", () => {
  test("returns the flag when present and recent", () => {
    const storage = makeStorage();
    setProfileUpdatePending("preferences_updated", storage);
    const result = readAndClearProfileUpdatePending(storage);
    assert.ok(result, "must return the flag");
    assert.strictEqual(result.trigger, "preferences_updated");
    assert.ok(typeof result.setAt === "number");
  });

  test("clears the flag after reading (idempotent read)", () => {
    const storage = makeStorage();
    setProfileUpdatePending("preferences_updated", storage);
    readAndClearProfileUpdatePending(storage);
    const second = readAndClearProfileUpdatePending(storage);
    assert.strictEqual(second, null, "flag must be gone after first read");
  });
});

describe("readAndClearProfileUpdatePending — no progress state after failed save", () => {
  test("returns null when no flag is stored", () => {
    const storage = makeStorage();
    const result = readAndClearProfileUpdatePending(storage);
    assert.strictEqual(result, null, "must return null when nothing was stored");
  });

  test("returns null for malformed JSON", () => {
    const storage = makeStorage({ [SESSION_KEY]: "not-json" });
    const result = readAndClearProfileUpdatePending(storage);
    assert.strictEqual(result, null);
  });

  test("returns null when trigger field is missing", () => {
    const storage = makeStorage({
      [SESSION_KEY]: JSON.stringify({ setAt: Date.now() }),
    });
    assert.strictEqual(readAndClearProfileUpdatePending(storage), null);
  });

  test("returns null when setAt field is missing", () => {
    const storage = makeStorage({
      [SESSION_KEY]: JSON.stringify({ trigger: "preferences_updated" }),
    });
    assert.strictEqual(readAndClearProfileUpdatePending(storage), null);
  });
});

describe("readAndClearProfileUpdatePending — refresh does not restore old completed update", () => {
  test("returns null when flag is older than MAX_AGE_MS", () => {
    const staleSetAt = Date.now() - (MAX_AGE_MS + 5_000);
    const storage = makeStorage({
      [SESSION_KEY]: JSON.stringify({ trigger: "preferences_updated", setAt: staleSetAt }),
    });
    const result = readAndClearProfileUpdatePending(storage);
    assert.strictEqual(result, null, "stale flag must be ignored");
  });

  test("still clears a stale flag from storage", () => {
    const staleSetAt = Date.now() - (MAX_AGE_MS + 5_000);
    const storage = makeStorage({
      [SESSION_KEY]: JSON.stringify({ trigger: "preferences_updated", setAt: staleSetAt }),
    });
    readAndClearProfileUpdatePending(storage);
    assert.strictEqual(storage.getItem(SESSION_KEY), null, "stale flag must be removed");
  });
});

// ── computeEffectiveTaskState ─────────────────────────────────────────────────

describe("computeEffectiveTaskState — optimistic state", () => {
  test("transition: optimistic state shows synthetic pending when taskStatus is null", () => {
    const result = computeEffectiveTaskState(null, null, "preferences_updated", false);
    assert.strictEqual(result.effectiveTaskStatus, "pending", "must synthesise pending");
    assert.strictEqual(result.effectiveTaskTrigger, "preferences_updated");
    assert.strictEqual(result.isOptimistic, true);
    assert.strictEqual(result.shouldClearOptimistic, false);
  });

  test("transition: optimistic → pending (task confirmed in DB)", () => {
    const result = computeEffectiveTaskState("pending", "preferences_updated", "preferences_updated", false);
    assert.strictEqual(result.effectiveTaskStatus, "pending");
    assert.strictEqual(result.isOptimistic, false, "no longer optimistic once task is confirmed");
    assert.strictEqual(result.shouldClearOptimistic, false);
  });

  test("transition: optimistic → processing", () => {
    const result = computeEffectiveTaskState("processing", "preferences_updated", "preferences_updated", false);
    assert.strictEqual(result.effectiveTaskStatus, "processing");
    assert.strictEqual(result.isOptimistic, false);
    assert.strictEqual(result.shouldClearOptimistic, false);
  });
});

describe("computeEffectiveTaskState — terminal states clear the optimistic flag", () => {
  test("completion clears the temporary state", () => {
    const result = computeEffectiveTaskState("completed", "preferences_updated", "preferences_updated", false);
    assert.strictEqual(result.shouldClearOptimistic, true, "completed must signal clear");
    assert.strictEqual(result.isOptimistic, false);
  });

  test("failure clears the temporary state", () => {
    const result = computeEffectiveTaskState("failed", "preferences_updated", "preferences_updated", false);
    assert.strictEqual(result.shouldClearOptimistic, true, "failed must signal clear");
    assert.strictEqual(result.isOptimistic, false);
  });

  test("no clear when optimisticTrigger is already null", () => {
    const result = computeEffectiveTaskState("completed", "preferences_updated", null, false);
    assert.strictEqual(result.shouldClearOptimistic, false);
  });
});

describe("computeEffectiveTaskState — timeout prevents infinite spinner", () => {
  test("timed-out state is not optimistic even when taskStatus is still null", () => {
    const result = computeEffectiveTaskState(null, null, "preferences_updated", true);
    assert.strictEqual(result.isOptimistic, false, "timed out → not optimistic");
    assert.strictEqual(result.effectiveTaskStatus, null, "real null status must pass through");
  });

  test("timed-out state does not synthesise pending", () => {
    const result = computeEffectiveTaskState(null, null, "preferences_updated", true);
    assert.notStrictEqual(result.effectiveTaskStatus, "pending");
  });
});

describe("computeEffectiveTaskState — no optimistic trigger", () => {
  test("passes real task status through unchanged when no optimistic trigger", () => {
    const result = computeEffectiveTaskState("pending", "cv_replaced", null, false);
    assert.strictEqual(result.effectiveTaskStatus, "pending");
    assert.strictEqual(result.effectiveTaskTrigger, "cv_replaced");
    assert.strictEqual(result.isOptimistic, false);
    assert.strictEqual(result.shouldClearOptimistic, false);
  });

  test("passes null status unchanged when no optimistic trigger", () => {
    const result = computeEffectiveTaskState(null, null, null, false);
    assert.strictEqual(result.effectiveTaskStatus, null);
    assert.strictEqual(result.isOptimistic, false);
  });
});

// ── Integration: optimistic state + deriveCvProfileState ─────────────────────

describe("old 'Ready for review' profile is not shown during the transition", () => {
  // When the user just saved preferences, the DB may still show the old
  // completed analysis as ready_for_review. The optimistic trigger must force
  // the profile state to "analyzing" so the progress panel appears instead.

  const existingAnalysis = {
    status: "completed",
    review_status: "pending_review",
    recommendations_state: "current",
  };

  test("optimistic state overrides ready_for_review via synthetic pending task", () => {
    const { effectiveTaskStatus } = computeEffectiveTaskState(
      null,
      null,
      "preferences_updated",
      false
    );
    // Simulate what CvProfileSection passes to deriveCvProfileState.
    const state = deriveCvProfileState({
      hasActiveCv: true,
      preferencesComplete: true,
      task: effectiveTaskStatus ? { status: effectiveTaskStatus } : null,
      analysis: existingAnalysis,
    });
    assert.strictEqual(
      state,
      "analyzing",
      "must show analyzing (spinner) not ready_for_review"
    );
  });

  test("once timed out, real state is used (ready_for_review returns)", () => {
    const { effectiveTaskStatus } = computeEffectiveTaskState(
      null,
      null,
      "preferences_updated",
      true // timed out
    );
    const state = deriveCvProfileState({
      hasActiveCv: true,
      preferencesComplete: true,
      task: effectiveTaskStatus ? { status: effectiveTaskStatus } : null,
      analysis: existingAnalysis,
    });
    assert.strictEqual(
      state,
      "ready_for_review",
      "after timeout, real DB state is used"
    );
  });

  test("once task confirmed as pending, analyzing state persists", () => {
    const { effectiveTaskStatus } = computeEffectiveTaskState(
      "pending",
      "preferences_updated",
      "preferences_updated",
      false
    );
    const state = deriveCvProfileState({
      hasActiveCv: true,
      preferencesComplete: true,
      task: effectiveTaskStatus ? { status: effectiveTaskStatus } : null,
      analysis: existingAnalysis,
    });
    assert.strictEqual(state, "analyzing");
  });

  test("once completed, new analysis takes over and optimistic state clears", () => {
    const { effectiveTaskStatus, shouldClearOptimistic } = computeEffectiveTaskState(
      "completed",
      "preferences_updated",
      "preferences_updated",
      false
    );
    assert.strictEqual(shouldClearOptimistic, true, "dashboard must clear optimistic trigger");

    const newAnalysis = {
      status: "completed",
      review_status: "pending_review",
      recommendations_state: "current",
    };
    const state = deriveCvProfileState({
      hasActiveCv: true,
      preferencesComplete: true,
      // After clearing optimistic trigger: task is completed (not active), no optimistic
      task: { status: effectiveTaskStatus },
      analysis: newAnalysis,
    });
    // completed task is not active → deriveCvProfileState falls through to analysis
    assert.strictEqual(state, "ready_for_review");
  });
});
