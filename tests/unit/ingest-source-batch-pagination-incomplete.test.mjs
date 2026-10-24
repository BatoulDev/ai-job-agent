// Regression tests for the 2026-10-23 pagination-safety fix's
// paginationIncomplete option on persistValidatedJobs, extracted out of
// tests/unit/ingest-source-batch-partial-persistence.test.mjs's broader
// "partial_stale_close_failed" audit (that file's own tests 1/2 assert an
// outcome this Oracle-only snapshot does not yet include — see the
// isolation report for why these two are split out on their own). Pure
// offline — a hand-rolled in-memory fake Supabase client, zero network,
// zero real database.
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

test("paginationIncomplete omitted entirely (no multi-page caller) preserves existing behavior identically to false", async () => {
  const supabase = makeMockSupabase([
    { data: [], error: null },
    { error: null },
    { data: [], error: null },
  ]);
  const rows = [makeJobRow("gt-sa-1")];

  const result = await persistValidatedJobs(supabase, 1, rows, 0, { maxJobsPerSource: 10, dryRun: false }, GULFTALENT_SA_SCOPE);

  assert.equal(result.truncated, false);
  assert.equal(result.outcome, "succeeded");
  assert.equal(supabase.calls.length, 3, "stale-close still runs normally when the option is not provided at all");
});
