import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkJobFreshness,
  RECENT_CONFIRMATION_WINDOW_DAYS,
  FALLBACK_PUBLISHED_WINDOW_DAYS,
} from "../../src/lib/matching/jobFreshness.ts";

const NOW = new Date("2026-10-17T12:00:00Z");
function daysAgo(n) {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

function base(overrides = {}) {
  return { publishedAt: null, lastSeenAt: null, expiresAt: null, closingDate: null, createdAt: NOW.toISOString(), ...overrides };
}

test("a recently re-confirmed job is fresh", () => {
  const result = checkJobFreshness(base({ lastSeenAt: daysAgo(2), publishedAt: daysAgo(2) }), NOW);
  assert.deepEqual(result, { fresh: true, reason: "fresh_confirmed" });
});

test("an explicitly expired job (expires_at passed) is excluded, even if recently seen", () => {
  const result = checkJobFreshness(base({ lastSeenAt: daysAgo(1), expiresAt: daysAgo(1) }), NOW);
  assert.deepEqual(result, { fresh: false, reason: "expired" });
});

test("an explicit closing_date in the past excludes the job, even if recently seen", () => {
  const result = checkJobFreshness(base({ lastSeenAt: daysAgo(1), closingDate: daysAgo(1) }), NOW);
  assert.deepEqual(result, { fresh: false, reason: "closing_date_passed" });
});

test("a future expires_at/closing_date never excludes", () => {
  const future = new Date(NOW.getTime() + 30 * 86_400_000).toISOString();
  const result = checkJobFreshness(base({ lastSeenAt: daysAgo(1), expiresAt: future, closingDate: future }), NOW);
  assert.equal(result.fresh, true);
});

test("a job unconfirmed for longer than the recent-confirmation window is stale", () => {
  const result = checkJobFreshness(base({ lastSeenAt: daysAgo(RECENT_CONFIRMATION_WINDOW_DAYS + 1), publishedAt: daysAgo(200) }), NOW);
  assert.deepEqual(result, { fresh: false, reason: "stale_unconfirmed" });
});

test("a job last confirmed exactly at the recent-confirmation window boundary is still fresh (inclusive)", () => {
  const result = checkJobFreshness(base({ lastSeenAt: daysAgo(RECENT_CONFIRMATION_WINDOW_DAYS) }), NOW);
  assert.equal(result.fresh, true);
});

test("an old posting (by published_at) that is still reconfirmed recently remains eligible — real evergreen-posting case", () => {
  const result = checkJobFreshness(base({ lastSeenAt: daysAgo(3), publishedAt: daysAgo(180) }), NOW);
  assert.deepEqual(result, { fresh: true, reason: "fresh_confirmed" });
});

test("null last_seen_at falls back to published_at within the fallback window", () => {
  const result = checkJobFreshness(base({ lastSeenAt: null, publishedAt: daysAgo(10) }), NOW);
  assert.deepEqual(result, { fresh: true, reason: "fresh_published_fallback" });
});

test("null last_seen_at with published_at beyond the fallback window is stale", () => {
  const result = checkJobFreshness(base({ lastSeenAt: null, publishedAt: daysAgo(FALLBACK_PUBLISHED_WINDOW_DAYS + 1) }), NOW);
  assert.deepEqual(result, { fresh: false, reason: "stale_unconfirmed" });
});

test("published_at is never a rescue once last_seen_at itself is stale (fallback applies only when last_seen_at is absent)", () => {
  const result = checkJobFreshness(base({ lastSeenAt: daysAgo(RECENT_CONFIRMATION_WINDOW_DAYS + 5), publishedAt: daysAgo(1) }), NOW);
  assert.deepEqual(result, { fresh: false, reason: "stale_unconfirmed" });
});

test("null published_at AND null last_seen_at falls back to created_at (e.g. a freshly admin-entered job)", () => {
  const result = checkJobFreshness(base({ lastSeenAt: null, publishedAt: null, createdAt: daysAgo(1) }), NOW);
  assert.deepEqual(result, { fresh: true, reason: "fresh_published_fallback" });
});

test("null published_at AND null last_seen_at AND an old created_at is stale", () => {
  const result = checkJobFreshness(base({ lastSeenAt: null, publishedAt: null, createdAt: daysAgo(FALLBACK_PUBLISHED_WINDOW_DAYS + 1) }), NOW);
  assert.deepEqual(result, { fresh: false, reason: "stale_unconfirmed" });
});
