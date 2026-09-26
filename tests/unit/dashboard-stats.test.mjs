// Unit tests for src/lib/dashboardData.ts's computeDashboardStats (Phase 07).
// Pure logic, no DB, no network.
//
// Run: node --test tests/unit/dashboard-stats.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeDashboardStats } from "../../src/lib/dashboardData.ts";

function statValue(stats, label) {
  return stats.find((s) => s.label === label)?.value;
}

describe("computeDashboardStats", () => {
  test("shows zero matches and a dash average when there are none", () => {
    const stats = computeDashboardStats([]);
    assert.equal(statValue(stats, "New matches"), "0");
    assert.equal(statValue(stats, "Average match score"), "—");
  });

  test("shows zero matches and a dash average when null (not yet loaded)", () => {
    const stats = computeDashboardStats(null);
    assert.equal(statValue(stats, "New matches"), "0");
    assert.equal(statValue(stats, "Average match score"), "—");
  });

  test("computes count and rounded average score from real matches", () => {
    const stats = computeDashboardStats([{ score: 90 }, { score: 65 }, { score: 70 }]);
    assert.equal(statValue(stats, "New matches"), "3");
    assert.equal(statValue(stats, "Average match score"), "75%");
  });

  test("cover letters and applications stay zero — no worker built yet", () => {
    const stats = computeDashboardStats([{ score: 90 }]);
    assert.equal(statValue(stats, "Cover letters ready"), "0");
    assert.equal(statValue(stats, "Applications sent"), "0");
  });
});
