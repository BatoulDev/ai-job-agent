// DB-dependent integration tests for
// src/lib/ingestion/ingestSourceBatch.ts's runMultiCompanyIngestionBatch
// (Phase 13) against the real local Supabase instance — the
// multi-company-feed counterpart to tests/db/ingestion-core-batch.test.mjs.
// Mirrors that file's coverage (idempotent upsert, bounded writes,
// stale-close, provider-authorization gate) so both paths are proven to
// the same standard, not just the original one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, deleteFakeJobs } from "./helpers.mjs";
import { runMultiCompanyIngestionBatch } from "../../src/lib/ingestion/ingestSourceBatch.ts";

const jobIdsToClean = [];

after(async () => {
  await deleteFakeJobs(jobIdsToClean);
});

function rawJob(externalId, overrides = {}) {
  return {
    externalId,
    title: `Job ${externalId}`,
    description: "A fake multi-company job fixture for automated tests only.",
    companyName: "Fixture Remote Co",
    // A bare "Remote" is medium-confidence per normalizeLocation.ts (not
    // low), so this maps to status:active, not pending_review — needed so
    // the stale-close tests below (which only ever touch active rows,
    // matching runIngestionBatch's existing semantics) actually exercise
    // real rows instead of silently no-op'ing against pending_review ones.
    rawLocation: "Remote",
    providerWorkArrangement: "remote",
    applicationUrl: "https://example.test/apply",
    ...overrides,
  };
}

// remoteok is a real, distinct source_type — scoping every query below by
// a run-unique external_id prefix keeps this test isolated from any other
// concurrent test run without needing a fixture source row (there is none
// for multi-company feeds by design).
function prefixed(run, id) {
  return `${run}-${id}`;
}

async function trackJobs(externalIds) {
  const { data } = await adminClient.from("jobs").select("id").eq("source_type", "remoteok").in("external_id", externalIds);
  for (const row of data ?? []) jobIdsToClean.push(row.id);
}

test("a disabled/unknown provider is rejected before any write (fail-closed)", async () => {
  await assertExpectedLocalProject();
  // jsearch is a real JobSourceType but enabled:false in providerConfig.ts
  // this phase (BLOCKED_ON_CREDENTIAL) — must never write, even with
  // perfectly valid raw jobs.
  const result = await runMultiCompanyIngestionBatch(adminClient, "jsearch", [rawJob(`disabled-${randomUUID()}`)], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(result.outcome, "provider_not_enabled");
  assert.equal(result.jobsCreated, 0);
});

// Phase 19: explicit, named persistence-layer guard for the two providers
// about to be live-validated next phase — proven generically above via
// jsearch already, but Bayt/GulfTalent get their own named coverage here
// specifically because a live benchmark run is imminent and this is the
// real, final backstop even if the discovery layer (providerConfig.ts's
// enabled flag / multiCompanyFeedUrls.ts's hardcoded provider list — see
// tests/unit/provider-config.test.mjs) were ever bypassed, e.g. by a
// hand-crafted POST directly to /api/internal/ingestion/run-multi-company-batch.
test("Bayt is rejected before any write, even with a perfectly real-shaped job, as long as providerConfig.ts keeps it enabled:false", async () => {
  await assertExpectedLocalProject();
  const result = await runMultiCompanyIngestionBatch(
    adminClient,
    "bayt",
    [rawJob(`bayt-guard-${randomUUID()}`, { companyName: "Fixture Bayt Co" })],
    { maxJobsPerSource: 10, dryRun: false }
  );
  assert.equal(result.outcome, "provider_not_enabled");
  assert.equal(result.jobsCreated, 0);
  assert.equal(result.jobsUpdated, 0);
});

test("GulfTalent is rejected before any write, even with a perfectly real-shaped job, as long as providerConfig.ts keeps it enabled:false", async () => {
  await assertExpectedLocalProject();
  const result = await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(`gulftalent-guard-${randomUUID()}`, { companyName: "Fixture GulfTalent Co" })],
    { maxJobsPerSource: 10, dryRun: false }
  );
  assert.equal(result.outcome, "provider_not_enabled");
  assert.equal(result.jobsCreated, 0);
  assert.equal(result.jobsUpdated, 0);
});

test("dry_run validates and reports but writes nothing", async () => {
  const run = randomUUID().slice(0, 8);
  const result = await runMultiCompanyIngestionBatch(
    adminClient,
    "remoteok",
    [rawJob(prefixed(run, "dry-1")), rawJob(prefixed(run, "dry-2"))],
    { maxJobsPerSource: 10, dryRun: true }
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsValid, 2);
  assert.equal(result.jobsCreated, 0);
  const { data: rows } = await adminClient
    .from("jobs")
    .select("id")
    .eq("source_type", "remoteok")
    .in("external_id", [prefixed(run, "dry-1"), prefixed(run, "dry-2")]);
  assert.equal(rows.length, 0, "dry_run must never write a row");
});

test("a job missing companyName is rejected, valid ones still succeed, and source_id is null on the written row", async () => {
  const run = randomUUID().slice(0, 8);
  const result = await runMultiCompanyIngestionBatch(
    adminClient,
    "remoteok",
    [rawJob(prefixed(run, "mixed-valid")), rawJob(prefixed(run, "mixed-no-company"), { companyName: undefined })],
    { maxJobsPerSource: 10, dryRun: false }
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsValid, 1);
  assert.equal(result.jobsRejected, 1);
  assert.equal(result.jobsCreated, 1);
  await trackJobs([prefixed(run, "mixed-valid")]);

  const { data: rows } = await adminClient
    .from("jobs")
    .select("source_id, company_name, dedup_scope")
    .eq("source_type", "remoteok")
    .eq("external_id", prefixed(run, "mixed-valid"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_id, null);
  assert.equal(rows[0].company_name, "Fixture Remote Co");
  assert.equal(rows[0].dedup_scope, "type:remoteok");
});

test("an idempotent retry updates the same row instead of duplicating it, keyed by dedup_scope+external_id with no source_id", async () => {
  const run = randomUUID().slice(0, 8);
  const externalId = prefixed(run, "retry-1");
  const first = await runMultiCompanyIngestionBatch(adminClient, "remoteok", [rawJob(externalId, { title: "First pass" })], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(first.jobsCreated, 1);
  await trackJobs([externalId]);

  const second = await runMultiCompanyIngestionBatch(adminClient, "remoteok", [rawJob(externalId, { title: "Second pass (retry)" })], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(second.jobsCreated, 0);
  assert.equal(second.jobsUpdated, 1);

  const { data: rows } = await adminClient.from("jobs").select("id, title").eq("source_type", "remoteok").eq("external_id", externalId);
  assert.equal(rows.length, 1, "a retried multi-company ingestion must update the same row, never create a second one");
  assert.equal(rows[0].title, "Second pass (retry)");
});

test("stale-close is scoped to this provider's source_type only — a job from a different multi-company provider with a colliding external_id is untouched", async () => {
  const run = randomUUID().slice(0, 8);
  const collidingExternalId = prefixed(run, "shared-external-id");

  // Seed the SAME external_id under a different provider (jobicy) first —
  // must never be affected by remoteok's stale-close below, proving
  // scope isolation between two source_types that both have source_id=null.
  const jobicySeed = await runMultiCompanyIngestionBatch(adminClient, "jobicy", [rawJob(collidingExternalId, { companyName: "Jobicy Fixture Co" })], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(jobicySeed.jobsCreated, 1);
  const { data: jobicyRows } = await adminClient.from("jobs").select("id").eq("source_type", "jobicy").eq("external_id", collidingExternalId);
  for (const row of jobicyRows) jobIdsToClean.push(row.id);

  const seed = await runMultiCompanyIngestionBatch(
    adminClient,
    "remoteok",
    [rawJob(prefixed(run, "keep")), rawJob(collidingExternalId, { companyName: "RemoteOK Fixture Co" })],
    { maxJobsPerSource: 10, dryRun: false }
  );
  assert.equal(seed.jobsCreated, 2);
  await trackJobs([prefixed(run, "keep"), collidingExternalId]);

  // remoteok run 2: collidingExternalId absent -> must close only the
  // remoteok row, never the jobicy row with the same external_id.
  const result = await runMultiCompanyIngestionBatch(adminClient, "remoteok", [rawJob(prefixed(run, "keep"))], {
    maxJobsPerSource: 10,
    dryRun: false,
  });
  assert.equal(result.truncated, false);
  assert.equal(result.jobsClosed, 1);

  const { data: remoteokRow } = await adminClient
    .from("jobs")
    .select("status")
    .eq("source_type", "remoteok")
    .eq("external_id", collidingExternalId)
    .single();
  assert.equal(remoteokRow.status, "unavailable");

  const { data: jobicyRow } = await adminClient.from("jobs").select("status").eq("source_type", "jobicy").eq("external_id", collidingExternalId).single();
  assert.equal(jobicyRow.status, "active", "a same-external_id row under a different source_type must never be closed by another provider's run");
});
