// Coverage for the re-analysis / retry-eligibility policy added by
// supabase/migrations/20260924140000_add_source_intelligence_retry_eligibility.sql
// — fixes "Source Intelligence behaves like analyze-once-forever": a
// transient fetch failure (429/5xx/timeout/network error) used to
// permanently exclude a source from ever being reselected, exactly like a
// genuine permanent finding. This file proves the corrected model:
//
//   ELIGIBLE when either
//     A. never analyzed at all, OR
//     B. the LATEST observation is ingestion_type='needs_investigation'
//        AND retryable=true AND analyzed_at is more than 3 days old
//
// A successful classification (ats_adapter/html/custom_parser) and a
// structural needs_investigation result (retryable=false/NULL) are never
// auto-retried, regardless of how much time has passed — permanence is
// still correct for those, only the transient case changed.
//
// Timing is exercised by inserting fixture rows with an explicit,
// backdated `analyzed_at` rather than waiting real days.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject } from "./helpers.mjs";

const fixtureCompanyIds = new Set();
const fixtureSourceIds = new Set();

after(async () => {
  if (fixtureSourceIds.size > 0) {
    await adminClient.from("source_intelligence").delete().in("source_id", [...fixtureSourceIds]);
    const { error } = await adminClient.from("company_sources").delete().in("id", [...fixtureSourceIds]);
    if (error) throw new Error(`cleanup: failed to delete fixture company_sources: ${error.message}`);
  }
  if (fixtureCompanyIds.size > 0) {
    const { error } = await adminClient.from("companies").delete().in("id", [...fixtureCompanyIds]);
    if (error) throw new Error(`cleanup: failed to delete fixture companies: ${error.message}`);
  }
});

async function createFixtureSource(label, overrides = {}) {
  const suffix = randomUUID().slice(0, 8);
  const companyId = `cc-siretry-${label}-${suffix}`;
  const sourceId = `sr-siretry-${label}-${suffix}`;

  const { error: companyError } = await adminClient.from("companies").insert({ id: companyId, display_name: `SI Retry Probe ${label} ${suffix}` });
  if (companyError) throw new Error(`fixture company insert failed: ${companyError.message}`);
  fixtureCompanyIds.add(companyId);

  const { error: sourceError } = await adminClient.from("company_sources").insert({
    id: sourceId,
    company_id: companyId,
    company_name: `SI Retry Probe ${label} ${suffix}`,
    target_country: "Lebanon",
    country_code: "LB",
    review_status: "needs_manual_review",
    ats_provider: "unknown",
    automation_eligibility: "unknown",
    ...overrides,
  });
  if (sourceError) throw new Error(`fixture company_sources insert failed: ${sourceError.message}`);
  fixtureSourceIds.add(sourceId);

  return sourceId;
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

async function insertObservation(sourceId, overrides = {}) {
  const row = {
    source_id: sourceId,
    run_id: randomUUID(),
    detected_provider: "unknown",
    ingestion_type: "needs_investigation",
    confidence: "low",
    retryable: null,
    evidence: { probe: true },
    analyzed_at: new Date().toISOString(),
    ...overrides,
  };
  const { error } = await adminClient.from("source_intelligence").insert(row);
  if (error) throw new Error(`fixture source_intelligence insert failed: ${error.message}`);
}

async function isCandidate(sourceId) {
  const { data, error } = await adminClient.rpc("get_source_intelligence_candidates", { p_limit: 1000 });
  if (error) throw new Error(`get_source_intelligence_candidates failed: ${error.message}`);
  return data.find((c) => c.source.id === sourceId) ?? null;
}

// ── 1. Never-analyzed unknown source is selected ───────────────────────────

test("a never-analyzed unknown source is selected, with selection_reason=never_analyzed", async () => {
  await assertExpectedLocalProject();
  const sourceId = await createFixtureSource("never-analyzed");
  const candidate = await isCandidate(sourceId);
  assert.ok(candidate, "must be a candidate");
  assert.equal(candidate.selection_reason, "never_analyzed");
  assert.equal(candidate.previous_ingestion_type, null);
});

// ── 2. Successful stable classification is not unnecessarily re-selected ──

test("a successful classification (ats_adapter) is never re-selected, no matter how old", async () => {
  const sourceId = await createFixtureSource("stable-success");
  await insertObservation(sourceId, {
    detected_provider: "greenhouse", ingestion_type: "ats_adapter", confidence: "medium", retryable: null,
    analyzed_at: daysAgo(365),
  });
  assert.equal(await isCandidate(sourceId), null, "a successful classification must never become eligible again, regardless of age");
});

test("a successful classification (html) is never re-selected", async () => {
  const sourceId = await createFixtureSource("stable-html");
  await insertObservation(sourceId, { detected_provider: "unknown", ingestion_type: "html", confidence: "low", retryable: null, analyzed_at: daysAgo(365) });
  assert.equal(await isCandidate(sourceId), null);
});

// ── 3/4. 429 becomes eligible after backoff, not before ────────────────────

test("a 429 (retryable) result becomes eligible again once its 3-day backoff has elapsed", async () => {
  const sourceId = await createFixtureSource("429-past-backoff");
  await insertObservation(sourceId, {
    ingestion_type: "needs_investigation", retryable: true,
    evidence: { detection_method: "fetch_blocked_or_error_status", http_status: 429 },
    analyzed_at: daysAgo(4),
  });
  const candidate = await isCandidate(sourceId);
  assert.ok(candidate, "must be eligible again past the 3-day backoff");
  assert.equal(candidate.selection_reason, "retry_after_backoff");
  assert.equal(candidate.previous_ingestion_type, "needs_investigation");
});

test("a 429 (retryable) result is NOT eligible before its backoff expires", async () => {
  const sourceId = await createFixtureSource("429-before-backoff");
  await insertObservation(sourceId, {
    ingestion_type: "needs_investigation", retryable: true,
    evidence: { detection_method: "fetch_blocked_or_error_status", http_status: 429 },
    analyzed_at: daysAgo(1),
  });
  assert.equal(await isCandidate(sourceId), null, "must not be eligible before the 3-day backoff elapses");
});

// ── 5. Temporary 5xx becomes eligible later ────────────────────────────────

test("a temporary 5xx (retryable) result becomes eligible after backoff", async () => {
  const sourceId = await createFixtureSource("5xx-past-backoff");
  await insertObservation(sourceId, {
    ingestion_type: "needs_investigation", retryable: true,
    evidence: { detection_method: "fetch_blocked_or_error_status", http_status: 503 },
    analyzed_at: daysAgo(5),
  });
  assert.ok(await isCandidate(sourceId));
});

// ── 6. Timeout/network failure becomes eligible later ──────────────────────

test("a network error / timeout (retryable) result becomes eligible after backoff", async () => {
  const sourceId = await createFixtureSource("network-error-past-backoff");
  await insertObservation(sourceId, {
    ingestion_type: "needs_investigation", retryable: true,
    evidence: { detection_method: "fetch_network_error", http_status: null },
    analyzed_at: daysAgo(4),
  });
  assert.ok(await isCandidate(sourceId));
});

// ── 7. Structural/manual-review result does not retry every day ───────────

test("a structural (retryable=false) result is never re-selected, even after a very long time", async () => {
  const sourceId = await createFixtureSource("structural-old");
  await insertObservation(sourceId, {
    ingestion_type: "needs_investigation", retryable: false,
    evidence: { detection_method: "fetch_blocked_or_error_status", http_status: 404 },
    analyzed_at: daysAgo(90),
  });
  assert.equal(await isCandidate(sourceId), null, "structural results must stay excluded regardless of elapsed time");
});

// ── 8. No-URL result follows the intended (structural, non-retryable) policy ──

test("a no-URL result (structural) is never re-selected", async () => {
  const sourceId = await createFixtureSource("no-url");
  await insertObservation(sourceId, {
    ingestion_type: "needs_investigation", retryable: false,
    evidence: { detection_method: "no_public_url_available", checked_url: null, http_status: null },
    analyzed_at: daysAgo(90),
  });
  assert.equal(await isCandidate(sourceId), null);
});

// ── 9/10. Multiple observations preserve history; latest wins deterministically ──

test("a source can accumulate multiple observations over time — none are overwritten or deleted", async () => {
  const sourceId = await createFixtureSource("history-preserved");
  await insertObservation(sourceId, { ingestion_type: "needs_investigation", retryable: true, analyzed_at: daysAgo(10) });
  await insertObservation(sourceId, { ingestion_type: "needs_investigation", retryable: true, analyzed_at: daysAgo(6) });
  await insertObservation(sourceId, { ingestion_type: "needs_investigation", retryable: true, analyzed_at: daysAgo(2) });

  const { data, error } = await adminClient.from("source_intelligence").select("analyzed_at").eq("source_id", sourceId);
  assert.equal(error, null);
  assert.equal(data.length, 3, "all three historical observations must still exist");
});

test("eligibility reflects the LATEST observation, not an older one — an old retryable row does not matter once superseded by a newer structural row", async () => {
  const sourceId = await createFixtureSource("latest-wins-structural");
  await insertObservation(sourceId, { ingestion_type: "needs_investigation", retryable: true, analyzed_at: daysAgo(10) });
  await insertObservation(sourceId, { ingestion_type: "needs_investigation", retryable: false, analyzed_at: daysAgo(1) });
  assert.equal(await isCandidate(sourceId), null, "the newer structural (non-retryable) row must govern, not the older retryable one");
});

test("eligibility reflects the LATEST observation — an old structural row does not block a newer retryable one from its own backoff", async () => {
  const sourceId = await createFixtureSource("latest-wins-retryable");
  await insertObservation(sourceId, { ingestion_type: "needs_investigation", retryable: false, analyzed_at: daysAgo(10) });
  await insertObservation(sourceId, { ingestion_type: "needs_investigation", retryable: true, analyzed_at: daysAgo(5) });
  const candidate = await isCandidate(sourceId);
  assert.ok(candidate, "the newer retryable row (past its own backoff) must govern");
  assert.equal(candidate.previous_analyzed_at !== null, true);
});

// ── 11/12. Same logical attempt / concurrent executions cannot duplicate ──

test("a same-day retry attempt for a source still eligible does not insert a duplicate row for that day", async () => {
  const sourceId = await createFixtureSource("same-day-retry-guard");
  await insertObservation(sourceId, { ingestion_type: "needs_investigation", retryable: true, analyzed_at: daysAgo(4) });
  assert.ok(await isCandidate(sourceId), "sanity: eligible before the second attempt");

  // A second "analysis attempt" landing on the SAME day as the first must
  // still be rejected by the day-scoped unique index, exactly like before
  // retry was introduced — retry only ever creates a genuinely NEW day's
  // row, never a second row for a day that already has one.
  const { error } = await adminClient.from("source_intelligence").insert({
    source_id: sourceId, run_id: randomUUID(), detected_provider: "unknown",
    ingestion_type: "needs_investigation", confidence: "low", retryable: true,
    evidence: {}, analyzed_at: daysAgo(4),
  });
  assert.notEqual(error, null, "a second insert for the same source on the same UTC day must be rejected");
});

test("two concurrent re-analysis attempts for the same eligible source cannot both insert an observation for today", async () => {
  const sourceId = await createFixtureSource("concurrent-retry");
  await insertObservation(sourceId, { ingestion_type: "needs_investigation", retryable: true, analyzed_at: daysAgo(4) });

  const results = await Promise.allSettled([
    adminClient.from("source_intelligence").insert({ source_id: sourceId, run_id: randomUUID(), detected_provider: "greenhouse", ingestion_type: "ats_adapter", confidence: "high", retryable: null, evidence: {}, analyzed_at: new Date().toISOString() }),
    adminClient.from("source_intelligence").insert({ source_id: sourceId, run_id: randomUUID(), detected_provider: "unknown", ingestion_type: "needs_investigation", confidence: "low", retryable: true, evidence: {}, analyzed_at: new Date().toISOString() }),
  ]);
  const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.error === null);
  assert.equal(succeeded.length, 1, "only one of two concurrent executions analyzing the same source today may succeed");

  const { count } = await adminClient.from("source_intelligence").select("id", { count: "exact", head: true }).eq("source_id", sourceId).gte("analyzed_at", daysAgo(1));
  assert.equal(count, 1);
});

// ── 13. Later successful analysis after transient failure triggers promotion ──

test("a transient failure followed by a later high-confidence classification promotes correctly", async () => {
  const sourceId = await createFixtureSource("transient-then-promoted");

  // Day -4: a 503, retryable.
  await insertObservation(sourceId, {
    ingestion_type: "needs_investigation", retryable: true,
    evidence: { detection_method: "fetch_blocked_or_error_status", http_status: 503 },
    analyzed_at: daysAgo(4),
  });
  assert.ok(await isCandidate(sourceId), "sanity: eligible for re-analysis after the transient failure");

  // Today: the site recovered — a real high-confidence Greenhouse hit.
  await insertObservation(sourceId, {
    detected_provider: "greenhouse", ingestion_type: "ats_adapter", confidence: "high", retryable: null,
    evidence: { matched_signal: "boards-api.greenhouse.io" },
    analyzed_at: new Date().toISOString(),
  });

  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].promoted, true);
  assert.equal(data[0].resulting_ats_provider, "greenhouse");
  assert.equal(data[0].resulting_automation_eligibility, "suitable_public_ats");

  const { data: source } = await adminClient.from("company_sources").select("ats_provider, automation_eligibility").eq("id", sourceId).single();
  assert.equal(source.ats_provider, "greenhouse");
  assert.equal(source.automation_eligibility, "suitable_public_ats");

  // Both historical rows must still exist — the transient failure was
  // never overwritten, only superseded.
  const { count } = await adminClient.from("source_intelligence").select("id", { count: "exact", head: true }).eq("source_id", sourceId);
  assert.equal(count, 2);
});

// ── 14. Already-promoted source is not incorrectly reprocessed ────────────

test("an already-promoted source (both fields resolved) is never selected again, even though its own observation would otherwise look retryable-adjacent", async () => {
  const sourceId = await createFixtureSource("already-promoted");
  await insertObservation(sourceId, {
    detected_provider: "lever", ingestion_type: "ats_adapter", confidence: "high", retryable: null,
    analyzed_at: new Date().toISOString(),
  });
  const { error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);

  assert.equal(await isCandidate(sourceId), null, "a fully-promoted source must never be reselected — both ats_provider and automation_eligibility are no longer unknown");
});
