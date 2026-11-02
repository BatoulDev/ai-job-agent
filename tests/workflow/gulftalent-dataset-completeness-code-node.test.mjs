// Offline behavioral tests for the PROPOSED (not yet deployed) "Check
// GulfTalent Dataset Completeness" Code node — part of the 2026-10-25
// GulfTalent stale-close safety design. This node does not exist in any
// real workflow yet; PROPOSED_JS_CODE below is the exact candidate string,
// kept here verbatim so this file is the literal source of truth for the
// logic until/if it is ever applied to the real staging workflow (at
// which point this file's own convention — see
// tests/workflow/oracle-hcm-code-node-behavior.test.mjs — would switch to
// reading the jsCode back out of the real exported workflow JSON instead).
//
// Executed via node:vm against a mocked $input, mirroring
// oracle-hcm-code-node-behavior.test.mjs's own harness exactly — no n8n
// instance, no network, no database.
//
// Design recap (see the accompanying report for full detail):
//   - isValidResponse: true only when statusCode is 2xx AND body is an
//     array. False routes (in the real graph) to the existing
//     "Build GulfTalent Dataset Fetch Failure Result" node, skipping the
//     batch endpoint entirely — an untrustworthy response is never
//     forwarded as if it were real data.
//   - paginationIncomplete: true unless isValidResponse AND the
//     X-Apify-Pagination-Total header is a valid non-negative integer AND
//     receivedCount === total. Under-fetch, over-fetch, a missing header,
//     a fractional/negative/non-numeric header, and an unreadable response
//     all fail closed. An empty-string header is explicitly treated the
//     same as a missing one (Number('') is a long-standing JS trap — it
//     coerces to 0, which would otherwise make an incomplete retrieval
//     look complete by coincidence).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const PROPOSED_JS_CODE = `
const allInputItems = $input.all();
if (allInputItems.length !== 1) {
  throw new Error('Check GulfTalent Dataset Completeness expected exactly 1 input item but received ' + allInputItems.length + ' — refusing to process via $input.first() only, which would silently discard the rest.');
}
const input = allInputItems[0].json;
const statusCode = input.statusCode;
const headers = input.headers ?? {};
const body = input.body;

const statusOk = typeof statusCode === 'number' && statusCode >= 200 && statusCode < 300;
const bodyIsArray = Array.isArray(body);
const isValidResponse = statusOk && bodyIsArray;
// Never carry data forward from a response we've already decided not to
// trust — jobs stays empty whenever isValidResponse is false, even if the
// body happened to look array-shaped (e.g. a non-2xx error response with
// an array-shaped body). The real graph also routes a false
// isValidResponse straight to the existing failure builder, skipping the
// batch endpoint entirely, so this is defense in depth, not the only gate.
const itemsArray = isValidResponse ? body : [];
const receivedCount = itemsArray.length;

const totalHeaderRaw = headers['x-apify-pagination-total'];
const hasHeaderValue = (typeof totalHeaderRaw === 'string' && totalHeaderRaw.trim() !== '') || typeof totalHeaderRaw === 'number';
const totalParsed = hasHeaderValue ? Number(totalHeaderRaw) : NaN;
const totalKnown = hasHeaderValue && Number.isInteger(totalParsed) && totalParsed >= 0;

const paginationIncomplete = !(isValidResponse && totalKnown && receivedCount === totalParsed);

return [{ json: { jobs: itemsArray, paginationIncomplete: paginationIncomplete, isValidResponse: isValidResponse } }];
`;

function runCodeNode(jsCode, inputJson) {
  const context = {
    $input: { first: () => ({ json: inputJson }), all: () => [{ json: inputJson }] },
  };
  vm.createContext(context);
  const script = new vm.Script(`(function () {\n${jsCode}\n})()`);
  const result = script.runInContext(context);
  assert.ok(Array.isArray(result) && result.length === 1, "a Code node (runOnceForAllItems) must return exactly one item here");
  assert.ok("json" in result[0], "the returned item must be wrapped in a json property");
  return JSON.parse(JSON.stringify(result[0].json));
}

function runCodeNodeExpectingMultiItemGuard(jsCode, inputJsonItems) {
  assert.ok(inputJsonItems.length > 1, "this helper is for the >1-item guard case specifically");
  const wrapped = inputJsonItems.map((json) => ({ json }));
  const context = {
    $input: { first: () => wrapped[0], all: () => wrapped },
  };
  vm.createContext(context);
  const script = new vm.Script(`(function () {\n${jsCode}\n})()`);
  assert.throws(
    () => script.runInContext(context),
    (err) => err.message.includes(String(inputJsonItems.length)),
    "must throw (routing to its error output) rather than silently process only $input.first() when more than 1 item arrives"
  );
}

function fullResponse(overrides = {}) {
  return { statusCode: 200, headers: {}, body: [], ...overrides };
}

describe("Check GulfTalent Dataset Completeness (proposed Code node)", () => {
  test("exact count match: receivedCount === total -> valid, complete", () => {
    const out = runCodeNode(PROPOSED_JS_CODE, fullResponse({ headers: { "x-apify-pagination-total": "2" }, body: [{ id: 1 }, { id: 2 }] }));
    assert.equal(out.isValidResponse, true);
    assert.equal(out.paginationIncomplete, false);
    assert.equal(out.jobs.length, 2);
  });

  test("under-fetch: receivedCount < total -> valid but incomplete (still safe to ingest)", () => {
    const out = runCodeNode(PROPOSED_JS_CODE, fullResponse({ headers: { "x-apify-pagination-total": "5" }, body: [{ id: 1 }, { id: 2 }] }));
    assert.equal(out.isValidResponse, true, "a short page is still a trustworthy response, not a garbage one");
    assert.equal(out.paginationIncomplete, true);
    assert.equal(out.jobs.length, 2, "the real jobs we did receive must still be forwarded, never discarded");
  });

  test("over-fetch: receivedCount > total -> valid but flagged incomplete (inconsistent, never silently trusted)", () => {
    const out = runCodeNode(PROPOSED_JS_CODE, fullResponse({ headers: { "x-apify-pagination-total": "1" }, body: [{ id: 1 }, { id: 2 }, { id: 3 }] }));
    assert.equal(out.isValidResponse, true);
    assert.equal(out.paginationIncomplete, true, "receivedCount > total is just as untrustworthy as receivedCount < total — never treated as 'complete, plus extra'");
  });

  test("valid empty dataset: 0 received, total 0 -> valid and genuinely complete", () => {
    const out = runCodeNode(PROPOSED_JS_CODE, fullResponse({ headers: { "x-apify-pagination-total": "0" }, body: [] }));
    assert.equal(out.isValidResponse, true);
    assert.equal(out.paginationIncomplete, false, "a market with zero current postings, truthfully reported as zero, is complete");
    assert.equal(out.jobs.length, 0);
  });

  test("missing header: valid response, but completeness unknown -> fails closed", () => {
    const out = runCodeNode(PROPOSED_JS_CODE, fullResponse({ headers: {}, body: [{ id: 1 }] }));
    assert.equal(out.isValidResponse, true);
    assert.equal(out.paginationIncomplete, true);
  });

  test("empty-string header is treated the same as missing, never coerced to 0", () => {
    const out = runCodeNode(PROPOSED_JS_CODE, fullResponse({ headers: { "x-apify-pagination-total": "" }, body: [] }));
    assert.equal(out.isValidResponse, true);
    assert.equal(out.paginationIncomplete, true, "Number('') === 0 is a real trap — must not let an empty header masquerade as a confirmed total of zero");
  });

  test("fractional header -> invalid total, fails closed", () => {
    const out = runCodeNode(PROPOSED_JS_CODE, fullResponse({ headers: { "x-apify-pagination-total": "2.5" }, body: [{ id: 1 }, { id: 2 }] }));
    assert.equal(out.isValidResponse, true);
    assert.equal(out.paginationIncomplete, true);
  });

  test("negative header -> invalid total, fails closed", () => {
    const out = runCodeNode(PROPOSED_JS_CODE, fullResponse({ headers: { "x-apify-pagination-total": "-1" }, body: [] }));
    assert.equal(out.paginationIncomplete, true);
  });

  test("non-numeric header -> invalid total, fails closed", () => {
    const out = runCodeNode(PROPOSED_JS_CODE, fullResponse({ headers: { "x-apify-pagination-total": "not-a-number" }, body: [{ id: 1 }] }));
    assert.equal(out.paginationIncomplete, true);
  });

  test("non-2xx status -> response is NOT valid, regardless of body/header shape", () => {
    const out = runCodeNode(PROPOSED_JS_CODE, fullResponse({ statusCode: 500, headers: { "x-apify-pagination-total": "2" }, body: [{ id: 1 }, { id: 2 }] }));
    assert.equal(out.isValidResponse, false, "a non-2xx response must never be forwarded as if it were real ingestible data");
    assert.equal(out.jobs.length, 0, "no jobs are extracted from an untrustworthy response");
  });

  test("non-array body -> response is NOT valid, even with a 2xx status", () => {
    const out = runCodeNode(PROPOSED_JS_CODE, fullResponse({ statusCode: 200, headers: { "x-apify-pagination-total": "0" }, body: { unexpected: "shape" } }));
    assert.equal(out.isValidResponse, false);
    assert.equal(out.jobs.length, 0);
  });

  test("missing statusCode entirely -> not valid (fails closed, never assumes success)", () => {
    const input = { headers: { "x-apify-pagination-total": "1" }, body: [{ id: 1 }] };
    const out = runCodeNode(PROPOSED_JS_CODE, input);
    assert.equal(out.isValidResponse, false);
  });

  test("more than 1 input item throws instead of silently processing only the first via $input.first()", () => {
    runCodeNodeExpectingMultiItemGuard(PROPOSED_JS_CODE, [
      fullResponse({ headers: { "x-apify-pagination-total": "1" }, body: [{ id: 1 }] }),
      fullResponse({ headers: { "x-apify-pagination-total": "1" }, body: [{ id: 2 }] }),
    ]);
  });
});
