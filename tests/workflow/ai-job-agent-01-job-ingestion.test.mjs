/**
 * Static-analysis tests for the "AI Job Agent / 01 Job Ingestion" workflow
 * (Phase 04). No database or n8n connection required — reads the exported
 * workflow JSON directly, mirroring tests/workflow/job-ingestion-pilot-orchestrator.test.mjs.
 * All validation/mapping/dedup/persistence logic itself is covered by
 * tests/unit/raw-provider-job.test.mjs, tests/unit/ingestion-providers.test.mjs,
 * tests/unit/derive-ats-feed-url.test.mjs, tests/db/find-eligible-company-sources.test.mjs,
 * and tests/db/ingestion-core-batch.test.mjs — this file only checks that the
 * workflow graph wires those into n8n correctly (retry, rate limiting, error
 * handling, and dynamic source discovery, Phase 12).
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
  for (const name of ['Extract Greenhouse Jobs', 'Extract Lever Jobs', 'Extract Workable Jobs']) {
    const node = findNode(name);
    assert.equal(node.onError, 'continueErrorOutput', `${name} must continue to its error output, not stop the workflow`);
  }
});

test('every fallible node error output is wired to a Build *Result node, never left hanging', () => {
  const fallible = ['Fetch Source Jobs', 'Call Ingestion Batch Endpoint', 'Extract Greenhouse Jobs', 'Extract Lever Jobs', 'Extract Workable Jobs'];
  for (const name of fallible) {
    const conns = wf.connections[name]?.main ?? [];
    const errorOutput = conns[1] ?? [];
    assert.ok(errorOutput.length > 0, `${name}'s error output (index 1) must be wired to a failure-result node`);
  }
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
