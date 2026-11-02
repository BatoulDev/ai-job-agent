// Offline behavioral tests for the THREE PROPOSED (not yet deployed) Code
// nodes that make up the Workday per-job detail-fetch architecture —
// Sub-phase 2b of the Workday integration, see the accompanying isolated
// test workflow (n8n, inactive, disposable) built this phase. These nodes
// do not exist in any real workflow yet; the *_JS_CODE constants below are
// the exact candidate strings, kept here verbatim as this file's own
// source of truth — same convention as
// tests/workflow/gulftalent-dataset-completeness-code-node.test.mjs.
//
// Executed via node:vm against a mocked $json/$input/$(), no n8n instance,
// no network, no database. Node-reference pairedItem resolution ($('Split
// Out Job Postings').item.json) is mocked directly here rather than
// re-implementing n8n's own pairedItem engine — that engine's correctness
// for single-input/single-output chains (which the HTTP Request and Code
// nodes in this architecture all are) was already independently confirmed
// via n8n's own documentation earlier this engagement.
//
// Architecture under test (see the isolated n8n workflow for the full
// node graph): Mock List Response -> Split Out (jobPostings) -> HTTP
// Request (per-job detail fetch, onError: continueErrorOutput) ->
//   [success output] -> CODE_A_MERGE_SUCCESS
//   [error output]   -> CODE_B_MARK_FAILED
// -> Merge (append) -> Aggregate (aggregateAllItemData) -> CODE_C_FINAL
//
// Safety design under test: a job whose detail fetch ultimately fails is
// NEVER fabricated with an empty description — it is simply dropped from
// the final rawJobs array, and paginationIncomplete is forced true
// whenever ANY detail fetch failed OR the list's own total exceeds how
// many jobs were actually detail-fetched — reusing the existing,
// twice-proven paginationIncomplete mechanism (ingestSourceBatch.ts),
// never a new ad hoc flag.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const TENANT_SITE_BASE_URL = "https://murex.wd3.myworkdayjobs.com/MurexCareerPage1";

const CODE_A_MERGE_SUCCESS = `
const detailBody = $json.body;
const listItem = $('Split Out Job Postings').item.json;
return {
  json: {
    title: listItem.title ?? null,
    externalPath: listItem.externalPath ?? null,
    locationsText: listItem.locationsText ?? null,
    postedOn: listItem.postedOn ?? null,
    bulletFields: listItem.bulletFields ?? null,
    description: detailBody?.jobPostingInfo?.jobDescription ?? null,
    tenantSiteBaseUrl: '${TENANT_SITE_BASE_URL}',
    detailFetchSucceeded: true,
  },
};
`;

const CODE_B_MARK_FAILED = `
const listItem = $('Split Out Job Postings').item.json;
return {
  json: {
    title: listItem.title ?? null,
    externalPath: listItem.externalPath ?? null,
    locationsText: listItem.locationsText ?? null,
    postedOn: listItem.postedOn ?? null,
    bulletFields: listItem.bulletFields ?? null,
    description: null,
    tenantSiteBaseUrl: '${TENANT_SITE_BASE_URL}',
    detailFetchSucceeded: false,
    detailFetchError: ($json && $json.error && $json.error.message) ? $json.error.message : 'unknown error',
  },
};
`;

const CODE_C_FINAL = `
const allInputItems = $input.all();
if (allInputItems.length !== 1) {
  throw new Error('Compute paginationIncomplete expected exactly 1 aggregated item but received ' + allInputItems.length + ' — the Aggregate step must collapse every branch into one item.');
}
const results = allInputItems[0].json.data;
if (!Array.isArray(results)) {
  throw new Error('Compute paginationIncomplete expected the aggregated "data" field to be an array but got ' + typeof results);
}
const totalFromList = $('Mock: Murex Workday List Response').first().json.body.total;

const succeeded = results.filter((r) => r.detailFetchSucceeded === true);
const failed = results.filter((r) => r.detailFetchSucceeded !== true);

const rawJobs = succeeded.map((r) => ({
  title: r.title,
  externalPath: r.externalPath,
  locationsText: r.locationsText,
  postedOn: r.postedOn,
  bulletFields: r.bulletFields,
  description: r.description,
  tenantSiteBaseUrl: r.tenantSiteBaseUrl,
}));

const paginationIncomplete = failed.length > 0 || succeeded.length < totalFromList;

return [{
  json: {
    sourceId: 'PLACEHOLDER_SOURCE_ID',
    sourceType: 'workday',
    rawJobs: rawJobs,
    maxJobsPerSource: 50,
    dryRun: false,
    paginationIncomplete: paginationIncomplete,
    _debug_failedCount: failed.length,
    _debug_totalFromList: totalFromList,
    _debug_succeededCount: succeeded.length,
  },
}];
`;

/** Runs a runOnceForEachItem-style Code node body against one mocked $json, with a mocked $() node-reference. */
function runPerItemCodeNode(jsCode, inputJson, nodeRefs) {
  const context = {
    $json: inputJson,
    $: (nodeName) => {
      if (!(nodeName in nodeRefs)) throw new Error(`test harness: no mock registered for $('${nodeName}')`);
      return nodeRefs[nodeName];
    },
  };
  vm.createContext(context);
  const script = new vm.Script(`(function () {\n${jsCode}\n})()`);
  const result = script.runInContext(context);
  assert.ok(result && typeof result === "object" && "json" in result, "a runOnceForEachItem Code node must return one { json } object directly");
  return JSON.parse(JSON.stringify(result.json));
}

/** Runs the runOnceForAllItems final Code node body against a mocked $input.all() and a mocked $() node-reference. */
function runFinalCodeNode(jsCode, aggregatedItems, nodeRefs) {
  const context = {
    $input: { all: () => aggregatedItems.map((json) => ({ json })) },
    $: (nodeName) => {
      if (!(nodeName in nodeRefs)) throw new Error(`test harness: no mock registered for $('${nodeName}')`);
      return nodeRefs[nodeName];
    },
  };
  vm.createContext(context);
  const script = new vm.Script(`(function () {\n${jsCode}\n})()`);
  const result = script.runInContext(context);
  assert.ok(Array.isArray(result) && result.length === 1, "a runOnceForAllItems Code node here must return exactly one item");
  return JSON.parse(JSON.stringify(result[0].json));
}

function mockSplitOutRef(jobPosting) {
  return { item: { json: jobPosting } };
}

function mockListResponseRef(total) {
  return { first: () => ({ json: { body: { total } } }) };
}

function jobPosting(n) {
  return {
    title: `Job ${n}`,
    externalPath: `/job/City/Job-${n}_JR10000${n}`,
    locationsText: "Beirut",
    postedOn: "Posted 2 Days Ago",
    bulletFields: [`JR10000${n}`, "Category"],
  };
}

describe("Workday detail-fetch architecture — Code node A (merge on success)", () => {
  test("merges a real-shaped detail response with the original list fields", () => {
    const listItem = jobPosting(1);
    const httpSuccessJson = { body: { jobPostingInfo: { jobDescription: "<p>Real job description.</p>" } } };
    const out = runPerItemCodeNode(CODE_A_MERGE_SUCCESS, httpSuccessJson, { "Split Out Job Postings": mockSplitOutRef(listItem) });
    assert.equal(out.title, "Job 1");
    assert.equal(out.externalPath, "/job/City/Job-1_JR100001");
    assert.equal(out.description, "<p>Real job description.</p>");
    assert.equal(out.tenantSiteBaseUrl, TENANT_SITE_BASE_URL);
    assert.equal(out.detailFetchSucceeded, true);
  });

  test("a detail response missing jobPostingInfo.jobDescription entirely maps to null, never fabricated", () => {
    const listItem = jobPosting(2);
    const httpSuccessJson = { body: { jobPostingInfo: {} } };
    const out = runPerItemCodeNode(CODE_A_MERGE_SUCCESS, httpSuccessJson, { "Split Out Job Postings": mockSplitOutRef(listItem) });
    assert.equal(out.description, null);
    assert.equal(out.detailFetchSucceeded, true, "a 2xx response with an unexpectedly empty description is still a successful fetch, not a failure — validateRawProviderJob's missing_description rule handles rejection downstream, this node must not invent a fail state");
  });
});

describe("Workday detail-fetch architecture — Code node B (mark failed on error)", () => {
  test("a failed detail fetch is tagged, never silently given a fabricated description", () => {
    const listItem = jobPosting(3);
    const errorJson = { error: { message: "ETIMEDOUT" } };
    const out = runPerItemCodeNode(CODE_B_MARK_FAILED, errorJson, { "Split Out Job Postings": mockSplitOutRef(listItem) });
    assert.equal(out.title, "Job 3");
    assert.equal(out.description, null);
    assert.equal(out.detailFetchSucceeded, false);
    assert.equal(out.detailFetchError, "ETIMEDOUT");
  });

  test("an error item with no readable message still reports a safe fallback string, never throws", () => {
    const listItem = jobPosting(4);
    const out = runPerItemCodeNode(CODE_B_MARK_FAILED, {}, { "Split Out Job Postings": mockSplitOutRef(listItem) });
    assert.equal(out.detailFetchSucceeded, false);
    assert.equal(out.detailFetchError, "unknown error");
  });
});

describe("Workday detail-fetch architecture — Code node C (final payload + paginationIncomplete)", () => {
  test("full success, list total matches exactly -> paginationIncomplete:false, all jobs included", () => {
    const aggregated = [
      { ...jobPosting(1), description: "d1", tenantSiteBaseUrl: TENANT_SITE_BASE_URL, detailFetchSucceeded: true },
      { ...jobPosting(2), description: "d2", tenantSiteBaseUrl: TENANT_SITE_BASE_URL, detailFetchSucceeded: true },
    ];
    const out = runFinalCodeNode(CODE_C_FINAL, [{ data: aggregated }], { "Mock: Murex Workday List Response": mockListResponseRef(2) });
    assert.equal(out.paginationIncomplete, false);
    assert.equal(out.rawJobs.length, 2);
    assert.equal(out._debug_failedCount, 0);
  });

  test("one partial detail-fetch failure -> paginationIncomplete:true, the failed job is dropped (never fabricated), the succeeded job is kept", () => {
    const aggregated = [
      { ...jobPosting(1), description: "d1", tenantSiteBaseUrl: TENANT_SITE_BASE_URL, detailFetchSucceeded: true },
      { ...jobPosting(2), description: null, tenantSiteBaseUrl: TENANT_SITE_BASE_URL, detailFetchSucceeded: false, detailFetchError: "ECONNRESET" },
    ];
    const out = runFinalCodeNode(CODE_C_FINAL, [{ data: aggregated }], { "Mock: Murex Workday List Response": mockListResponseRef(2) });
    assert.equal(out.paginationIncomplete, true, "a run with any failed detail fetch must never be reported as a complete, trustworthy refresh");
    assert.equal(out.rawJobs.length, 1, "the failed job must be dropped from rawJobs, never sent downstream with a missing description");
    assert.equal(out.rawJobs[0].title, "Job 1");
    assert.equal(out._debug_failedCount, 1);
  });

  test("multiple partial failures -> all failed jobs dropped, paginationIncomplete:true, nothing silently lost from the count", () => {
    const aggregated = [
      { ...jobPosting(1), description: "d1", tenantSiteBaseUrl: TENANT_SITE_BASE_URL, detailFetchSucceeded: true },
      { ...jobPosting(2), description: null, tenantSiteBaseUrl: TENANT_SITE_BASE_URL, detailFetchSucceeded: false, detailFetchError: "ETIMEDOUT" },
      { ...jobPosting(3), description: null, tenantSiteBaseUrl: TENANT_SITE_BASE_URL, detailFetchSucceeded: false, detailFetchError: "HTTP 500" },
      { ...jobPosting(4), description: "d4", tenantSiteBaseUrl: TENANT_SITE_BASE_URL, detailFetchSucceeded: true },
    ];
    const out = runFinalCodeNode(CODE_C_FINAL, [{ data: aggregated }], { "Mock: Murex Workday List Response": mockListResponseRef(4) });
    assert.equal(out._debug_succeededCount + out._debug_failedCount, 4, "every aggregated item must be accounted for — succeeded + failed must equal the total items received, nothing silently dropped by the aggregation step itself");
    assert.equal(out.rawJobs.length, 2);
    assert.equal(out.paginationIncomplete, true);
  });

  test("pagination mismatch: every detail fetch succeeded, but fewer jobs were fetched than the list's own total -> paginationIncomplete:true even with zero failures", () => {
    // Simulates a run bounded before every page/job was detail-fetched (e.g.
    // a future maxJobsPerSource cap applied before this stage) — the list
    // endpoint's own total (74, matching the real Murex count observed in
    // Sub-phase 2a) says more jobs exist than this batch actually processed.
    const aggregated = [{ ...jobPosting(1), description: "d1", tenantSiteBaseUrl: TENANT_SITE_BASE_URL, detailFetchSucceeded: true }];
    const out = runFinalCodeNode(CODE_C_FINAL, [{ data: aggregated }], { "Mock: Murex Workday List Response": mockListResponseRef(74) });
    assert.equal(out.paginationIncomplete, true, "succeededCount (1) < totalFromList (74) must force paginationIncomplete:true regardless of zero fetch failures");
    assert.equal(out.rawJobs.length, 1);
    assert.equal(out._debug_totalFromList, 74);
  });

  test("zero jobs in the list response at all (total:0) -> paginationIncomplete:false, empty rawJobs, no crash", () => {
    const out = runFinalCodeNode(CODE_C_FINAL, [{ data: [] }], { "Mock: Murex Workday List Response": mockListResponseRef(0) });
    assert.equal(out.paginationIncomplete, false, "a genuinely empty, truthfully-reported-as-zero result is complete, same principle as the already-proven GulfTalent completeness design");
    assert.deepEqual(out.rawJobs, []);
  });

  test("throws (routing to its own error output) rather than silently processing a malformed aggregation — more than 1 aggregated item received", () => {
    assert.throws(
      () => runFinalCodeNode(CODE_C_FINAL, [{ data: [] }, { data: [] }], { "Mock: Murex Workday List Response": mockListResponseRef(0) }),
      /expected exactly 1 aggregated item/,
      "the Aggregate step must always collapse to exactly 1 item — more than 1 reaching this node means the aggregation itself is misconfigured, and must fail loudly rather than silently pick one"
    );
  });

  test("throws when the aggregated data field is not an array — malformed aggregation shape, never silently coerced", () => {
    assert.throws(
      () => runFinalCodeNode(CODE_C_FINAL, [{ data: "not-an-array" }], { "Mock: Murex Workday List Response": mockListResponseRef(0) }),
      /expected the aggregated "data" field to be an array/
    );
  });
});
