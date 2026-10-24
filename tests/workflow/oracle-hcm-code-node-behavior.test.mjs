// Behavioral tests for the Oracle HCM pagination Code nodes (2026-10-24
// corrective fix). These execute the EXACT `jsCode` string stored in the
// exported workflow JSON — not a reimplementation — via node:vm, with a
// mocked `$input`/`$` matching n8n's own Code-node calling convention. This
// is what makes these "offline" (no n8n instance, no network, no DB) while
// still exercising the real deployed logic, not a copy of it.
//
// Context: an isolated n8n diagnostic (executions 300293/300549/300782)
// proved that a Set-node inline `{{ }}` expression's
// `Array.from(map.values())` — and the `[...map.values()]` spread form —
// both silently return an empty array despite the Map itself reporting the
// correct size, while a Code node (real JS sandbox) does not share that
// defect. `Prepare Oracle HCM Page State` and `Merge & Classify Oracle HCM
// Page` were moved from Set nodes to Code nodes for exactly that reason.
// Static structural checks (type, onError wiring, notes) remain in
// tests/workflow/ai-job-agent-01-job-ingestion.test.mjs; this file is the
// behavioral complement, proving the moved logic still does what the
// Set-node version was supposed to do, and stays in parity with
// src/lib/ingestion/oracleHcmPagination.ts (the independently unit-tested
// source of truth this logic is deliberately duplicated from, since n8n
// cannot import a project module at runtime).
//
// Also covers the 2026-10-24 defensive item-count guard: both nodes now
// throw (routing to their already-wired error output) if they ever receive
// more than 1 input item, instead of silently processing only
// $input.first() and discarding the rest.
//
// Known, explicitly unresolved limitation: node:vm's Function/Map/Array.from
// behave as standard real JS, same as n8n's own Code-node sandbox is
// confirmed (by the diagnostics above) to behave — but running this string
// through node:vm does NOT re-prove that n8n's live Code-node sandbox
// executes this *exact* string identically in production. That was only
// empirically confirmed for equivalent (not this literal) logic, in the two
// isolated diagnostic executions. No new n8n execution was authorized for
// this phase to re-confirm against this exact string.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../");
const wf = JSON.parse(readFileSync(resolve(ROOT, "n8n-workflows/ai-job-agent-01-job-ingestion.json"), "utf8"));

function getJsCode(nodeName) {
  const node = wf.nodes.find((n) => n.name === nodeName);
  assert.ok(node, `node ${nodeName} must exist`);
  assert.equal(node.type, "n8n-nodes-base.code", `${nodeName} must be a Code node (2026-10-24 corrective fix)`);
  assert.equal(node.parameters.mode, "runOnceForAllItems");
  assert.equal(node.parameters.language, "javaScript");
  return node.parameters.jsCode;
}

/**
 * Runs an n8n Code node's jsCode (runOnceForAllItems) against one mocked
 * input item. `namedNodeLookups` maps a node name to the json a `$('Name')`
 * reference should resolve to — only `Prepare Oracle HCM Page State` uses
 * this, for `$('Split Out Sources').item.json.feed_url`.
 */
function runCodeNode(jsCode, inputJson, namedNodeLookups = {}) {
  const context = {
    $input: { first: () => ({ json: inputJson }), all: () => [{ json: inputJson }] },
    $: (name) => {
      if (!(name in namedNodeLookups)) throw new Error(`no mock registered for $('${name}')`);
      return { item: { json: namedNodeLookups[name] } };
    },
  };
  vm.createContext(context);
  const script = new vm.Script(`(function () {\n${jsCode}\n})()`);
  const result = script.runInContext(context);
  assert.ok(Array.isArray(result) && result.length === 1, "a Code node (runOnceForAllItems) must return exactly one item here");
  assert.ok("json" in result[0], "the returned item must be wrapped in a json property");
  // Normalize out of the vm's separate realm (its Array/Object prototypes
  // differ from this file's, which trips assert.deepEqual's reference-
  // equality check on otherwise-identical structures) — this also better
  // matches real n8n, which passes item data between nodes as plain JSON,
  // not a live cross-realm object graph.
  return JSON.parse(JSON.stringify(result[0].json));
}

const FEED_URL = "https://example.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber=CX_1&expand=requisitionList&limit=50";
const SPLIT_OUT_SOURCES_MOCK = { "Split Out Sources": { feed_url: FEED_URL } };

/**
 * 2026-10-24 defensive guard regression: both corrected nodes run
 * `runOnceForAllItems` and historically read only `$input.first()`. If more
 * than one item ever reached them, the rest would be silently discarded —
 * no error, just quietly lost jobs. Both nodes now throw instead, routing
 * to their existing (already-wired) error output. Runs the jsCode against
 * N mocked input items and asserts it throws rather than silently
 * processing only the first.
 */
function runCodeNodeExpectingMultiItemGuard(jsCode, inputJsonItems, namedNodeLookups = {}) {
  assert.ok(inputJsonItems.length > 1, "this helper is for the >1-item guard case specifically");
  const wrapped = inputJsonItems.map((json) => ({ json }));
  const context = {
    $input: { first: () => wrapped[0], all: () => wrapped },
    $: (name) => {
      if (!(name in namedNodeLookups)) throw new Error(`no mock registered for $('${name}')`);
      return { item: { json: namedNodeLookups[name] } };
    },
  };
  vm.createContext(context);
  const script = new vm.Script(`(function () {\n${jsCode}\n})()`);
  assert.throws(
    () => script.runInContext(context),
    (err) => err.message.includes(String(inputJsonItems.length)),
    "must throw (routing to its error output) rather than silently process only $input.first() when more than 1 item arrives"
  );
}

describe("Prepare Oracle HCM Page State (Code node) — first-page behavior, parity with classifyOracleHcmFirstPage", () => {
  const jsCode = getJsCode("Prepare Oracle HCM Page State");

  test("a complete single page (AUBMC-shaped, 8 jobs) is recognized as complete and stamps candidateSiteUrl", () => {
    const out = runCodeNode(
      jsCode,
      { items: [{ Offset: 0, Limit: 25, TotalJobsCount: 8, requisitionList: Array.from({ length: 8 }, (_, i) => ({ Id: i + 1 })) }] },
      SPLIT_OUT_SOURCES_MOCK
    );
    assert.equal(out.pageState.rawJobs.length, 8);
    assert.equal(out.pageState.isComplete, true);
    assert.equal(out.pageState.paginationIncomplete, false);
    assert.equal(out.pageState.candidateSiteUrl, "https://example.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1");
    assert.equal(out.pageState.feedUrl, FEED_URL);
  });

  test("a page needing more pages is correctly classified as incomplete", () => {
    const out = runCodeNode(
      jsCode,
      { items: [{ Offset: 0, Limit: 2, TotalJobsCount: 6, requisitionList: [{ Id: 1 }, { Id: 2 }] }] },
      SPLIT_OUT_SOURCES_MOCK
    );
    assert.equal(out.pageState.isComplete, false);
    assert.equal(out.pageState.rawJobs.length, 2);
  });

  test("missing/invalid Ids on the first page are never collapsed into each other", () => {
    const out = runCodeNode(
      jsCode,
      { items: [{ Offset: 0, Limit: 25, TotalJobsCount: 2, requisitionList: [{ Title: "no id A" }, { Title: "no id B" }] }] },
      SPLIT_OUT_SOURCES_MOCK
    );
    assert.equal(out.pageState.rawJobs.length, 2, "both Id-less jobs survive — no real shared identity to dedup by");
  });

  test("malformed metadata (missing items) fails closed — zero jobs, paginationIncomplete true", () => {
    const out = runCodeNode(jsCode, {}, SPLIT_OUT_SOURCES_MOCK);
    assert.equal(out.pageState.paginationIncomplete, true);
    assert.equal(out.pageState.rawJobs.length, 0);
    assert.equal(out.pageState.isComplete, false);
  });

  test("non-numeric TotalJobsCount fails closed, never half-trusts the response", () => {
    const out = runCodeNode(
      jsCode,
      { items: [{ Offset: 0, Limit: 25, TotalJobsCount: "eight", requisitionList: [{ Id: 1 }] }] },
      SPLIT_OUT_SOURCES_MOCK
    );
    assert.equal(out.pageState.paginationIncomplete, true);
    assert.equal(out.pageState.rawJobs.length, 0);
  });

  test("2026-10-24 guard: more than 1 input item throws instead of silently processing only the first via $input.first()", () => {
    runCodeNodeExpectingMultiItemGuard(
      jsCode,
      [
        { items: [{ Offset: 0, Limit: 2, TotalJobsCount: 6, requisitionList: [{ Id: 1 }, { Id: 2 }] }] },
        { items: [{ Offset: 0, Limit: 2, TotalJobsCount: 6, requisitionList: [{ Id: 99 }] }] },
      ],
      SPLIT_OUT_SOURCES_MOCK
    );
  });
});

describe("Merge & Classify Oracle HCM Page (Code node) — subsequent-page behavior, parity with classifyOracleHcmNextPage", () => {
  const jsCode = getJsCode("Merge & Classify Oracle HCM Page");

  function priorState(overrides) {
    return Object.assign(
      {
        rawJobs: [{ Id: 1 }, { Id: 2 }],
        pageOffset: 0,
        pageLimit: 2,
        totalJobsCount: 6,
        pagesFetched: 1,
        paginationIncomplete: false,
        isComplete: false,
        candidateSiteUrl: "https://example.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1",
        feedUrl: FEED_URL,
      },
      overrides
    );
  }

  test("three-page accumulation (the exact synthetic shape the earlier isolated n8n diagnostic used) reaches all 6 jobs and completes", () => {
    const prior = priorState();
    const out1 = runCodeNode(jsCode, { pageState: prior, items: [{ Offset: 2, Limit: 2, TotalJobsCount: 6, requisitionList: [{ Id: 3 }, { Id: 4 }] }] });
    assert.equal(out1.pageState.rawJobs.length, 4, "this is EXACTLY the case the original Set-node defect silently reduced to 0");
    assert.equal(out1.pageState.pagesFetched, 2);
    assert.equal(out1.pageState.isComplete, false);

    const out2 = runCodeNode(jsCode, { pageState: out1.pageState, items: [{ Offset: 4, Limit: 2, TotalJobsCount: 6, requisitionList: [{ Id: 5 }, { Id: 6 }] }] });
    assert.equal(out2.pageState.rawJobs.length, 6, "all six distinct jobs accumulated across three pages");
    assert.equal(out2.pageState.pagesFetched, 3);
    assert.equal(out2.pageState.isComplete, true);
    assert.equal(out2.pageState.paginationIncomplete, false);
    const ids = out2.pageState.rawJobs.map((j) => j.Id).sort((a, b) => a - b);
    assert.deepEqual(ids, [1, 2, 3, 4, 5, 6]);
  });

  test("duplicate Ids across pages are deduplicated, never double-counted", () => {
    const prior = priorState({ rawJobs: [{ Id: 1 }, { Id: 2 }], totalJobsCount: 3 });
    const out = runCodeNode(jsCode, { pageState: prior, items: [{ Offset: 2, Limit: 1, TotalJobsCount: 3, requisitionList: [{ Id: 2 }, { Id: 3 }] }] });
    assert.equal(out.pageState.rawJobs.length, 3, "Id 2 counted once, not twice");
    assert.equal(out.pageState.isComplete, true);
  });

  test("missing/invalid Ids across two pages all survive distinctly, never collapsed under a shared empty key", () => {
    const prior = priorState({ rawJobs: [{ Id: 1 }, { Title: "no id, page 1" }], totalJobsCount: 10 });
    const out = runCodeNode(jsCode, { pageState: prior, items: [{ Offset: 2, Limit: 2, TotalJobsCount: 10, requisitionList: [{ Id: 2 }, { Title: "no id, page 2" }] }] });
    assert.equal(out.pageState.rawJobs.length, 4, "Id:1, Id:2, and both distinct Id-less jobs must all survive");
  });

  test("a premature empty page (0 items before the real total) fails closed, preserves prior jobs", () => {
    const prior = priorState();
    const out = runCodeNode(jsCode, { pageState: prior, items: [{ Offset: 2, Limit: 2, TotalJobsCount: 6, requisitionList: [] }] });
    assert.equal(out.pageState.paginationIncomplete, true);
    assert.equal(out.pageState.isComplete, false);
    assert.equal(out.pageState.rawJobs.length, 2, "prior page preserved, never discarded");
  });

  test("a genuinely-exhausting empty page (0 items, offset already at/past total) is the correct completion signal, not premature", () => {
    const prior = priorState({ rawJobs: Array.from({ length: 8 }, (_, i) => ({ Id: i + 1 })), pageOffset: 0, pageLimit: 25, totalJobsCount: 8 });
    const out = runCodeNode(jsCode, { pageState: prior, items: [{ Offset: 8, Limit: 25, TotalJobsCount: 8, requisitionList: [] }] });
    assert.equal(out.pageState.paginationIncomplete, false);
    assert.equal(out.pageState.isComplete, true);
  });

  test("a fetch error (input.error, set by Carry Forward Oracle HCM Page State) fails closed without touching rawJobs", () => {
    const prior = priorState();
    const out = runCodeNode(jsCode, { pageState: prior, error: { message: "boom" } });
    assert.equal(out.pageState.paginationIncomplete, true);
    assert.equal(out.pageState.isComplete, false);
    assert.equal(out.pageState.rawJobs.length, 2);
  });

  test("a non-advancing/repeated offset fails closed, never merges the repeated page", () => {
    const prior = priorState();
    const out = runCodeNode(jsCode, { pageState: prior, items: [{ Offset: 0, Limit: 2, TotalJobsCount: 6, requisitionList: [{ Id: 1 }, { Id: 2 }] }] });
    assert.equal(out.pageState.paginationIncomplete, true);
    assert.equal(out.pageState.rawJobs.length, 2);
  });

  test("malformed metadata on a later page preserves prior good pages rather than discarding them", () => {
    const prior = priorState();
    const out = runCodeNode(jsCode, { pageState: prior, items: [{ Offset: 2, Limit: "oops", TotalJobsCount: 6, requisitionList: [] }] });
    assert.equal(out.pageState.paginationIncomplete, true);
    assert.equal(out.pageState.rawJobs.length, 2);
  });

  test("other input fields (the Set-node includeOtherFields:true equivalent) survive untouched alongside the recomputed pageState", () => {
    const prior = priorState();
    const out = runCodeNode(jsCode, { pageState: prior, requestedOffset: 2, items: [{ Offset: 2, Limit: 2, TotalJobsCount: 6, requisitionList: [{ Id: 3 }, { Id: 4 }] }] });
    assert.equal(out.requestedOffset, 2, "fields other than pageState must still pass through, matching the old Set node's includeOtherFields:true");
  });

  test("2026-10-24 guard: more than 1 input item throws instead of silently merging only the first via $input.first()", () => {
    const prior = priorState();
    runCodeNodeExpectingMultiItemGuard(jsCode, [
      { pageState: prior, items: [{ Offset: 2, Limit: 2, TotalJobsCount: 6, requisitionList: [{ Id: 3 }, { Id: 4 }] }] },
      { pageState: prior, items: [{ Offset: 2, Limit: 2, TotalJobsCount: 6, requisitionList: [{ Id: 5 }] }] },
    ]);
  });
});
