/**
 * Static-analysis tests for the "AI Job Guide / 03 Cover Letter Generation"
 * workflow (Phase 08). No database or n8n connection required — reads the
 * exported workflow JSON directly. All discovery/persistence logic itself is
 * covered by tests/db/cover-letter-generation.test.mjs; this file only
 * checks that the workflow graph wires the n8n-owned OpenAI call correctly
 * (retry, error handling, credential shape, per-candidate looping with
 * immediate save — same shape as Phase 06's rerank stage).
 *
 * Run: node --test tests/workflow/ai-job-agent-03-cover-letter-generation.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

const JSON_PATH = resolve(ROOT, 'n8n-workflows/ai-job-agent-03-cover-letter-generation.json');
const wf = JSON.parse(readFileSync(JSON_PATH, 'utf8'));

function findNode(name) {
  const n = wf.nodes.find((x) => x.name === name);
  assert.ok(n, `Node "${name}" must exist`);
  return n;
}

test('workflow JSON parses and has name/nodes/connections', () => {
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
  assert.ok(urls.some((u) => u.includes('/api/internal/cover-letters/prepare-generation')));
  assert.ok(urls.some((u) => u.includes('/api/internal/cover-letters/save-generation')));

  const prepare = findNode('Prepare Generation');
  const save = findNode('Save Generation Result');
  assert.equal(prepare.parameters.authentication, 'genericCredentialType');
  assert.equal(prepare.parameters.genericAuthType, 'httpBearerAuth');
  assert.equal(save.parameters.authentication, 'genericCredentialType');
  assert.equal(save.parameters.genericAuthType, 'httpBearerAuth');
});

test('Call OpenAI Chat uses the predefined credential type, matching cv-analysis-worker.ts and the rerank stage', () => {
  const node = findNode('Call OpenAI Chat');
  assert.equal(node.parameters.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(node.parameters.authentication, 'predefinedCredentialType');
  assert.equal(node.parameters.nodeCredentialType, 'openAiApi');
});

test('the generation loop processes one candidate at a time (chat completions has no batch endpoint)', () => {
  const loop = findNode('Loop Candidates (Rate Limited)');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1);
});

test('every network-calling node has native retry configured', () => {
  for (const name of ['Prepare Generation', 'Call OpenAI Chat', 'Save Generation Result']) {
    const node = findNode(name);
    assert.equal(node.retryOnFail, true, `${name} must have retryOnFail enabled`);
    assert.ok(node.maxTries >= 2 && node.maxTries <= 5, `${name}.maxTries must respect the n8n engine cap of 5`);
    assert.ok(node.waitBetweenTries <= 5000, `${name}.waitBetweenTries must respect the n8n engine cap of 5000ms`);
    assert.equal(node.onError, 'continueErrorOutput', `${name} must continue to its error output, not halt the run`);
  }
});

test('Prepare Generation failure is terminal for the run (nothing to loop over)', () => {
  const errorOutput = wf.connections['Prepare Generation']?.main?.[1] ?? [];
  assert.ok(errorOutput.some((c) => c.node === 'Log Prepare Failure'));
});

test('a failed candidate still reaches the rate-limit delay and loops to the next one, instead of stalling the run', () => {
  for (const name of ['Call OpenAI Chat', 'Save Generation Result']) {
    const errorOutput = wf.connections[name]?.main?.[1] ?? [];
    assert.ok(errorOutput.some((c) => c.node === 'Log Generation Failure'), `${name}'s error output must be wired to Log Generation Failure`);
  }
  const fromFailure = wf.connections['Log Generation Failure']?.main?.[0] ?? [];
  assert.ok(fromFailure.some((c) => c.node === 'Generation Rate Limit Delay'));
  const fromSuccess = wf.connections['Save Generation Result']?.main?.[0] ?? [];
  assert.ok(fromSuccess.some((c) => c.node === 'Generation Rate Limit Delay'));
  const loopBack = wf.connections['Generation Rate Limit Delay']?.main?.[0] ?? [];
  assert.ok(loopBack.some((c) => c.node === 'Loop Candidates (Rate Limited)'));
});

test('each draft is saved immediately per candidate, never aggregated across the loop', () => {
  const node = findNode('Build Save Request');
  // A single-element results array built from *this* candidate's own data —
  // not $('Loop...').all() or any other cross-iteration aggregation, which
  // Phase 05 already found unreliable across splitInBatches iterations.
  assert.match(node.parameters.jsonOutput, /results:\s*\[\s*\{\s*matchId:/);
  assert.doesNotMatch(node.parameters.jsonOutput, /\.all\(\)/);
});

test('a failed generation attempt is never explicitly recorded — no "failed" flag is ever sent to save-generation', () => {
  const node = findNode('Build Save Request');
  assert.doesNotMatch(node.parameters.jsonOutput, /failed/);
});
