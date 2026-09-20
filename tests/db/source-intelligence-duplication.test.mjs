// Regression coverage for the confirmed source_intelligence duplication
// incident (2026-09-20): the first-ever scheduled ('trigger' mode)
// execution of the Source Intelligence Analyzer re-classified 10 sources an
// earlier manual execution had already classified, because
// source_intelligence carried no uniqueness guarantee on source_id at all —
// proven directly (see the investigation notes) by two concurrent inserts
// for the same fresh source_id both succeeding today.
//
// supabase/migrations/20260920100000_add_source_intelligence_source_id_
// unique.sql adds the fix (UNIQUE(source_id)), but is deliberately NOT
// applied to this shared local dev database yet: it cannot be — the
// database still carries the 10 real duplicate pairs from the incident,
// untouched, pending a separate, explicitly human-approved cleanup
// decision (see the investigation report). A plain CREATE UNIQUE INDEX
// cannot be created over data that currently violates it.
//
// This file therefore describes the CORRECT, POST-FIX behavior and is
// expected to be partially red until that cleanup + migration land — the
// tests marked "REQUIRES MIGRATION" below will fail today for exactly that
// reason (both concurrent inserts currently succeed) and will pass the
// moment the pending migration is applied, with no test-file change
// needed. This is intentional, not a masked gap: a test describing the
// current, still-vulnerable behavior would become wrong the instant the
// fix lands, so none is included here — see the investigation report for
// the one-time, already-run proof that the vulnerability is real today.
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
  const companyId = `cc-siprobe-${label}-${suffix}`;
  const sourceId = `sr-siprobe-${label}-${suffix}`;

  const { error: companyError } = await adminClient.from("companies").insert({ id: companyId, display_name: `SI Probe ${label} ${suffix}` });
  if (companyError) throw new Error(`fixture company insert failed: ${companyError.message}`);
  fixtureCompanyIds.add(companyId);

  const { error: sourceError } = await adminClient.from("company_sources").insert({
    id: sourceId,
    company_id: companyId,
    company_name: `SI Probe ${label} ${suffix}`,
    target_country: "Lebanon",
    country_code: "LB",
    review_status: "needs_manual_review",
    ats_provider: "unknown",
    ...overrides,
  });
  if (sourceError) throw new Error(`fixture company_sources insert failed: ${sourceError.message}`);
  fixtureSourceIds.add(sourceId);

  return sourceId;
}

function classification(sourceId, overrides = {}) {
  return {
    source_id: sourceId,
    run_id: randomUUID(),
    detected_provider: "unknown",
    ingestion_type: "needs_investigation",
    confidence: "low",
    evidence: { probe: true },
    ...overrides,
  };
}

// ── 1. First analysis of a new source succeeds ────────────────────────────

test("first analysis of a new source succeeds", async () => {
  await assertExpectedLocalProject();
  const sourceId = await createFixtureSource("first-analysis");
  const { error } = await adminClient.from("source_intelligence").insert(classification(sourceId));
  assert.equal(error, null);

  const { count } = await adminClient.from("source_intelligence").select("id", { count: "exact", head: true }).eq("source_id", sourceId);
  assert.equal(count, 1);
});

// ── 2. Candidate selection excludes an already-analyzed source ───────────

test("get_source_intelligence_candidates excludes a source that already has a classification", async () => {
  const sourceId = await createFixtureSource("already-classified", { ats_provider: "unknown" });

  const before = await adminClient.rpc("get_source_intelligence_candidates", { p_limit: 1000 });
  assert.ok(before.data.some((c) => c.id === sourceId), "must be a candidate before any classification exists");

  const { error } = await adminClient.from("source_intelligence").insert(classification(sourceId));
  assert.equal(error, null);

  const after = await adminClient.rpc("get_source_intelligence_candidates", { p_limit: 1000 });
  assert.ok(!after.data.some((c) => c.id === sourceId), "must no longer be a candidate once classified");
});

// ── 3. REQUIRES MIGRATION — concurrent attempts cannot duplicate ─────────

test("REQUIRES MIGRATION 20260920100000: two concurrent classification attempts for the same source produce exactly one row", async () => {
  const sourceId = await createFixtureSource("concurrent");

  const results = await Promise.allSettled([
    adminClient.from("source_intelligence").insert(classification(sourceId)),
    adminClient.from("source_intelligence").insert(classification(sourceId)),
  ]);
  const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.error === null);

  assert.equal(
    succeeded.length,
    1,
    "exactly one of two concurrent classification attempts for the same source must succeed — " +
      "this fails today because supabase/migrations/20260920100000_add_source_intelligence_source_id_unique.sql " +
      "has not been applied to this database yet (it cannot be, until the 10 real duplicate rows from the " +
      "2026-09-20 incident are cleaned up — see the investigation report). It will pass unmodified once that " +
      "migration is live."
  );

  const { count } = await adminClient.from("source_intelligence").select("id", { count: "exact", head: true }).eq("source_id", sourceId);
  assert.equal(count, 1);
});

// ── 4. REQUIRES MIGRATION — a sequential retry cannot duplicate ──────────

test("REQUIRES MIGRATION 20260920100000: a retried classification attempt for an already-classified source does not duplicate the row", async () => {
  const sourceId = await createFixtureSource("retry");

  const first = await adminClient.from("source_intelligence").insert(classification(sourceId));
  assert.equal(first.error, null);

  // Simulates a retry (e.g. the n8n write node re-attempting after a
  // transient network error, believing the first write may not have
  // landed) -- same source_id, a fresh run_id, sent again afterward.
  const retry = await adminClient.from("source_intelligence").insert(classification(sourceId));
  assert.notEqual(retry.error, null, "a retried insert for an already-classified source must be rejected, not silently duplicated");

  const { count } = await adminClient.from("source_intelligence").select("id", { count: "exact", head: true }).eq("source_id", sourceId);
  assert.equal(count, 1);
});

// ── 5. Two different sources still work normally ─────────────────────────

test("two different sources can each be classified independently, with no cross-interference", async () => {
  const sourceA = await createFixtureSource("independent-a");
  const sourceB = await createFixtureSource("independent-b");

  const [a, b] = await Promise.all([
    adminClient.from("source_intelligence").insert(classification(sourceA)),
    adminClient.from("source_intelligence").insert(classification(sourceB)),
  ]);
  assert.equal(a.error, null);
  assert.equal(b.error, null);

  const { count: countA } = await adminClient.from("source_intelligence").select("id", { count: "exact", head: true }).eq("source_id", sourceA);
  const { count: countB } = await adminClient.from("source_intelligence").select("id", { count: "exact", head: true }).eq("source_id", sourceB);
  assert.equal(countA, 1);
  assert.equal(countB, 1);
});

// ── 6. A newly created Registry Sync source becomes a candidate ──────────

test("a company_sources row created with ats_provider='unknown' (Registry Sync's own default) is a Source Intelligence candidate", async () => {
  const sourceId = await createFixtureSource("registry-sync-shaped", { ats_provider: "unknown", automation_eligibility: "unknown" });

  const { data: candidates, error } = await adminClient.rpc("get_source_intelligence_candidates", { p_limit: 1000 });
  assert.equal(error, null);
  assert.ok(candidates.some((c) => c.id === sourceId));
});

// ── 7. Registry Sync never writes source_intelligence itself ─────────────

test("resolve_registry_candidate never inserts into source_intelligence", async () => {
  const name = `SI RS Probe ${randomUUID().slice(0, 8)}`;
  const { data, error } = await adminClient.rpc("resolve_registry_candidate", {
    p_discovery_source: "apify",
    p_company_name: name,
    p_country_code: "LB",
    p_official_careers_url: `https://${randomUUID()}.example/careers`,
    p_raw_payload: {},
  });
  assert.equal(error, null);
  const result = data[0];
  assert.equal(result.outcome, "created_new");
  fixtureCompanyIds.add(result.out_company_id);
  fixtureSourceIds.add(result.out_source_id);

  const { count } = await adminClient.from("source_intelligence").select("id", { count: "exact", head: true }).eq("source_id", result.out_source_id);
  assert.equal(count, 0);
});

// ── 8. Existing classification behavior remains valid ────────────────────

test("a source_intelligence row still records evidence, detected_provider, ingestion_type, and confidence as before", async () => {
  const sourceId = await createFixtureSource("shape-unchanged");
  const { data, error } = await adminClient
    .from("source_intelligence")
    .insert(classification(sourceId, { detected_provider: "greenhouse", ingestion_type: "ats_adapter", confidence: "high", evidence: { matched_signal: "boards-api.greenhouse.io" } }))
    .select()
    .single();
  assert.equal(error, null);
  assert.equal(data.detected_provider, "greenhouse");
  assert.equal(data.ingestion_type, "ats_adapter");
  assert.equal(data.confidence, "high");
  assert.deepEqual(data.evidence, { matched_signal: "boards-api.greenhouse.io" });
});

// ── RLS unaffected by this change ─────────────────────────────────────────

test("service_role retains select+insert on source_intelligence; the new unique index changes no grant", async () => {
  const sourceId = await createFixtureSource("grants-unchanged");
  const { error: insertError } = await adminClient.from("source_intelligence").insert(classification(sourceId));
  assert.equal(insertError, null);
  const { error: selectError } = await adminClient.from("source_intelligence").select("id").eq("source_id", sourceId);
  assert.equal(selectError, null);
});
