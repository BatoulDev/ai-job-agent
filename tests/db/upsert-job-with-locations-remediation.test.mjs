// tests/db/upsert-job-with-locations-remediation.test.mjs
//
// Checkpoint 2C corrective fix (20261027090000_fix_job_locations_null_city_and_remote_status.sql)
// — guarded local integration coverage for the three fixes to
// upsert_job_with_locations(): (1) a genuinely-null p_locations.city is
// accepted, (2) p_locations.is_primary rejects explicit JSON null, (3) a
// country-less Remote job falls back to the new primary_location_confidence
// input, gated to work_arrangement='remote' with no qualifying p_locations
// row. LOCAL DATABASE ONLY — see localTestGuard.mjs for the three
// independent safety checks enforced at import time.
//
// Calls the RPC directly via adminClient (service_role) rather than through
// persistValidatedJobs, so each test controls the exact p_job/p_locations
// shape being validated — the TypeScript pass-through
// (rawProviderJob.ts/ingestSourceBatch.ts) is covered separately by the
// existing unit tests, which already assert primaryLocationConfidence is
// set to the pure normalizeLocation() output.
//
// Every fixture job is tracked by id and deleted in after() — never left
// behind on success or failure.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject } from "./helpers.mjs";

before(async () => {
  await assertExpectedLocalProject();
});

const createdJobIds = [];

after(async () => {
  if (createdJobIds.length === 0) return;
  const { error } = await adminClient.from("jobs").delete().in("id", createdJobIds);
  if (error) throw new Error(`cleanup: failed to delete fixture jobs: ${error.message}`);
});

function baseJob(overrides = {}) {
  const suffix = randomUUID();
  return {
    title: "Remediation Fixture Job",
    company_name: "Remediation Fixture Co",
    description: "A fixture job for the Checkpoint 2C corrective-fix test suite.",
    application_method: "external_link",
    application_url: "https://example.test/apply",
    source_type: "admin_manual",
    external_id: `remediation-fixture-${suffix}`,
    ...overrides,
  };
}

async function callRpc(p_job, p_locations = [], p_replace_locations = true) {
  return adminClient.rpc("upsert_job_with_locations", { p_job, p_locations, p_replace_locations });
}

async function readJob(externalId) {
  const { data, error } = await adminClient
    .from("jobs")
    .select("id, status, work_arrangement, remote_scope, country_code, city")
    .eq("external_id", externalId)
    .eq("dedup_scope", "type:admin_manual")
    .maybeSingle();
  assert.equal(error, null, `readJob failed: ${error?.message}`);
  return data;
}

async function readLocations(jobId) {
  const { data, error } = await adminClient
    .from("job_locations")
    .select("country_code, city, is_primary, location_confidence")
    .eq("job_id", jobId);
  assert.equal(error, null, `readLocations failed: ${error?.message}`);
  return data;
}

test("accepts a genuinely-null city for a country-only location (Lebanon)", async () => {
  const job = baseJob({ country_code: "LB", city: null, work_arrangement: "onsite" });
  const { data, error } = await callRpc(job, [
    { country_code: "LB", city: null, is_primary: true, location_confidence: "high" },
  ]);
  assert.equal(error, null, `expected success, got: ${error?.message}`);
  createdJobIds.push(data[0].out_job_id);
  assert.equal(data[0].out_status, "active");

  const locations = await readLocations(data[0].out_job_id);
  assert.equal(locations.length, 1);
  assert.equal(locations[0].city, null);
  assert.equal(locations[0].country_code, "LB");
});

test("rejects a non-string, non-null city (invalid type)", async () => {
  for (const invalidCity of [123, true, [], {}]) {
    const job = baseJob();
    const { error } = await callRpc(job, [
      { country_code: "LB", city: invalidCity, is_primary: true, location_confidence: "high" },
    ]);
    assert.ok(error, `expected rejection for city=${JSON.stringify(invalidCity)}`);
    assert.match(error.message, /city.*must be a JSON string or null/i);

    // Rollback on invalid input: the job must not have been created.
    const row = await readJob(job.external_id);
    assert.equal(row, null, "invalid city must not leave a partial job row");
  }
});

test("rejects an explicit JSON null is_primary (must be a genuine boolean)", async () => {
  const job = baseJob();
  const { error } = await callRpc(job, [
    { country_code: "LB", city: "Beirut", is_primary: null, location_confidence: "high" },
  ]);
  assert.ok(error, "expected rejection for is_primary=null");
  assert.match(error.message, /is_primary.*genuine JSON boolean/i);

  const row = await readJob(job.external_id);
  assert.equal(row, null, "invalid is_primary must not leave a partial job row");
});

test("rejects a non-boolean, non-null is_primary (invalid type)", async () => {
  for (const invalidIsPrimary of ["true", 1, [], {}]) {
    const job = baseJob();
    const { error } = await callRpc(job, [
      { country_code: "LB", city: "Beirut", is_primary: invalidIsPrimary, location_confidence: "high" },
    ]);
    assert.ok(error, `expected rejection for is_primary=${JSON.stringify(invalidIsPrimary)}`);
  }
});

test("a missing is_primary key still defaults silently to not-primary", async () => {
  const job = baseJob({ country_code: "LB", city: "Beirut", work_arrangement: "onsite" });
  const { data, error } = await callRpc(job, [
    { country_code: "LB", city: "Beirut", location_confidence: "high" },
  ]);
  assert.equal(error, null, `expected success, got: ${error?.message}`);
  createdJobIds.push(data[0].out_job_id);
  const locations = await readLocations(data[0].out_job_id);
  assert.equal(locations[0].is_primary, false);
});

test("country-less Remote, explicit scope, high confidence -> active", async () => {
  const job = baseJob({
    work_arrangement: "remote",
    remote_scope: "worldwide",
    country_code: null,
    city: null,
    primary_location_confidence: "high",
  });
  const { data, error } = await callRpc(job, []);
  assert.equal(error, null, `expected success, got: ${error?.message}`);
  createdJobIds.push(data[0].out_job_id);
  assert.equal(data[0].out_status, "active");

  const locations = await readLocations(data[0].out_job_id);
  assert.equal(locations.length, 0, "a country-less remote job must never get a job_locations row");
});

test("country-less Remote, no scope, medium confidence -> active (pre-Phase-2 parity)", async () => {
  const job = baseJob({
    work_arrangement: "remote",
    remote_scope: null,
    country_code: null,
    city: null,
    primary_location_confidence: "medium",
  });
  const { data, error } = await callRpc(job, []);
  assert.equal(error, null, `expected success, got: ${error?.message}`);
  createdJobIds.push(data[0].out_job_id);
  assert.equal(data[0].out_status, "active");
});

test("country-less Remote, low confidence -> pending_review (never auto-active on low)", async () => {
  const job = baseJob({
    work_arrangement: "remote",
    remote_scope: null,
    country_code: null,
    city: null,
    primary_location_confidence: "low",
  });
  const { data, error } = await callRpc(job, []);
  assert.equal(error, null, `expected success, got: ${error?.message}`);
  createdJobIds.push(data[0].out_job_id);
  assert.equal(data[0].out_status, "pending_review");
});

test("unresolved NON-remote job with a high primary_location_confidence must stay pending_review", async () => {
  // The fallback is gated to work_arrangement='remote' — a high/medium
  // confidence value alone must never activate an unresolved onsite job,
  // even if a caller somehow sent one (defense-in-depth, not just
  // TypeScript-layer trust).
  const job = baseJob({
    work_arrangement: "onsite",
    country_code: null,
    city: null,
    primary_location_confidence: "high",
  });
  const { data, error } = await callRpc(job, []);
  assert.equal(error, null, `expected success, got: ${error?.message}`);
  createdJobIds.push(data[0].out_job_id);
  assert.equal(data[0].out_status, "pending_review");
});

test("unresolved non-remote job with no primary_location_confidence at all -> pending_review", async () => {
  const job = baseJob({ work_arrangement: "hybrid", country_code: null, city: null });
  const { data, error } = await callRpc(job, []);
  assert.equal(error, null, `expected success, got: ${error?.message}`);
  createdJobIds.push(data[0].out_job_id);
  assert.equal(data[0].out_status, "pending_review");
});

test("Paris primary + Beirut additional: both resolve, confidence fallback never consulted", async () => {
  const job = baseJob({
    country_code: "FR",
    city: "Paris",
    work_arrangement: "onsite",
    // Deliberately omit primary_location_confidence to prove the
    // country-resolved primary path alone decides status — matches a
    // legacy caller that predates this fix.
  });
  const { data, error } = await callRpc(job, [
    { country_code: "FR", city: "Paris", is_primary: true, location_confidence: "high" },
    { country_code: "LB", city: "Beirut", is_primary: false, location_confidence: "high" },
  ]);
  assert.equal(error, null, `expected success, got: ${error?.message}`);
  createdJobIds.push(data[0].out_job_id);
  assert.equal(data[0].out_status, "active");

  const locations = await readLocations(data[0].out_job_id);
  assert.equal(locations.length, 2);
  const paris = locations.find((l) => l.country_code === "FR");
  const beirut = locations.find((l) => l.country_code === "LB");
  assert.equal(paris.is_primary, true);
  assert.equal(beirut.is_primary, false);
});

test("legacy single-location provider call (no primary_location_confidence key at all) behaves exactly as before", async () => {
  const job = baseJob({ country_code: "SA", city: "Riyadh", work_arrangement: "onsite" });
  const { data, error } = await callRpc(job, [
    { country_code: "SA", city: "Riyadh", is_primary: true, location_confidence: "high" },
  ]);
  assert.equal(error, null, `expected success, got: ${error?.message}`);
  createdJobIds.push(data[0].out_job_id);
  assert.equal(data[0].out_status, "active");
});

test("invalid primary_location_confidence value is rejected, no partial write", async () => {
  const job = baseJob({ work_arrangement: "remote", primary_location_confidence: "unknown" });
  const { error } = await callRpc(job, []);
  assert.ok(error, "expected rejection for an invalid primary_location_confidence value");
  assert.match(error.message, /primary_location_confidence/i);

  const row = await readJob(job.external_id);
  assert.equal(row, null, "invalid primary_location_confidence must not leave a partial job row");
});
