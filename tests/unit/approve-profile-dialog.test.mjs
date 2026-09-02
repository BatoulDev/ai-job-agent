// Unit tests for the ApproveProfileDialog UX fix (Automation-1 audit,
// "confirmed approval-dialog UX" item): the dialog previously never closed
// itself on success — it stayed open showing a success message with the
// original Cancel/Approve Profile buttons still active, reproduced live.
//
// These tests verify the state-machine logic that drives handleConfirm/
// handleClose without requiring a DOM/React test environment (see
// tests/unit/ai-career-profile-popup.test.mjs for the same convention
// already used in this area of the codebase). The functions below mirror
// src/components/dashboard/cvProfile/ApproveProfileDialog.tsx exactly.
//
// Run: node --test tests/unit/approve-profile-dialog.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── Inline mirror of ApproveProfileDialog's state machine ──────────────────

function createDialogHarness() {
  let isSubmitting = false;
  let errorNotice = null;
  let closed = false;
  let approvedNotice = null;

  async function handleConfirm(onConfirm) {
    if (isSubmitting) return "ignored-duplicate-click";
    isSubmitting = true;
    errorNotice = null;

    const result = await onConfirm();
    isSubmitting = false;

    if (result.ok) {
      errorNotice = null;
      closed = true;
      approvedNotice = result.message ?? "Your profile has been approved.";
      return "approved";
    }

    errorNotice = result.message ?? "Something went wrong. Please try again.";
    return "rejected";
  }

  function handleClose() {
    if (isSubmitting) return "ignored-close-while-submitting";
    errorNotice = null;
    closed = true;
    return "closed";
  }

  return {
    handleConfirm,
    handleClose,
    get isSubmitting() {
      return isSubmitting;
    },
    get errorNotice() {
      return errorNotice;
    },
    get closed() {
      return closed;
    },
    get approvedNotice() {
      return approvedNotice;
    },
  };
}

describe("ApproveProfileDialog state machine", () => {
  test("on success: dialog closes itself and hands the parent a success message", async () => {
    const dialog = createDialogHarness();
    const outcome = await dialog.handleConfirm(async () => ({ ok: true, message: "Your profile has been approved." }));

    assert.equal(outcome, "approved");
    assert.equal(dialog.closed, true, "dialog must close automatically on success");
    assert.equal(dialog.approvedNotice, "Your profile has been approved.");
    assert.equal(dialog.errorNotice, null, "no error notice should remain inside a closed dialog");
    assert.equal(dialog.isSubmitting, false);
  });

  test("on failure: dialog stays open, shows the error, and can be retried", async () => {
    const dialog = createDialogHarness();
    const outcome = await dialog.handleConfirm(async () => ({ ok: false, message: "This analysis no longer reflects your latest preferences." }));

    assert.equal(outcome, "rejected");
    assert.equal(dialog.closed, false, "dialog must stay open on failure so the user can retry or cancel");
    assert.equal(dialog.errorNotice, "This analysis no longer reflects your latest preferences.");
    assert.equal(dialog.approvedNotice, null);
  });

  test("a second click while submitting is ignored (no duplicate confirm calls)", async () => {
    const dialog = createDialogHarness();
    let confirmCallCount = 0;
    let resolveFirst;
    const firstCallPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    const onConfirm = async () => {
      confirmCallCount += 1;
      await firstCallPromise;
      return { ok: true };
    };

    const firstHandle = dialog.handleConfirm(onConfirm);
    // A duplicate click while the first request is still in flight.
    const secondOutcome = await dialog.handleConfirm(onConfirm);
    assert.equal(secondOutcome, "ignored-duplicate-click");

    resolveFirst();
    await firstHandle;

    assert.equal(confirmCallCount, 1, "onConfirm must only ever be called once for one approval");
  });

  test("Escape/backdrop-close (handleClose) is ignored while a request is in flight", async () => {
    const dialog = createDialogHarness();
    let resolveConfirm;
    const confirmPromise = new Promise((resolve) => {
      resolveConfirm = resolve;
    });

    const handlePromise = dialog.handleConfirm(() => confirmPromise);
    const closeOutcome = dialog.handleClose();
    assert.equal(closeOutcome, "ignored-close-while-submitting");
    assert.equal(dialog.closed, false);

    resolveConfirm({ ok: true, message: "Approved." });
    await handlePromise;
    assert.equal(dialog.closed, true, "the dialog can close normally once the request finishes");
  });

  test("handleClose works normally when nothing is in flight", () => {
    const dialog = createDialogHarness();
    const outcome = dialog.handleClose();
    assert.equal(outcome, "closed");
    assert.equal(dialog.closed, true);
  });
});
