// LinkedIn Lebanon final-validation phase (docs/LEBANON_LIVE_SOURCE_EXPANSION.md
// §12): proves a controlled, real-shaped subset of LinkedIn jobs can pass
// end-to-end through the real adapter -> validate -> normalize -> persist
// path into the local test database, and that re-ingestion is idempotent —
// WITHOUT flipping providerConfig.ts's linkedin.enabled to true just to test.
//
// Calls persistValidatedJobs directly (exported from ingestSourceBatch.ts
// specifically for this purpose) with already-mapped/validated rows — the
// exact same idempotent-upsert/dedupe/stale-close code a real enabled run
// would use via runMultiCompanyIngestionBatch, which this test deliberately
// does not go through (it would 400/no-op on provider_not_enabled, proven
// separately in tests/db/ingest-multi-company-batch.test.mjs).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, deleteFakeJobs } from "./helpers.mjs";
import { persistValidatedJobs } from "../../src/lib/ingestion/ingestSourceBatch.ts";
import { mapLinkedInJob } from "../../src/lib/ingestion/providers/linkedin.ts";
import { validateMultiCompanyProviderJob } from "../../src/lib/ingestion/multiCompanyProviderJob.ts";
import { mapRawProviderJobToJobRow } from "../../src/lib/ingestion/rawProviderJob.ts";
import { deriveEligibilityLocation } from "../../src/lib/ingestion/jobEligibilityLocation.ts";
import { checkJobEligibility } from "../../src/lib/ingestion/checkJobEligibility.ts";

const run = randomUUID();
const jobIdsToClean = [];

after(async () => {
  await deleteFakeJobs(jobIdsToClean);
});

async function trackJobs(externalIds) {
  const { data } = await adminClient.from("jobs").select("id").eq("source_type", "linkedin").in("external_id", externalIds);
  for (const row of data ?? []) jobIdsToClean.push(row.id);
}

function prefixed(id) {
  return `${run}-${id}`;
}

// Real-shaped subset mirroring the actual 30-item Lebanon pilot sample
// (docs/LEBANON_LIVE_SOURCE_EXPANSION.md §12) — a remote Easy-Apply job, a
// hybrid Easy-Apply job (classifier fallback), an EXTERNAL job with a real
// external applyUrl, an EXTERNAL job with an empty applyUrl (jobUrl
// fallback), and an unknown-work-arrangement job — not a generic fixture.
const PILOT_SUBSET_RAW = [
  {
    id: prefixed("4236879065"),
    title: "Remote Mortgage Customer Service Representative",
    companyName: "MCI",
    location: "Lebanon",
    description: "Handle inbound customer calls in a courteous, timely, and professional manner. This is a Remote Work-at-Home position.",
    contractType: "Full-time",
    workType: "",
    applyType: "EASY_APPLY",
    applyUrl: `https://lb.linkedin.com/jobs/view/${prefixed("4236879065")}`,
    jobUrl: `https://lb.linkedin.com/jobs/view/${prefixed("4236879065")}`,
    publishedAt: "2025-05-28",
    experienceLevel: "Not Applicable",
  },
  {
    id: prefixed("4472557411"),
    title: "Execution Trader",
    companyName: "Fixture Trading Co",
    location: "Beirut Governorate, Lebanon",
    description: "You'll be executing live orders across equities, ETFs, fixed income, FX, options and futures. Beirut — hybrid, 2-3 days on-site / 2-3 remote.",
    contractType: "Full-time",
    workType: "",
    applyType: "EASY_APPLY",
    applyUrl: `https://lb.linkedin.com/jobs/view/${prefixed("4472557411")}`,
    jobUrl: `https://lb.linkedin.com/jobs/view/${prefixed("4472557411")}`,
    publishedAt: "2026-10-01",
    experienceLevel: "Mid-Senior level",
  },
  {
    id: prefixed("4475403679"),
    title: "Finance Director",
    companyName: "L'Oréal",
    location: "Beirut, Beirut Governorate, Lebanon",
    description: "Act as a strategic advisor to the General Manager and brand heads, translating financial insights into actionable business strategies.",
    contractType: "Full-time",
    workType: "",
    applyType: "EXTERNAL",
    applyUrl: "https://careers-apply.loreal.test/job/257296",
    jobUrl: `https://www.linkedin.com/jobs/view/${prefixed("4475403679")}`,
    publishedAt: "2026-10-07",
    experienceLevel: "Not Applicable",
  },
  {
    id: prefixed("4438265428"),
    title: "Senior Java Developer - Remote Work",
    companyName: "BairesDev",
    location: "Lebanon",
    description: "Lead the design and development of complex, high-performance Java applications. 100% remote work (from anywhere).",
    contractType: "Full-time",
    workType: "",
    applyType: "EXTERNAL",
    applyUrl: "", // real finding: EXTERNAL with an empty applyUrl — jobUrl fallback must be used
    jobUrl: `https://www.linkedin.com/jobs/view/${prefixed("4438265428")}`,
    publishedAt: "2026-08-04",
    experienceLevel: "Not Applicable",
  },
  {
    id: prefixed("4474709782"),
    title: "Technician (Mechanical)",
    companyName: "Nexans",
    location: "Nahr Ibrahim, Keserwan-Jbeil Governorate, Lebanon",
    description: "The Maintenance Technician is responsible for the equipment performance and availability within his own field of expertise and perimeter.",
    contractType: "Full-time",
    workType: "",
    applyType: "EXTERNAL",
    applyUrl: "https://career.nexans.test/job/80984",
    jobUrl: `https://www.linkedin.com/jobs/view/${prefixed("4474709782")}`,
    publishedAt: "2026-10-02",
    experienceLevel: "Not Applicable",
  },
];

function buildValidatedRows() {
  const validated = [];
  for (const raw of PILOT_SUBSET_RAW) {
    const mapped = mapLinkedInJob(raw);
    const v = validateMultiCompanyProviderJob(mapped, "linkedin");
    assert.equal(v.valid, true, `fixture ${raw.id} should be valid: ${JSON.stringify(v)}`);
    validated.push(mapRawProviderJobToJobRow(mapped, { sourceId: null, sourceType: "linkedin" }));
  }
  return validated;
}

test("a controlled real-shaped LinkedIn subset persists correctly via the shared persistence path (provider stays disabled)", async () => {
  await assertExpectedLocalProject();
  const validated = buildValidatedRows();
  const externalIds = PILOT_SUBSET_RAW.map((r) => r.id);

  const result = await persistValidatedJobs(adminClient, PILOT_SUBSET_RAW.length, validated, 0, { maxJobsPerSource: 10, dryRun: false }, {
    sourceId: null,
    sourceType: "linkedin",
    refreshScope: `test-fixture-${run}`,
  });
  await trackJobs(externalIds);

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsCreated, 5);
  assert.equal(result.jobsUpdated, 0);

  const { data: rows } = await adminClient
    .from("jobs")
    .select(
      "source_type, external_id, dedup_scope, refresh_scope, title, company_name, location, country_code, city, description, employment_type, work_arrangement, published_at, application_method, application_url, status, source_url"
    )
    .eq("source_type", "linkedin")
    .in("external_id", externalIds)
    .order("external_id");

  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.equal(row.source_type, "linkedin");
    assert.equal(row.dedup_scope, "type:linkedin");
    assert.equal(row.refresh_scope, `test-fixture-${run}`);
    assert.ok(row.title);
    assert.ok(row.company_name);
    assert.ok(row.description);
    assert.equal(row.employment_type, "full-time");
    assert.ok(row.application_url, "every row must have a usable application target (direct or jobUrl fallback)");
    assert.ok(row.source_url, "every row must preserve the canonical LinkedIn URL");
    assert.ok(["active", "pending_review"].includes(row.status));
  }

  const byId = Object.fromEntries(rows.map((r) => [r.external_id, r]));
  // The MCI remote job: country-level location, real work_arrangement from the classifier fallback.
  assert.equal(byId[prefixed("4236879065")].work_arrangement, "remote");
  assert.equal(byId[prefixed("4236879065")].country_code, "LB");
  // The Beirut hybrid job: classifier fallback again, this time hybrid.
  assert.equal(byId[prefixed("4472557411")].work_arrangement, "hybrid");
  assert.equal(byId[prefixed("4472557411")].city, "Beirut");
  // Finance Director: no structured or classifiable signal — stays null, never guessed.
  assert.equal(byId[prefixed("4475403679")].work_arrangement, null);
  // The EXTERNAL job with an empty applyUrl: application_url must be the jobUrl fallback, never null.
  assert.equal(byId[prefixed("4438265428")].application_url, `https://www.linkedin.com/jobs/view/${prefixed("4438265428")}`);
  assert.equal(byId[prefixed("4438265428")].work_arrangement, "remote");
});

test("re-ingesting the exact same subset is idempotent — no duplicate rows, jobsCreated:0", async () => {
  await assertExpectedLocalProject();
  const validated = buildValidatedRows();
  const externalIds = PILOT_SUBSET_RAW.map((r) => r.id);

  // First pass (independent of the test above — randomUUID() run id keeps fixtures isolated per test file execution).
  await persistValidatedJobs(adminClient, PILOT_SUBSET_RAW.length, validated, 0, { maxJobsPerSource: 10, dryRun: false }, {
    sourceId: null,
    sourceType: "linkedin",
    refreshScope: `test-fixture-${run}`,
  });
  await trackJobs(externalIds);

  const { count: countAfterFirst } = await adminClient
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("source_type", "linkedin")
    .in("external_id", externalIds);
  assert.equal(countAfterFirst, 5);

  // Second pass: same batch, same scope — simulates the same LinkedIn job being re-discovered on the next ingestion run.
  const second = await persistValidatedJobs(adminClient, PILOT_SUBSET_RAW.length, validated, 0, { maxJobsPerSource: 10, dryRun: false }, {
    sourceId: null,
    sourceType: "linkedin",
    refreshScope: `test-fixture-${run}`,
  });

  assert.equal(second.jobsCreated, 0);
  assert.equal(second.jobsUpdated, 5);

  const { count: countAfterSecond } = await adminClient
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("source_type", "linkedin")
    .in("external_id", externalIds);
  assert.equal(countAfterSecond, 5, "re-ingestion must never create duplicate rows");
});

test("the same real external id reappearing under a different raw jobUrl query-param decoration still dedupes to one row (identity is external_id, never the URL)", async () => {
  await assertExpectedLocalProject();
  const id = prefixed(`tracking-${randomUUID()}`);
  const baseRaw = {
    id,
    title: "Tracking Param Dedup Fixture",
    companyName: "Fixture Co",
    location: "Beirut, Lebanon",
    description: "Proves dedupe identity is external_id, not the decorated LinkedIn URL.",
    contractType: "Full-time",
    workType: "",
    applyType: "EASY_APPLY",
  };

  const firstRaw = { ...baseRaw, applyUrl: `https://lb.linkedin.com/jobs/view/fixture-${id}?trk=public_jobs_topcard-title`, jobUrl: `https://lb.linkedin.com/jobs/view/fixture-${id}?trk=public_jobs_topcard-title` };
  const secondRaw = { ...baseRaw, applyUrl: `https://lb.linkedin.com/jobs/view/fixture-${id}?trk=flagship3_search_srp_jobs&refId=xyz`, jobUrl: `https://lb.linkedin.com/jobs/view/fixture-${id}?trk=flagship3_search_srp_jobs&refId=xyz` };

  const mapRow = (raw) => mapRawProviderJobToJobRow(mapLinkedInJob(raw), { sourceId: null, sourceType: "linkedin" });

  await persistValidatedJobs(adminClient, 1, [mapRow(firstRaw)], 0, { maxJobsPerSource: 10, dryRun: false }, { sourceId: null, sourceType: "linkedin", refreshScope: `test-fixture-${run}` });
  await trackJobs([id]);
  await persistValidatedJobs(adminClient, 1, [mapRow(secondRaw)], 0, { maxJobsPerSource: 10, dryRun: false }, { sourceId: null, sourceType: "linkedin", refreshScope: `test-fixture-${run}` });

  const { data: rows } = await adminClient.from("jobs").select("id, source_url").eq("source_type", "linkedin").eq("external_id", id);
  assert.equal(rows.length, 1, "a second ingestion with a differently-decorated tracking URL must update the same row, never insert a second one");
  assert.match(rows[0].source_url, /refId=xyz/, "the row's source_url reflects the latest ingestion's URL, as expected for an update");
});

// Phase 12 (matching compatibility): using the real persisted LinkedIn rows
// above, prove checkJobEligibility()/deriveEligibilityLocation() — the same
// bridge already proven for Bayt/GulfTalent/Indeed
// (docs/LEBANON_LIVE_SOURCE_EXPANSION.md §5) — handles LinkedIn rows
// identically. No real users/CVs: every "user" here is a synthetic
// JobEligibilityInput object, never a database row.
test("real persisted LinkedIn rows reach matching eligibility correctly for synthetic test users", async () => {
  await assertExpectedLocalProject();
  const validated = buildValidatedRows();
  const externalIds = PILOT_SUBSET_RAW.map((r) => r.id);

  await persistValidatedJobs(adminClient, PILOT_SUBSET_RAW.length, validated, 0, { maxJobsPerSource: 10, dryRun: false }, {
    sourceId: null,
    sourceType: "linkedin",
    refreshScope: `test-fixture-${run}`,
  });
  await trackJobs(externalIds);

  const { data: rows } = await adminClient
    .from("jobs")
    .select("external_id, title, description, location, country_code, city, work_arrangement, remote_scope, employment_type")
    .eq("source_type", "linkedin")
    .in("external_id", externalIds);
  const byId = Object.fromEntries(rows.map((r) => [r.external_id, r]));

  // Title/description are plain columns — matching's semantic layer reads
  // them directly off the row; proving they survived ingestion intact is
  // sufficient (no separate "reaches semantic matching" wiring to test).
  assert.ok(byId[prefixed("4236879065")].title.length > 0);
  assert.ok(byId[prefixed("4236879065")].description.length > 0);

  const lebanonFreeUser = {
    planCode: "free",
    preferredWorkArrangement: null,
    preferredJobType: "open",
    jobMarketCoverage: null,
    internationalSearchEnabled: false,
    willingToRelocate: null,
    relocationMarketCountryCodes: [],
  };

  // MCI remote job (Lebanon, work_arrangement:remote): eligible for a
  // Lebanon-market user via the Lebanon-inclusive remote-scope branch.
  // workArrangementStatus is "unknown" here because this synthetic user has
  // no stated preference (null) — a known job arrangement vs. no user
  // preference is still "unknown", never spuriously "match".
  {
    const job = byId[prefixed("4236879065")];
    const result = checkJobEligibility({ job: deriveEligibilityLocation(job), ...lebanonFreeUser });
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "unknown");
  }

  // Finance Director (Beirut, country_code:LB, work_arrangement:null —
  // unknown/never guessed): must NOT be falsely rejected just because
  // work_arrangement is unknown — the founder decision's core rule.
  {
    const job = byId[prefixed("4475403679")];
    const location = deriveEligibilityLocation(job);
    assert.equal(location.workArrangement, null, "real finding: no structured or classifiable signal for this job");
    const result = checkJobEligibility({ job: location, ...lebanonFreeUser });
    assert.equal(result.eligible, true, "unknown work_arrangement must not cause a false rejection for an otherwise-eligible Lebanon job");
    assert.equal(result.workArrangementStatus, "unknown");
  }

  // A known work-arrangement CONFLICT must still reject: synthetic user
  // wants onsite only, job (Execution Trader) is hybrid.
  {
    const job = byId[prefixed("4472557411")];
    const onsiteOnlyUser = { ...lebanonFreeUser, preferredWorkArrangement: "onsite" };
    const result = checkJobEligibility({ job: deriveEligibilityLocation(job), ...onsiteOnlyUser });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "work_arrangement_conflict");
  }

  // A known employment-type CONFLICT must still reject: synthetic user
  // wants part-time only, every real sample job is full-time.
  {
    const job = byId[prefixed("4475403679")];
    const partTimeOnlyUser = { ...lebanonFreeUser, preferredJobType: "part-time" };
    const result = checkJobEligibility({ job: deriveEligibilityLocation(job), ...partTimeOnlyUser });
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "employment_type_conflict");
  }

  // A Pro user with remote_worldwide coverage: the Nexans onsite-Lebanon
  // job (country_code:LB) is eligible regardless of market-coverage tier
  // (Lebanon itself is always in scope) — proves a non-remote LinkedIn row
  // survives into a Pro user's eligible set too, not just Free/Student.
  {
    const job = byId[prefixed("4474709782")];
    const proRemoteWorldwideUser = {
      planCode: "pro",
      preferredWorkArrangement: null,
      preferredJobType: "open",
      jobMarketCoverage: "remote_worldwide",
      internationalSearchEnabled: true,
      willingToRelocate: false,
      relocationMarketCountryCodes: [],
    };
    const result = checkJobEligibility({ job: deriveEligibilityLocation(job), ...proRemoteWorldwideUser });
    assert.equal(result.eligible, true);
  }
});
