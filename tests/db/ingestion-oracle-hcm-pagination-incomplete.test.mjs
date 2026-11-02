// DB-dependent integration tests for the 2026-10-23 pagination-safety fix's
// paginationIncomplete option (src/lib/ingestion/ingestSourceBatch.ts),
// specifically for Oracle HCM (Tier A, company-specific — scoped by
// source_id, same as greenhouse/lever/workable/ashby), against the real
// local Supabase instance. Closes the gap identified in the 2026-10-25
// read-only pipeline assessment: the existing real-DB tests
// (tests/db/ingestion-core-batch.test.mjs) never use sourceType:
// "oracle_hcm" and never exercise paginationIncomplete at all; the only
// paginationIncomplete coverage that exists today
// (tests/unit/ingest-source-batch-pagination-incomplete.test.mjs) runs
// against a hand-rolled mock Supabase client, never the real database.
//
// Mirrors tests/db/ingestion-core-batch.test.mjs's fixture conventions
// exactly (createFixtureSource/trackJobsForSource/tracked-id cleanup) —
// no new test infrastructure, same proven pattern.
//
// For a company-specific (Tier A) source like oracle_hcm, "refresh scope"
// IS source_id — there is no separate refresh_scope column in play here
// (that dimension exists only for multi-company feeds, e.g. GulfTalent's
// per-market partitions; see PersistScope's own comment in
// ingestSourceBatch.ts). Every query below is scoped by this fixture's own
// randomUUID-suffixed source_id, which cannot collide with any of the
// ~857 pre-existing real jobs' source_id values.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, deleteFakeJobs } from "./helpers.mjs";
import { runIngestionBatch } from "../../src/lib/ingestion/ingestSourceBatch.ts";

const jobIdsToClean = [];
const fixtureCompanyIds = [];
const fixtureSourceIds = [];

// Cleanup order: jobs (reference source_id) -> company_sources (reference
// company_id) -> companies. Every delete is an explicit .in("id", [...])
// against ids this file itself tracked at creation time — never a broad
// predicate (e.g. "where ats_provider = oracle_hcm") that could reach a
// real row. Each step verifies zero rows remain afterward and throws
// (never just logs) if any survive, so a cleanup failure is always
// reported, never silently swallowed.
after(async () => {
  await deleteFakeJobs(jobIdsToClean);

  if (fixtureSourceIds.length > 0) {
    const { error: deleteError } = await adminClient.from("company_sources").delete().in("id", fixtureSourceIds);
    if (deleteError) throw new Error(`cleanup: failed to delete fixture company_sources: ${deleteError.message}`);

    const { data: remainingSources, error: verifyError } = await adminClient
      .from("company_sources")
      .select("id")
      .in("id", fixtureSourceIds);
    if (verifyError) throw new Error(`cleanup: failed to verify fixture company_sources deletion: ${verifyError.message}`);
    if ((remainingSources ?? []).length > 0) {
      throw new Error(`cleanup: ${remainingSources.length} fixture company_sources row(s) still present after delete.`);
    }
  }

  if (fixtureCompanyIds.length > 0) {
    const { error: deleteError } = await adminClient.from("companies").delete().in("id", fixtureCompanyIds);
    if (deleteError) throw new Error(`cleanup: failed to delete fixture companies: ${deleteError.message}`);

    const { data: remainingCompanies, error: verifyError } = await adminClient
      .from("companies")
      .select("id")
      .in("id", fixtureCompanyIds);
    if (verifyError) throw new Error(`cleanup: failed to verify fixture companies deletion: ${verifyError.message}`);
    if ((remainingCompanies ?? []).length > 0) {
      throw new Error(`cleanup: ${remainingCompanies.length} fixture companies row(s) still present after delete.`);
    }
  }
});

/**
 * Fresh, uniquely-suffixed oracle_hcm fixture source. Each call gets its
 * own randomUUID suffix, so two tests (even run out of order, even if a
 * future change made them concurrent) never share a source_id/company_id —
 * no shared mutable fixture state between tests in this file.
 */
async function createFixtureOracleHcmSource(reviewStatus = "verified") {
  const suffix = randomUUID();
  const companyId = `test-oracle-hcm-pg-co-${suffix}`;
  const sourceId = `test-oracle-hcm-pg-src-${suffix}`;

  const { error: companyError } = await adminClient
    .from("companies")
    .insert({ id: companyId, display_name: `Oracle HCM Pagination Test Co ${suffix}` });
  if (companyError) throw new Error(`fixture company insert failed: ${companyError.message}`);
  fixtureCompanyIds.push(companyId);

  const { error: sourceError } = await adminClient.from("company_sources").insert({
    id: sourceId,
    company_id: companyId,
    company_name: `Oracle HCM Pagination Test Co ${suffix} (live)`,
    target_country: "Test",
    ats_provider: "oracle_hcm",
    review_status: reviewStatus,
  });
  if (sourceError) throw new Error(`fixture company_sources insert failed: ${sourceError.message}`);
  fixtureSourceIds.push(sourceId);

  return sourceId;
}

// Generic RawProviderJob shape — runIngestionBatch takes already-adapter-
// normalized jobs (the vendor-specific Oracle HCM shape is normalized
// upstream by mapRawJobsWithAdapter/providers/oracle-hcm.ts before this
// point in the real route; see run-batch/route.ts), same convention
// tests/db/ingestion-core-batch.test.mjs already uses for other ATS types.
// externalId is always caller-supplied with a randomUUID component so it
// can never collide with any pre-existing real job's external_id.
function rawJob(externalId, overrides = {}) {
  return {
    externalId,
    title: `Oracle HCM Fixture Job ${externalId}`,
    description: "A fake Oracle HCM job fixture for automated tests only.",
    rawLocation: "Beirut, Lebanon",
    applicationUrl: `https://example.test/oracle-hcm/${externalId}`,
    ...overrides,
  };
}

async function trackJobsForSource(sourceId) {
  const { data } = await adminClient.from("jobs").select("id").eq("source_id", sourceId);
  for (const row of data ?? []) jobIdsToClean.push(row.id);
}

test("paginationIncomplete:true preserves a previously active Oracle HCM fixture job that is absent from a partial refresh", async () => {
  await assertExpectedLocalProject();

  const sourceId = await createFixtureOracleHcmSource();
  const keepId = `oracle-hcm-pg-keep-${randomUUID()}`;
  const missingId = `oracle-hcm-pg-missing-${randomUUID()}`;

  const seed = await runIngestionBatch(adminClient, sourceId, "oracle_hcm", [rawJob(keepId), rawJob(missingId)], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(seed.outcome, "succeeded");
  assert.equal(seed.jobsCreated, 2);
  await trackJobsForSource(sourceId);

  // Partial refresh: only keepId is present, and the caller explicitly
  // signals that this retrieval did not confirm every page
  // (paginationIncomplete:true) — e.g. the Oracle HCM malformed-page-2
  // scenario validated in n8n execution 309097. missingId must NOT be
  // stale-closed even though it is genuinely absent from this run.
  const result = await runIngestionBatch(adminClient, sourceId, "oracle_hcm", [rawJob(keepId)], {
    maxJobsPerSource: 10,
    dryRun: false,
    paginationIncomplete: true,
  });
  await trackJobsForSource(sourceId);

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.truncated, true, "paginationIncomplete:true must force truncated:true regardless of fetched count");
  assert.equal(result.jobsClosed, 0, "stale-close must never run against an incomplete retrieval");

  const { data: rows, error } = await adminClient
    .from("jobs")
    .select("external_id, status, status_reason")
    .eq("source_id", sourceId)
    .in("external_id", [keepId, missingId])
    .order("external_id");
  if (error) throw new Error(`verification read failed: ${error.message}`);

  const missingRow = rows.find((r) => r.external_id === missingId);
  const keepRow = rows.find((r) => r.external_id === keepId);
  assert.ok(missingRow, "the missing fixture job must still exist in the database");
  assert.equal(missingRow.status, "active", "a job absent only because pagination was incomplete must remain active, never stale-closed");
  assert.equal(missingRow.status_reason, null, "must carry no stale-close reason — it was never evaluated for stale-close at all");
  assert.equal(keepRow.status, "active");
});

test("paginationIncomplete:false allows the missing fixture job to be stale-closed under the correct scope", async () => {
  await assertExpectedLocalProject();

  const sourceId = await createFixtureOracleHcmSource();
  const keepId = `oracle-hcm-pg-keep-${randomUUID()}`;
  const missingId = `oracle-hcm-pg-missing-${randomUUID()}`;

  const seed = await runIngestionBatch(adminClient, sourceId, "oracle_hcm", [rawJob(keepId), rawJob(missingId)], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(seed.outcome, "succeeded");
  assert.equal(seed.jobsCreated, 2);
  await trackJobsForSource(sourceId);

  // Control case: a genuinely complete (non-truncated) refresh that omits
  // missingId must close it — proves the preservation in the test above is
  // actually caused by paginationIncomplete, not some other coincidence
  // (e.g. the scoped query trivially finding nothing either way).
  const result = await runIngestionBatch(adminClient, sourceId, "oracle_hcm", [rawJob(keepId)], {
    maxJobsPerSource: 10,
    dryRun: false,
    paginationIncomplete: false,
  });
  await trackJobsForSource(sourceId);

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.truncated, false);
  assert.equal(result.jobsClosed, 1, "a genuinely complete refresh must close the one job missing from it");

  const { data: rows, error } = await adminClient
    .from("jobs")
    .select("external_id, status, status_reason")
    .eq("source_id", sourceId)
    .in("external_id", [keepId, missingId])
    .order("external_id");
  if (error) throw new Error(`verification read failed: ${error.message}`);

  const missingRow = rows.find((r) => r.external_id === missingId);
  const keepRow = rows.find((r) => r.external_id === keepId);
  assert.equal(missingRow.status, "unavailable");
  assert.equal(missingRow.status_reason, "not_found_in_latest_ingestion_run");
  assert.equal(keepRow.status, "active");
});
