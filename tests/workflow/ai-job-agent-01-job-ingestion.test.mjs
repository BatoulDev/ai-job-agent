/**
 * Static-analysis tests for the "AI Job Guide / 01 Job Ingestion" workflow
 * (Phase 04, extended Phase 12/13). No database or n8n connection required —
 * reads the exported workflow JSON directly, mirroring
 * tests/workflow/job-ingestion-pilot-orchestrator.test.mjs. All validation/
 * mapping/dedup/persistence logic itself is covered by
 * tests/unit/raw-provider-job.test.mjs, tests/unit/ingestion-providers.test.mjs,
 * tests/unit/multi-company-provider-job.test.mjs, tests/unit/provider-config.test.mjs,
 * tests/unit/extract-career-page-job-postings.test.mjs, tests/unit/derive-ats-feed-url.test.mjs,
 * tests/db/find-eligible-company-sources.test.mjs, tests/db/find-career-page-extraction-candidates.test.mjs,
 * tests/db/ingestion-core-batch.test.mjs, and tests/db/ingest-multi-company-batch.test.mjs
 * — this file only checks that the workflow graph wires those into n8n
 * correctly across all three tiers (retry, rate limiting, error handling,
 * dynamic source discovery, and the Phase 13 fan-out to Tier D/Tier B).
 *
 * Run: node --test tests/workflow/ai-job-agent-01-job-ingestion.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

const JSON_PATH = resolve(ROOT, 'n8n-workflows/ai-job-agent-01-job-ingestion.json');
const wf = JSON.parse(readFileSync(JSON_PATH, 'utf8'));

function findNode(name) {
  const n = wf.nodes.find((x) => x.name === name);
  assert.ok(n, `Node "${name}" must exist`);
  return n;
}

// n8n's real API fetch (confirmed this phase, 2026-10-16 production-
// readiness audit) never serializes a switch rule's authoring-time
// `outputKey` label — it is an SDK/UI-only display name, not part of the
// stored node. Case routing is positional (rule index === connection
// output index), so these tests assert on each rule's actual condition
// (rightValue) in order instead of a field that doesn't survive a live
// round-trip.
function switchCaseValues(switchNode) {
  return switchNode.parameters.rules.values.map((v) => v.conditions.conditions[0].rightValue);
}

// Same live-round-trip reality for splitInBatches: n8n omits `batchSize`
// entirely from a GET when it equals the node's own default (1), rather
// than writing it explicitly — confirmed by direct comparison against this
// workflow's live MCP fetch. Treat "absent" and "1" as the same thing.
function assertBatchesOneAtATime(loopNode) {
  assert.equal(loopNode.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loopNode.parameters.batchSize ?? 1, 1);
}

test('workflow JSON parses and has name/nodes/connections/settings', () => {
  assert.equal(typeof wf.name, 'string');
  assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 0);
  assert.equal(typeof wf.connections, 'object');
  assert.equal(typeof wf.settings, 'object');
});

test('workflow is inactive in JSON', () => {
  assert.equal(wf.active, false, 'Workflow must remain inactive until a human reviews a real run');
});

test('exactly one Manual Trigger and exactly one Schedule Trigger (production daily cadence, added alongside the manual entry point for testing/admin use)', () => {
  const manualTriggers = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.manualTrigger');
  assert.equal(manualTriggers.length, 1);
  const scheduleTriggers = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  assert.equal(scheduleTriggers.length, 1, 'exactly one Schedule Trigger — the daily production cadence');
});

test('no Supabase HTTP calls — persistence is fully delegated to the internal endpoint', () => {
  const urls = wf.nodes
    .filter((n) => n.type === 'n8n-nodes-base.httpRequest')
    .map((n) => n.parameters?.url ?? '');
  assert.ok(!urls.some((u) => u.includes('supabase')), 'this workflow must never call Supabase REST directly (see overview sticky note)');
});

test('List Ingestion Sources discovers sources dynamically via the internal endpoint, with retry, error handling, and Bearer auth', () => {
  const node = findNode('List Ingestion Sources');
  assert.equal(node.parameters.method, 'POST');
  assert.match(node.parameters.url, /\/api\/internal\/ingestion\/list-sources$/);
  assert.equal(node.parameters.authentication, 'genericCredentialType');
  assert.equal(node.parameters.genericAuthType, 'httpBearerAuth');
  assert.equal(node.retryOnFail, true);
  assert.equal(node.onError, 'continueErrorOutput');
});

test("List Ingestion Sources's error output is wired to Log List Sources Failure, never left hanging", () => {
  const conns = wf.connections['List Ingestion Sources']?.main ?? [];
  const success = conns[0] ?? [];
  const errorOutput = conns[1] ?? [];
  assert.ok(success.some((c) => c.node === 'Split Out Sources'), 'success output must feed Split Out Sources');
  assert.ok(errorOutput.some((c) => c.node === 'Log List Sources Failure'), 'error output must feed Log List Sources Failure');
});

test('List Ingestion Sources fans out to all three tiers (Phase 13) from the same success output — a single discovery call drives Tier A, Tier D, and Tier B', () => {
  const success = wf.connections['List Ingestion Sources']?.main?.[0] ?? [];
  assert.ok(success.some((c) => c.node === 'Split Out Sources'), 'Tier A branch missing');
  assert.ok(success.some((c) => c.node === 'Split Out Multi-Company Sources'), 'Tier D branch missing');
  assert.ok(success.some((c) => c.node === 'Split Out Career Page Candidates'), 'Tier B branch missing');
  assert.equal(success.length, 3, 'exactly three branches must fan out from List Ingestion Sources, no more, no fewer');
});

test('Fetch Source Jobs has native retry and continues on error rather than halting the run', () => {
  const node = findNode('Fetch Source Jobs');
  assert.equal(node.retryOnFail, true);
  assert.ok(node.maxTries >= 2 && node.maxTries <= 5, 'maxTries must respect the n8n engine cap of 5');
  assert.ok(node.waitBetweenTries <= 5000, 'waitBetweenTries must respect the n8n engine cap of 5000ms');
  assert.equal(node.onError, 'continueErrorOutput');
});

test('Call Ingestion Batch Endpoint posts to the internal route with Bearer auth, retries, and continues on error', () => {
  const node = findNode('Call Ingestion Batch Endpoint');
  assert.equal(node.parameters.method, 'POST');
  assert.match(node.parameters.url, /\/api\/internal\/ingestion\/run-batch$/);
  assert.equal(node.parameters.authentication, 'genericCredentialType');
  assert.equal(node.parameters.genericAuthType, 'httpBearerAuth');
  assert.equal(node.retryOnFail, true);
  assert.equal(node.onError, 'continueErrorOutput');
});

test('every extraction node degrades gracefully instead of halting the whole run on a malformed response', () => {
  for (const name of ['Extract Greenhouse Jobs', 'Extract Lever Jobs', 'Extract Workable Jobs', 'Extract Ashby Jobs', 'Extract Oracle HCM Jobs']) {
    const node = findNode(name);
    assert.equal(node.onError, 'continueErrorOutput', `${name} must continue to its error output, not stop the workflow`);
  }
});

test('every fallible node error output is wired to a Build *Result node, never left hanging', () => {
  const fallible = ['Fetch Source Jobs', 'Call Ingestion Batch Endpoint', 'Extract Greenhouse Jobs', 'Extract Lever Jobs', 'Extract Workable Jobs', 'Extract Ashby Jobs', 'Extract Oracle HCM Jobs'];
  for (const name of fallible) {
    const conns = wf.connections[name]?.main ?? [];
    const errorOutput = conns[1] ?? [];
    assert.ok(errorOutput.length > 0, `${name}'s error output (index 1) must be wired to a failure-result node`);
  }
});

test('Extract Jobs By ATS Type has ashby and oracle_hcm cases (Phase 13/16) routing to their own extraction nodes, alongside greenhouse/lever/workable, with the fallback still catching anything else', () => {
  const switchNode = findNode('Extract Jobs By ATS Type');
  assert.deepEqual(switchCaseValues(switchNode), ['greenhouse', 'lever', 'workable', 'ashby', 'oracle_hcm']);
  const conns = wf.connections['Extract Jobs By ATS Type']?.main ?? [];
  assert.equal(conns.length, 6, 'five defined cases plus one fallback output');
  assert.ok(conns[3]?.some((c) => c.node === 'Extract Ashby Jobs'), 'the ashby case (index 3) must route to Extract Ashby Jobs');
  assert.ok(conns[4]?.some((c) => c.node === 'Extract Oracle HCM Jobs'), 'the oracle_hcm case (index 4) must route to Extract Oracle HCM Jobs');
  assert.ok(conns[5]?.some((c) => c.node === 'Build Unsupported Source Result'), 'the fallback (index 5) must still route to Build Unsupported Source Result');
});

test('Extract Oracle HCM Jobs derives a real candidate-facing apply URL from feed_url and stamps it onto every raw job, then feeds the shared Call Ingestion Batch Endpoint (Phase 16)', () => {
  const node = findNode('Extract Oracle HCM Jobs');
  assert.equal(node.type, 'n8n-nodes-base.set');
  assert.equal(node.onError, 'continueErrorOutput');
  const value = node.parameters.assignments.assignments[0].value;
  assert.match(value, /candidateSiteUrl/, 'must derive and stamp candidateSiteUrl onto each raw job — Oracle\'s REST response carries no candidate-facing URL of its own');
  assert.match(value, /requisitionList/, 'must read the real nested job list shape (items[0].requisitionList), not assume a flat array');
  assert.ok(wf.connections['Extract Oracle HCM Jobs']?.main?.[0]?.some((c) => c.node === 'Call Ingestion Batch Endpoint'), 'success output must feed the shared Tier-A endpoint');
  assert.ok(wf.connections['Extract Oracle HCM Jobs']?.main?.[1]?.some((c) => c.node === 'Build Fetch Failure Result'), 'error output must be wired, never left hanging');
});

test('all four per-source result paths converge on Record Source Result', () => {
  for (const name of ['Build Success Result', 'Build Endpoint Failure Result', 'Build Unsupported Source Result', 'Build Fetch Failure Result']) {
    const conns = wf.connections[name]?.main?.[0] ?? [];
    assert.ok(conns.some((c) => c.node === 'Record Source Result'), `${name} must feed into Record Source Result`);
  }
});

test('the loop rate-limits between sources via Wait before looping back', () => {
  const waitNode = findNode('Rate Limit Delay');
  assert.equal(waitNode.type, 'n8n-nodes-base.wait');
  const loopBack = wf.connections['Rate Limit Delay']?.main?.[0] ?? [];
  assert.ok(loopBack.some((c) => c.node === 'Loop Sources (Rate Limited)'), 'Rate Limit Delay must loop back into the batching node');
});

test('the loop batches one source at a time', () => {
  assertBatchesOneAtATime(findNode('Loop Sources (Rate Limited)'));
});

// ── Tier D: multi-company feeds (Phase 13) ─────────────────────────────

test('Fetch Multi-Company Feed has native retry and continues on error', () => {
  const node = findNode('Fetch Multi-Company Feed');
  assert.equal(node.retryOnFail, true);
  assert.ok(node.maxTries >= 2 && node.maxTries <= 5);
  assert.ok(node.waitBetweenTries <= 5000);
  assert.equal(node.onError, 'continueErrorOutput');
});

test('Extract Raw Jobs By Provider Type routes remoteok/jobicy/arbeitnow to their own normalization branch, with a defensive fallback', () => {
  const switchNode = findNode('Extract Raw Jobs By Provider Type');
  assert.deepEqual(switchCaseValues(switchNode), ['remoteok', 'jobicy', 'arbeitnow']);
  const conns = wf.connections['Extract Raw Jobs By Provider Type']?.main ?? [];
  assert.equal(conns.length, 4, 'three defined cases plus one fallback output');
  assert.ok(conns[0]?.some((c) => c.node === 'Aggregate RemoteOK Jobs'));
  assert.ok(conns[1]?.some((c) => c.node === 'Split Out Jobicy Jobs'));
  assert.ok(conns[2]?.some((c) => c.node === 'Split Out Arbeitnow Jobs'));
  assert.ok(conns[3]?.some((c) => c.node === 'Build Multi-Company Failure Result'), 'fallback must never be left hanging, even though providerConfig.ts never actually emits an unknown provider_type');
});

test('all three multi-company provider branches normalize to a common {jobs:[...]} shape before converging on Call Multi-Company Batch Endpoint', () => {
  assert.ok(wf.connections['Aggregate RemoteOK Jobs']?.main?.[0]?.some((c) => c.node === 'Call Multi-Company Batch Endpoint'));
  assert.ok(wf.connections['Aggregate Jobicy Jobs']?.main?.[0]?.some((c) => c.node === 'Call Multi-Company Batch Endpoint'));
  assert.ok(wf.connections['Aggregate Arbeitnow Jobs']?.main?.[0]?.some((c) => c.node === 'Call Multi-Company Batch Endpoint'));
});

test('Arbeitnow branch splits its data array, filters to remote:true only, then aggregates back into one item', () => {
  const splitNode = findNode('Split Out Arbeitnow Jobs');
  assert.equal(splitNode.parameters.fieldToSplitOut, 'data');
  assert.ok(wf.connections['Split Out Arbeitnow Jobs']?.main?.[0]?.some((c) => c.node === 'Filter Arbeitnow Remote Only'));
  const filterNode = findNode('Filter Arbeitnow Remote Only');
  assert.equal(filterNode.type, 'n8n-nodes-base.filter');
  assert.ok(wf.connections['Filter Arbeitnow Remote Only']?.main?.[0]?.some((c) => c.node === 'Aggregate Arbeitnow Jobs'));
});

test('Call Multi-Company Batch Endpoint posts to the run-multi-company-batch route with Bearer auth, retries, and continues on error', () => {
  const node = findNode('Call Multi-Company Batch Endpoint');
  assert.equal(node.parameters.method, 'POST');
  assert.match(node.parameters.url, /\/api\/internal\/ingestion\/run-multi-company-batch$/);
  assert.equal(node.parameters.authentication, 'genericCredentialType');
  assert.equal(node.parameters.genericAuthType, 'httpBearerAuth');
  assert.equal(node.retryOnFail, true);
  assert.equal(node.onError, 'continueErrorOutput');
});

test('every fallible Tier-D node error output is wired to Build Multi-Company Failure Result, never left hanging', () => {
  for (const name of ['Fetch Multi-Company Feed', 'Call Multi-Company Batch Endpoint']) {
    const errorOutput = wf.connections[name]?.main?.[1] ?? [];
    assert.ok(errorOutput.some((c) => c.node === 'Build Multi-Company Failure Result'), `${name}'s error output must be wired`);
  }
});

test('both Tier-D result paths converge on Record Multi-Company Source Result, which rate-limits before looping back', () => {
  for (const name of ['Build Multi-Company Success Result', 'Build Multi-Company Failure Result']) {
    assert.ok(wf.connections[name]?.main?.[0]?.some((c) => c.node === 'Record Multi-Company Source Result'), `${name} must feed Record Multi-Company Source Result`);
  }
  assert.ok(wf.connections['Record Multi-Company Source Result']?.main?.[0]?.some((c) => c.node === 'Multi-Company Rate Limit Delay'));
  assert.ok(wf.connections['Multi-Company Rate Limit Delay']?.main?.[0]?.some((c) => c.node === 'Loop Multi-Company Sources (Rate Limited)'));
});

test('the Tier-D loop batches one provider at a time', () => {
  assertBatchesOneAtATime(findNode('Loop Multi-Company Sources (Rate Limited)'));
});

// ── Tier B: career-page extraction (Phase 13) ──────────────────────────

test('Fetch Career Page HTML fetches as plain text (not JSON) with retry and error handling', () => {
  const node = findNode('Fetch Career Page HTML');
  assert.equal(node.parameters.options?.response?.response?.responseFormat, 'text');
  assert.equal(node.parameters.options?.response?.response?.outputPropertyName, 'html');
  assert.equal(node.retryOnFail, true);
  assert.equal(node.onError, 'continueErrorOutput');
});

test('Call Extract Career Page Jobs Endpoint posts to the extraction route, then Call Career Page Ingestion Batch Endpoint reuses the shared run-batch route with sourceType career_page', () => {
  const extractNode = findNode('Call Extract Career Page Jobs Endpoint');
  assert.match(extractNode.parameters.url, /\/api\/internal\/ingestion\/extract-career-page-jobs$/);
  assert.equal(extractNode.parameters.authentication, 'genericCredentialType');

  const batchNode = findNode('Call Career Page Ingestion Batch Endpoint');
  assert.match(batchNode.parameters.url, /\/api\/internal\/ingestion\/run-batch$/);
  assert.match(batchNode.parameters.jsonBody, /sourceType:\s*'career_page'/);
});

test('the career-page chain is fully wired: fetch -> extract -> ingest, each error output landing on Build Career Page Failure Result', () => {
  assert.ok(wf.connections['Fetch Career Page HTML']?.main?.[0]?.some((c) => c.node === 'Call Extract Career Page Jobs Endpoint'));
  assert.ok(wf.connections['Call Extract Career Page Jobs Endpoint']?.main?.[0]?.some((c) => c.node === 'Call Career Page Ingestion Batch Endpoint'));
  for (const name of ['Fetch Career Page HTML', 'Call Extract Career Page Jobs Endpoint', 'Call Career Page Ingestion Batch Endpoint']) {
    const errorOutput = wf.connections[name]?.main?.[1] ?? [];
    assert.ok(errorOutput.some((c) => c.node === 'Build Career Page Failure Result'), `${name}'s error output must be wired`);
  }
});

test('Build Career Page Success Result treats no_valid_jobs as success, not a failure — an honest zero is not an error', () => {
  const node = findNode('Build Career Page Success Result');
  const succeededField = node.parameters.assignments.assignments.find((a) => a.name === 'succeeded');
  assert.match(succeededField.value, /no_valid_jobs/);
});

test('both Tier-B result paths converge on Record Career Page Source Result, which rate-limits before looping back', () => {
  for (const name of ['Build Career Page Success Result', 'Build Career Page Failure Result']) {
    assert.ok(wf.connections[name]?.main?.[0]?.some((c) => c.node === 'Record Career Page Source Result'), `${name} must feed Record Career Page Source Result`);
  }
  assert.ok(wf.connections['Record Career Page Source Result']?.main?.[0]?.some((c) => c.node === 'Career Page Rate Limit Delay'));
  assert.ok(wf.connections['Career Page Rate Limit Delay']?.main?.[0]?.some((c) => c.node === 'Loop Career Page Candidates (Rate Limited)'));
});

test('the Tier-B loop batches one candidate at a time', () => {
  assertBatchesOneAtATime(findNode('Loop Career Page Candidates (Rate Limited)'));
});

test('exactly 77 nodes total, matching the live, MCP-synced workflow (76 from the production-readiness audit + 1 new Schedule Trigger for the daily production cadence)', () => {
  assert.equal(wf.nodes.length, 77);
});

test('Apify multi-company branch (Phase 21) is fully isolated — its own seed, split, loop, actor call, aggregate, batch endpoint, success/failure builders, and rate limiter', () => {
  for (const name of [
    'Apify Multi-Company Source Seeds',
    'Split Out Apify Sources',
    'Loop Apify Sources (Rate Limited)',
    'Call Apify Actor',
    'Aggregate Apify Jobs',
    'Call Apify Batch Endpoint',
    'Build Apify Success Result',
    'Build Apify Failure Result',
    'Record Apify Source Result',
    'Apify Rate Limit Delay',
  ]) {
    findNode(name);
  }

  assert.ok(wf.connections['Workflow Configuration'].main[0].some((c) => c.node === 'Apify Multi-Company Source Seeds'), 'Workflow Configuration must fan out to the Apify seed node');
  assert.ok(wf.connections['Loop Apify Sources (Rate Limited)'].main[1].some((c) => c.node === 'Call Apify Actor'), 'the loop branch (index 1) must feed Call Apify Actor');
  assert.ok(wf.connections['Call Apify Actor'].main[0].some((c) => c.node === 'Aggregate Apify Jobs'), 'success output must feed Aggregate Apify Jobs');
  assert.ok(wf.connections['Call Apify Actor'].main[1].some((c) => c.node === 'Build Apify Failure Result'), 'error output must feed Build Apify Failure Result');
  assert.ok(wf.connections['Apify Rate Limit Delay'].main[0].some((c) => c.node === 'Loop Apify Sources (Rate Limited)'), 'the delay must loop back to Loop Apify Sources');

  const callApifyBatchEndpoint = findNode('Call Apify Batch Endpoint');
  assert.match(callApifyBatchEndpoint.parameters.jsonBody, /Split Out Apify Sources/, "Call Apify Batch Endpoint's sourceType expression must resolve its own branch's Split Out node, not the Tier D branch's");
});

// Phase 2 hardening fix: Call Apify Actor is the shared paid, non-idempotent
// run-sync-get-dataset-items call for Bayt/GulfTalent/Indeed (all three real,
// confirmed PAY_PER_EVENT actors). A transport-level retry on this 60s-
// timeout node could start a second full-price actor run while the first is
// still executing/billing — the exact same reasoning already correctly
// applied to Call Data-Slayer Actor below.
test('Call Apify Actor exists exactly once and never auto-retries (paid, non-idempotent actor call shared by Bayt/GulfTalent/Indeed)', () => {
  const occurrences = wf.nodes.filter((n) => n.name === 'Call Apify Actor').length;
  assert.equal(occurrences, 1, 'the actor node must appear exactly once — no duplicate/hidden call path');

  const node = findNode('Call Apify Actor');
  assert.equal(node.retryOnFail, false, 'a paid, non-idempotent actor call must never auto-retry (AGENTS.md §18)');

  // All four real seeds (Bayt, GulfTalent SA, GulfTalent AE/Dubai, Indeed)
  // route through this one shared node via the loop's error-output index 1.
  assert.ok(wf.connections['Loop Apify Sources (Rate Limited)'].main[1].some((c) => c.node === 'Call Apify Actor'), 'Bayt/GulfTalent/Indeed must still route through the same shared actor node');

  // Downstream failure routing remains intact regardless of the retry fix —
  // onError still reaches an explicit terminal, the branch never silently
  // disappears.
  assert.ok(wf.connections['Call Apify Actor'].main[0].some((c) => c.node === 'Aggregate Apify Jobs'), 'success output must still feed Aggregate Apify Jobs');
  assert.ok(wf.connections['Call Apify Actor'].main[1].some((c) => c.node === 'Build Apify Failure Result'), 'error output must still feed Build Apify Failure Result, never left hanging');
});

// Phase 2 cost-safety hardening: Bayt/GulfTalent/Indeed are all real,
// confirmed PAY_PER_EVENT actors (free pricing-metadata GET, re-verified
// live twice this phase) — same mechanism Call Data-Slayer Actor already
// uses. Per-item prices below are the real, live-verified values
// (apify-default-dataset-item), not assumed. Each seed's maxTotalChargeUsd
// is actor-start (one-time) + max_jobs_per_run * per-item — the actor-start
// term is not an arbitrary buffer; omitting it would make the cap trigger
// before a run that returns exactly max_jobs_per_run items finishes.
const APIFY_ACTOR_START_USD = { bayt: 0.0005, gulftalent: 0.005, indeed: 0.0001 };
const APIFY_PER_ITEM_USD = { bayt: 0.00099, gulftalent: 0.0007, indeed: 0.0001 };

function getApifySeeds() {
  const seedsNode = findNode('Apify Multi-Company Source Seeds');
  const parsed = JSON.parse(seedsNode.parameters.jsonOutput);
  return parsed.apify_sources;
}

test('Call Apify Actor derives maxTotalChargeUsd dynamically from each seed, never a hardcoded shared value', () => {
  const node = findNode('Call Apify Actor');
  assert.match(node.parameters.url, /\$json\.actor_url/, 'must still build the URL from the seed\'s own actor_url');
  assert.match(node.parameters.url, /maxTotalChargeUsd=.*\$json\.max_total_charge_usd/, 'maxTotalChargeUsd must be appended dynamically per-seed, mirroring Call Data-Slayer Actor\'s own pattern');
  // request_body (maxResults/count) must be preserved untouched, separate from the new cap.
  assert.match(node.parameters.jsonBody, /\$json\.request_body/);
  assert.equal(node.retryOnFail, false);
  assert.equal(node.parameters.options.timeout, 60000, 'timeout must be preserved');
});

for (const [providerType, refreshScope, label] of [
  ['bayt', null, 'Bayt'],
  ['gulftalent', 'country:SA', 'GulfTalent SA'],
  ['gulftalent', 'country:AE:location:Dubai', 'GulfTalent UAE/Dubai'],
  ['indeed', null, 'Indeed'],
]) {
  test(`${label} seed's maxTotalChargeUsd is bounded and derived from its own configured result cap x the verified per-item price`, () => {
    const seeds = getApifySeeds();
    const seed = seeds.find((s) => s.provider_type === providerType && s.refresh_scope === refreshScope);
    assert.ok(seed, `${label} seed must exist`);

    const maxResults = seed.request_body.maxResults ?? seed.request_body.count;
    assert.ok(typeof maxResults === 'number' && maxResults > 0, `${label}'s own maxResults/count must be a positive number`);
    assert.equal(seed.max_jobs_per_run, maxResults, `${label}'s max_jobs_per_run must match its own actor-input result cap`);

    const expected = Math.round((APIFY_ACTOR_START_USD[providerType] + maxResults * APIFY_PER_ITEM_USD[providerType]) * 1e6) / 1e6;
    assert.equal(seed.max_total_charge_usd, expected, `${label}'s maxTotalChargeUsd must equal actor-start + maxResults x per-item price, not an arbitrary value`);
    assert.ok(seed.max_total_charge_usd > 0 && seed.max_total_charge_usd < 1, `${label}'s cap must be a small, real bounded amount, never unbounded`);
  });
}

test('Call Data-Slayer Actor retry safety is unaffected by the Apify actor retry fix (regression against accidental reversion)', () => {
  const node = findNode('Call Data-Slayer Actor');
  assert.equal(node.retryOnFail, false);
});

test('unrelated safe-read/internal-API retry policies are unchanged by the Apify actor retry fix', () => {
  // Call Apify Batch Endpoint is the safe, idempotent internal API call
  // (not a paid external side effect) — its retry must remain untouched.
  const batchEndpoint = findNode('Call Apify Batch Endpoint');
  assert.equal(batchEndpoint.retryOnFail, true);
  assert.equal(batchEndpoint.maxTries, 2);

  // Spot-check a handful of other provider-facing/internal nodes elsewhere
  // in the graph to confirm this was a scoped, single-node fix.
  assert.equal(findNode('Fetch Source Jobs').retryOnFail, true);
  assert.equal(findNode('Fetch Multi-Company Feed').retryOnFail, true);
  assert.equal(findNode('List LinkedIn Enrichment Queue').retryOnFail, true);
});

test('Lever case routes through Aggregate Lever Jobs before Extract Lever Jobs (Phase 14 fix — Lever\'s bare top-level array response gets auto-split into one item per job by n8n, so the raw array must be re-collected before extraction)', () => {
  const switchConns = wf.connections['Extract Jobs By ATS Type']?.main ?? [];
  assert.ok(switchConns[1]?.some((c) => c.node === 'Aggregate Lever Jobs'), 'the lever case (index 1) must route to Aggregate Lever Jobs, not directly to Extract Lever Jobs');
  assert.ok(wf.connections['Aggregate Lever Jobs']?.main?.[0]?.some((c) => c.node === 'Extract Lever Jobs'), 'Aggregate Lever Jobs must feed Extract Lever Jobs');

  const aggregateNode = findNode('Aggregate Lever Jobs');
  assert.equal(aggregateNode.type, 'n8n-nodes-base.aggregate');
  assert.equal(aggregateNode.parameters.aggregate, 'aggregateAllItemData');
  assert.equal(aggregateNode.parameters.destinationFieldName, 'jobs');

  const extractLever = findNode('Extract Lever Jobs');
  assert.equal(
    extractLever.parameters.assignments.assignments[0].value,
    '={{ $json.jobs }}',
    'must read the aggregated jobs array, not assume $json is still the whole raw response'
  );
});

// ── LinkedIn enrichment (data-slayer exact-ID pass) ────────────────────
// Added during the 2026-10-16 production-readiness audit — this branch was
// synced to the live workflow in a prior session but had no regression
// coverage of its own; the six failures this audit found when reading the
// real live-fetched JSON (see switchCaseValues/assertBatchesOneAtATime
// above) proved this suite can silently drift from the live workflow it
// claims to test. This section closes that gap for the newest branch.

test('LinkedIn branch is its own fifth independent branch off Workflow Configuration — a failure here cannot block Tier A/D/B/Apify ingestion', () => {
  const fanOut = wf.connections['Workflow Configuration']?.main?.[0] ?? [];
  assert.ok(fanOut.some((c) => c.node === 'List Ingestion Sources'));
  assert.ok(fanOut.some((c) => c.node === 'Apify Multi-Company Source Seeds'));
  assert.ok(fanOut.some((c) => c.node === 'List LinkedIn Enrichment Queue'), 'LinkedIn branch must start fresh off Workflow Configuration, not depend on any other branch succeeding first');
});

test('List LinkedIn Enrichment Queue has Bearer auth, bounded retry, and a wired error output (never a hanging failure)', () => {
  const node = findNode('List LinkedIn Enrichment Queue');
  assert.equal(node.parameters.method, 'POST');
  assert.match(node.parameters.url, /\/api\/internal\/ingestion\/list-linkedin-enrichment-queue$/);
  assert.equal(node.parameters.authentication, 'genericCredentialType');
  assert.equal(node.parameters.genericAuthType, 'httpBearerAuth');
  assert.equal(node.retryOnFail, true);
  assert.equal(node.onError, 'continueErrorOutput');
  assert.ok(wf.connections['List LinkedIn Enrichment Queue']?.main?.[1]?.some((c) => c.node === 'Log List Queue Failure'), 'error output must be wired, never left hanging');
});

test('zero eligible jobs is a safe terminal, never the pricing/actor path', () => {
  assert.ok(wf.connections['Check Eligible Jobs Exist']?.main?.[0]?.some((c) => c.node === 'Fetch Data-Slayer Pricing Metadata'), 'has_jobs case must lead to the pricing check');
  assert.ok(wf.connections['Check Eligible Jobs Exist']?.main?.[1]?.some((c) => c.node === 'Build No Eligible Jobs Result'), 'no_jobs fallback must terminate safely, never reach pricing or the actor');
});

test('pricing metadata failure and price-too-high both abort before the actor is ever called', () => {
  assert.ok(wf.connections['Fetch Data-Slayer Pricing Metadata']?.main?.[1]?.some((c) => c.node === 'Build Pricing Metadata Failure Result'), 'pricing metadata error output must be wired');
  assert.ok(wf.connections['Check Data-Slayer Price']?.main?.[1]?.some((c) => c.node === 'Build Pricing Aborted Result'), 'price-too-high fallback must be wired');
  const actorCallers = Object.entries(wf.connections)
    .filter(([, c]) => (c.main ?? []).some((output) => (output ?? []).some((t) => t.node === 'Call Data-Slayer Actor')))
    .map(([name]) => name);
  assert.deepEqual(actorCallers, ['Check Data-Slayer Price'], 'the actor must only ever be reachable through the price_ok case — no other path may call it');
});

test('Call Data-Slayer Actor is exact-ID only, bounded, and never auto-retried (non-idempotent paid call)', () => {
  const node = findNode('Call Data-Slayer Actor');
  assert.equal(node.retryOnFail, false, 'a paid, non-idempotent actor call must never auto-retry (AGENTS.md §18/§35)');
  assert.match(node.parameters.url, /maxItems=/);
  assert.match(node.parameters.url, /maxTotalChargeUsd=/);
  assert.match(node.parameters.jsonBody, /job_ids_or_urls/);
  assert.match(node.parameters.jsonBody, /include_hiring_team:\s*false/);
  assert.ok(!/keyword|location/i.test(node.parameters.jsonBody), 'must never send a keyword/location filter — this actor is exact-ID enrichment only, never discovery');
  assert.equal((wf.connections['Call Data-Slayer Actor']?.main ?? []).length, 2, 'exactly one success + one error output');
  assert.ok(wf.connections['Call Data-Slayer Actor']?.main?.[1]?.some((c) => c.node === 'Build Actor Failure Result'), 'actor error output must be wired, never left hanging');
});

test('actor success flows through dataset aggregation to server-side reconciliation, never applied twice', () => {
  const actorOccurrences = wf.nodes.filter((n) => n.name === 'Call Data-Slayer Actor').length;
  assert.equal(actorOccurrences, 1, 'the actor node must appear exactly once — no duplicate/hidden call path');
  assert.ok(wf.connections['Call Data-Slayer Actor']?.main?.[0]?.some((c) => c.node === 'Aggregate Data-Slayer Dataset'));
  assert.ok(wf.connections['Aggregate Data-Slayer Dataset']?.main?.[0]?.some((c) => c.node === 'Call LinkedIn Enrichment Batch Endpoint'));

  const applyNode = findNode('Call LinkedIn Enrichment Batch Endpoint');
  assert.equal(applyNode.retryOnFail, false, 'retrying an already-applied dataset would double-count attempts — must never auto-retry');
  assert.match(applyNode.parameters.url, /\/api\/internal\/ingestion\/run-linkedin-enrichment-batch$/);
  assert.match(applyNode.parameters.jsonBody, /requestedJobIds/);
  assert.match(applyNode.parameters.jsonBody, /rawDatasetItems/);
  assert.ok(wf.connections['Call LinkedIn Enrichment Batch Endpoint']?.main?.[1]?.some((c) => c.node === 'Build Apply Call Failure Result'), 'apply-call error output must be wired');
});

test('every LinkedIn branch terminal path converges on Record LinkedIn Enrichment Result — no path is left unobserved', () => {
  const terminals = [
    'Log List Queue Failure',
    'Build No Eligible Jobs Result',
    'Build Pricing Metadata Failure Result',
    'Build Pricing Aborted Result',
    'Build Actor Failure Result',
    'Build Apply Call Failure Result',
    'Build Enrichment Success Result',
  ];
  for (const name of terminals) {
    assert.ok(wf.connections[name]?.main?.[0]?.some((c) => c.node === 'Record LinkedIn Enrichment Result'), `${name} must feed Record LinkedIn Enrichment Result`);
  }
});

test('the LinkedIn branch has no loop/rate-limit-delay node — one run is already one bounded <=25-id batch, by design', () => {
  assert.ok(!wf.nodes.some((n) => n.name === 'LinkedIn Rate Limit Delay'), 'no rate-limit loop should exist for this branch');
  const splitBatchesNearLinkedIn = wf.nodes.filter(
    (n) => n.type === 'n8n-nodes-base.splitInBatches' && n.name.toLowerCase().includes('linkedin')
  );
  assert.equal(splitBatchesNearLinkedIn.length, 0, 'List LinkedIn Enrichment Queue already bounds one run to one batch — no fan-out loop is needed or present');
});

// ── Daily production Schedule Trigger ──────────────────────────────────
// Added once the production-readiness audit (and the explicit, approved
// bounded LinkedIn pilot decision) closed out — see this workflow's own
// overview sticky note: "stays inactive until a human reviews a run and
// decides on a schedule." Kept alongside the Manual Trigger, never
// replacing it, mirroring the exact same pattern already proven in
// source-intelligence-analyzer.ts/.test.mjs.

test('Daily 09:00 Beirut Trigger exists as a real Schedule Trigger node, alongside (never instead of) Start Job Ingestion Run', () => {
  const schedule = findNode('Daily 09:00 Beirut Trigger');
  assert.equal(schedule.type, 'n8n-nodes-base.scheduleTrigger');
  findNode('Start Job Ingestion Run');
});

test('the schedule rule is daily at 09:00 (hour/minute), not a cron expression and not some other interval unit', () => {
  const schedule = findNode('Daily 09:00 Beirut Trigger');
  const rule = schedule.parameters.rule.interval[0];
  assert.equal(rule.field, 'days', 'must be a days-interval rule, not seconds/minutes/hours/weeks/months/cronExpression');
  assert.equal(rule.daysInterval, 1, 'must fire every day, not every N days');
  assert.equal(rule.triggerAtHour, 9);
  assert.equal(rule.triggerAtMinute, 0);
});

test('both the Manual Trigger and the Schedule Trigger converge on the same Workflow Configuration node — two independent entry points, one pipeline', () => {
  assert.ok(wf.connections['Start Job Ingestion Run']?.main?.[0]?.some((c) => c.node === 'Workflow Configuration'), 'Manual Trigger must still feed Workflow Configuration');
  assert.ok(wf.connections['Daily 09:00 Beirut Trigger']?.main?.[0]?.some((c) => c.node === 'Workflow Configuration'), 'Schedule Trigger must feed Workflow Configuration');
});

test('adding the Schedule Trigger did not change Workflow Configuration\'s own downstream fan-out — still exactly the 3 existing branches', () => {
  const fanOut = wf.connections['Workflow Configuration']?.main?.[0] ?? [];
  assert.equal(fanOut.length, 3, 'Workflow Configuration must still fan out to exactly 3 branches (List Ingestion Sources, Apify Multi-Company Source Seeds, List LinkedIn Enrichment Queue) — adding a second trigger upstream must never add a new downstream branch');
  assert.ok(fanOut.some((c) => c.node === 'List Ingestion Sources'));
  assert.ok(fanOut.some((c) => c.node === 'Apify Multi-Company Source Seeds'));
  assert.ok(fanOut.some((c) => c.node === 'List LinkedIn Enrichment Queue'));
});

test('workflow-level timezone: if set, must be the real IANA identifier Asia/Beirut (never a fixed UTC offset, so Lebanon\'s DST transitions resolve automatically); if unset, this is the documented, still-pending manual n8n UI step (same confirmed SDK/MCP limitation as Error Workflow attachment — see the trigger node\'s own notes)', () => {
  if (wf.settings.timezone !== undefined) {
    assert.equal(wf.settings.timezone, 'Asia/Beirut');
  }
});

test('the workflow remains inactive after adding the production schedule — going live is still a separate, explicit decision', () => {
  assert.equal(wf.active, false);
});
