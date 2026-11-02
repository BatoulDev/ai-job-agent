// DB-dependent integration tests for the 2026-10-23 pagination-safety fix's
// paginationIncomplete option (src/lib/ingestion/ingestSourceBatch.ts),
// for GulfTalent specifically (multi-company feed, Tier C — scoped by
// source_type + refresh_scope, NOT source_id), against the real local
// Supabase instance. Mirrors tests/db/ingestion-oracle-hcm-pagination-incomplete.test.mjs's
// proven pattern exactly, adapted for runMultiCompanyIngestionBatch.
//
// Unlike the Oracle HCM (Tier A) counterpart, a multi-company feed has no
// company_sources row at all — source_id is always null and identity/
// stale-close scoping is source_type + refresh_scope only (see
// PersistScope's own comment in ingestSourceBatch.ts). This means no
// companies/company_sources fixture is needed here, only jobs rows —
// cleanup is correspondingly simpler.
//
// Closes the gap identified in the 2026-10-25 readiness assessment: the
// existing paginationIncomplete coverage for GulfTalent
// (tests/unit/ingest-source-batch-pagination-incomplete.test.mjs's
// GULFTALENT_SA_SCOPE tests) runs against a hand-rolled mock Supabase
// client, never the real database.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, deleteFakeJobs } from "./helpers.mjs";
import { runMultiCompanyIngestionBatch } from "../../src/lib/ingestion/ingestSourceBatch.ts";

const jobIdsToClean = [];

after(async () => {
  await deleteFakeJobs(jobIdsToClean);
});

// Generic RawProviderJob shape for a multi-company feed — companyName is
// required (validateMultiCompanyProviderJob), unlike Tier A sources where
// it comes from the live company_sources row. externalId always carries a
// randomUUID component so it can never collide with any pre-existing real
// job's external_id.
function rawJob(externalId, overrides = {}) {
  return {
    externalId,
    title: `GulfTalent Fixture Job ${externalId}`,
    description: "A fake GulfTalent job fixture for automated tests only.",
    companyName: "GulfTalent Fixture Co",
    rawLocation: "Riyadh, Saudi Arabia",
    providerWorkArrangement: "onsite",
    applicationUrl: `https://example.test/gulftalent/${externalId}`,
    ...overrides,
  };
}

async function trackJobsByExternalIds(externalIds) {
  const { data } = await adminClient.from("jobs").select("id").eq("source_type", "gulftalent").in("external_id", externalIds);
  for (const row of data ?? []) jobIdsToClean.push(row.id);
}

test("paginationIncomplete:true preserves a previously active GulfTalent fixture job missing from a partial refresh, scoped strictly to its own refreshScope", async () => {
  await assertExpectedLocalProject();

  const refreshScope = `test-gulftalent-pg-${randomUUID()}`;
  const keepId = `gulftalent-pg-keep-${randomUUID()}`;
  const missingId = `gulftalent-pg-missing-${randomUUID()}`;

  const seed = await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(keepId, { title: "GulfTalent Fixture Job (seed)" }), rawJob(missingId)],
    { maxJobsPerSource: 10, dryRun: false },
    refreshScope
  );
  assert.equal(seed.outcome, "succeeded");
  assert.equal(seed.jobsCreated, 2);
  await trackJobsByExternalIds([keepId, missingId]);

  // Partial refresh: only keepId present (with updated content, to prove
  // the next assertion distinguishes a real update from a no-op), and the
  // caller explicitly signals this retrieval did not confirm every page.
  const result = await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(keepId, { title: "GulfTalent Fixture Job (updated)" })],
    { maxJobsPerSource: 10, dryRun: false, paginationIncomplete: true },
    refreshScope
  );
  await trackJobsByExternalIds([keepId, missingId]);

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.truncated, true, "paginationIncomplete:true must force truncated:true regardless of fetched count");
  assert.equal(result.jobsClosed, 0, "stale-close must never run against an incomplete retrieval");
  assert.equal(result.jobsUpdated, 1, "the kept job must be reported as updated, not re-created");
  assert.equal(result.jobsCreated, 0);

  const { data: rows, error } = await adminClient
    .from("jobs")
    .select("external_id, status, status_reason, title")
    .eq("source_type", "gulftalent")
    .is("source_id", null)
    .eq("refresh_scope", refreshScope)
    .in("external_id", [keepId, missingId])
    .order("external_id");
  if (error) throw new Error(`verification read failed: ${error.message}`);

  const missingRow = rows.find((r) => r.external_id === missingId);
  const keepRow = rows.find((r) => r.external_id === keepId);
  assert.ok(missingRow, "the missing fixture job must still exist in the database");
  assert.equal(missingRow.status, "active", "a job absent only because pagination was incomplete must remain active, never stale-closed");
  assert.equal(missingRow.status_reason, null, "must carry no stale-close reason — it was never evaluated for stale-close at all");
  assert.equal(keepRow.status, "active");
  assert.equal(keepRow.title, "GulfTalent Fixture Job (updated)", "the kept job's content must reflect the second call's real update, not the original seed");
});

test("paginationIncomplete:false allows normal stale-close for a genuinely complete GulfTalent refresh, scoped strictly to its own refreshScope", async () => {
  await assertExpectedLocalProject();

  const refreshScope = `test-gulftalent-pg-${randomUUID()}`;
  const keepId = `gulftalent-pg-keep-${randomUUID()}`;
  const missingId = `gulftalent-pg-missing-${randomUUID()}`;

  const seed = await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(keepId), rawJob(missingId)],
    { maxJobsPerSource: 10, dryRun: false },
    refreshScope
  );
  assert.equal(seed.outcome, "succeeded");
  assert.equal(seed.jobsCreated, 2);
  await trackJobsByExternalIds([keepId, missingId]);

  // Control case: a genuinely complete (non-truncated) refresh that omits
  // missingId must close it — proves the preservation above is actually
  // caused by paginationIncomplete, not some other coincidence, and that
  // this fixture's own scope is where stale-close correctly still applies.
  const result = await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(keepId)],
    { maxJobsPerSource: 10, dryRun: false, paginationIncomplete: false },
    refreshScope
  );
  await trackJobsByExternalIds([keepId, missingId]);

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.truncated, false);
  assert.equal(result.jobsClosed, 1, "a genuinely complete refresh must close the one job missing from it, scoped to this refreshScope only");

  const { data: rows, error } = await adminClient
    .from("jobs")
    .select("external_id, status, status_reason")
    .eq("source_type", "gulftalent")
    .is("source_id", null)
    .eq("refresh_scope", refreshScope)
    .in("external_id", [keepId, missingId])
    .order("external_id");
  if (error) throw new Error(`verification read failed: ${error.message}`);

  const missingRow = rows.find((r) => r.external_id === missingId);
  const keepRow = rows.find((r) => r.external_id === keepId);
  assert.equal(missingRow.status, "unavailable");
  assert.equal(missingRow.status_reason, "not_found_in_latest_ingestion_run");
  assert.equal(keepRow.status, "active");
});
