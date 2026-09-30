/**
 * Static-analysis tests for the AI Job Guide - Job Expiry Sweep workflow
 * (n8n-workflows/job-expiry-sweep.json). Mirrors
 * tests/workflow/error-handler.test.mjs's own pattern: reads the workflow
 * JSON and checks structure only. No database or network connection
 * required. The RPC it calls (public.expire_due_jobs()) has its own real
 * DB-level tests in tests/db/job-expiry-sweep.test.mjs — this file only
 * proves the workflow itself is well-formed and, critically, stays
 * inactive.
 *
 * Run: node --test tests/workflow/job-expiry-sweep.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

const JSON_PATH = resolve(ROOT, 'n8n-workflows/job-expiry-sweep.json');
const rawText = readFileSync(JSON_PATH, 'utf8');
const wf = JSON.parse(rawText);

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

test('workflow is inactive in JSON — must stay this way until an explicit, separate production authorization', () => {
  assert.equal(wf.active, false);
});

test('no duplicate node names or ids', () => {
  const names = wf.nodes.map((n) => n.name);
  assert.equal(new Set(names).size, names.length);
  const ids = wf.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the trigger is an hourly Schedule Trigger, matching the founder-recommended cadence', () => {
  const n = wf.nodes.find((x) => x.type === 'n8n-nodes-base.scheduleTrigger');
  assert.ok(n, 'must have a scheduleTrigger node');
  assert.equal(n.name, 'Hourly Schedule Trigger');
  const interval = n.parameters.rule.interval[0];
  assert.equal(interval.field, 'hours');
  assert.equal(interval.hoursInterval, 1);
});

test('every required node exists', () => {
  for (const name of ['Hourly Schedule Trigger', 'Workflow Configuration', 'Expire Due Jobs']) {
    findNode(name);
  }
});

test('the pipeline is a single linear chain: trigger -> config -> RPC call, nothing else', () => {
  const chain = ['Hourly Schedule Trigger', 'Workflow Configuration', 'Expire Due Jobs'];
  for (let i = 0; i < chain.length - 1; i++) {
    const outbound = wf.connections[chain[i]]?.main ?? [];
    assert.equal(outbound.length, 1, `${chain[i]} must have exactly one output branch`);
    assert.equal(outbound[0].length, 1, `${chain[i]} must connect to exactly one downstream node`);
    assert.equal(outbound[0][0].node, chain[i + 1]);
  }
  assert.equal(wf.connections['Expire Due Jobs'], undefined, 'Expire Due Jobs must be the terminal node');
});

test('the RPC call targets expire_due_jobs, POST, with the Supabase service-role credential type', () => {
  const n = findNode('Expire Due Jobs');
  assert.equal(n.type, 'n8n-nodes-base.httpRequest');
  assert.equal(n.parameters.method, 'POST');
  assert.match(n.parameters.url, /\/rest\/v1\/rpc\/expire_due_jobs$/);
  assert.equal(n.parameters.authentication, 'predefinedCredentialType');
  assert.equal(n.parameters.nodeCredentialType, 'supabaseApi');
});

test('no credentials block is embedded anywhere in this workflow', () => {
  assert.ok(!wf.nodes.some((n) => n.credentials), 'no node may carry a bound credential value');
  assert.ok(!rawText.includes('"credentials"'), 'the raw JSON text must not contain a credentials key at all');
});

test('no secrets or hardcoded tokens appear in the workflow JSON', () => {
  const checks = [
    { label: 'JWT-like token', re: /eyJ[A-Za-z0-9_-]{20,}/ },
    { label: 'Authorization header with a literal bearer value', re: /Authorization["']?\s*[:=]\s*["']Bearer [A-Za-z0-9._-]{10,}/i },
  ];
  for (const { label, re } of checks) {
    assert.ok(!re.test(rawText), `Workflow JSON appears to contain: ${label}`);
  }
});

test('the workflow sends an empty request body — expire_due_jobs() takes no arguments', () => {
  const n = findNode('Expire Due Jobs');
  assert.equal(n.parameters.jsonBody, '={{ {} }}');
});
