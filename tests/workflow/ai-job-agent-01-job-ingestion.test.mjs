/**
 * Static-analysis tests for the "AI Job Agent / 01 Job Ingestion" workflow
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

test('workflow JSON parses and has name/nodes/connections/settings', () => {
  assert.equal(typeof wf.name, 'string');
  assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 0);
  assert.equal(typeof wf.connections, 'object');
  assert.equal(typeof wf.settings, 'object');
});

test('workflow is inactive in JSON', () => {
  assert.equal(wf.active, false, 'Workflow must remain inactive until a human reviews a real run');
});

test('exactly one Manual Trigger, no Schedule Trigger', () => {
  const triggers = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.manualTrigger');
  assert.equal(triggers.length, 1);
  assert.ok(!wf.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger'), 'must not include a Schedule Trigger this phase');
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
  const outputKeys = switchNode.parameters.rules.values.map((v) => v.outputKey);
  assert.deepEqual(outputKeys, ['greenhouse', 'lever', 'workable', 'ashby', 'oracle_hcm']);
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
  const loop = findNode('Loop Sources (Rate Limited)');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1);
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
  const outputKeys = switchNode.parameters.rules.values.map((v) => v.outputKey);
  assert.deepEqual(outputKeys, ['remoteok', 'jobicy', 'arbeitnow']);
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
  const loop = findNode('Loop Multi-Company Sources (Rate Limited)');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1);
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
  const loop = findNode('Loop Career Page Candidates (Rate Limited)');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1);
});

test('exactly 59 nodes total, matching the live, MCP-tested workflow (Phase 21 adds the isolated Apify multi-company branch: Bayt/GulfTalent/Indeed)', () => {
  assert.equal(wf.nodes.length, 59);
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
