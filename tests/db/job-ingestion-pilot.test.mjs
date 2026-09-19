// Integration tests for the Job Ingestion Pilot Orchestrator's normalized
// output against the REAL local jobs table — closes the gap between
// tests/workflow's pure-function normalization tests and the DB-level
// dedup guarantees already proven generically in jobs-ingestion-identity.test.mjs.
// Here we thread the workflow's own Classify & Normalize / Compute Diff Plan
// jsCode (extracted from the canonical JSON, never re-typed) through a real
// upsert against public.jobs, so the exact code the n8n workflow runs is
// what gets verified — not a hand-written stand-in payload.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { adminClient, assertExpectedLocalProject, deleteFakeJobs } from "./helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../");
const wf = JSON.parse(readFileSync(resolve(ROOT, "n8n-workflows/job-ingestion-pilot-orchestrator.json"), "utf8"));

function findNode(name) {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`Node "${name}" not found in workflow JSON`);
  return n;
}

function runClassifyGreenhouse(src, evalResult) {
  const code = findNode("Classify & Normalize Greenhouse").parameters.jsCode;
  const mockDollar = (name) => {
    if (name === "Attach Provenance & Guard") return { item: { json: src } };
    throw new Error(`unexpected $('${name}')`);
  };
  return new Function("$", "$input", code)(mockDollar, { first: () => ({ json: evalResult }) })[0].json;
}

function runComputeDiffPlan(prepared, existingRows) {
  const code = findNode("Compute Diff Plan").parameters.jsCode;
  const mockDollar = (name) => {
    if (name === "Prepare Bounded Write Set") return { item: { json: prepared } };
    throw new Error(`unexpected $('${name}')`);
  };
  // Select Existing Jobs For Source has no fullResponse wrapping, so n8n
  // auto-splits its JSON array response into one output item per row.
  return new Function("$", "$input", code)(mockDollar, { all: () => existingRows.map((r) => ({ json: r })) })[0].json;
}

const jobIdsToClean = [];
after(async () => {
  await deleteFakeJobs(jobIdsToClean);
});

// sr-sa-alpaca is a real, existing company_sources row (Alpaca, Greenhouse,
// Saudi Arabia — see docs/job-source-discovery). jobs.source_id has a
// foreign key into company_sources, so fixtures must reference a row that
// actually exists rather than an invented id; this test file never writes
// to company_sources itself.
function fixtureSource(externalId, overrides = {}) {
  return runClassifyGreenhouse(
    { source_id: "sr-sa-alpaca", ats_type: "greenhouse", company_name: "Pilot Test Co" },
    {
      success: true,
      attempt: 1,
      body: {
        jobs: [
          {
            id: externalId,
            title: "Pilot Fixture Job",
            absolute_url: `https://job-boards.greenhouse.io/pilottest/jobs/${externalId}`,
            content: "<p>Fixture job for automated tests only.</p>",
            location: { name: "Remote" },
            ...overrides,
          },
        ],
      },
    }
  ).normalizedJobs[0];
}

// ─── 9. Reingesting the same job creates no duplicate ─────────────────────

test("reingesting the same normalized job twice (idempotent upsert) creates no duplicate", async () => {
  await assertExpectedLocalProject();
  const externalId = `pilot-${randomUUID()}`;
  const job = fixtureSource(externalId);

  const { data: first, error: e1 } = await adminClient
    .from("jobs")
    .upsert(job, { onConflict: "dedup_scope,external_id" })
    .select()
    .single();
  assert.equal(e1, null);
  jobIdsToClean.push(first.id);

  const { data: second, error: e2 } = await adminClient
    .from("jobs")
    .upsert(job, { onConflict: "dedup_scope,external_id" })
    .select()
    .single();
  assert.equal(e2, null);
  assert.equal(second.id, first.id, "reingesting the identical job must update the same row, never create a second one");

  const { data: rows } = await adminClient.from("jobs").select("id").eq("source_type", "greenhouse").eq("external_id", externalId);
  assert.equal(rows.length, 1);
});

// ─── 10. Changed source data updates the same logical job ─────────────────

test("changed source data (new title) updates the same logical job, not a new row", async () => {
  const externalId = `pilot-${randomUUID()}`;
  const jobV1 = fixtureSource(externalId, { title: "Original Title" });

  const { data: first } = await adminClient.from("jobs").upsert(jobV1, { onConflict: "dedup_scope,external_id" }).select().single();
  jobIdsToClean.push(first.id);

  const jobV2 = fixtureSource(externalId, { title: "Updated Title" });
  const { data: second, error } = await adminClient.from("jobs").upsert(jobV2, { onConflict: "dedup_scope,external_id" }).select().single();
  assert.equal(error, null);
  assert.equal(second.id, first.id);
  assert.equal(second.title, "Updated Title");

  const { data: rows } = await adminClient.from("jobs").select("id").eq("source_type", "greenhouse").eq("external_id", externalId);
  assert.equal(rows.length, 1);
});

// ─── 11. Different sources may reuse the same external job ID ─────────────

test("a Lever fixture and a Greenhouse fixture may reuse the same external_id without colliding", async () => {
  const sharedId = `shared-${randomUUID()}`;
  const ghJob = fixtureSource(sharedId);

  const leverCode = findNode("Classify & Normalize Lever").parameters.jsCode;
  const leverResult = new Function(
    "$",
    "$input",
    leverCode
  )(
    (name) => {
      if (name === "Attach Provenance & Guard") return { item: { json: { source_id: "sr-intl-wahed", ats_type: "lever", company_name: "Pilot Test Co 2" } } };
      throw new Error("unexpected");
    },
    {
      first: () => ({
        json: {
          success: true,
          attempt: 1,
          body: [
            {
              id: sharedId,
              text: "Pilot Fixture Lever Job",
              applyUrl: `https://jobs.lever.co/pilottest/${sharedId}`,
              descriptionPlain: "Fixture job for automated tests only.",
              categories: {},
              createdAt: Date.now(),
            },
          ],
        },
      }),
    }
  )[0].json;
  const leverJob = leverResult.normalizedJobs[0];

  const { data: gh, error: e1 } = await adminClient.from("jobs").upsert(ghJob, { onConflict: "dedup_scope,external_id" }).select().single();
  assert.equal(e1, null);
  jobIdsToClean.push(gh.id);

  const { data: lv, error: e2 } = await adminClient.from("jobs").upsert(leverJob, { onConflict: "dedup_scope,external_id" }).select().single();
  assert.equal(e2, null, "a different source_type reusing the identical external_id must succeed, not collide");
  jobIdsToClean.push(lv.id);

  assert.notEqual(gh.id, lv.id);
});

// ─── 12. Concurrent ingestion cannot create duplicate jobs ─────────────────

test("ten concurrent upserts of the identical normalized job produce exactly one row", async () => {
  const externalId = `pilot-concurrent-${randomUUID()}`;
  const job = fixtureSource(externalId);

  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => adminClient.from("jobs").upsert(job, { onConflict: "dedup_scope,external_id" }).select().single())
  );
  const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.error === null);
  assert.equal(succeeded.length, 10, "upsert (not plain insert) means every concurrent retry succeeds by design");
  const ids = new Set(succeeded.map((r) => r.value.data.id));
  assert.equal(ids.size, 1, "all ten concurrent upserts must resolve to the same single row");
  jobIdsToClean.push(...ids);
});

// ─── 17. A temporary source outage does not close all source jobs ─────────

test("Compute Diff Plan only marks jobs stale that are genuinely absent from a SUCCESSFUL fetch, never on a failed fetch", () => {
  // Simulate: two jobs already active for this source from a prior successful run.
  const existingActive = [
    { external_id: "still-here", title: "A", description: "d", first_seen_at: "2020-01-01T00:00:00Z" },
    { external_id: "gone-now", title: "B", description: "d", first_seen_at: "2020-01-01T00:00:00Z" },
  ];
  // A successful current fetch only found "still-here" — "gone-now" is a genuine stale candidate.
  const preparedSuccess = { boundedJobs: [{ external_id: "still-here", title: "A", description: "d" }] };
  const planSuccess = runComputeDiffPlan(preparedSuccess, existingActive);
  assert.deepEqual(planSuccess.staleExternalIds, ["gone-now"]);

  // Compute Diff Plan is only ever reached via Should Write To DB? -> Prepare
  // Bounded Write Set, which requires classifyResult.succeeded === true
  // (asserted structurally in tests/workflow). A failed/retryable fetch
  // never produces normalizedJobs, so this node is never invoked with a
  // failure's empty result standing in as "0 jobs found" — proving the
  // architecture itself prevents "outage looks like everything closed".
  const shouldWriteToDb = wf.nodes.find((n) => n.name === "Should Write To DB?");
  const raw = JSON.stringify(shouldWriteToDb.parameters);
  assert.ok(raw.includes("succeeded"), "Should Write To DB? must gate on succeeded, not just jobsValid");
});

test("a failed/retries-exhausted fetch attempt never produces normalizedJobs, so it can never reach Compute Diff Plan or close jobs", () => {
  const failedResult = runClassifyGreenhouse(
    { source_id: "sr-sa-alpaca", ats_type: "greenhouse", company_name: "Pilot Test Co" },
    { success: false, attempt: 4, outcome: "retryable_server_error_retries_exhausted", errorMessage: "HTTP 503 from Greenhouse" }
  );
  assert.equal(failedResult.succeeded, false);
  assert.equal(failedResult.jobsValid, 0);
  assert.deepEqual(failedResult.normalizedJobs, []);
});

test("a truncated (bounded-cap-exceeded) source result cannot close stale jobs, even though the write itself succeeds", () => {
  // A source with more valid jobs than the pilot's per-source cap only ever
  // writes/diffs its bounded subset; Compute Diff Plan sees existing rows
  // beyond that subset as "stale" purely because the fetch was truncated,
  // not because they are genuinely gone from the source. Should Close Stale
  // Jobs? gates on $json.truncated === false (proven structurally in
  // tests/workflow), so this diff output must never reach the close step.
  const existingActive = [
    { external_id: "kept-1", title: "A", description: "d", first_seen_at: "2020-01-01T00:00:00Z" },
    { external_id: "not-in-bounded-page", title: "B", description: "d", first_seen_at: "2020-01-01T00:00:00Z" },
  ];
  const preparedTruncated = { boundedJobs: [{ external_id: "kept-1", title: "A", description: "d" }], truncated: true };
  const plan = runComputeDiffPlan(preparedTruncated, existingActive);
  assert.ok(plan.staleExternalIds.includes("not-in-bounded-page"), "the diff itself still lists the id as absent from the bounded page");
  assert.equal(plan.truncated, true, "the truncated flag must survive into the diff plan so the downstream IF can gate on it");
});

// ─── 19. Existing matches and applications remain valid ───────────────────

test("upserting a pilot job never touches unrelated tables (matches/applications untouched)", async () => {
  const before = await adminClient.from("matches").select("id", { count: "exact", head: true });
  const beforeApps = await adminClient.from("applications").select("id", { count: "exact", head: true });

  const externalId = `pilot-isolation-${randomUUID()}`;
  const job = fixtureSource(externalId);
  const { data } = await adminClient.from("jobs").upsert(job, { onConflict: "dedup_scope,external_id" }).select().single();
  jobIdsToClean.push(data.id);

  const after1 = await adminClient.from("matches").select("id", { count: "exact", head: true });
  const afterApps = await adminClient.from("applications").select("id", { count: "exact", head: true });
  assert.equal(after1.count, before.count, "matches row count must be unaffected by ingestion");
  assert.equal(afterApps.count, beforeApps.count, "applications row count must be unaffected by ingestion");
});

// ─── 20. Test fixtures contain no credentials or sensitive data ───────────

test("fixture job payloads used in this file contain no credential-shaped values", () => {
  const job = fixtureSource(`pilot-hygiene-${randomUUID()}`);
  const raw = JSON.stringify(job);
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(raw));
  assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(raw));
  assert.ok(!/"password"\s*:/.test(raw));
});
