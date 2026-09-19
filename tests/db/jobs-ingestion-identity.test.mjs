// P0 review follow-up — deterministic source/external-job identity, duplicate
// prevention under CONCURRENT ingestion, and idempotent-retry-via-upsert.
// The pre-existing "duplicate (source_type, external_id) is rejected" test
// in jobs-and-admin.test.mjs only proves a SEQUENTIAL second insert is
// rejected (insert, await, insert again). It does not prove what two
// genuinely racing ingestion attempts do — the actual scenario a future
// ingestion worker must be safe under. This file closes that gap using the
// existing jobs_source_external_id_key unique index (20260809090030); no
// schema change was needed or made for this file.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, deleteFakeJobs } from "./helpers.mjs";

const jobIdsToClean = [];

after(async () => {
  await deleteFakeJobs(jobIdsToClean);
});

function fakeJobPayload(overrides = {}) {
  return {
    title: "Concurrent ingestion fixture",
    company_name: "Test Co",
    description: "x",
    application_method: "external_link",
    application_url: "https://example.test/apply",
    source_type: "greenhouse",
    status: "active",
    ...overrides,
  };
}

test("two concurrent inserts with the same (source_type, external_id) never both succeed", async () => {
  await assertExpectedLocalProject();
  const externalId = `concurrent-dup-${randomUUID()}`;

  const [a, b] = await Promise.allSettled([
    adminClient.from("jobs").insert(fakeJobPayload({ external_id: externalId })).select().single(),
    adminClient.from("jobs").insert(fakeJobPayload({ external_id: externalId })).select().single(),
  ]);

  const succeeded = [a, b].filter((r) => r.status === "fulfilled" && r.value.error === null);
  const rejected = [a, b].filter((r) => r.status === "fulfilled" && r.value.error !== null);

  assert.equal(succeeded.length, 1, "exactly one of the two racing inserts must win");
  assert.equal(rejected.length, 1, "the other must be rejected by jobs_source_external_id_key, not silently duplicated");

  jobIdsToClean.push(succeeded[0].value.data.id);

  const { data: rows } = await adminClient.from("jobs").select("id").eq("source_type", "greenhouse").eq("external_id", externalId);
  assert.equal(rows.length, 1, "exactly one row must exist in the table after both attempts settle");
});

test("ten concurrent inserts with the same (source_type, external_id) produce exactly one row", async () => {
  const externalId = `concurrent-dup-fanout-${randomUUID()}`;

  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => adminClient.from("jobs").insert(fakeJobPayload({ external_id: externalId })).select().single())
  );

  const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.error === null);
  assert.equal(succeeded.length, 1);
  jobIdsToClean.push(succeeded[0].value.data.id);

  const { data: rows } = await adminClient.from("jobs").select("id").eq("source_type", "greenhouse").eq("external_id", externalId);
  assert.equal(rows.length, 1);
});

test("an upsert on (source_type, external_id) gives an ingestion retry idempotent behavior (update in place, never a duplicate row)", async () => {
  const externalId = `upsert-retry-${randomUUID()}`;

  const { data: first, error: firstError } = await adminClient
    .from("jobs")
    .upsert(fakeJobPayload({ external_id: externalId, title: "First ingestion pass" }), {
      onConflict: "dedup_scope,external_id",
    })
    .select()
    .single();
  assert.equal(firstError, null);
  jobIdsToClean.push(first.id);

  // Simulates a retried/re-run ingestion attempt for the identical source
  // job — same (source_type, external_id), changed description/title, as a
  // real upstream re-scrape would produce.
  const { data: second, error: secondError } = await adminClient
    .from("jobs")
    .upsert(fakeJobPayload({ external_id: externalId, title: "Second ingestion pass (retry)" }), {
      onConflict: "dedup_scope,external_id",
    })
    .select()
    .single();
  assert.equal(secondError, null);
  assert.equal(second.id, first.id, "a retried upsert must update the same row, never create a second one");
  assert.equal(second.title, "Second ingestion pass (retry)");

  const { data: rows } = await adminClient.from("jobs").select("id").eq("source_type", "greenhouse").eq("external_id", externalId);
  assert.equal(rows.length, 1);
});

test("different sources may reuse the same external_id — the dedup key is (source_type, external_id), not external_id alone", async () => {
  const sharedExternalId = `shared-across-sources-${randomUUID()}`;

  const { data: greenhouseJob, error: greenhouseError } = await adminClient
    .from("jobs")
    .insert(fakeJobPayload({ source_type: "greenhouse", external_id: sharedExternalId }))
    .select()
    .single();
  assert.equal(greenhouseError, null);
  jobIdsToClean.push(greenhouseJob.id);

  const { data: leverJob, error: leverError } = await adminClient
    .from("jobs")
    .insert(fakeJobPayload({ source_type: "lever", external_id: sharedExternalId }))
    .select()
    .single();
  assert.equal(leverError, null, "a different source_type reusing the identical external_id must succeed, not collide");
  jobIdsToClean.push(leverJob.id);

  assert.notEqual(greenhouseJob.id, leverJob.id);

  const { data: rows } = await adminClient.from("jobs").select("id, source_type").eq("external_id", sharedExternalId);
  assert.equal(rows.length, 2);
});

test("admin_manual jobs (external_id null) are exempt from the dedup key even under concurrency", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => adminClient.from("jobs").insert(fakeJobPayload({ source_type: "admin_manual", external_id: null })).select().single())
  );
  const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.error === null);
  assert.equal(succeeded.length, 5, "manually-entered jobs with no external id must never collide with each other");
  for (const r of succeeded) jobIdsToClean.push(r.value.data.id);
});

test("provenance columns are independently queryable per job (source_type, source_url, external_id)", async () => {
  const { data: job, error } = await adminClient
    .from("jobs")
    .insert(
      fakeJobPayload({
        external_id: `provenance-${randomUUID()}`,
        source_url: "https://boards.greenhouse.io/example/jobs/12345",
      })
    )
    .select()
    .single();
  assert.equal(error, null);
  jobIdsToClean.push(job.id);

  assert.equal(job.source_type, "greenhouse");
  assert.notEqual(job.source_url, null);
  assert.notEqual(job.external_id, null);
  // created_by is nullable (on delete set null) precisely so a service-role
  // ingestion insert — with no authenticated user in the request — is a
  // fully valid, provenance-complete row via source_type/source_url/
  // external_id alone; it is not required for provenance.
  assert.equal(job.created_by, null);
});

// ── Same-ATS / different-company collision (job-ingestion pilot review) ───
//
// jobs.source_type is an ATS/provider CATEGORY ('greenhouse' | 'lever' |
// 'workable' | ...), not a company- or source-specific value (confirmed by
// 20260809090030_create_jobs.sql's own check constraint and the 4 real pilot
// rows, which show both Scale AI and Alpaca as source_type='greenhouse').
// jobs.source_id (added later, 20260914150000) points at the specific
// company_sources row and is explicitly documented there as "distinct from
// jobs.source_type/external_id (the per-source dedup key, unrelated to
// company identity)" — i.e. the schema itself already flags source_id as a
// separate identity dimension that the dedup key does not include.
//
// This test proves, against the real local database, what actually happens
// if two DIFFERENT company_sources on the SAME ATS ever produce the SAME
// external_id: does the dedup key correctly keep them apart, or does a
// same-shaped upsert (exactly what the pilot workflow's Upsert Jobs node
// issues: on_conflict=source_type,external_id + merge-duplicates) silently
// splice one company's data into the other's existing row?
const fixtureCompanyIds = [];
const fixtureSourceIds = [];

// Bug found in this same review: jobs.source_id -> company_sources(id) has no
// ON DELETE clause (defaults to RESTRICT), so deleting a company_sources row
// while any jobs row still references it fails outright. Node's test runner
// runs same-file after() hooks in REVERSE registration order — this hook
// (registered after the top-of-file `after(() => deleteFakeJobs(...))`) would
// otherwise run BEFORE that job cleanup, hitting exactly that FK violation.
// The delete calls' errors were also never checked, so the failure was
// silent: six fixture companies/company_sources rows (labels a-f, across
// this file's several manual test-iteration runs) leaked into the shared
// local registry undetected until a whole-suite count check caught it.
// Fixed by deleting any jobs referencing these fixture sources FIRST, in
// this same hook, regardless of what the other after() hook does or when it
// runs — and by asserting every delete actually succeeded.
after(async () => {
  if (fixtureSourceIds.length > 0) {
    const { error: jobsError } = await adminClient.from("jobs").delete().in("source_id", fixtureSourceIds);
    if (jobsError) throw new Error(`cleanup: failed to delete jobs referencing fixture company_sources: ${jobsError.message}`);

    const { error: sourcesError } = await adminClient.from("company_sources").delete().in("id", fixtureSourceIds);
    if (sourcesError) throw new Error(`cleanup: failed to delete fixture company_sources: ${sourcesError.message}`);
  }
  if (fixtureCompanyIds.length > 0) {
    const { error: companiesError } = await adminClient.from("companies").delete().in("id", fixtureCompanyIds);
    if (companiesError) throw new Error(`cleanup: failed to delete fixture companies: ${companiesError.message}`);
  }
});

async function createFixtureCompanySource(label, atsProvider) {
  const suffix = randomUUID().slice(0, 8);
  const companyId = `test-collision-co-${label}-${suffix}`;
  const sourceId = `test-collision-src-${label}-${suffix}`;

  const { error: companyError } = await adminClient
    .from("companies")
    .insert({ id: companyId, display_name: `Collision Test Co ${label}` });
  if (companyError) throw new Error(`fixture company insert failed: ${companyError.message}`);
  fixtureCompanyIds.push(companyId);

  const { error: sourceError } = await adminClient.from("company_sources").insert({
    id: sourceId,
    company_id: companyId,
    company_name: `Collision Test Co ${label}`,
    target_country: "Test",
    ats_provider: atsProvider,
    review_status: "verified",
  });
  if (sourceError) throw new Error(`fixture company_sources insert failed: ${sourceError.message}`);
  fixtureSourceIds.push(sourceId);

  return sourceId;
}

test("FIXED: two different company_sources on the SAME ATS with the SAME external_id now correctly coexist under (dedup_scope, external_id) — the source-specific identity fix", async () => {
  const sourceA = await createFixtureCompanySource("e", "greenhouse");
  const sourceB = await createFixtureCompanySource("f", "greenhouse");
  const collidingExternalId = `same-ats-coexist-${randomUUID()}`;

  const { data: jobA, error: jobAError } = await adminClient
    .from("jobs")
    .insert(fakeJobPayload({ source_type: "greenhouse", external_id: collidingExternalId, source_id: sourceA, company_name: "Collision Test Co e", title: "Job genuinely posted by company E" }))
    .select()
    .single();
  assert.equal(jobAError, null);
  jobIdsToClean.push(jobA.id);

  const { data: jobB, error: jobBError } = await adminClient
    .from("jobs")
    .insert(fakeJobPayload({ source_type: "greenhouse", external_id: collidingExternalId, source_id: sourceB, company_name: "Collision Test Co f", title: "Job genuinely posted by company F" }))
    .select()
    .single();
  assert.equal(jobBError, null, "two genuinely different company_sources sharing an ATS and an external_id must now coexist");
  jobIdsToClean.push(jobB.id);

  assert.notEqual(jobA.id, jobB.id);

  const { data: rows } = await adminClient.from("jobs").select("id, source_id, company_name").eq("source_type", "greenhouse").eq("external_id", collidingExternalId);
  assert.equal(rows.length, 2, "both logical jobs must exist side by side");

  // Reingesting either source updates only its own logical job.
  const { data: reingested, error: reingestError } = await adminClient
    .from("jobs")
    .upsert(
      { title: "Job E, retried ingestion", company_name: "Collision Test Co e", description: "A fake job fixture for automated tests only.", application_method: "external_link", application_url: "https://example.test/apply", source_type: "greenhouse", external_id: collidingExternalId, source_id: sourceA, status: "active" },
      { onConflict: "dedup_scope,external_id" }
    )
    .select()
    .single();
  assert.equal(reingestError, null);
  assert.equal(reingested.id, jobA.id, "reingesting source A must update job A's own row, never job B's");
  assert.equal(reingested.title, "Job E, retried ingestion");

  const { data: jobBUnchanged } = await adminClient.from("jobs").select("title, source_id").eq("id", jobB.id).single();
  assert.equal(jobBUnchanged.title, "Job genuinely posted by company F", "job B must be completely unaffected by source A's reingestion");
  assert.equal(jobBUnchanged.source_id, sourceB);
});

test("FIX VERIFIED: the OLD vulnerable on_conflict target (source_type,external_id) is no longer usable at all — the collision path is closed, not just superseded", async () => {
  const sourceA = await createFixtureCompanySource("c", "greenhouse");
  const sourceB = await createFixtureCompanySource("d", "greenhouse");
  const collidingExternalId = `same-ats-collision-upsert-${randomUUID()}`;

  const { data: jobA, error: jobAError } = await adminClient
    .from("jobs")
    .insert(fakeJobPayload({ source_type: "greenhouse", external_id: collidingExternalId, source_id: sourceA, company_name: "Collision Test Co c", title: "Job genuinely posted by company C" }))
    .select()
    .single();
  assert.equal(jobAError, null);
  jobIdsToClean.push(jobA.id);

  // Before the fix, this exact request shape (the pilot workflow's own
  // "Upsert Jobs" node: on_conflict=source_type,external_id + Prefer:
  // resolution=merge-duplicates) silently spliced company D's data into
  // company C's row (same id, wrong source_id/company_name, no error at
  // all). jobs_source_external_id_key (source_type, external_id) no longer
  // exists as of 20260915170000 — PostgREST/Postgres must now reject this
  // on_conflict target outright (error 42P10), proving the vulnerable path
  // itself is gone, not merely bypassed by callers using a different target.
  const { error: mergeError } = await adminClient
    .from("jobs")
    .upsert(
      {
        title: "Job genuinely posted by company D",
        company_name: "Collision Test Co d",
        description: "A fake job fixture for automated tests only.",
        application_method: "external_link",
        application_url: "https://example.test/apply",
        source_type: "greenhouse",
        external_id: collidingExternalId,
        source_id: sourceB,
        status: "active",
      },
      { onConflict: "source_type,external_id" }
    )
    .select()
    .single();

  assert.notEqual(mergeError, null, "on_conflict=source_type,external_id must be rejected — no unique index backs it any more");

  const { data: rows } = await adminClient.from("jobs").select("id, source_id, company_name").eq("source_type", "greenhouse").eq("external_id", collidingExternalId);
  assert.equal(rows.length, 1, "the rejected upsert must not have written anything");
  assert.equal(rows[0].id, jobA.id);
  assert.equal(rows[0].source_id, sourceA, "company C's original job must remain completely untouched");
});
