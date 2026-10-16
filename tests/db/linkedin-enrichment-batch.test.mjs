// DB integration tests for applyLinkedInEnrichmentBatch.ts and the new
// linkedin_enrichment_attempts/linkedin_enrichment_last_attempt_at
// columns (20261016090000_add_jobs_linkedin_enrichment_tracking.sql).
// LOCAL DATABASE ONLY. Mirrors linkedin-pilot-persistence.test.mjs's
// pattern of calling the real persistence function directly — the
// provider's `enabled` flag is irrelevant to this module (it operates on
// already-persisted rows by external_id, not on a live discovery call).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, insertFakeJob, deleteFakeJobs } from "./helpers.mjs";
import { applyLinkedInEnrichmentBatch } from "../../src/lib/ingestion/applyLinkedInEnrichmentBatch.ts";
import { findEligibleLinkedInEnrichmentJobs } from "../../src/lib/ingestion/findEligibleLinkedInEnrichmentJobs.ts";
import { checkJobEligibility } from "../../src/lib/ingestion/checkJobEligibility.ts";
import { deriveEligibilityLocation } from "../../src/lib/ingestion/jobEligibilityLocation.ts";

const run = randomUUID();
const createdJobIds = [];

after(async () => {
  await deleteFakeJobs(createdJobIds);
});

function prefixedExternalId(suffix) {
  return `${run}-${suffix}`;
}

async function insertFakeLinkedInJob(overrides = {}) {
  const job = await insertFakeJob({
    source_type: "linkedin",
    title: "Senior Accountant",
    description: "A real job description with no explicit work arrangement stated.",
    employment_type: null,
    work_arrangement: null,
    application_url: "https://www.linkedin.com/jobs/view/fixture",
    ...overrides,
  });
  createdJobIds.push(job.id);
  return job;
}

async function fetchJob(id) {
  const { data, error } = await adminClient
    .from("jobs")
    .select("id, external_id, dedup_scope, work_arrangement, employment_type, linkedin_enrichment_attempts, linkedin_enrichment_last_attempt_at")
    .eq("id", id)
    .single();
  if (error) throw new Error(`fetchJob failed: ${error.message}`);
  return data;
}

describe("migration columns (20261016090000)", () => {
  test("linkedin_enrichment_attempts defaults to 0 and linkedin_enrichment_last_attempt_at defaults to null", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("defaults");
    const job = await insertFakeLinkedInJob({ external_id: externalId });
    const row = await fetchJob(job.id);
    assert.equal(row.linkedin_enrichment_attempts, 0);
    assert.equal(row.linkedin_enrichment_last_attempt_at, null);
    assert.equal(row.dedup_scope, "type:linkedin");
  });

  test("linkedin_enrichment_attempts rejects a value outside [0,2] at the database level", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("range-check");
    const job = await insertFakeLinkedInJob({ external_id: externalId });
    const { error } = await adminClient.from("jobs").update({ linkedin_enrichment_attempts: 3 }).eq("id", job.id);
    assert.ok(error, "expected the check constraint to reject attempts=3");
  });
});

describe("applyLinkedInEnrichmentBatch — Case A: structured WA found", () => {
  test("persists the structured value and counts one attempt; re-running skips it (already resolved)", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("case-a");
    const job = await insertFakeLinkedInJob({ external_id: externalId, title: "Senior Accountant", description: "No explicit arrangement in the text." });

    const first = await applyLinkedInEnrichmentBatch(adminClient, [
      { requestedJobId: externalId, rawItem: { job_posting_id: externalId, workplace_types: ["ONSITE"], employment_status: "Full-time" } },
    ]);
    assert.equal(first.jobsUpdated, 1);
    assert.equal(first.structuredWaPresentCount, 1);

    const row = await fetchJob(job.id);
    assert.equal(row.work_arrangement, "onsite");
    assert.equal(row.employment_type, "full-time");
    assert.equal(row.linkedin_enrichment_attempts, 1);
    assert.ok(row.linkedin_enrichment_last_attempt_at);

    // Re-running the exact same batch must not re-spend — the job is
    // already resolved, regardless of attempts remaining under the cap.
    const second = await applyLinkedInEnrichmentBatch(adminClient, [
      { requestedJobId: externalId, rawItem: { job_posting_id: externalId, workplace_types: ["ONSITE"] } },
    ]);
    assert.equal(second.jobsUpdated, 0);
    assert.equal(second.jobsSkippedNotEligible, 1);

    const rowAfter = await fetchJob(job.id);
    assert.equal(rowAfter.linkedin_enrichment_attempts, 1, "attempts must not increase once resolved");
  });
});

describe("applyLinkedInEnrichmentBatch — Case B: structured empty, classifier resolves", () => {
  test("persists the classifier's value and counts one attempt; no further paid enrichment needed", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("case-b");
    const job = await insertFakeLinkedInJob({
      external_id: externalId,
      title: "Remote Call Center Representative",
      description: "Remote Work-at-Home POSITION OVERVIEW. This is a fully remote role.",
    });

    const result = await applyLinkedInEnrichmentBatch(adminClient, [
      { requestedJobId: externalId, rawItem: { job_posting_id: externalId, workplace_types: [] } },
    ]);
    assert.equal(result.jobsUpdated, 1);
    assert.equal(result.structuredWaEmptyCount, 1);
    assert.equal(result.classifierFallbackUsedCount, 1);

    const row = await fetchJob(job.id);
    assert.equal(row.work_arrangement, "remote");
    assert.equal(row.linkedin_enrichment_attempts, 1);
  });

  // Real regression this module exists to prevent: workplace_types:[] +
  // is_remote_allowed:false must never become "onsite" — the resolver
  // doesn't even accept is_remote_allowed as an input, but this proves
  // the end-to-end persisted outcome for the real MCI-shaped case.
  test("MCI regression: empty workplace_types on a genuinely remote job resolves to remote via the classifier, never onsite", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("mci-regression");
    await insertFakeLinkedInJob({
      external_id: externalId,
      title: "Remote Call Center Representative",
      description: "Remote Work-at-Home. Reliable internet connection and a quiet home workspace required.",
    });

    await applyLinkedInEnrichmentBatch(adminClient, [
      // is_remote_allowed is deliberately present in the raw fixture (as
      // data-slayer's real response shape includes it) but is never read
      // anywhere in this pipeline.
      { requestedJobId: externalId, rawItem: { job_posting_id: externalId, workplace_types: [], is_remote_allowed: false } },
    ]);

    const row = await adminClient.from("jobs").select("work_arrangement").eq("external_id", externalId).eq("dedup_scope", "type:linkedin").single();
    assert.equal(row.data.work_arrangement, "remote");
    assert.notEqual(row.data.work_arrangement, "onsite");
  });
});

describe("applyLinkedInEnrichmentBatch — Case C: bounded retry when both sources are unresolved", () => {
  test("attempts 0 -> 1 -> 2, then the job becomes ineligible for further automatic paid retries", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("case-c");
    const job = await insertFakeLinkedInJob({
      external_id: externalId,
      title: "Finance Director",
      description: "Act as a strategic advisor to the General Manager, translating financial insights into strategy.",
    });

    const r1 = await applyLinkedInEnrichmentBatch(adminClient, [{ requestedJobId: externalId, rawItem: { job_posting_id: externalId, workplace_types: [] } }]);
    assert.equal(r1.jobsUpdated, 1);
    assert.equal(r1.finalWaUnresolvedCount, 1);
    let row = await fetchJob(job.id);
    assert.equal(row.work_arrangement, null);
    assert.equal(row.linkedin_enrichment_attempts, 1);

    const r2 = await applyLinkedInEnrichmentBatch(adminClient, [{ requestedJobId: externalId, rawItem: { job_posting_id: externalId, workplace_types: [] } }]);
    assert.equal(r2.jobsUpdated, 1);
    row = await fetchJob(job.id);
    assert.equal(row.linkedin_enrichment_attempts, 2);

    // Third attempt: attempts is now at the cap — must be skipped, never queried again automatically.
    const r3 = await applyLinkedInEnrichmentBatch(adminClient, [{ requestedJobId: externalId, rawItem: { job_posting_id: externalId, workplace_types: [] } }]);
    assert.equal(r3.jobsUpdated, 0);
    assert.equal(r3.jobsSkippedNotEligible, 1);
    row = await fetchJob(job.id);
    assert.equal(row.linkedin_enrichment_attempts, 2, "attempts must never exceed the cap");
  });
});

describe("applyLinkedInEnrichmentBatch — Case D: provider/network failure never counts as an attempt", () => {
  test("rawItem: null leaves attempts untouched and the job immediately eligible again", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("case-d");
    const job = await insertFakeLinkedInJob({ external_id: externalId });

    const result = await applyLinkedInEnrichmentBatch(adminClient, [{ requestedJobId: externalId, rawItem: null }]);
    assert.equal(result.jobsProviderFailure, 1);
    assert.equal(result.jobsUpdated, 0);

    const row = await fetchJob(job.id);
    assert.equal(row.linkedin_enrichment_attempts, 0);
    assert.equal(row.linkedin_enrichment_last_attempt_at, null);
  });
});

describe("applyLinkedInEnrichmentBatch — identity mismatch never contaminates the row", () => {
  test("a returned job_posting_id that does not match the requested id is discarded, attempts untouched", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("mismatch");
    const job = await insertFakeLinkedInJob({ external_id: externalId });

    const result = await applyLinkedInEnrichmentBatch(adminClient, [
      { requestedJobId: externalId, rawItem: { job_posting_id: "some-other-job-id", workplace_types: ["ONSITE"] } },
    ]);
    assert.equal(result.identityMismatchCount, 1);
    assert.equal(result.jobsUpdated, 0);

    const row = await fetchJob(job.id);
    assert.equal(row.work_arrangement, null, "must never attach another job's data to this row");
    assert.equal(row.linkedin_enrichment_attempts, 0);
  });
});

describe("applyLinkedInEnrichmentBatch — employment type policy", () => {
  test("Bebity-present employment_type is never overridden, even when data-slayer disagrees", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("emp-conflict");
    await insertFakeLinkedInJob({ external_id: externalId, employment_type: "full-time" });

    const result = await applyLinkedInEnrichmentBatch(adminClient, [
      { requestedJobId: externalId, rawItem: { job_posting_id: externalId, workplace_types: [], employment_status: "Contract" } },
    ]);
    assert.equal(result.employmentTypeConflictCount, 1);

    const row = await adminClient.from("jobs").select("employment_type").eq("external_id", externalId).eq("dedup_scope", "type:linkedin").single();
    assert.equal(row.data.employment_type, "full-time", "Bebity's value must be retained on conflict");
  });

  test("Bebity-null employment_type is filled by data-slayer", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("emp-fill");
    await insertFakeLinkedInJob({ external_id: externalId, employment_type: null });

    const result = await applyLinkedInEnrichmentBatch(adminClient, [
      { requestedJobId: externalId, rawItem: { job_posting_id: externalId, workplace_types: [], employment_status: "Part-time" } },
    ]);
    assert.equal(result.employmentTypeFilledCount, 1);

    const row = await adminClient.from("jobs").select("employment_type").eq("external_id", externalId).eq("dedup_scope", "type:linkedin").single();
    assert.equal(row.data.employment_type, "part-time");
  });
});

describe("applyLinkedInEnrichmentBatch — partial batch handling", () => {
  test("one successful item and one provider-failure item in the same batch are handled independently", async () => {
    await assertExpectedLocalProject();
    const okId = prefixedExternalId("partial-ok");
    const failedId = prefixedExternalId("partial-failed");
    await insertFakeLinkedInJob({ external_id: okId });
    await insertFakeLinkedInJob({ external_id: failedId });

    const result = await applyLinkedInEnrichmentBatch(adminClient, [
      { requestedJobId: okId, rawItem: { job_posting_id: okId, workplace_types: ["HYBRID"] } },
      { requestedJobId: failedId, rawItem: null },
    ]);
    assert.equal(result.jobsRequested, 2);
    assert.equal(result.jobsUpdated, 1);
    assert.equal(result.jobsProviderFailure, 1);

    const okRow = await adminClient.from("jobs").select("work_arrangement, linkedin_enrichment_attempts").eq("external_id", okId).eq("dedup_scope", "type:linkedin").single();
    assert.equal(okRow.data.work_arrangement, "hybrid");
    assert.equal(okRow.data.linkedin_enrichment_attempts, 1);

    const failedRow = await adminClient.from("jobs").select("work_arrangement, linkedin_enrichment_attempts").eq("external_id", failedId).eq("dedup_scope", "type:linkedin").single();
    assert.equal(failedRow.data.work_arrangement, null);
    assert.equal(failedRow.data.linkedin_enrichment_attempts, 0);
  });
});

describe("matching behavior is unaffected by enrichment", () => {
  test("an enriched job still reaches checkJobEligibility exactly as an unenriched one would", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("matching");
    // country_code/city set directly — representative of a real row,
    // which already has these populated by normalizeLocation() at
    // Bebity discovery time, long before this enrichment pass ever runs.
    await insertFakeLinkedInJob({
      external_id: externalId,
      title: "Senior Accountant",
      description: "No explicit arrangement stated.",
      location: "Beirut, Beirut Governorate, Lebanon",
      country_code: "LB",
      city: "Beirut",
    });

    await applyLinkedInEnrichmentBatch(adminClient, [{ requestedJobId: externalId, rawItem: { job_posting_id: externalId, workplace_types: ["ONSITE"] } }]);

    const { data: row } = await adminClient
      .from("jobs")
      .select("location, country_code, city, work_arrangement, remote_scope, employment_type")
      .eq("external_id", externalId)
      .eq("dedup_scope", "type:linkedin")
      .single();

    const lebanonFreeUser = {
      planCode: "free",
      preferredWorkArrangement: "onsite",
      preferredJobType: "open",
      jobMarketCoverage: null,
      internationalSearchEnabled: false,
      willingToRelocate: null,
      relocationMarketCountryCodes: [],
    };
    const result = checkJobEligibility({ job: deriveEligibilityLocation(row), ...lebanonFreeUser });
    // Proves the enriched work_arrangement ("onsite", written by this
    // feature) flows unchanged into the existing, unmodified eligibility
    // function and correctly matches a user who prefers onsite.
    assert.equal(result.workArrangementStatus, "match");
    assert.equal(result.eligible, true);
  });
});

// Other tests in this file leave their own eligible/ineligible fixtures
// behind until the top-level after() hook runs, so these tests assert
// membership (does MY fixture appear/not appear), never an absolute
// total count, which would be fragile depending on test execution order.
describe("findEligibleLinkedInEnrichmentJobs — orchestration queue selection", () => {
  test("a job with work_arrangement null and attempts 0 is eligible", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("queue-eligible");
    await insertFakeLinkedInJob({ external_id: externalId, work_arrangement: null });

    const jobs = await findEligibleLinkedInEnrichmentJobs(adminClient, 1000);
    assert.ok(jobs.some((j) => j.externalId === externalId));
  });

  test("a job with a resolved work_arrangement is excluded", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("queue-resolved");
    await insertFakeLinkedInJob({ external_id: externalId, work_arrangement: "remote" });

    const jobs = await findEligibleLinkedInEnrichmentJobs(adminClient, 1000);
    assert.ok(!jobs.some((j) => j.externalId === externalId));
  });

  test("a job at the attempt cap (2) is excluded even with work_arrangement still null", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("queue-capped");
    await insertFakeLinkedInJob({ external_id: externalId, work_arrangement: null, linkedin_enrichment_attempts: 2 });

    const jobs = await findEligibleLinkedInEnrichmentJobs(adminClient, 1000);
    assert.ok(!jobs.some((j) => j.externalId === externalId));
  });

  test("a job with one attempt used (1 < 2) remains eligible", async () => {
    await assertExpectedLocalProject();
    const externalId = prefixedExternalId("queue-one-attempt");
    await insertFakeLinkedInJob({ external_id: externalId, work_arrangement: null, linkedin_enrichment_attempts: 1 });

    const jobs = await findEligibleLinkedInEnrichmentJobs(adminClient, 1000);
    assert.ok(jobs.some((j) => j.externalId === externalId));
  });

  test("the limit parameter bounds the returned batch size", async () => {
    await assertExpectedLocalProject();
    // Ensure at least 2 eligible rows exist regardless of other tests' state.
    await insertFakeLinkedInJob({ external_id: prefixedExternalId("queue-limit-a"), work_arrangement: null });
    await insertFakeLinkedInJob({ external_id: prefixedExternalId("queue-limit-b"), work_arrangement: null });

    const jobs = await findEligibleLinkedInEnrichmentJobs(adminClient, 1);
    assert.ok(jobs.length <= 1, "must never return more than the requested limit");
  });
});
