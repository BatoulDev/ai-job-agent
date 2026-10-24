// Reproduction + fix verification for the 2026-10-23 audit's "one malformed
// dataset record fails the whole batch" risk. Pure offline — no network, no
// database (runMultiCompanyIngestionBatch is called with dryRun:true, which
// returns before ever touching the supabase client).
import test from "node:test";
import assert from "node:assert/strict";
import { getProviderAdapter } from "../../src/lib/ingestion/providers/index.ts";
import { runMultiCompanyIngestionBatch } from "../../src/lib/ingestion/ingestSourceBatch.ts";
import { mapRawJobsWithAdapter } from "../../src/lib/ingestion/mapRawJobsWithAdapter.ts";

function gulfTalentRaw(jobId, company) {
  return {
    jobId,
    title: `Job ${jobId}`,
    company,
    description: "A real job description.",
    applyUrl: `https://www.gulftalent.com/jobs/${jobId}`,
  };
}

test("BEFORE-fix reproduction: route.ts's old rawJobs.map((raw) => adapter(raw)) pattern throws for the whole batch on one malformed record", () => {
  const adapter = getProviderAdapter("gulftalent");
  const rawJobs = [gulfTalentRaw("gt-1", "Co A"), null, gulfTalentRaw("gt-2", "Co B")];
  assert.throws(
    () => rawJobs.map((raw) => adapter(raw)),
    TypeError,
    "confirms the pre-fix defect: adapter(null) throws inside mapGulfTalentJob and kills the entire .map(), losing both otherwise-valid records"
  );
});

test("mapRawJobsWithAdapter: isolates the malformed record, keeps both valid records, flags the exception distinctly", () => {
  const adapter = getProviderAdapter("gulftalent");
  const rawJobs = [gulfTalentRaw("gt-1", "Co A"), null, gulfTalentRaw("gt-2", "Co B")];
  const exceptions = [];
  const { mapped, adapterExceptions } = mapRawJobsWithAdapter(rawJobs, adapter, "gulftalent", (index, sourceType) => {
    exceptions.push({ index, sourceType });
  });

  assert.equal(mapped.length, 3, "array length preserved — a deterministic empty stand-in replaces the malformed record");
  assert.equal(adapterExceptions, 1);
  assert.deepEqual(exceptions, [{ index: 1, sourceType: "gulftalent" }], "the malformed record is flagged by its own index, distinctly from any validation rejection");
  assert.equal(mapped[0].externalId, "gt-1");
  assert.equal(mapped[2].externalId, "gt-2");
});

test("mapRawJobsWithAdapter: zero exceptions and an unchanged array when every record is well-formed", () => {
  const adapter = getProviderAdapter("gulftalent");
  const rawJobs = [gulfTalentRaw("gt-1", "Co A"), gulfTalentRaw("gt-2", "Co B")];
  const { mapped, adapterExceptions } = mapRawJobsWithAdapter(rawJobs, adapter, "gulftalent");
  assert.equal(adapterExceptions, 0);
  assert.equal(mapped.length, 2);
});

test("AFTER-fix end-to-end (dry run, no DB): two valid GulfTalent records persist, the malformed record is rejected and counted, nothing else is lost", async () => {
  const adapter = getProviderAdapter("gulftalent");
  const rawJobs = [gulfTalentRaw("gt-e2e-1", "Co A"), null, gulfTalentRaw("gt-e2e-2", "Co B")];
  const { mapped, adapterExceptions } = mapRawJobsWithAdapter(rawJobs, adapter, "gulftalent");
  assert.equal(adapterExceptions, 1);

  const result = await runMultiCompanyIngestionBatch(
    /* supabase */ null,
    "gulftalent",
    mapped,
    { maxJobsPerSource: 10, dryRun: true },
    "test-malformed-record-scope"
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsFetched, 3, "the original batch size is preserved — the malformed record is not silently dropped from the count");
  assert.equal(result.jobsValid, 2, "both otherwise-valid records survive the one malformed record");
  assert.equal(result.jobsRejected, 1, "the malformed record is rejected and counted, via the real missing_company_name rule — no new rejection reason invented");
});

test("a genuinely invalid but well-formed record (missing required fields, no adapter exception) is rejected for its own real reason, unaffected by this fix", () => {
  const adapter = getProviderAdapter("gulftalent");
  // No title/description/applyUrl — the adapter itself never throws on this (every field access is typeof-guarded); it is an ordinary validation rejection.
  const rawJobs = [gulfTalentRaw("gt-3", "Co A"), { jobId: "gt-bad", company: "Co B" }];
  const { mapped, adapterExceptions } = mapRawJobsWithAdapter(rawJobs, adapter, "gulftalent");
  assert.equal(adapterExceptions, 0, "this record never throws — it is a validation rejection, not an adapter exception");
  assert.equal(mapped.length, 2);
});

test("a systemically empty/garbage batch still reports no_valid_jobs, never a false succeeded with fabricated data", async () => {
  const adapter = getProviderAdapter("gulftalent");
  // null/undefined throw inside the adapter's property access (exceptions);
  // a bare number never throws (numbers auto-box in JS) but maps to an
  // all-empty job that validation rejects on its own — both paths must
  // still add up to a fully-rejected batch.
  const rawJobs = [null, undefined, null, 42];
  const { mapped, adapterExceptions } = mapRawJobsWithAdapter(rawJobs, adapter, "gulftalent");
  assert.equal(adapterExceptions, 3, "the three null/undefined records throw; the bare number does not");

  const result = await runMultiCompanyIngestionBatch(null, "gulftalent", mapped, { maxJobsPerSource: 10, dryRun: true }, "test-malformed-record-scope");
  assert.equal(result.outcome, "no_valid_jobs", "a fully-broken batch is reported honestly, never as succeeded");
  assert.equal(result.jobsRejected, 4);
  assert.equal(result.jobsValid, 0);
});
