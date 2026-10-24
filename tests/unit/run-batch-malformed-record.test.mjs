// Reproduction + fix verification for run-batch/route.ts's own copy of the
// 2026-10-23 "one malformed record fails the whole batch" defect — the
// Tier-A (company-specific) counterpart to
// tests/unit/run-multi-company-batch-malformed-record.test.mjs. Mirrors
// that file's coverage style. A real DB call (verifySourceForIngestion's
// one company_sources read) still happens even under dryRun:true — see
// ingestSourceBatch.ts's runIngestionBatch — so the end-to-end test below
// uses a small hand-rolled fake Supabase client for that one read only;
// persistValidatedJobs's own dryRun short-circuit means no further calls
// are ever issued.
import test from "node:test";
import assert from "node:assert/strict";
import { getProviderAdapter } from "../../src/lib/ingestion/providers/index.ts";
import { runIngestionBatch } from "../../src/lib/ingestion/ingestSourceBatch.ts";
import { mapRawJobsWithAdapter } from "../../src/lib/ingestion/mapRawJobsWithAdapter.ts";

function oracleHcmRaw(id, candidateSiteUrl = "https://example.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1") {
  return {
    Id: id,
    Title: `Job ${id}`,
    ShortDescriptionStr: "A real job description.",
    PrimaryLocation: "Lebanon",
    candidateSiteUrl,
  };
}

function makeVerifiedSourceMock(companyName) {
  return {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle() {
          return Promise.resolve({ data: { company_name: companyName, review_status: "verified" }, error: null });
        },
      };
    },
  };
}

test("BEFORE-fix reproduction: run-batch's old rawJobs.map((raw) => adapter(raw)) pattern throws for the whole batch on one malformed record", () => {
  const adapter = getProviderAdapter("oracle_hcm");
  const rawJobs = [oracleHcmRaw(1), null, oracleHcmRaw(2)];
  assert.throws(
    () => rawJobs.map((raw) => adapter(raw)),
    TypeError,
    "confirms the pre-fix defect: adapter(null) throws inside mapOracleHcmJob and kills the entire .map(), losing both otherwise-valid records"
  );
});

test("mapRawJobsWithAdapter: isolates the malformed record, keeps both valid records, flags the exception distinctly", () => {
  const adapter = getProviderAdapter("oracle_hcm");
  const rawJobs = [oracleHcmRaw(1), null, oracleHcmRaw(2)];
  const exceptions = [];
  const { mapped, adapterExceptions } = mapRawJobsWithAdapter(rawJobs, adapter, "oracle_hcm", (index, sourceType) => {
    exceptions.push({ index, sourceType });
  });

  assert.equal(mapped.length, 3, "array length preserved — a deterministic empty stand-in replaces the malformed record");
  assert.equal(adapterExceptions, 1);
  assert.deepEqual(exceptions, [{ index: 1, sourceType: "oracle_hcm" }]);
  assert.equal(mapped[0].externalId, "1");
  assert.equal(mapped[2].externalId, "2");
});

test("AFTER-fix end-to-end (dry run, fake Supabase for the one authorization read only): two valid AUBMC-shaped records persist, the malformed record is rejected and counted", async () => {
  const adapter = getProviderAdapter("oracle_hcm");
  const rawJobs = [oracleHcmRaw(188), null, oracleHcmRaw(187)];
  const { mapped, adapterExceptions } = mapRawJobsWithAdapter(rawJobs, adapter, "oracle_hcm");
  assert.equal(adapterExceptions, 1);

  const supabase = makeVerifiedSourceMock("American University of Beirut Medical Center");
  const result = await runIngestionBatch(supabase, "sr-lb-aubmc", "oracle_hcm", mapped, { maxJobsPerSource: 10, dryRun: true });

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.jobsFetched, 3, "the original batch size is preserved — the malformed record is not silently dropped from the count");
  assert.equal(result.jobsValid, 2, "both otherwise-valid records survive the one malformed record");
  assert.equal(result.jobsRejected, 1, "the malformed record is rejected and counted, via the real missing_external_id rule — no new rejection reason invented");
});
