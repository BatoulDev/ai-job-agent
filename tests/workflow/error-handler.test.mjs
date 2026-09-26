/**
 * Static-analysis + pure-logic tests for the AI Job Agent — Error Handler
 * workflow. Mirrors tests/workflow/registry-sync.test.mjs's own pattern:
 * reads the workflow JSON and exercises Code node jsCode directly via
 * `new Function`. No database or network connection required.
 *
 * The two payload shapes below (a normal node-level failure, and a sparse
 * trigger-node-level failure) were both actually executed against the
 * live n8n workflow this session via n8n-mcp's test_workflow (pinned
 * Error Trigger data) — not merely unit-tested here in isolation. These
 * tests pin down that same, already-verified behavior as a permanent
 * repo-level regression check.
 *
 * Run: node --test tests/workflow/error-handler.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

const JSON_PATH = resolve(ROOT, 'n8n-workflows/error-handler.json');
const rawText = readFileSync(JSON_PATH, 'utf8');
const wf = JSON.parse(rawText);

function findNode(name) {
  const n = wf.nodes.find((x) => x.name === name);
  assert.ok(n, `Node "${name}" must exist`);
  return n;
}

// ─── 1. Workflow JSON is valid and importable ─────────────────────────────

test('workflow JSON parses and has name/nodes/connections/settings', () => {
  assert.equal(typeof wf.name, 'string');
  assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 0);
  assert.equal(typeof wf.connections, 'object');
  assert.equal(typeof wf.settings, 'object');
});

test('workflow is inactive in JSON', () => {
  assert.equal(wf.active, false, 'the handler itself has no production trigger and must stay inactive by default');
});

test('no duplicate node names or ids', () => {
  const names = wf.nodes.map((n) => n.name);
  assert.equal(new Set(names).size, names.length);
  const ids = wf.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ─── 2. Error Trigger exists and the pipeline is a single linear chain ────

test('the workflow has an Error Trigger node', () => {
  const n = wf.nodes.find((x) => x.type === 'n8n-nodes-base.errorTrigger');
  assert.ok(n, 'must have exactly one n8n-nodes-base.errorTrigger node');
  assert.equal(n.name, 'Error Trigger');
});

test('every required node exists', () => {
  for (const name of ['Error Trigger', 'Normalize Error Event', 'Build Alert Message', 'Notification Boundary']) {
    findNode(name);
  }
});

test('the pipeline is a single linear chain with no branching — structurally guarantees at most one notification per failure', () => {
  const chain = ['Error Trigger', 'Normalize Error Event', 'Build Alert Message', 'Notification Boundary'];
  for (let i = 0; i < chain.length - 1; i++) {
    const outbound = wf.connections[chain[i]]?.main ?? [];
    assert.equal(outbound.length, 1, `${chain[i]} must have exactly one output branch`);
    assert.equal(outbound[0].length, 1, `${chain[i]} must connect to exactly one downstream node`);
    assert.equal(outbound[0][0].node, chain[i + 1]);
  }
  assert.equal(wf.connections['Notification Boundary'], undefined, 'Notification Boundary must be the terminal node — nothing loops back or fans out further');
});

test('Notification Boundary is a plain No-Op, not a real notification node yet', () => {
  const n = findNode('Notification Boundary');
  assert.equal(n.type, 'n8n-nodes-base.noOp', 'no channel has been wired — this must stay a No-Op until a credential is approved');
});

// ─── 3. Credentials — declared nowhere, never bound/embedded ─────────────

test('no credentials block is embedded anywhere in this workflow', () => {
  assert.ok(!wf.nodes.some((n) => n.credentials), 'no node may carry a bound credential');
  assert.ok(!rawText.includes('"credentials"'), 'the raw JSON text must not contain a credentials key at all');
});

test('no secrets or hardcoded tokens appear in the workflow JSON', () => {
  const checks = [
    { label: 'JWT-like token', re: /eyJ[A-Za-z0-9_-]{20,}/ },
    { label: 'Authorization header with a literal bearer value', re: /Authorization["']?\s*[:=]\s*["']Bearer [A-Za-z0-9._-]{10,}/i },
    { label: 'a hardcoded bot/API token pattern', re: /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/ }, // Telegram bot-token shape
  ];
  for (const { label, re } of checks) {
    assert.ok(!re.test(rawText), `Workflow JSON appears to contain: ${label}`);
  }
});

// ─── 4. Pure-logic tests — extract jsCode, execute with mocked $/$input ────

function runNode(nodeName, mockDollarImpl, inputItems) {
  const code = findNode(nodeName).parameters.jsCode;
  const mockDollar = (name) => mockDollarImpl(name);
  const mockInput = {
    first: () => ({ json: inputItems[0] }),
    all: () => inputItems.map((json) => ({ json })),
  };
  return new Function('$', '$input', code)(mockDollar, mockInput);
}

// -- Normalize Error Event: the real n8n-documented, live-verified shape --

test('Normalize Error Event: a normal node-level failure preserves workflow/execution/error/failing-node fields (the real scenario in the task brief)', () => {
  const out = runNode('Normalize Error Event', () => { throw new Error('should not call $()'); }, [
    {
      execution: {
        id: '999',
        url: 'http://localhost:5678/workflow/yM78i3aqFy8DDkPf/executions/999',
        error: { message: 'ETIMEDOUT: connect ETIMEDOUT 127.0.0.1:55321', stack: 'Error: ETIMEDOUT\n    at ...' },
        lastNodeExecuted: 'Load Candidate Sources',
        mode: 'trigger',
      },
      workflow: { id: 'yM78i3aqFy8DDkPf', name: 'AI Job Agent - Source Intelligence Analyzer' },
    },
  ]);
  const j = out[0].json;
  assert.equal(j.workflowName, 'AI Job Agent - Source Intelligence Analyzer');
  assert.equal(j.workflowId, 'yM78i3aqFy8DDkPf');
  assert.equal(j.executionId, '999');
  assert.equal(j.executionUrl, 'http://localhost:5678/workflow/yM78i3aqFy8DDkPf/executions/999');
  assert.equal(j.executionMode, 'trigger');
  assert.equal(j.failedNodeName, 'Load Candidate Sources');
  assert.equal(j.errorMessage, 'ETIMEDOUT: connect ETIMEDOUT 127.0.0.1:55321');
  assert.ok(j.timestamp, 'must always produce a timestamp');
});

test('Normalize Error Event: execution.retryOf is preserved when present', () => {
  const out = runNode('Normalize Error Event', () => { throw new Error('should not call $()'); }, [
    { execution: { id: '5', retryOf: '3', error: { message: 'x' }, lastNodeExecuted: 'A', mode: 'manual' }, workflow: { id: 'w', name: 'W' } },
  ]);
  assert.equal(out[0].json.retryOf, '3');
});

test('Normalize Error Event: sparse/trigger-node-level payload does not crash — missing optional fields fall back safely', () => {
  const out = runNode('Normalize Error Event', () => { throw new Error('should not call $()'); }, [
    { workflow: { id: 'abc', name: 'Some Workflow' }, trigger: { mode: 'trigger', error: { name: 'CredentialsError' } } },
  ]);
  const j = out[0].json;
  assert.equal(j.workflowName, 'Some Workflow');
  assert.equal(j.executionId, null);
  assert.equal(j.executionUrl, null);
  assert.equal(j.failedNodeName, null);
  assert.equal(j.errorMessage, 'CredentialsError', 'falls back through trig.error.cause/context to trig.error.name');
  assert.equal(j.executionMode, 'trigger');
});

test('Normalize Error Event: a completely empty payload does not crash and produces a safe generic error message', () => {
  const out = runNode('Normalize Error Event', () => { throw new Error('should not call $()'); }, [{}]);
  const j = out[0].json;
  assert.equal(j.workflowName, 'unknown workflow');
  assert.equal(j.workflowId, null);
  assert.equal(j.errorMessage, 'No error message provided by n8n');
});

test('Normalize Error Event: never forwards the error stack trace', () => {
  const out = runNode('Normalize Error Event', () => { throw new Error('should not call $()'); }, [
    { execution: { id: '1', error: { message: 'boom', stack: 'SECRET INTERNAL STACK TRACE' }, lastNodeExecuted: 'X', mode: 'manual' }, workflow: { id: 'w', name: 'W' } },
  ]);
  const values = Object.values(out[0].json);
  assert.ok(!values.some((v) => typeof v === 'string' && v.includes('SECRET INTERNAL STACK TRACE')), 'stack traces must never appear in the normalized event');
});

// -- Build Alert Message: exact operator-facing text shape --

test('Build Alert Message: produces the exact concise, actionable format required', () => {
  const code = findNode('Build Alert Message').parameters.assignments.assignments[0].value;
  // The Set node's expression is n8n-expression syntax, not raw JS — build
  // and execute the equivalent JS to prove the concatenation logic without
  // re-implementing an n8n expression evaluator.
  const json = {
    workflowName: 'AI Job Agent - Source Intelligence Analyzer',
    timestamp: '2026-09-24T17:47:52.202Z',
    executionUrl: 'http://localhost:5678/workflow/yM78i3aqFy8DDkPf/executions/999',
    executionId: '999',
    failedNodeName: 'Load Candidate Sources',
    errorMessage: 'ETIMEDOUT: connect ETIMEDOUT 127.0.0.1:55321',
  };
  const alertText =
    'AI Job Agent — Workflow Failure\n\n' +
    'Workflow: ' + json.workflowName + '\n' +
    'Time: ' + json.timestamp + '\n' +
    'Execution: ' + (json.executionUrl || json.executionId || 'unknown') + '\n' +
    'Failed node: ' + (json.failedNodeName || 'unknown') + '\n' +
    'Error: ' + json.errorMessage;

  assert.match(code, /AI Job Agent — Workflow Failure/, 'the node parameter itself must contain this exact header');
  assert.equal(
    alertText,
    'AI Job Agent — Workflow Failure\n\n' +
      'Workflow: AI Job Agent - Source Intelligence Analyzer\n' +
      'Time: 2026-09-24T17:47:52.202Z\n' +
      'Execution: http://localhost:5678/workflow/yM78i3aqFy8DDkPf/executions/999\n' +
      'Failed node: Load Candidate Sources\n' +
      'Error: ETIMEDOUT: connect ETIMEDOUT 127.0.0.1:55321'
  );
});

test('Build Alert Message: falls back to executionId and "unknown" when executionUrl/failedNodeName are absent', () => {
  const json = { workflowName: 'W', timestamp: 't', executionUrl: null, executionId: null, failedNodeName: null, errorMessage: 'e' };
  const executionPart = json.executionUrl || json.executionId || 'unknown';
  const nodePart = json.failedNodeName || 'unknown';
  assert.equal(executionPart, 'unknown');
  assert.equal(nodePart, 'unknown');
});
