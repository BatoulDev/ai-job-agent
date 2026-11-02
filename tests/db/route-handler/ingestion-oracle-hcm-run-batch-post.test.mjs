// In-process integration test for the REAL, unmodified exported POST of
// src/app/api/internal/ingestion/run-batch/route.ts, against the real
// local Supabase instance — closes Gap C from the 2026-10-25 read-only
// pipeline assessment (nothing previously exercised auth + parsing +
// adapter + persistence as one continuous path through the actual route
// handler; every earlier test entered the pipeline at a lower layer).
//
// DELIBERATELY OPT-IN, NOT part of the normal `npm run test:db` run:
// scripts/run-db-tests.mjs's defaultTestFiles() only readdirSync()s the
// DIRECT children of tests/db/ (non-recursive) — a file in this
// tests/db/route-handler/ subdirectory is structurally invisible to that
// glob, not just excluded by naming convention. Must be invoked
// explicitly:
//
//   node --import ./tests/db/_nextRouteResolveHook.mjs --test tests/db/route-handler/ingestion-oracle-hcm-run-batch-post.test.mjs
//
// The --import flag is REQUIRED: route.ts's own `import { NextResponse }
// from "next/server"` (and its own "@/..." and extensionless-relative
// imports) cannot be resolved by plain Node without the test-only resolve
// hook at tests/db/_nextRouteResolveHook.mjs (see that file's own header,
// and the separately-reported proof-of-concept that established this).
// This file does NOT import route.ts with a static top-level `import` —
// it must be a DYNAMIC import inside before(), issued only after this
// file's own env-var preparation below, because src/lib/supabase/env.ts
// reads NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// eagerly at module-evaluation time — a static import would run before
// this file's own before() hook ever gets a chance to prepare them.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, deleteFakeJobs } from "../helpers.mjs";
import { getEnv } from "../localTestGuard.mjs";

const jobIdsToClean = [];
const fixtureCompanyIds = [];
const fixtureSourceIds = [];

// route.ts and its transitive imports (internalAuth.ts, admin.ts, env.ts)
// read process.env directly, with no .env.local fallback of their own
// (unlike this file's own getEnv()). Populated once in before(), ONLY for
// whichever of these four keys are not already set in this process —
// never overwriting a pre-existing value — and restored exactly (deleted
// if it was unset, reset to its original value otherwise) in after().
// Values are read via the already-reviewed getEnv() (process.env ??
// parsed .env.local) and never logged.
const ROUTE_ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "INGESTION_WORKER_SECRET"];
const originalEnv = {};

function prepareRouteEnv() {
  for (const key of ROUTE_ENV_KEYS) {
    originalEnv[key] = process.env[key];
    if (process.env[key] === undefined) {
      const value = getEnv(key);
      if (!value) {
        throw new Error(`${key} is required (process.env or .env.local) to run this test, and is not set.`);
      }
      process.env[key] = value;
    }
  }
}

function restoreRouteEnv() {
  for (const key of ROUTE_ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

let POST;

before(async () => {
  // Verify the target BEFORE touching process.env, creating any fixture,
  // or importing/invoking the route handler at all.
  await assertExpectedLocalProject();
  prepareRouteEnv();
  try {
    ({ POST } = await import("../../../src/app/api/internal/ingestion/run-batch/route.ts"));
  } catch (err) {
    throw new Error(
      "Failed to import the real run-batch route module. This test MUST be run with " +
        "`node --import ./tests/db/_nextRouteResolveHook.mjs --test " +
        "tests/db/route-handler/ingestion-oracle-hcm-run-batch-post.test.mjs` — the resolve hook is required. " +
        `Original error: ${err.message}`
    );
  }
  assert.equal(typeof POST, "function", "the imported route module must expose POST as a function");
});

// Cleanup order: jobs (reference source_id) -> company_sources (reference
// company_id) -> companies, then restore process.env. Every delete is an
// explicit .in("id", [...]) against ids this file itself tracked at
// creation time. Test B/C never create any fixture (see their own
// comments below), so these arrays stay empty for them and every guard
// below is a no-op — nothing broad is ever deleted.
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

  restoreRouteEnv();
});

/** Fresh, uniquely-suffixed oracle_hcm fixture source — same convention as tests/db/ingestion-oracle-hcm-pagination-incomplete.test.mjs. */
async function createFixtureOracleHcmSource(reviewStatus = "verified") {
  const suffix = randomUUID();
  const companyId = `test-oracle-hcm-route-co-${suffix}`;
  const sourceId = `test-oracle-hcm-route-src-${suffix}`;

  const { error: companyError } = await adminClient
    .from("companies")
    .insert({ id: companyId, display_name: `Oracle HCM Route Test Co ${suffix}` });
  if (companyError) throw new Error(`fixture company insert failed: ${companyError.message}`);
  fixtureCompanyIds.push(companyId);

  const { error: sourceError } = await adminClient.from("company_sources").insert({
    id: sourceId,
    company_id: companyId,
    company_name: `Oracle HCM Route Test Co ${suffix} (live)`,
    target_country: "Test",
    ats_provider: "oracle_hcm",
    review_status: reviewStatus,
  });
  if (sourceError) throw new Error(`fixture company_sources insert failed: ${sourceError.message}`);
  fixtureSourceIds.push(sourceId);

  return sourceId;
}

async function trackJobsForSource(sourceId) {
  const { data } = await adminClient.from("jobs").select("id").eq("source_id", sourceId);
  for (const row of data ?? []) jobIdsToClean.push(row.id);
}

// Genuinely RAW, vendor-shaped Oracle HCM input (OracleHcmRawJob — Id,
// Title, ShortDescriptionStr, PrimaryLocation, candidateSiteUrl) — unlike
// the already-accepted tests/db/ingestion-oracle-hcm-pagination-incomplete.test.mjs
// (which calls runIngestionBatch directly with already-ADAPTED
// RawProviderJob objects), this test goes through the real HTTP route, so
// it must supply genuinely raw vendor JSON for getProviderAdapter("oracle_hcm")
// / mapOracleHcmJob to actually run on.
function oracleHcmRawJob(id, overrides = {}) {
  return {
    Id: id,
    Title: `Oracle HCM Route Fixture Job ${id}`,
    ShortDescriptionStr: "<p>A fake Oracle HCM job fixture for automated route-handler tests only.</p>",
    PrimaryLocation: "Beirut, Lebanon",
    candidateSiteUrl: "https://example.test/hcmUI/CandidateExperience/en/sites/CX_ROUTE_TEST",
    ...overrides,
  };
}

/**
 * Constructs a real, standard Web Request and calls the real POST export
 * in-process — no server, no network. `authorization` defaults to a
 * correctly-authorized header using the real secret prepared in before();
 * pass `null` for no header at all, or an explicit wrong value, to
 * exercise the rejection path.
 */
async function callPost({ body, rawBodyText, authorization = `Bearer ${process.env.INGESTION_WORKER_SECRET}` }) {
  const headers = { "content-type": "application/json" };
  if (authorization !== null) headers.authorization = authorization;

  const request = new Request("http://localhost/api/internal/ingestion/run-batch", {
    method: "POST",
    headers,
    body: rawBodyText ?? JSON.stringify(body),
  });
  const response = await POST(request);
  const json = await response.json();
  return { status: response.status, json };
}

test("A: authorized Oracle HCM request with paginationIncomplete:true preserves a previously active fixture job missing from the partial refresh", async () => {
  await assertExpectedLocalProject();

  const sourceId = await createFixtureOracleHcmSource();
  const keepId = `route-oracle-keep-${randomUUID()}`;
  const missingId = `route-oracle-missing-${randomUUID()}`;

  const seed = await callPost({
    body: {
      sourceId,
      sourceType: "oracle_hcm",
      rawJobs: [oracleHcmRawJob(keepId), oracleHcmRawJob(missingId)],
      maxJobsPerSource: 10,
      dryRun: false,
      paginationIncomplete: false,
    },
  });
  assert.equal(seed.status, 200);
  assert.equal(seed.json.outcome, "succeeded");
  assert.equal(seed.json.jobsCreated, 2, "the real adapter must have mapped both raw Oracle HCM items successfully");
  await trackJobsForSource(sourceId);

  // Partial refresh through the real route: only keepId present, and the
  // caller explicitly signals the retrieval did not confirm every page.
  const partial = await callPost({
    body: {
      sourceId,
      sourceType: "oracle_hcm",
      rawJobs: [oracleHcmRawJob(keepId)],
      maxJobsPerSource: 10,
      dryRun: false,
      paginationIncomplete: true,
    },
  });
  await trackJobsForSource(sourceId);

  assert.equal(partial.status, 200);
  assert.equal(partial.json.outcome, "succeeded");
  assert.equal(partial.json.truncated, true, "paginationIncomplete:true must force truncated:true through the real route");
  assert.equal(partial.json.jobsClosed, 0, "stale-close must never run against an incomplete retrieval");

  const { data: rows, error } = await adminClient
    .from("jobs")
    .select("external_id, status, status_reason")
    .eq("source_id", sourceId)
    .in("external_id", [keepId, missingId])
    .order("external_id");
  if (error) throw new Error(`verification read failed: ${error.message}`);

  const missingRow = rows.find((r) => r.external_id === missingId);
  const keepRow = rows.find((r) => r.external_id === keepId);
  assert.ok(missingRow, "the missing fixture job must still exist");
  assert.equal(missingRow.status, "active", "must remain active — never stale-closed through an incomplete-pagination refresh");
  assert.equal(missingRow.status_reason, null);
  assert.equal(keepRow.status, "active");
});

test("B: missing or invalid Authorization header returns 401 without any database write", async () => {
  await assertExpectedLocalProject();

  // No fixture is created in this test at all — route.ts's auth check
  // runs before request.json() is ever called, so no sourceId/rawJobs
  // value here can reach the database regardless of its shape.
  const noHeader = await callPost({
    authorization: null,
    body: { sourceId: "unused", sourceType: "oracle_hcm", rawJobs: [], maxJobsPerSource: 10, dryRun: false },
  });
  assert.equal(noHeader.status, 401);
  assert.deepEqual(noHeader.json, { error: "Unauthorized" });

  const wrongSecret = await callPost({
    authorization: "Bearer this-is-not-the-real-secret",
    body: { sourceId: "unused", sourceType: "oracle_hcm", rawJobs: [], maxJobsPerSource: 10, dryRun: false },
  });
  assert.equal(wrongSecret.status, 401);
  assert.deepEqual(wrongSecret.json, { error: "Unauthorized" });
});

test("C: malformed request body returns 400 without any database write", async () => {
  await assertExpectedLocalProject();

  // Authorized correctly in both cases — isolates the parsing layer from
  // the auth layer already covered by Test B. No fixture is created:
  // both failures occur before getProviderAdapter/createAdminClient are
  // ever reached (confirmed by reading route.ts), so nothing here can
  // touch the database regardless of outcome.
  const invalidJson = await callPost({ rawBodyText: "{ this is not valid json" });
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.json.error, "Invalid request body");

  const missingSourceId = await callPost({
    body: { sourceType: "oracle_hcm", rawJobs: [], maxJobsPerSource: 10, dryRun: false },
  });
  assert.equal(missingSourceId.status, 400);
  assert.match(missingSourceId.json.error, /sourceId/);
});
