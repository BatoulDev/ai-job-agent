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

async function trackJobs(externalIds, sourceType = "remoteok") {
  const { data } = await adminClient.from("jobs").select("id").eq("source_type", sourceType).in("external_id", externalIds);
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

// Phase 19 added named persistence-layer guards for Bayt/GulfTalent here
// (superseded — both, plus Indeed, went live enabled:true in Phase 21
// after real benchmark validation; the generic jsearch guard above still
// proves the same fail-closed mechanism for whichever providers remain
// disabled). Phase 21 replaces those three with the opposite proof: real
// writes now succeed for all three once enabled.
//
// Phase 22 fix: these three providers can carry real, non-fixture paid-
// pilot data in this very local database (confirmed during the GulfTalent
// SA/AE stale-close investigation — a run of exactly these three tests
// with no refreshScope is what stale-closed every real Bayt/GulfTalent/
// Indeed row that existed at the time, since each wrote only one fixture
// job and then this function's own stale-close logic treated that as the
// complete universe for the provider's unpartitioned null-refresh_scope).
// Each test below now passes a run-unique refreshScope so its stale-close
// universe can never overlap real data (whose refresh_scope is null for
// Bayt/Indeed, or 'country:SA'/'country:AE:location:Dubai' for GulfTalent
// — never equal to a random per-run fixture string).
test("Bayt writes a real row once enabled:true, keyed by dedup_scope 'type:bayt'", async () => {
  const run = randomUUID().slice(0, 8);
  const result = await runMultiCompanyIngestionBatch(
    adminClient,
    "bayt",
    [rawJob(prefixed(run, "bayt-live"), { companyName: "Fixture Bayt Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    `test-fixture-${run}`
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsCreated, 1);
  await trackJobs([prefixed(run, "bayt-live")], "bayt");
  const { data } = await adminClient.from("jobs").select("dedup_scope").eq("source_type", "bayt").eq("external_id", prefixed(run, "bayt-live")).single();
  assert.equal(data.dedup_scope, "type:bayt");
});

test("GulfTalent writes a real row once enabled:true, keyed by dedup_scope 'type:gulftalent'", async () => {
  const run = randomUUID().slice(0, 8);
  const result = await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(prefixed(run, "gulftalent-live"), { companyName: "Fixture GulfTalent Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    `test-fixture-${run}`
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsCreated, 1);
  await trackJobs([prefixed(run, "gulftalent-live")], "gulftalent");
  const { data } = await adminClient.from("jobs").select("dedup_scope").eq("source_type", "gulftalent").eq("external_id", prefixed(run, "gulftalent-live")).single();
  assert.equal(data.dedup_scope, "type:gulftalent");
});

test("Indeed writes a real row once enabled:true, keyed by dedup_scope 'type:indeed'", async () => {
  const run = randomUUID().slice(0, 8);
  const result = await runMultiCompanyIngestionBatch(
    adminClient,
    "indeed",
    [rawJob(prefixed(run, "indeed-live"), { companyName: "Fixture Indeed Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    `test-fixture-${run}`
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsCreated, 1);
  await trackJobs([prefixed(run, "indeed-live")], "indeed");
  const { data } = await adminClient.from("jobs").select("dedup_scope").eq("source_type", "indeed").eq("external_id", prefixed(run, "indeed-live")).single();
  assert.equal(data.dedup_scope, "type:indeed");
});

// ─────────────────────────────────────────────────────────────────────────
// 2026-10-02 fix: the real paid pilot requested maxJobsPerSource:5 (an n8n
// workflow-config bug) while Bayt/GulfTalent/Indeed returned 25/15/15/15
// real jobs — every batch was falsely truncated, persisting nothing.
// clampToProviderCeiling (ingestSourceBatch.ts) now lets each provider
// branch request its own real batch size, server-clamped to
// providerConfig.ts's maxJobsPerRun (40 for all three here) as the
// authoritative ceiling. Each test below uses a run-unique refreshScope,
// same discipline as the rest of this file, so it can never stale-close
// real local pilot data.
// ─────────────────────────────────────────────────────────────────────────

test("Bayt: a requested cap of 25 (the real production seed value) is accepted and does not falsely truncate a 25-job batch", async () => {
  const run = randomUUID().slice(0, 8);
  const rawJobs = Array.from({ length: 25 }, (_, i) => rawJob(prefixed(run, `bayt-${i}`), { companyName: "Fixture Bayt Co" }));
  const result = await runMultiCompanyIngestionBatch(adminClient, "bayt", rawJobs, { maxJobsPerSource: 25, dryRun: false }, `test-fixture-${run}`);
  await trackJobs(rawJobs.map((_, i) => prefixed(run, `bayt-${i}`)), "bayt");

  assert.equal(result.truncated, false, "25 requested vs. 25 real jobs must never be reported as truncated");
  assert.equal(result.jobsCreated, 25);
});

test("GulfTalent: a requested cap of 15 (the real production seed value, per market) is accepted and does not falsely truncate", async () => {
  const run = randomUUID().slice(0, 8);
  const rawJobs = Array.from({ length: 15 }, (_, i) => rawJob(prefixed(run, `gt-${i}`), { companyName: "Fixture GulfTalent Co" }));
  const result = await runMultiCompanyIngestionBatch(adminClient, "gulftalent", rawJobs, { maxJobsPerSource: 15, dryRun: false }, `test-fixture-${run}`);
  await trackJobs(rawJobs.map((_, i) => prefixed(run, `gt-${i}`)), "gulftalent");

  assert.equal(result.truncated, false);
  assert.equal(result.jobsCreated, 15);
});

test("Indeed: a requested cap of 15 (the real production seed value) is accepted and does not falsely truncate", async () => {
  const run = randomUUID().slice(0, 8);
  const rawJobs = Array.from({ length: 15 }, (_, i) => rawJob(prefixed(run, `indeed-${i}`), { companyName: "Fixture Indeed Co" }));
  const result = await runMultiCompanyIngestionBatch(adminClient, "indeed", rawJobs, { maxJobsPerSource: 15, dryRun: false }, `test-fixture-${run}`);
  await trackJobs(rawJobs.map((_, i) => prefixed(run, `indeed-${i}`)), "indeed");

  assert.equal(result.truncated, false);
  assert.equal(result.jobsCreated, 15);
});

test("Bayt: a requested cap above providerConfig's own maxJobsPerRun (40) is clamped server-side, never honored verbatim", async () => {
  const run = randomUUID().slice(0, 8);
  const rawJobs = Array.from({ length: 41 }, (_, i) => rawJob(prefixed(run, `clamp-${i}`), { companyName: "Fixture Bayt Co" }));
  const result = await runMultiCompanyIngestionBatch(adminClient, "bayt", rawJobs, { maxJobsPerSource: 1000, dryRun: false }, `test-fixture-${run}`);
  await trackJobs(rawJobs.map((_, i) => prefixed(run, `clamp-${i}`)), "bayt");

  assert.equal(result.jobsValid, 41);
  assert.equal(result.truncated, true, "Bayt's maxJobsPerRun (40) must clamp a requested cap of 1000");
  assert.equal(result.jobsCreated, 40, "only the provider-authoritative cap's worth of rows may be written");
  assert.equal(result.jobsClosed, 0, "a clamp-truncated run must never stale-close");
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

// ─────────────────────────────────────────────────────────────────────────
// Phase 22 fix: GulfTalent SA/AE stale-close scoping (refreshScope).
//
// Reproduces the exact real paid-pilot bug (2026-10-01): GulfTalent is
// queried through two independently-complete market calls (Saudi Arabia,
// then AE/Dubai) that used to share one stale-close universe keyed only by
// source_type — the AE call's "jobs I saw" set naturally excluded every SA
// external_id, so SA's jobs got wrongly stale-closed as AE's leftovers.
//
// Every refreshScope value below is a run-unique fixture string
// (`test-sa-${run}` / `test-ae-${run}`), deliberately NOT the real
// production values ('country:SA' / 'country:AE:location:Dubai') — this
// local database can hold real paid-pilot GulfTalent rows under those
// exact production scopes, and a collision would let these tests silently
// stale-close real data (precisely the mechanism that produced the bug
// this suite exists to catch). See the updated "writes a real row" tests
// above for the same reasoning applied to the pre-existing tests.
// ─────────────────────────────────────────────────────────────────────────

test("GulfTalent: a SA-scoped refresh creates active jobs stamped with their own refresh_scope", async () => {
  const run = randomUUID().slice(0, 8);
  const saScope = `test-sa-${run}`;
  const result = await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(prefixed(run, "sa-1"), { companyName: "Fixture GulfTalent SA Co" }), rawJob(prefixed(run, "sa-2"), { companyName: "Fixture GulfTalent SA Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    saScope
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsCreated, 2);
  await trackJobs([prefixed(run, "sa-1"), prefixed(run, "sa-2")], "gulftalent");

  const { data } = await adminClient
    .from("jobs")
    .select("status, refresh_scope")
    .eq("source_type", "gulftalent")
    .in("external_id", [prefixed(run, "sa-1"), prefixed(run, "sa-2")]);
  assert.equal(data.length, 2);
  for (const row of data) {
    assert.equal(row.status, "active");
    assert.equal(row.refresh_scope, saScope);
  }
});

test("GulfTalent: an AE-scoped refresh run afterward does not stale-close the SA partition's jobs", async () => {
  const run = randomUUID().slice(0, 8);
  const saScope = `test-sa-${run}`;
  const aeScope = `test-ae-${run}`;

  await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(prefixed(run, "sa-a"), { companyName: "Fixture GulfTalent SA Co" }), rawJob(prefixed(run, "sa-b"), { companyName: "Fixture GulfTalent SA Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    saScope
  );
  await trackJobs([prefixed(run, "sa-a"), prefixed(run, "sa-b")], "gulftalent");

  // This is the exact real-bug reproduction: the AE call happens after SA,
  // shares gulftalent's source_type, and does not mention sa-a/sa-b at all.
  const aeResult = await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(prefixed(run, "ae-a"), { companyName: "Fixture GulfTalent AE Co" }), rawJob(prefixed(run, "ae-b"), { companyName: "Fixture GulfTalent AE Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    aeScope
  );
  await trackJobs([prefixed(run, "ae-a"), prefixed(run, "ae-b")], "gulftalent");
  assert.equal(aeResult.jobsClosed, 0, "AE's own first run has nothing pre-existing in AE's scope to close");

  const { data: saRows } = await adminClient
    .from("jobs")
    .select("status")
    .eq("source_type", "gulftalent")
    .in("external_id", [prefixed(run, "sa-a"), prefixed(run, "sa-b")]);
  for (const row of saRows) assert.equal(row.status, "active", "the SA partition's jobs must survive an unrelated AE refresh — this is the real bug this test reproduces");

  const { data: aeRows } = await adminClient
    .from("jobs")
    .select("status")
    .eq("source_type", "gulftalent")
    .in("external_id", [prefixed(run, "ae-a"), prefixed(run, "ae-b")]);
  for (const row of aeRows) assert.equal(row.status, "active");
});

test("GulfTalent: a complete SA refresh stale-closes only a missing SA job, never AE's jobs", async () => {
  const run = randomUUID().slice(0, 8);
  const saScope = `test-sa-${run}`;
  const aeScope = `test-ae-${run}`;

  await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(prefixed(run, "sa-keep"), { companyName: "Fixture Co" }), rawJob(prefixed(run, "sa-drop"), { companyName: "Fixture Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    saScope
  );
  await trackJobs([prefixed(run, "sa-keep"), prefixed(run, "sa-drop")], "gulftalent");

  await runMultiCompanyIngestionBatch(adminClient, "gulftalent", [rawJob(prefixed(run, "ae-keep"), { companyName: "Fixture Co" })], { maxJobsPerSource: 10, dryRun: false }, aeScope);
  await trackJobs([prefixed(run, "ae-keep")], "gulftalent");

  // Next complete SA refresh: only sa-keep reappears.
  const result = await runMultiCompanyIngestionBatch(adminClient, "gulftalent", [rawJob(prefixed(run, "sa-keep"), { companyName: "Fixture Co" })], { maxJobsPerSource: 10, dryRun: false }, saScope);
  assert.equal(result.truncated, false);
  assert.equal(result.jobsClosed, 1);

  const { data: keep } = await adminClient.from("jobs").select("status").eq("source_type", "gulftalent").eq("external_id", prefixed(run, "sa-keep")).single();
  assert.equal(keep.status, "active");

  const { data: drop } = await adminClient.from("jobs").select("status, status_reason").eq("source_type", "gulftalent").eq("external_id", prefixed(run, "sa-drop")).single();
  assert.equal(drop.status, "unavailable");
  assert.equal(drop.status_reason, "not_found_in_latest_ingestion_run");

  const { data: aeKeep } = await adminClient.from("jobs").select("status").eq("source_type", "gulftalent").eq("external_id", prefixed(run, "ae-keep")).single();
  assert.equal(aeKeep.status, "active", "AE's job must be untouched by an SA-only stale-close");
});

test("GulfTalent: a complete AE refresh stale-closes only a missing AE job, never SA's jobs (reversed roles)", async () => {
  const run = randomUUID().slice(0, 8);
  const saScope = `test-sa-${run}`;
  const aeScope = `test-ae-${run}`;

  await runMultiCompanyIngestionBatch(adminClient, "gulftalent", [rawJob(prefixed(run, "sa-keep"), { companyName: "Fixture Co" })], { maxJobsPerSource: 10, dryRun: false }, saScope);
  await trackJobs([prefixed(run, "sa-keep")], "gulftalent");

  await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(prefixed(run, "ae-keep"), { companyName: "Fixture Co" }), rawJob(prefixed(run, "ae-drop"), { companyName: "Fixture Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    aeScope
  );
  await trackJobs([prefixed(run, "ae-keep"), prefixed(run, "ae-drop")], "gulftalent");

  const result = await runMultiCompanyIngestionBatch(adminClient, "gulftalent", [rawJob(prefixed(run, "ae-keep"), { companyName: "Fixture Co" })], { maxJobsPerSource: 10, dryRun: false }, aeScope);
  assert.equal(result.jobsClosed, 1);

  const { data: drop } = await adminClient.from("jobs").select("status").eq("source_type", "gulftalent").eq("external_id", prefixed(run, "ae-drop")).single();
  assert.equal(drop.status, "unavailable");

  const { data: saKeep } = await adminClient.from("jobs").select("status").eq("source_type", "gulftalent").eq("external_id", prefixed(run, "sa-keep")).single();
  assert.equal(saKeep.status, "active", "SA's job must be untouched by an AE-only stale-close");
});

test("GulfTalent: a failed SA refresh (zero valid jobs) closes nothing in either SA or AE", async () => {
  const run = randomUUID().slice(0, 8);
  const saScope = `test-sa-${run}`;
  const aeScope = `test-ae-${run}`;

  await runMultiCompanyIngestionBatch(adminClient, "gulftalent", [rawJob(prefixed(run, "sa-x"), { companyName: "Fixture Co" })], { maxJobsPerSource: 10, dryRun: false }, saScope);
  await trackJobs([prefixed(run, "sa-x")], "gulftalent");
  await runMultiCompanyIngestionBatch(adminClient, "gulftalent", [rawJob(prefixed(run, "ae-x"), { companyName: "Fixture Co" })], { maxJobsPerSource: 10, dryRun: false }, aeScope);
  await trackJobs([prefixed(run, "ae-x")], "gulftalent");

  // Every raw job in this "run" is rejected (missing title) -> zero valid jobs -> outcome: no_valid_jobs, never reaches the stale-close branch.
  const failed = await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(prefixed(run, "sa-bad"), { title: null, companyName: "Fixture Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    saScope
  );
  assert.equal(failed.outcome, "no_valid_jobs");
  assert.equal(failed.jobsClosed, 0);

  const { data: sa } = await adminClient.from("jobs").select("status").eq("source_type", "gulftalent").eq("external_id", prefixed(run, "sa-x")).single();
  assert.equal(sa.status, "active");
  const { data: ae } = await adminClient.from("jobs").select("status").eq("source_type", "gulftalent").eq("external_id", prefixed(run, "ae-x")).single();
  assert.equal(ae.status, "active");
});

test("GulfTalent: a truncated SA refresh (more valid jobs than maxJobsPerSource) closes nothing", async () => {
  const run = randomUUID().slice(0, 8);
  const saScope = `test-sa-${run}`;

  await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(prefixed(run, "t-1"), { companyName: "Fixture Co" }), rawJob(prefixed(run, "t-2"), { companyName: "Fixture Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    saScope
  );
  await trackJobs([prefixed(run, "t-1"), prefixed(run, "t-2")], "gulftalent");

  // 2 valid jobs > maxJobsPerSource:1 -> truncated:true -> stale-close must be skipped entirely.
  const result = await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(prefixed(run, "t-1"), { companyName: "Fixture Co" }), rawJob(prefixed(run, "t-3"), { companyName: "Fixture Co" })],
    { maxJobsPerSource: 1, dryRun: false },
    saScope
  );
  assert.equal(result.truncated, true);
  assert.equal(result.jobsClosed, 0);

  const { data: t2 } = await adminClient.from("jobs").select("status").eq("source_type", "gulftalent").eq("external_id", prefixed(run, "t-2")).single();
  assert.equal(t2.status, "active", "a truncated run must never stale-close jobs simply outside its own cap");
});

test("GulfTalent: a SA job that stale-closed then reappears in a later SA refresh is reactivated with first_seen_at preserved", async () => {
  const run = randomUUID().slice(0, 8);
  const saScope = `test-sa-${run}`;

  await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(prefixed(run, "reopen"), { companyName: "Fixture Co" }), rawJob(prefixed(run, "keep"), { companyName: "Fixture Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    saScope
  );
  await trackJobs([prefixed(run, "reopen"), prefixed(run, "keep")], "gulftalent");
  const { data: original } = await adminClient.from("jobs").select("first_seen_at").eq("source_type", "gulftalent").eq("external_id", prefixed(run, "reopen")).single();

  const closeResult = await runMultiCompanyIngestionBatch(adminClient, "gulftalent", [rawJob(prefixed(run, "keep"), { companyName: "Fixture Co" })], { maxJobsPerSource: 10, dryRun: false }, saScope);
  assert.equal(closeResult.jobsClosed, 1);
  const { data: closed } = await adminClient.from("jobs").select("status, status_reason").eq("source_type", "gulftalent").eq("external_id", prefixed(run, "reopen")).single();
  assert.equal(closed.status, "unavailable");
  assert.equal(closed.status_reason, "not_found_in_latest_ingestion_run");

  await runMultiCompanyIngestionBatch(
    adminClient,
    "gulftalent",
    [rawJob(prefixed(run, "reopen"), { companyName: "Fixture Co" }), rawJob(prefixed(run, "keep"), { companyName: "Fixture Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    saScope
  );
  const { data: reopened } = await adminClient
    .from("jobs")
    .select("status, status_reason, first_seen_at")
    .eq("source_type", "gulftalent")
    .eq("external_id", prefixed(run, "reopen"))
    .single();
  assert.equal(reopened.status, "active");
  assert.equal(reopened.status_reason, null, "a reopened job must not keep displaying its old close reason");
  assert.equal(reopened.first_seen_at, original.first_seen_at, "reopening must not reset first_seen_at");
});

test("GulfTalent: the same external_id ingested twice within the same refresh scope updates one row, never duplicates (dedup identity unaffected)", async () => {
  const run = randomUUID().slice(0, 8);
  const saScope = `test-sa-${run}`;
  const id = prefixed(run, "dedup-1");

  const first = await runMultiCompanyIngestionBatch(adminClient, "gulftalent", [rawJob(id, { title: "First pass", companyName: "Fixture Co" })], { maxJobsPerSource: 10, dryRun: false }, saScope);
  assert.equal(first.jobsCreated, 1);
  await trackJobs([id], "gulftalent");

  const second = await runMultiCompanyIngestionBatch(adminClient, "gulftalent", [rawJob(id, { title: "Second pass", companyName: "Fixture Co" })], { maxJobsPerSource: 10, dryRun: false }, saScope);
  assert.equal(second.jobsCreated, 0);
  assert.equal(second.jobsUpdated, 1);

  const { data: rows } = await adminClient.from("jobs").select("id, title").eq("source_type", "gulftalent").eq("external_id", id);
  assert.equal(rows.length, 1, "a retried ingestion within the same refresh scope must update the same row, never create a second one");
  assert.equal(rows[0].title, "Second pass");
});

test("GulfTalent: dedup identity stays provider-wide — the same external_id reappearing under a different refresh_scope updates the existing row rather than duplicating it", async () => {
  const run = randomUUID().slice(0, 8);
  const saScope = `test-sa-${run}`;
  const aeScope = `test-ae-${run}`;
  const id = prefixed(run, "cross-scope");

  await runMultiCompanyIngestionBatch(adminClient, "gulftalent", [rawJob(id, { companyName: "Fixture Co" })], { maxJobsPerSource: 10, dryRun: false }, saScope);
  await trackJobs([id], "gulftalent");

  // Real GulfTalent jobIds are the provider's own global identifier — this
  // only models what the dedup index does IF the same identity were ever
  // seen under a different market call. It must update, never duplicate:
  // dedup_scope ('type:gulftalent') never incorporates refresh_scope.
  const result = await runMultiCompanyIngestionBatch(adminClient, "gulftalent", [rawJob(id, { companyName: "Fixture Co" })], { maxJobsPerSource: 10, dryRun: false }, aeScope);
  assert.equal(result.jobsCreated, 0);
  assert.equal(result.jobsUpdated, 1);

  const { data: rows } = await adminClient.from("jobs").select("id, refresh_scope").eq("source_type", "gulftalent").eq("external_id", id);
  assert.equal(rows.length, 1, "dedup identity (dedup_scope + external_id) must be unaffected by refresh_scope — never a duplicate row");
  assert.equal(rows[0].refresh_scope, aeScope, "the row's refresh_scope reflects whichever partition most recently ingested it");
});

test("Bayt: an explicit refresh scope stale-closes correctly, same as GulfTalent's partitioned behavior (Bayt itself still ships refreshScope: null in production — see the n8n seed and the parser's default)", async () => {
  const run = randomUUID().slice(0, 8);
  const scope = `test-fixture-${run}`;

  await runMultiCompanyIngestionBatch(
    adminClient,
    "bayt",
    [rawJob(prefixed(run, "bayt-keep"), { companyName: "Fixture Bayt Co" }), rawJob(prefixed(run, "bayt-drop"), { companyName: "Fixture Bayt Co" })],
    { maxJobsPerSource: 10, dryRun: false },
    scope
  );
  await trackJobs([prefixed(run, "bayt-keep"), prefixed(run, "bayt-drop")], "bayt");

  const result = await runMultiCompanyIngestionBatch(adminClient, "bayt", [rawJob(prefixed(run, "bayt-keep"), { companyName: "Fixture Bayt Co" })], { maxJobsPerSource: 10, dryRun: false }, scope);
  assert.equal(result.jobsClosed, 1);

  const { data: keepRow } = await adminClient.from("jobs").select("status, refresh_scope").eq("source_type", "bayt").eq("external_id", prefixed(run, "bayt-keep")).single();
  assert.equal(keepRow.status, "active");
  assert.equal(keepRow.refresh_scope, scope);

  const { data: dropRow } = await adminClient.from("jobs").select("status, refresh_scope").eq("source_type", "bayt").eq("external_id", prefixed(run, "bayt-drop")).single();
  assert.equal(dropRow.status, "unavailable");
  assert.equal(dropRow.refresh_scope, scope);
});

// Deliberately NOT exercised against "indeed"/"bayt"/"gulftalent" source
// types with refreshScope omitted: this local database can hold real,
// currently-inactive paid-pilot rows for exactly those three providers,
// and a future repair restoring them to active would make this test
// silently stale-close them again the moment it next ran — the precise
// mechanism that produced the real bug this suite exists to catch (see
// the "writes a real row once enabled:true" tests' comment above). jobicy
// has zero real local data, so it safely proves the same generic code
// path (refreshScope omitted/null is the default for every call above
// that never passes a 5th argument, e.g. every remoteok test in this
// file) without that risk.
test("refreshScope omitted reproduces the exact unchanged pre-fix stale-close behavior (scoped to source_type alone, refresh_scope stays null)", async () => {
  const run = randomUUID().slice(0, 8);
  const keep = prefixed(run, "jobicy-keep");
  const drop = prefixed(run, "jobicy-drop");

  const seed = await runMultiCompanyIngestionBatch(
    adminClient,
    "jobicy",
    [rawJob(keep, { companyName: "Fixture Jobicy Co" }), rawJob(drop, { companyName: "Fixture Jobicy Co" })],
    { maxJobsPerSource: 10, dryRun: false }
  );
  assert.equal(seed.jobsCreated, 2);
  await trackJobs([keep, drop], "jobicy");

  const result = await runMultiCompanyIngestionBatch(adminClient, "jobicy", [rawJob(keep, { companyName: "Fixture Jobicy Co" })], { maxJobsPerSource: 10, dryRun: false });
  assert.equal(result.jobsClosed, 1, "omitting refreshScope must still correctly stale-close within source_type, exactly as before this fix");

  const { data: keepRow } = await adminClient.from("jobs").select("status, refresh_scope").eq("source_type", "jobicy").eq("external_id", keep).single();
  assert.equal(keepRow.status, "active");
  assert.equal(keepRow.refresh_scope, null);

  const { data: dropRow } = await adminClient.from("jobs").select("status, refresh_scope").eq("source_type", "jobicy").eq("external_id", drop).single();
  assert.equal(dropRow.status, "unavailable");
  assert.equal(dropRow.refresh_scope, null);
});
