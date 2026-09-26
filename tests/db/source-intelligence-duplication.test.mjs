// Regression coverage for the confirmed source_intelligence duplication
// incident (2026-09-20): the first-ever scheduled ('trigger' mode)
// execution of the Source Intelligence Analyzer re-classified 10 sources an
// earlier manual execution had already classified, because
// source_intelligence carried no uniqueness guarantee on source_id at all —
// proven directly (see the investigation notes) by two concurrent inserts
// for the same fresh source_id both succeeding today.
//
// supabase/migrations/20260920100000_add_source_intelligence_source_id_
// unique.sql (UNIQUE(source_id), now applied and verified here) closed
// that gap — but made re-analysis structurally impossible (at most one
// row per source, ever), which was then identified as its own separate
// architecture gap (a transient 429/5xx/timeout wrongly excluded a source
// from re-analysis forever, exactly like a genuine permanent finding).
//
// supabase/migrations/20260924140000_add_source_intelligence_retry_
// eligibility.sql replaced that absolute constraint with UNIQUE(source_id,
// day) — at most one observation per source per UTC calendar day, not
// per source ever. Tests 3 and 4 below (still named after the original
// migration for history) now exercise that DAY-SCOPED protection: two
// inserts for the same source within the same test run necessarily land
// on the same UTC day, so the same-instant/same-day duplicate-prevention
// behavior they describe is unchanged in observable outcome — only the
// underlying mechanism changed. A LEGITIMATE retry occurring >= 3 days
// later (the real, intended way a second row now gets created) is NOT
// exercised here — see tests/db/source-intelligence-retry-eligibility.test.mjs
// for that.
//
// get_source_intelligence_candidates() also changed return shape
// (20260924140000): each row is now `{ source: {...company_sources...},
// selection_reason, previous_ingestion_type, previous_confidence,
// previous_analyzed_at }` instead of a flat company_sources row — tests 2
// and 6 below read `.source.id` accordingly.
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

test("get_source_intelligence_candidates excludes a source whose latest classification is not retryable", async () => {
  const sourceId = await createFixtureSource("already-classified", { ats_provider: "unknown" });

  const before = await adminClient.rpc("get_source_intelligence_candidates", { p_limit: 1000 });
  assert.ok(before.data.some((c) => c.source.id === sourceId), "must be a candidate before any classification exists");

  // classification()'s default shape carries no `retryable` field, so this
  // inserts retryable=NULL — treated as non-retryable/structural, exactly
  // like a genuine successful or structural classification would be.
  const { error } = await adminClient.from("source_intelligence").insert(classification(sourceId));
  assert.equal(error, null);

  const after = await adminClient.rpc("get_source_intelligence_candidates", { p_limit: 1000 });
  assert.ok(!after.data.some((c) => c.source.id === sourceId), "must no longer be a candidate once classified with a non-retryable result");
});

// ── 3. Same-day concurrent attempts cannot duplicate ──────────────────────

test("two concurrent classification attempts for the same source on the same day produce exactly one row", async () => {
  const sourceId = await createFixtureSource("concurrent");

  const results = await Promise.allSettled([
    adminClient.from("source_intelligence").insert(classification(sourceId)),
    adminClient.from("source_intelligence").insert(classification(sourceId)),
  ]);
  const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.error === null);

  assert.equal(
    succeeded.length,
    1,
    "exactly one of two concurrent classification attempts for the same source on the same UTC day must succeed — " +
      "enforced by source_intelligence_source_id_analyzed_day_key (supabase/migrations/" +
      "20260924140000_add_source_intelligence_retry_eligibility.sql), which replaced the original absolute " +
      "UNIQUE(source_id) once legitimate multi-day re-analysis needed to be possible."
  );

  const { count } = await adminClient.from("source_intelligence").select("id", { count: "exact", head: true }).eq("source_id", sourceId);
  assert.equal(count, 1);
});

// ── 4. A same-day retry cannot duplicate (a real, later retry is a separate, positive test) ──

test("a same-day retried classification attempt for an already-classified source does not duplicate the row", async () => {
  const sourceId = await createFixtureSource("retry");

  const first = await adminClient.from("source_intelligence").insert(classification(sourceId));
  assert.equal(first.error, null);

  // Simulates a retry (e.g. the n8n write node re-attempting after a
  // transient network error, believing the first write may not have
  // landed) -- same source_id, a fresh run_id, sent again the same day.
  // A LEGITIMATE retry after the real 3-day backoff is expected to
  // succeed and create a genuine second row — see
  // tests/db/source-intelligence-retry-eligibility.test.mjs for that
  // positive case; this test only covers the same-day duplicate guard.
  const retry = await adminClient.from("source_intelligence").insert(classification(sourceId));
  assert.notEqual(retry.error, null, "a same-day retried insert for an already-classified source must be rejected, not silently duplicated");

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
  assert.ok(candidates.some((c) => c.source.id === sourceId));
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
