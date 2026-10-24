// Reproduction + fix verification for the 2026-10-23 audit's "partial
// persistence / misleading failure result" risk in persistValidatedJobs
// (upsert succeeds, the following stale-close step fails). Pure offline —
// a hand-rolled in-memory fake Supabase client, zero network, zero real
// database. Call order mirrors the exact sequence persistValidatedJobs
// issues: existingQuery (read) -> upsert (write) -> activeQuery (read) ->
// close update (write, only when staleIds.length > 0).
import test from "node:test";
import assert from "node:assert/strict";
import { persistValidatedJobs } from "../../src/lib/ingestion/ingestSourceBatch.ts";

function makeJobRow(externalId) {
  return {
    title: "Engineer",
    company_name: "Acme",
    description: "A real job description.",
    location: null,
    work_arrangement: null,
    employment_type: null,
    seniority: null,
    application_method: "external_link",
    application_url: `https://example.com/jobs/${externalId}`,
    application_email: null,
    source_type: "gulftalent",
    external_id: externalId,
    source_url: null,
    source_id: null,
    country_code: null,
    city: null,
    remote_scope: null,
    published_at: null,
    source_last_modified_at: null,
    closing_date: null,
    status: "active",
  };
}

/** responses are consumed in call order: [existingQuery, upsert, activeQuery, closeUpdate?] */
function makeMockSupabase(responses) {
  let callIndex = 0;
  const calls = [];
  return {
    calls,
    from(table) {
      const result = responses[callIndex++];
      const record = { table, ops: [] };
      calls.push(record);
      const builder = {
        select(...args) { record.ops.push(["select", args]); return builder; },
        eq(...args) { record.ops.push(["eq", args]); return builder; },
        is(...args) { record.ops.push(["is", args]); return builder; },
        in(...args) { record.ops.push(["in", args]); return builder; },
        update(...args) { record.ops.push(["update", args]); return builder; },
        upsert(...args) { record.ops.push(["upsert", args]); return Promise.resolve(result); },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
      return builder;
    },
  };
}

const GULFTALENT_SA_SCOPE = { sourceId: null, sourceType: "gulftalent", refreshScope: "test-country:SA" };

test("BEFORE-fix reproduction (documented): a stale-close read failure used to throw and lose the already-committed upsert counts — now returns partial_stale_close_failed instead", async () => {
  const supabase = makeMockSupabase([
    { data: [], error: null }, // existingQuery: no pre-existing rows
    { error: null }, // upsert: succeeds
    { data: null, error: { message: "simulated stale-close read failure" } }, // activeQuery: fails
  ]);
  const rows = [makeJobRow("gt-sa-1"), makeJobRow("gt-sa-2")];

  const result = await persistValidatedJobs(supabase, 2, rows, 0, { maxJobsPerSource: 10, dryRun: false }, GULFTALENT_SA_SCOPE);

  assert.equal(result.outcome, "partial_stale_close_failed", "never reported as succeeded when stale-close did not complete");
  assert.equal(result.jobsCreated, 2, "the upsert really committed — these counts must not be lost or zeroed");
  assert.equal(result.jobsUpdated, 0);
  assert.equal(result.jobsClosed, 0, "stale-close never completed, so 0 here means 'unknown', not 'verified nothing stale'");
});

test("stale-close UPDATE failure (read succeeded, the close write itself failed) is also reported as partial, with real upsert counts intact", async () => {
  const supabase = makeMockSupabase([
    { data: [{ external_id: "gt-sa-1", first_seen_at: "2026-01-01T00:00:00.000Z" }], error: null }, // existingQuery: gt-sa-1 already existed
    { error: null }, // upsert succeeds
    { data: [{ id: "row-stale", external_id: "gt-sa-old" }], error: null }, // activeQuery: one stale candidate found
    { error: { message: "simulated stale-close update failure" } }, // close update fails
  ]);
  const rows = [makeJobRow("gt-sa-1"), makeJobRow("gt-sa-2")];

  const result = await persistValidatedJobs(supabase, 2, rows, 0, { maxJobsPerSource: 10, dryRun: false }, GULFTALENT_SA_SCOPE);

  assert.equal(result.outcome, "partial_stale_close_failed");
  assert.equal(result.jobsCreated, 1, "gt-sa-2 is new");
  assert.equal(result.jobsUpdated, 1, "gt-sa-1 already existed");
  assert.equal(result.jobsClosed, 0, "the close update never committed");
});

test("full success path is unaffected by this fix: upsert and stale-close both succeed, outcome stays 'succeeded'", async () => {
  const supabase = makeMockSupabase([
    { data: [], error: null },
    { error: null },
    { data: [{ id: "row-stale", external_id: "gt-sa-old" }], error: null },
    { error: null },
  ]);
  const rows = [makeJobRow("gt-sa-1")];

  const result = await persistValidatedJobs(supabase, 1, rows, 0, { maxJobsPerSource: 10, dryRun: false }, GULFTALENT_SA_SCOPE);

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsCreated, 1);
  assert.equal(result.jobsClosed, 1, "the genuinely stale row is closed exactly as before this fix");
});

test("upsert failure itself is unchanged: still throws immediately, since nothing was committed at all", async () => {
  const supabase = makeMockSupabase([
    { data: [], error: null },
    { error: { message: "simulated upsert failure" } },
  ]);
  const rows = [makeJobRow("gt-sa-1")];

  await assert.rejects(
    () => persistValidatedJobs(supabase, 1, rows, 0, { maxJobsPerSource: 10, dryRun: false }, GULFTALENT_SA_SCOPE),
    /ingestion: upsert failed/,
    "an upsert failure means zero rows were written — throwing (unchanged behavior) is still correct here"
  );
});

test("refresh_scope isolation is preserved: the stale-close read is still filtered to this exact refresh_scope, never the whole gulftalent source_type", async () => {
  const supabase = makeMockSupabase([
    { data: [], error: null },
    { error: null },
    { data: [], error: null },
  ]);
  const rows = [makeJobRow("gt-sa-1")];

  await persistValidatedJobs(supabase, 1, rows, 0, { maxJobsPerSource: 10, dryRun: false }, GULFTALENT_SA_SCOPE);

  const activeQueryCall = supabase.calls[2]; // 3rd from("jobs") call = the stale-close active-rows read
  const scopeFilters = activeQueryCall.ops.filter((op) => op[0] === "eq" || op[0] === "is");
  assert.ok(
    scopeFilters.some((op) => op[0] === "eq" && op[1][0] === "refresh_scope" && op[1][1] === "test-country:SA"),
    "the AE/Dubai partition must never be touched by an SA-scoped call — refresh_scope filter must carry through unchanged"
  );
});

test("truncated batches still skip stale-close entirely, unaffected by this fix", async () => {
  const supabase = makeMockSupabase([
    { data: [], error: null },
    { error: null },
  ]);
  const rows = [makeJobRow("gt-sa-1"), makeJobRow("gt-sa-2")];

  const result = await persistValidatedJobs(supabase, 2, rows, 0, { maxJobsPerSource: 1, dryRun: false }, GULFTALENT_SA_SCOPE);

  assert.equal(result.truncated, true);
  assert.equal(result.outcome, "succeeded", "truncation is not a stale-close failure — a partial PAGE is not the same as a failed stale-close call");
  assert.equal(result.jobsClosed, 0, "a truncated run must never attempt stale-close at all");
  assert.equal(supabase.calls.length, 2, "only existingQuery + upsert ran — the stale-close read was never issued for a truncated batch");
});

// 2026-10-23 pagination-safety fix: a page-fetch failure or bounded
// page-count exhaustion in a future multi-page retrieval (Oracle HCM,
// GulfTalent) can leave a fetched count that happens to be <=
// maxJobsPerSource — the item count alone is not proof every page was
// seen. paginationIncomplete:true must force the exact same
// truncated-batch safety (no stale-close) as an over-the-cap batch does,
// regardless of count.
test("paginationIncomplete:true forces truncated:true and skips stale-close even when the fetched count is under maxJobsPerSource", async () => {
  const supabase = makeMockSupabase([
    { data: [], error: null },
    { error: null },
  ]);
  const rows = [makeJobRow("gt-sa-1")]; // 1 row, well under maxJobsPerSource: 10

  const result = await persistValidatedJobs(supabase, 1, rows, 0, { maxJobsPerSource: 10, dryRun: false, paginationIncomplete: true }, GULFTALENT_SA_SCOPE);

  assert.equal(result.truncated, true, "an incomplete multi-page retrieval must be treated as truncated regardless of how few items were actually fetched");
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsClosed, 0, "stale-close must never run against an incomplete retrieval, even though 1 <= maxJobsPerSource would otherwise look complete");
  assert.equal(supabase.calls.length, 2, "only existingQuery + upsert ran — the stale-close read was never issued");
});

test("paginationIncomplete:false (the default) does not force truncation — existing single-page behavior is unaffected", async () => {
  const supabase = makeMockSupabase([
    { data: [], error: null },
    { error: null },
    { data: [], error: null },
    // no close-update call expected since no stale rows are found
  ]);
  const rows = [makeJobRow("gt-sa-1")];

  const result = await persistValidatedJobs(supabase, 1, rows, 0, { maxJobsPerSource: 10, dryRun: false, paginationIncomplete: false }, GULFTALENT_SA_SCOPE);

  assert.equal(result.truncated, false);
  assert.equal(result.outcome, "succeeded");
  assert.equal(supabase.calls.length, 3, "stale-close still runs normally for a genuinely complete batch");
});
