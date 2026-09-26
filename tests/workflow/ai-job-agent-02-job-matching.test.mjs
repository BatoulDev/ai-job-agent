/**
 * Static-analysis tests for the "AI Job Agent / 02 Job Matching" workflow's
 * embedding step (Phase 05). No database or n8n connection required — reads
 * the exported workflow JSON directly. All discovery/persistence logic
 * itself is covered by tests/db/matching-embeddings.test.mjs; this file
 * only checks that the workflow graph wires the n8n-owned provider call
 * correctly (retry, error handling, credential shape, index-safe vector
 * remapping, the empty-input guard).
 *
 * Run: node --test tests/workflow/ai-job-agent-02-job-matching.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

const JSON_PATH = resolve(ROOT, 'n8n-workflows/ai-job-agent-02-job-matching.json');
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
});

test('workflow is inactive in JSON', () => {
  assert.equal(wf.active, false, 'Workflow must remain inactive');
});

test('exactly one Manual Trigger, no Schedule Trigger', () => {
  const triggers = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.manualTrigger');
  assert.equal(triggers.length, 1);
  assert.ok(!wf.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger'));
});

test('the two internal endpoints are called with Bearer auth, never Supabase directly', () => {
  const urls = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest').map((n) => n.parameters?.url ?? '');
  assert.ok(!urls.some((u) => u.includes('supabase')), 'this workflow must never call Supabase REST directly — persistence is delegated to the internal endpoints');
  assert.ok(urls.some((u) => u.includes('/api/internal/matching/prepare-embeddings')));
  assert.ok(urls.some((u) => u.includes('/api/internal/matching/save-embeddings')));

  const prepare = findNode('Prepare Embeddings');
  const save = findNode('Save Embeddings');
  assert.equal(prepare.parameters.authentication, 'genericCredentialType');
  assert.equal(prepare.parameters.genericAuthType, 'httpBearerAuth');
  assert.equal(save.parameters.authentication, 'genericCredentialType');
  assert.equal(save.parameters.genericAuthType, 'httpBearerAuth');
});

test('Generate Embeddings calls OpenAI using the predefined credential type, not a raw header', () => {
  const node = findNode('Generate Embeddings');
  assert.equal(node.parameters.url, 'https://api.openai.com/v1/embeddings');
  assert.equal(node.parameters.authentication, 'predefinedCredentialType');
  assert.equal(node.parameters.nodeCredentialType, 'openAiApi');
  assert.ok(node.credentials?.openAiApi, 'must reference the openAiApi credential, matching cv-analysis-worker.ts\'s established pattern');
});

test('every network-calling node has native retry configured', () => {
  for (const name of ['Prepare Embeddings', 'Generate Embeddings', 'Save Embeddings']) {
    const node = findNode(name);
    assert.equal(node.retryOnFail, true, `${name} must have retryOnFail enabled`);
    assert.ok(node.maxTries >= 2 && node.maxTries <= 5, `${name}.maxTries must respect the n8n engine cap of 5`);
    assert.ok(node.waitBetweenTries <= 5000, `${name}.waitBetweenTries must respect the n8n engine cap of 5000ms`);
    assert.equal(node.onError, 'continueErrorOutput', `${name} must continue to its error output, not halt the run`);
  }
});

test('every fallible node error output is wired to Log Embeddings Failure', () => {
  for (const name of ['Prepare Embeddings', 'Generate Embeddings', 'Save Embeddings']) {
    const errorOutput = wf.connections[name]?.main?.[1] ?? [];
    assert.ok(errorOutput.some((c) => c.node === 'Log Embeddings Failure'), `${name}'s error output must be wired to Log Embeddings Failure`);
  }
});

test('the empty-input guard routes to a no-op instead of calling OpenAI with an empty batch', () => {
  const branches = wf.connections['Has Anything To Embed?']?.main ?? [];
  assert.equal(branches[0]?.[0]?.node, 'Generate Embeddings', 'true branch must call OpenAI');
  assert.equal(branches[1]?.[0]?.node, 'Nothing To Embed', 'false branch must short-circuit, never call OpenAI with input: []');
});

test('Build Save Embeddings Request maps vectors back by response index, not array order', () => {
  const node = findNode('Build Save Embeddings Request');
  assert.match(node.parameters.jsonOutput, /vectors\[d\.index\] = d\.embedding/, 'must index by the API response\'s own index field, since OpenAI batch responses are not guaranteed to preserve input order');
});
