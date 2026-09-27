// DB-dependent integration tests for src/lib/ingestion/ingestSourceBatch.ts
// (Phase 03 ingestion core) against the real local Supabase instance —
// idempotent upsert, bounded writes, and source-scoped stale-close, per
// docs/OVERNIGHT_BUILD_PROGRESS.md Phase 03's "must be truly validated
// locally, not claimed from reading the code" requirement.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, deleteFakeJobs } from "./helpers.mjs";
import { runIngestionBatch, verifySourceForIngestion } from "../../src/lib/ingestion/ingestSourceBatch.ts";

const jobIdsToClean = [];
const fixtureCompanyIds = [];
const fixtureSourceIds = [];

after(async () => {
  await deleteFakeJobs(jobIdsToClean);
  if (fixtureSourceIds.length > 0) {
    const { error: sourcesError } = await adminClient.from("company_sources").delete().in("id", fixtureSourceIds);
    if (sourcesError) throw new Error(`cleanup: failed to delete fixture company_sources: ${sourcesError.message}`);
  }
  if (fixtureCompanyIds.length > 0) {
    const { error: companiesError } = await adminClient.from("companies").delete().in("id", fixtureCompanyIds);
    if (companiesError) throw new Error(`cleanup: failed to delete fixture companies: ${companiesError.message}`);
  }
});

async function createFixtureSource(reviewStatus = "verified") {
  const suffix = randomUUID().slice(0, 8);
  const companyId = `test-ingestion-co-${suffix}`;
  const sourceId = `test-ingestion-src-${suffix}`;

  const { error: companyError } = await adminClient.from("companies").insert({ id: companyId, display_name: `Ingestion Test Co ${suffix}` });
  if (companyError) throw new Error(`fixture company insert failed: ${companyError.message}`);
  fixtureCompanyIds.push(companyId);

  const { error: sourceError } = await adminClient.from("company_sources").insert({
    id: sourceId,
    company_id: companyId,
    company_name: `Ingestion Test Co ${suffix} (live)`,
    target_country: "Test",
    ats_provider: "greenhouse",
    review_status: reviewStatus,
  });
  if (sourceError) throw new Error(`fixture company_sources insert failed: ${sourceError.message}`);
  fixtureSourceIds.push(sourceId);

  return sourceId;
}

function rawJob(externalId, overrides = {}) {
  return {
    externalId,
    title: `Job ${externalId}`,
    description: "A fake job fixture for automated tests only.",
    rawLocation: "Beirut, Lebanon",
    applicationUrl: "https://example.test/apply",
    ...overrides,
  };
}

async function trackJobsForSource(sourceId) {
  const { data } = await adminClient.from("jobs").select("id").eq("source_id", sourceId);
  for (const row of data ?? []) jobIdsToClean.push(row.id);
}

test("an unapproved source (needs_manual_review) is rejected before any write", async () => {
  await assertExpectedLocalProject();
  const sourceId = await createFixtureSource("needs_manual_review");

  const result = await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("a1")], {
    maxJobsPerSource: 10,
    dryRun: false,
  });

  assert.equal(result.outcome, "source_not_approved");
  assert.equal(result.jobsCreated, 0);
  const { data: rows } = await adminClient.from("jobs").select("id").eq("source_id", sourceId);
  assert.equal(rows.length, 0, "an unapproved source must never have anything written for it");
});

test("a nonexistent source is rejected", async () => {
  const result = await runIngestionBatch(adminClient, `no-such-source-${randomUUID()}`, "greenhouse", [rawJob("a1")], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(result.outcome, "source_not_found");
});

test("verifySourceForIngestion re-checks live, never trusts a cached approval", async () => {
  const sourceId = await createFixtureSource("verified");
  const ok = await verifySourceForIngestion(adminClient, sourceId, "greenhouse");
  assert.equal(ok.ok, true);
  assert.equal(ok.provenance.companyName, (await adminClient.from("company_sources").select("company_name").eq("id", sourceId).single()).data.company_name);

  await adminClient.from("company_sources").update({ review_status: "blocked_or_unsafe" }).eq("id", sourceId);
  const rejected = await verifySourceForIngestion(adminClient, sourceId, "greenhouse");
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "source_not_approved");
});

test("dry_run validates and reports but writes nothing", async () => {
  const sourceId = await createFixtureSource();
  const result = await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("dry-1"), rawJob("dry-2")], {
    maxJobsPerSource: 10,
    dryRun: true,
  });

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsValid, 2);
  assert.equal(result.jobsCreated, 0);
  const { data: rows } = await adminClient.from("jobs").select("id").eq("source_id", sourceId);
  assert.equal(rows.length, 0, "dry_run must never write a row");
});

test("invalid raw jobs are rejected and counted, valid ones still succeed", async () => {
  const sourceId = await createFixtureSource();
  const result = await runIngestionBatch(
    adminClient,
    sourceId,
    "greenhouse",
    [rawJob("mixed-valid"), rawJob("mixed-invalid", { title: null }), rawJob("mixed-invalid-2", { applicationUrl: null })],
    { maxJobsPerSource: 10, dryRun: false }
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsValid, 1);
  assert.equal(result.jobsRejected, 2);
  assert.equal(result.jobsCreated, 1);
  await trackJobsForSource(sourceId);
});

test("an idempotent retry updates the same rows instead of duplicating them, and uses the live company name", async () => {
  const sourceId = await createFixtureSource();
  const first = await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("retry-1", { title: "First pass" })], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(first.jobsCreated, 1);
  assert.equal(first.jobsUpdated, 0);
  await trackJobsForSource(sourceId);

  const second = await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("retry-1", { title: "Second pass (retry)" })], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(second.jobsCreated, 0);
  assert.equal(second.jobsUpdated, 1);

  const { data: rows } = await adminClient.from("jobs").select("id, title, company_name").eq("source_id", sourceId);
  assert.equal(rows.length, 1, "a retried ingestion must update the same row, never create a second one");
  assert.equal(rows[0].title, "Second pass (retry)");
});

test("a truncated run (more valid jobs than the cap) never closes stale jobs", async () => {
  const sourceId = await createFixtureSource();
  const seed = await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("keep-1"), rawJob("keep-2")], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(seed.jobsCreated, 2);
  await trackJobsForSource(sourceId);

  // 3 valid jobs offered, cap of 1 — this run is truncated and must not
  // close "keep-1"/"keep-2" even though neither appears in this bounded page.
  const result = await runIngestionBatch(
    adminClient,
    sourceId,
    "greenhouse",
    [rawJob("new-1"), rawJob("new-2"), rawJob("new-3")],
    { maxJobsPerSource: 1, dryRun: false }
  );
  assert.equal(result.truncated, true);
  assert.equal(result.jobsClosed, 0, "a truncated run must never close jobs merely outside its own page");
  await trackJobsForSource(sourceId);

  const { data: rows } = await adminClient.from("jobs").select("external_id, status").eq("source_id", sourceId).in("external_id", ["keep-1", "keep-2"]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.status === "active"), "jobs outside a truncated page must remain active");
});

test("a complete (non-truncated) run closes jobs no longer present as stale, and reopens them if seen again", async () => {
  const sourceId = await createFixtureSource();
  const seed = await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("stale-a"), rawJob("stale-b")], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(seed.jobsCreated, 2);
  await trackJobsForSource(sourceId);

  // "stale-b" is absent from this complete (non-truncated) run — it must be closed.
  const result = await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("stale-a")], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(result.truncated, false);
  assert.equal(result.jobsClosed, 1);

  const { data: rows } = await adminClient.from("jobs").select("external_id, status, status_reason").eq("source_id", sourceId).order("external_id");
  const staleA = rows.find((r) => r.external_id === "stale-a");
  const staleB = rows.find((r) => r.external_id === "stale-b");
  assert.equal(staleA.status, "active");
  assert.equal(staleB.status, "unavailable");
  assert.equal(staleB.status_reason, "not_found_in_latest_ingestion_run");
});
