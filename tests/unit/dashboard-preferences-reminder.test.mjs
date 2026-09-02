// Unit tests for src/lib/dashboardPreferencesReminder.ts — the sessionStorage
// flag gating how often Dashboard shows the "complete your job preferences"
// reminder modal (src/components/dashboard/PreferencesReminderModal.tsx).
//
// Run: node --experimental-strip-types --test tests/unit/dashboard-preferences-reminder.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  hasShownPreferencesReminder,
  markPreferencesReminderShown,
  clearPreferencesReminderShown,
} from "../../src/lib/dashboardPreferencesReminder.ts";

function makeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = value; },
    removeItem: (key) => { delete store[key]; },
    _store: store,
  };
}

describe("hasShownPreferencesReminder / markPreferencesReminderShown", () => {
  test("returns false before anything has been marked", () => {
    const storage = makeStorage();
    assert.equal(hasShownPreferencesReminder("user-1", storage), false);
  });

  test("returns true for the same user id after marking", () => {
    const storage = makeStorage();
    markPreferencesReminderShown("user-1", storage);
    assert.equal(hasShownPreferencesReminder("user-1", storage), true);
  });

  test("a different user id on the same storage is never suppressed by another account's flag", () => {
    const storage = makeStorage();
    markPreferencesReminderShown("user-1", storage);
    assert.equal(hasShownPreferencesReminder("user-2", storage), false);
  });

  test("clearPreferencesReminderShown resets the flag so a new login can show the reminder again", () => {
    const storage = makeStorage();
    markPreferencesReminderShown("user-1", storage);
    clearPreferencesReminderShown(storage);
    assert.equal(hasShownPreferencesReminder("user-1", storage), false);
  });

  test("degrades gracefully (never throws) when storage access throws", () => {
    const throwingStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    assert.doesNotThrow(() => markPreferencesReminderShown("user-1", throwingStorage));
    assert.equal(hasShownPreferencesReminder("user-1", throwingStorage), false);
    assert.doesNotThrow(() => clearPreferencesReminderShown(throwingStorage));
  });
});
