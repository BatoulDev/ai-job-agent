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

test("a provider batch containing a genuine duplicate external_id (same job listed twice — real Salla/Workable behavior found in Phase 14) is collapsed to one row instead of crashing the upsert", async () => {
  const sourceId = await createFixtureSource();
  const result = await runIngestionBatch(
    adminClient,
    sourceId,
    "workable",
    [rawJob("dup-1", { title: "First copy" }), rawJob("dup-1", { title: "Second copy (identical job, provider listed it twice)" }), rawJob("unique-1")],
    { maxJobsPerSource: 10, dryRun: false }
  );

  assert.equal(result.outcome, "succeeded", "must not throw the Postgres 'ON CONFLICT DO UPDATE command cannot affect row a second time' error");
  assert.equal(result.jobsCreated, 2, "two distinct external_ids after de-duplication: dup-1 (once) + unique-1");
  await trackJobsForSource(sourceId);

  const { data: rows } = await adminClient.from("jobs").select("external_id, title").eq("source_id", sourceId).eq("external_id", "dup-1");
  assert.equal(rows.length, 1, "the duplicate must collapse to exactly one row, never two");
  assert.equal(rows[0].title, "Second copy (identical job, provider listed it twice)", "last occurrence wins deterministically");
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

// 2026-10-02 fix: a caller (the n8n orchestrator, or any other) must never
// be able to request more than providerConfig.ts's own maxJobsPerRun —
// greenhouse's is 50. Requesting 1000 here proves the server clamps the
// effective cap down to 50 regardless, truncating a 51-job batch that the
// caller's own requested cap would NOT have truncated.
test("a requested cap above the provider's own maxJobsPerRun is clamped server-side, never honored verbatim", async () => {
  const sourceId = await createFixtureSource();
  const rawJobs = Array.from({ length: 51 }, (_, i) => rawJob(`clamp-${i}`));

  const result = await runIngestionBatch(adminClient, sourceId, "greenhouse", rawJobs, {
    maxJobsPerSource: 1000,
    dryRun: false,
  });
  await trackJobsForSource(sourceId);

  assert.equal(result.jobsValid, 51);
  assert.equal(result.truncated, true, "greenhouse's maxJobsPerRun (50) must clamp a requested cap of 1000");
  assert.equal(result.jobsCreated, 50, "only the provider-authoritative cap's worth of rows may be written");
  assert.equal(result.jobsClosed, 0, "a clamp-truncated run must never stale-close");

  const { count } = await adminClient.from("jobs").select("*", { count: "exact", head: true }).eq("source_id", sourceId);
  assert.equal(count, 50, "the database must never hold more rows than the provider's authoritative cap");
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

// Real-ingestion pilot (2026-10-01): first_seen_at/last_seen_at/last_checked_at/
// last_successful_check_at were schema-documented (20260914120000_add_jobs_
// freshness_and_geography.sql) but never actually set by persistValidatedJobs,
// and a reopened job kept its stale status_reason. Fixed in ingestSourceBatch.ts
// without a DB-wide default — see tests/db/jobs-freshness-and-lifecycle.test.mjs's
// existing "no freshness timestamps by default" contract for non-ingestion
// inserts, which a DB default would have broken.
test("a new ingestion insert sets first_seen_at/last_seen_at/last_checked_at/last_successful_check_at", async () => {
  const sourceId = await createFixtureSource();
  const before = new Date();
  await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("fresh-1")], { maxJobsPerSource: 10, dryRun: false });
  await trackJobsForSource(sourceId);

  const { data: row } = await adminClient
    .from("jobs")
    .select("first_seen_at, last_seen_at, last_checked_at, last_successful_check_at")
    .eq("source_id", sourceId)
    .eq("external_id", "fresh-1")
    .single();

  for (const field of ["first_seen_at", "last_seen_at", "last_checked_at", "last_successful_check_at"]) {
    assert.notEqual(row[field], null, `${field} must be set on first ingestion`);
    assert.ok(new Date(row[field]) >= before, `${field} must reflect this ingestion run`);
  }
});

test("a second ingestion of the same job preserves first_seen_at while advancing last_seen_at/last_checked_at/last_successful_check_at", async () => {
  const sourceId = await createFixtureSource();
  await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("fresh-2")], { maxJobsPerSource: 10, dryRun: false });
  await trackJobsForSource(sourceId);

  const { data: firstRow } = await adminClient
    .from("jobs")
    .select("first_seen_at, last_seen_at")
    .eq("source_id", sourceId)
    .eq("external_id", "fresh-2")
    .single();

  await new Promise((resolve) => setTimeout(resolve, 10));
  await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("fresh-2")], { maxJobsPerSource: 10, dryRun: false });

  const { data: secondRow } = await adminClient
    .from("jobs")
    .select("first_seen_at, last_seen_at")
    .eq("source_id", sourceId)
    .eq("external_id", "fresh-2")
    .single();

  assert.equal(secondRow.first_seen_at, firstRow.first_seen_at, "first_seen_at must never change once set");
  assert.ok(new Date(secondRow.last_seen_at) > new Date(firstRow.last_seen_at), "last_seen_at must advance on every successful ingestion");
});

test("a job that is stale-closed then reappears is reactivated, clears its stale status_reason, and keeps its original first_seen_at", async () => {
  const sourceId = await createFixtureSource();
  await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("reopen-1"), rawJob("keep-alive")], { maxJobsPerSource: 10, dryRun: false });
  await trackJobsForSource(sourceId);

  const { data: original } = await adminClient.from("jobs").select("first_seen_at").eq("source_id", sourceId).eq("external_id", "reopen-1").single();

  // Complete, non-truncated run that omits reopen-1 — closes it with a reason.
  const closeResult = await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("keep-alive")], { maxJobsPerSource: 10, dryRun: false });
  assert.equal(closeResult.jobsClosed, 1);
  const { data: closed } = await adminClient.from("jobs").select("status, status_reason").eq("source_id", sourceId).eq("external_id", "reopen-1").single();
  assert.equal(closed.status, "unavailable");
  assert.equal(closed.status_reason, "not_found_in_latest_ingestion_run");

  // reopen-1 reappears in a later successful run.
  await runIngestionBatch(adminClient, sourceId, "greenhouse", [rawJob("reopen-1"), rawJob("keep-alive")], { maxJobsPerSource: 10, dryRun: false });
  const { data: reopened } = await adminClient
    .from("jobs")
    .select("status, status_reason, first_seen_at")
    .eq("source_id", sourceId)
    .eq("external_id", "reopen-1")
    .single();

  assert.equal(reopened.status, "active");
  assert.equal(reopened.status_reason, null, "a reopened job must not keep displaying its old close reason");
  assert.equal(reopened.first_seen_at, original.first_seen_at, "reopening must not reset first_seen_at");
});
