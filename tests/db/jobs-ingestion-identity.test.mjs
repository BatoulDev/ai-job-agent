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
      onConflict: "source_type,external_id",
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
      onConflict: "source_type,external_id",
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
