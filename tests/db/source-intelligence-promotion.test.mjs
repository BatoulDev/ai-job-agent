// Regression + contract coverage for promote_source_intelligence_observation()
// (supabase/migrations/20260924130000_add_source_intelligence_promotion.sql) —
// the single controlled write path from a Source Intelligence observation
// into company_sources.ats_provider/automation_eligibility.
//
// Approved rule under test: auto-promote ONLY ingestion_type='ats_adapter'
// AND confidence='high' AND detected_provider<>'unknown'. Everything else
// stays an unresolved observation, company_sources untouched.
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
  const companyId = `cc-sipromo-${label}-${suffix}`;
  const sourceId = `sr-sipromo-${label}-${suffix}`;

  const { error: companyError } = await adminClient.from("companies").insert({ id: companyId, display_name: `SI Promotion Probe ${label} ${suffix}` });
  if (companyError) throw new Error(`fixture company insert failed: ${companyError.message}`);
  fixtureCompanyIds.add(companyId);

  const { error: sourceError } = await adminClient.from("company_sources").insert({
    id: sourceId,
    company_id: companyId,
    company_name: `SI Promotion Probe ${label} ${suffix}`,
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

function classification(sourceId, overrides = {}) {
  return {
    source_id: sourceId,
    run_id: randomUUID(),
    detected_provider: "greenhouse",
    ingestion_type: "ats_adapter",
    confidence: "high",
    evidence: { matched_signal: "boards-api.greenhouse.io" },
    ...overrides,
  };
}

async function insertObservation(sourceId, overrides = {}) {
  const { error } = await adminClient.from("source_intelligence").insert(classification(sourceId, overrides));
  if (error) throw new Error(`fixture source_intelligence insert failed: ${error.message}`);
}

async function getSource(sourceId) {
  const { data, error } = await adminClient
    .from("company_sources")
    .select("ats_provider, automation_eligibility, review_status, company_id")
    .eq("id", sourceId)
    .single();
  if (error) throw new Error(`failed to read fixture company_sources: ${error.message}`);
  return data;
}

// ── 1. High-confidence, supported ATS classification promotes correctly ───

test("greenhouse + ats_adapter + high promotes ats_provider and automation_eligibility (a real, adapted provider)", async () => {
  await assertExpectedLocalProject();
  const sourceId = await createFixtureSource("greenhouse-promotes");
  await insertObservation(sourceId, { detected_provider: "greenhouse" });

  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  const result = data[0];
  assert.equal(result.promoted, true);
  assert.equal(result.reason, "promoted");
  assert.equal(result.ats_provider_applied, true);
  assert.equal(result.automation_eligibility_applied, true);
  assert.equal(result.resulting_ats_provider, "greenhouse");
  assert.equal(result.resulting_automation_eligibility, "suitable_public_ats");

  const source = await getSource(sourceId);
  assert.equal(source.ats_provider, "greenhouse");
  assert.equal(source.automation_eligibility, "suitable_public_ats");
});

test("lever + ats_adapter + high promotes the same way", async () => {
  const sourceId = await createFixtureSource("lever-promotes");
  await insertObservation(sourceId, { detected_provider: "lever" });
  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].resulting_ats_provider, "lever");
  assert.equal(data[0].resulting_automation_eligibility, "suitable_public_ats");
});

test("workable + ats_adapter + high promotes the same way", async () => {
  const sourceId = await createFixtureSource("workable-promotes");
  await insertObservation(sourceId, { detected_provider: "workable" });
  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].resulting_ats_provider, "workable");
  assert.equal(data[0].resulting_automation_eligibility, "suitable_public_ats");
});

// ── 11. ats_provider resolved independently from automation_eligibility ───

test("oracle + ats_adapter + high resolves ats_provider but sets automation_eligibility=manual_only (no Job Ingestion adapter exists today)", async () => {
  const sourceId = await createFixtureSource("oracle-no-adapter");
  await insertObservation(sourceId, { detected_provider: "oracle" });
  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  const result = data[0];
  assert.equal(result.promoted, true);
  assert.equal(result.ats_provider_applied, true);
  assert.equal(result.automation_eligibility_applied, true);
  assert.equal(result.resulting_ats_provider, "oracle", "the ATS itself must still be recorded even without an adapter");
  assert.equal(result.resulting_automation_eligibility, "manual_only", "must never claim automation readiness the system does not have");

  const source = await getSource(sourceId);
  assert.equal(source.ats_provider, "oracle");
  assert.equal(source.automation_eligibility, "manual_only");
});

test("sap/workday/taleo/smartrecruiters/icims all resolve ats_provider but never automation_eligibility=suitable_public_ats", async () => {
  for (const provider of ["sap", "workday", "taleo", "smartrecruiters", "icims"]) {
    const sourceId = await createFixtureSource(`unadapted-${provider}`);
    await insertObservation(sourceId, { detected_provider: provider });
    const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
    assert.equal(error, null, `${provider}: rpc must not error`);
    assert.equal(data[0].resulting_ats_provider, provider, `${provider}: ats_provider must resolve`);
    assert.equal(data[0].resulting_automation_eligibility, "manual_only", `${provider}: must be manual_only, never suitable_public_ats`);
  }
});

// ── 2/3. Medium and low confidence do NOT auto-promote ────────────────────

test("confidence=medium does NOT auto-promote, even for a recognized ats_adapter provider", async () => {
  const sourceId = await createFixtureSource("medium-confidence");
  await insertObservation(sourceId, { detected_provider: "greenhouse", ingestion_type: "ats_adapter", confidence: "medium" });
  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].promoted, false);
  assert.equal(data[0].reason, "not_eligible_for_auto_promotion");

  const source = await getSource(sourceId);
  assert.equal(source.ats_provider, "unknown", "company_sources must be untouched");
  assert.equal(source.automation_eligibility, "unknown");
});

test("confidence=low does NOT auto-promote", async () => {
  const sourceId = await createFixtureSource("low-confidence");
  await insertObservation(sourceId, { detected_provider: "unknown", ingestion_type: "html", confidence: "low" });
  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].promoted, false);
  const source = await getSource(sourceId);
  assert.equal(source.ats_provider, "unknown");
  assert.equal(source.automation_eligibility, "unknown");
});

// ── 4. unknown provider does NOT promote ───────────────────────────────────

test("detected_provider=unknown does NOT promote even if confidence and ingestion_type look otherwise eligible", async () => {
  const sourceId = await createFixtureSource("unknown-provider");
  // Not a realistic classifier output (ats_adapter is never paired with
  // 'unknown' in practice) but the RPC must reject it on its own terms
  // regardless of what upstream code currently guarantees.
  await insertObservation(sourceId, { detected_provider: "unknown", ingestion_type: "ats_adapter", confidence: "high" });
  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].promoted, false);
  assert.equal(data[0].reason, "not_eligible_for_auto_promotion");
});

// ── 5. needs_investigation does NOT promote ────────────────────────────────

test("ingestion_type=needs_investigation does NOT promote", async () => {
  const sourceId = await createFixtureSource("needs-investigation");
  await insertObservation(sourceId, { detected_provider: "unknown", ingestion_type: "needs_investigation", confidence: "low" });
  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].promoted, false);
});

// ── 6. HTML/custom_parser do NOT promote ───────────────────────────────────

test("ingestion_type=html does NOT promote", async () => {
  const sourceId = await createFixtureSource("html-candidate");
  await insertObservation(sourceId, { detected_provider: "unknown", ingestion_type: "html", confidence: "low" });
  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].promoted, false);
});

test("ingestion_type=custom_parser does NOT promote", async () => {
  const sourceId = await createFixtureSource("custom-parser");
  await insertObservation(sourceId, { detected_provider: "unknown", ingestion_type: "custom_parser", confidence: "low" });
  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].promoted, false);
});

// ── 7. A failed/missing observation cannot trigger promotion ──────────────

test("a source with no source_intelligence row at all cannot be promoted", async () => {
  const sourceId = await createFixtureSource("no-observation");
  // Deliberately never inserted into source_intelligence — simulates a
  // failed insert attempt upstream.
  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].promoted, false);
  assert.equal(data[0].reason, "no_observation_for_source");
  const source = await getSource(sourceId);
  assert.equal(source.ats_provider, "unknown");
});

test("a nonexistent source_id is handled gracefully, never a crash", async () => {
  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: "sr-does-not-exist-anywhere" });
  assert.equal(error, null);
  assert.equal(data[0].promoted, false);
  assert.equal(data[0].reason, "no_observation_for_source");
});

// ── 8. Re-running promotion is idempotent ──────────────────────────────────

test("calling promote twice for the same source_id is idempotent — second call replays the first result and changes nothing further", async () => {
  const sourceId = await createFixtureSource("idempotent-replay");
  await insertObservation(sourceId, { detected_provider: "lever" });

  const first = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(first.error, null);
  assert.equal(first.data[0].promoted, true);

  const second = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(second.error, null);
  assert.equal(second.data[0].reason, "already_applied");
  assert.equal(second.data[0].resulting_ats_provider, "lever");
  assert.equal(second.data[0].resulting_automation_eligibility, "suitable_public_ats");

  const source = await getSource(sourceId);
  assert.equal(source.ats_provider, "lever");
  assert.equal(source.automation_eligibility, "suitable_public_ats");
});

test("calling promote for an ineligible observation twice is also a stable no-op both times", async () => {
  const sourceId = await createFixtureSource("idempotent-ineligible");
  await insertObservation(sourceId, { detected_provider: "unknown", ingestion_type: "needs_investigation", confidence: "low" });

  const first = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  const second = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(first.data[0].promoted, false);
  assert.equal(second.data[0].promoted, false);
  assert.equal(first.data[0].reason, "not_eligible_for_auto_promotion");
  assert.equal(second.data[0].reason, "not_eligible_for_auto_promotion", "an ineligible observation is re-evaluated every call, not marked applied — there is nothing to replay");
});

// ── 9. Concurrent promotion cannot corrupt the source ──────────────────────

test("two concurrent promotion attempts for the same source_id never both apply — exactly one outcome wins, no corruption", async () => {
  const sourceId = await createFixtureSource("concurrent-promote");
  await insertObservation(sourceId, { detected_provider: "workable" });

  const [a, b] = await Promise.all([
    adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId }),
    adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId }),
  ]);
  assert.equal(a.error, null);
  assert.equal(b.error, null);

  const reasons = [a.data[0].reason, b.data[0].reason].sort();
  assert.deepEqual(reasons, ["already_applied", "promoted"], "one call must do the real work, the other must see it already applied — never two independent applications");

  const source = await getSource(sourceId);
  assert.equal(source.ats_provider, "workable");
  assert.equal(source.automation_eligibility, "suitable_public_ats");

  const { count } = await adminClient.from("source_intelligence").select("id", { count: "exact", head: true }).eq("source_id", sourceId);
  assert.equal(count, 1, "still exactly one observation row — promotion never inserts/duplicates source_intelligence");
});

// ── 10. A prior human/manual decision is never silently overwritten ───────

test("a source whose ats_provider was already manually set is left untouched by promotion, even for a high-confidence match", async () => {
  const sourceId = await createFixtureSource("manual-ats-provider-set", { ats_provider: "Greenhouse (manually verified)" });
  await insertObservation(sourceId, { detected_provider: "greenhouse" });

  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].ats_provider_applied, false, "must not overwrite the existing human value");
  assert.equal(data[0].resulting_ats_provider, "Greenhouse (manually verified)", "must report what is actually there, not what it would have set");
  // automation_eligibility was still 'unknown' on this fixture, so THAT
  // column is still free to resolve independently.
  assert.equal(data[0].automation_eligibility_applied, true);

  const source = await getSource(sourceId);
  assert.equal(source.ats_provider, "Greenhouse (manually verified)");
  assert.equal(source.automation_eligibility, "suitable_public_ats");
});

test("a source whose automation_eligibility was already manually set is left untouched, even when ats_provider is still unknown and resolves", async () => {
  const sourceId = await createFixtureSource("manual-eligibility-set", { automation_eligibility: "manual_only" });
  await insertObservation(sourceId, { detected_provider: "lever" });

  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].ats_provider_applied, true);
  assert.equal(data[0].automation_eligibility_applied, false, "must not overwrite the existing human decision");
  assert.equal(data[0].resulting_automation_eligibility, "manual_only");

  const source = await getSource(sourceId);
  assert.equal(source.ats_provider, "lever");
  assert.equal(source.automation_eligibility, "manual_only");
});

test("a source with both fields already resolved is a full no-op — promoted=false, nothing changes, still marked applied", async () => {
  const sourceId = await createFixtureSource("fully-resolved-already", { ats_provider: "greenhouse", automation_eligibility: "suitable_public_ats" });
  await insertObservation(sourceId, { detected_provider: "greenhouse" });

  const { data, error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);
  assert.equal(data[0].promoted, false, "nothing was actually changed");
  assert.equal(data[0].reason, "already_resolved_no_change_needed");
  assert.equal(data[0].ats_provider_applied, false);
  assert.equal(data[0].automation_eligibility_applied, false);

  // Still idempotent/marked processed — a second call replays, not re-evaluates.
  const second = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(second.data[0].reason, "already_applied");
});

// ── review_status / company_id are NEVER touched ───────────────────────────

test("promotion never changes review_status or company_id, in any outcome", async () => {
  const sourceId = await createFixtureSource("review-status-untouched");
  const before = await getSource(sourceId);
  await insertObservation(sourceId, { detected_provider: "greenhouse" });

  const { error } = await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });
  assert.equal(error, null);

  const after = await getSource(sourceId);
  assert.equal(after.review_status, before.review_status, "review_status must stay exactly as Registry Sync/whatever left it");
  assert.equal(after.review_status, "needs_manual_review");
  assert.equal(after.company_id, before.company_id, "company_id must never change");
});

// ── source_intelligence auditability: applied_at / applied_result ─────────

test("a successful promotion records applied_at and a matching applied_result on the source_intelligence row", async () => {
  const sourceId = await createFixtureSource("audit-trail-promoted");
  await insertObservation(sourceId, { detected_provider: "greenhouse" });
  await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });

  const { data, error } = await adminClient.from("source_intelligence").select("applied_at, applied_result").eq("source_id", sourceId).single();
  assert.equal(error, null);
  assert.ok(data.applied_at, "applied_at must be set");
  assert.equal(data.applied_result.ats_provider_applied, true);
  assert.equal(data.applied_result.automation_eligibility_applied, true);
  assert.equal(data.applied_result.resulting_ats_provider, "greenhouse");
  assert.equal(data.applied_result.resulting_automation_eligibility, "suitable_public_ats");
});

test("an ineligible observation is never marked applied — applied_at stays null so it remains visibly unresolved", async () => {
  const sourceId = await createFixtureSource("audit-trail-ineligible");
  await insertObservation(sourceId, { detected_provider: "unknown", ingestion_type: "needs_investigation", confidence: "low" });
  await adminClient.rpc("promote_source_intelligence_observation", { p_source_id: sourceId });

  const { data, error } = await adminClient.from("source_intelligence").select("applied_at, applied_result").eq("source_id", sourceId).single();
  assert.equal(error, null);
  assert.equal(data.applied_at, null);
  assert.equal(data.applied_result, null);
});

// ── grants / ownership model ────────────────────────────────────────────

test("service_role still cannot UPDATE source_intelligence directly — only the SECURITY DEFINER function can set applied_at", async () => {
  const sourceId = await createFixtureSource("no-direct-update-grant");
  await insertObservation(sourceId, { detected_provider: "greenhouse" });

  const { error } = await adminClient.from("source_intelligence").update({ applied_at: new Date().toISOString() }).eq("source_id", sourceId);
  assert.notEqual(error, null, "service_role must not have direct UPDATE on source_intelligence — the append-only/promotion-only invariant depends on this");
});
