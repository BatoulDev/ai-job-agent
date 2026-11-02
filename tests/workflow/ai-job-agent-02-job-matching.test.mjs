/**
 * Static-analysis tests for the "AI Job Guide / 02 Job Matching" workflow —
 * both the embedding step (Phase 05) and the rerank step (Phase 06). No
 * database or n8n connection required — reads the exported workflow JSON
 * directly. All discovery/persistence logic itself is covered by
 * tests/db/matching-embeddings.test.mjs and tests/db/matching-rerank.test.mjs;
 * this file only checks that the workflow graph wires the n8n-owned
 * provider calls correctly (retry, error handling, credential shape,
 * index-safe vector remapping, the empty-input guard, per-item rerank
 * looping with immediate save).
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

// ── Rerank stage (Phase 06) ──────────────────────────────────────────────

test('the rerank stage is reachable from every embedding-stage outcome', () => {
  assert.equal(wf.connections['Save Embeddings']?.main?.[0]?.[0]?.node, 'Prepare Rerank', 'a successful embedding save must continue to rerank');
  assert.equal(wf.connections['Nothing To Embed']?.main?.[0]?.[0]?.node, 'Prepare Rerank', 'having nothing to embed must still continue to rerank');
  assert.equal(wf.connections['Log Embeddings Failure']?.main?.[0]?.[0]?.node, 'Prepare Rerank', 'an embedding-stage failure must still continue to rerank — it reranks whatever is already embedded');
});

test('Prepare Rerank and Save Rerank Result use Bearer auth against the internal endpoints, never Supabase directly', () => {
  const prepare = findNode('Prepare Rerank');
  const save = findNode('Save Rerank Result');
  assert.match(prepare.parameters.url, /\/api\/internal\/matching\/prepare-rerank$/);
  assert.match(save.parameters.url, /\/api\/internal\/matching\/save-rerank-results$/);
  assert.equal(prepare.parameters.authentication, 'genericCredentialType');
  assert.equal(prepare.parameters.genericAuthType, 'httpBearerAuth');
  assert.equal(save.parameters.authentication, 'genericCredentialType');
  assert.equal(save.parameters.genericAuthType, 'httpBearerAuth');
});

test('Call OpenAI Chat uses the predefined credential type, matching cv-analysis-worker.ts and Generate Embeddings', () => {
  const node = findNode('Call OpenAI Chat');
  assert.equal(node.parameters.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(node.parameters.authentication, 'predefinedCredentialType');
  assert.equal(node.parameters.nodeCredentialType, 'openAiApi');
  assert.ok(node.credentials?.openAiApi);
});

test('rerank requests a strict JSON response from the model', () => {
  const node = findNode('Build Chat Request');
  assert.match(node.parameters.jsonOutput, /response_format:\s*\{\s*type:\s*'json_object'\s*\}/);
});

test('the rerank loop processes one candidate at a time (chat completions has no batch endpoint)', () => {
  const loop = findNode('Loop Candidates (Rate Limited)');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1);
});

test('every rerank network-calling node has native retry configured', () => {
  for (const name of ['Prepare Rerank', 'Call OpenAI Chat', 'Save Rerank Result']) {
    const node = findNode(name);
    assert.equal(node.retryOnFail, true, `${name} must have retryOnFail enabled`);
    assert.ok(node.maxTries >= 2 && node.maxTries <= 5, `${name}.maxTries must respect the n8n engine cap of 5`);
    assert.ok(node.waitBetweenTries <= 5000, `${name}.waitBetweenTries must respect the n8n engine cap of 5000ms`);
    assert.equal(node.onError, 'continueErrorOutput', `${name} must continue to its error output, not halt the whole rerank run over one candidate`);
  }
});

test('every per-candidate fallible rerank node error output is wired to Log Rerank Failure', () => {
  // Prepare Rerank is deliberately NOT in this list — see the next test.
  // It is the whole-batch call that runs BEFORE Split Out Candidates ever
  // primes Loop Candidates (Rate Limited) with real items, so it cannot
  // safely share this per-candidate retry chain (see the next test's
  // comment for the real defect this distinction fixes).
  for (const name of ['Call OpenAI Chat', 'Save Rerank Result']) {
    const errorOutput = wf.connections[name]?.main?.[1] ?? [];
    assert.ok(errorOutput.some((c) => c.node === 'Log Rerank Failure'), `${name}'s error output must be wired to Log Rerank Failure`);
  }
});

test('Prepare Rerank\'s own failure is wired to its own dedicated terminal node, never into the per-candidate retry loop', () => {
  // Fix (2026-11-02, reproduced live as n8n execution 349135): Prepare
  // Rerank previously shared Log Rerank Failure's chain into
  // nextBatch(Loop Candidates (Rate Limited)) — fine for a per-candidate
  // retry (the loop is already primed with real items by then), but when
  // Prepare Rerank itself fails, Split Out Candidates never ran, so the
  // loop was never primed. Feeding the bogus failure payload into
  // nextBatch() on that unprimed loop made n8n treat it as a brand-new
  // one-item batch, which flowed through Build Chat Request (no real
  // `.prompt` field) straight into a real, malformed Call OpenAI Chat
  // request. Log Prepare Rerank Failure is a dedicated dead end instead —
  // same proven pattern as ai-job-agent-03-cover-letter-generation.ts's
  // own "Log Prepare Failure".
  const errorOutput = wf.connections['Prepare Rerank']?.main?.[1] ?? [];
  assert.ok(
    errorOutput.some((c) => c.node === 'Log Prepare Rerank Failure'),
    'Prepare Rerank\'s error output must be wired to Log Prepare Rerank Failure, not the shared per-candidate Log Rerank Failure chain'
  );
  assert.ok(
    !errorOutput.some((c) => c.node === 'Log Rerank Failure'),
    'Prepare Rerank must NOT route into the per-candidate retry chain — it can feed a bogus item into an unprimed Loop Candidates (Rate Limited)'
  );

  const logPrepareRerankFailure = findNode('Log Prepare Rerank Failure');
  assert.equal(logPrepareRerankFailure.type, 'n8n-nodes-base.set');
  assert.ok(
    !wf.connections['Log Prepare Rerank Failure'],
    'Log Prepare Rerank Failure must be a true dead end — it must never feed back into Rerank Rate Limit Delay/Loop Candidates, since there are no real candidates to retry when Prepare Rerank itself failed'
  );
});

test('a failed candidate still reaches the rate-limit delay and loops to the next one, instead of stalling the run', () => {
  const fromFailure = wf.connections['Log Rerank Failure']?.main?.[0] ?? [];
  assert.ok(fromFailure.some((c) => c.node === 'Rerank Rate Limit Delay'));
  const fromSuccess = wf.connections['Save Rerank Result']?.main?.[0] ?? [];
  assert.ok(fromSuccess.some((c) => c.node === 'Rerank Rate Limit Delay'));
  const loopBack = wf.connections['Rerank Rate Limit Delay']?.main?.[0] ?? [];
  assert.ok(loopBack.some((c) => c.node === 'Loop Candidates (Rate Limited)'));
});

test('each rerank result is saved immediately per candidate, never aggregated across the loop', () => {
  const node = findNode('Build Save Rerank Request');
  // A single-element results array built from *this* candidate's own data —
  // not $('Loop...').all() or any other cross-iteration aggregation, which
  // Phase 05 already found unreliable across splitInBatches iterations.
  assert.match(node.parameters.jsonOutput, /results:\s*\[\s*\{\s*candidateId:/);
  assert.doesNotMatch(node.parameters.jsonOutput, /\.all\(\)/);
});
