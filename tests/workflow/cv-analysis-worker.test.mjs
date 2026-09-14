/**
 * Static-analysis tests for the CV Analysis Worker workflow.
 * No database connection required — reads only the workflow files.
 *
 * Run: node --test tests/workflow/cv-analysis-worker.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

const JSON_PATH = resolve(ROOT, 'n8n-workflows/cv-analysis-worker.json');
const TS_PATH   = resolve(ROOT, 'n8n-workflows/cv-analysis-worker.ts');

const wf    = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const tsRaw = readFileSync(TS_PATH, 'utf8');

const CONFIG_NAME      = 'Workflow Configuration';
const TRIGGER_NAME     = 'Poll Queue Every 5s';
const FAIL_STUCK_NAME  = 'Fail Stuck Tasks';
const CONFIG_URL_REF   = `$('Workflow Configuration').first().json.supabaseBaseUrl`;
const VARS_REF         = '$vars.SUPABASE_URL';

// ─── Node existence ───────────────────────────────────────────────────────────

test('Workflow Configuration node exists exactly once', () => {
  const hits = wf.nodes.filter(n => n.name === CONFIG_NAME);
  assert.equal(hits.length, 1, `Expected 1 "${CONFIG_NAME}" node, found ${hits.length}`);
});

test('Workflow Configuration node is type n8n-nodes-base.set', () => {
  const node = wf.nodes.find(n => n.name === CONFIG_NAME);
  assert.equal(node.type, 'n8n-nodes-base.set');
});

test('Workflow Configuration node has supabaseBaseUrl assignment', () => {
  const node        = wf.nodes.find(n => n.name === CONFIG_NAME);
  const assignments = node.parameters?.assignments?.assignments ?? [];
  const field       = assignments.find(a => a.name === 'supabaseBaseUrl');
  assert.ok(field,                              'supabaseBaseUrl assignment missing');
  assert.ok(field.value.startsWith('http'),     'supabaseBaseUrl must start with http');
  assert.ok(!field.value.endsWith('/'),         'supabaseBaseUrl must not have a trailing slash');
});

test('Workflow Configuration node has environment assignment', () => {
  const node        = wf.nodes.find(n => n.name === CONFIG_NAME);
  const assignments = node.parameters?.assignments?.assignments ?? [];
  const field       = assignments.find(a => a.name === 'environment');
  assert.ok(field, 'environment assignment missing');
});

// ─── Connections ─────────────────────────────────────────────────────────────

test('trigger connects to Workflow Configuration', () => {
  const outbound = wf.connections[TRIGGER_NAME]?.main?.[0] ?? [];
  assert.ok(
    outbound.some(c => c.node === CONFIG_NAME),
    `"${TRIGGER_NAME}" must connect to "${CONFIG_NAME}"`
  );
});

test('trigger does NOT connect directly to Fail Stuck Tasks', () => {
  const outbound = wf.connections[TRIGGER_NAME]?.main?.[0] ?? [];
  assert.ok(
    !outbound.some(c => c.node === FAIL_STUCK_NAME),
    `"${TRIGGER_NAME}" must not connect directly to "${FAIL_STUCK_NAME}"`
  );
});

test('Workflow Configuration connects to Fail Stuck Tasks', () => {
  const outbound = wf.connections[CONFIG_NAME]?.main?.[0] ?? [];
  assert.ok(
    outbound.some(c => c.node === FAIL_STUCK_NAME),
    `"${CONFIG_NAME}" must connect to "${FAIL_STUCK_NAME}"`
  );
});

// ─── URL hygiene ──────────────────────────────────────────────────────────────

test('no $vars.SUPABASE_URL references remain in the JSON workflow', () => {
  const raw = readFileSync(JSON_PATH, 'utf8');
  assert.ok(!raw.includes(VARS_REF), `Found ${VARS_REF} in the workflow JSON`);
});

test('no $vars.SUPABASE_URL references remain in the TypeScript source', () => {
  assert.ok(!tsRaw.includes(VARS_REF), `Found ${VARS_REF} in the TypeScript source`);
});

test('every Supabase HTTP node URL references Workflow Configuration.supabaseBaseUrl', () => {
  const supabaseHttpNodes = wf.nodes.filter(
    n => n.type === 'n8n-nodes-base.httpRequest' && n.credentials?.supabaseApi
  );
  assert.ok(supabaseHttpNodes.length > 0, 'No Supabase HTTP nodes found — test may be broken');
  for (const n of supabaseHttpNodes) {
    const url = n.parameters?.url ?? '';
    assert.ok(
      url.includes(CONFIG_URL_REF),
      `Node "${n.name}" has a Supabase URL that does not reference ${CONFIG_URL_REF}: ${url}`
    );
  }
});

test('TypeScript source references Workflow Configuration.supabaseBaseUrl for Supabase URLs', () => {
  assert.ok(
    tsRaw.includes(CONFIG_URL_REF),
    `TypeScript source must reference ${CONFIG_URL_REF}`
  );
});

// ─── Secret hygiene ───────────────────────────────────────────────────────────

test('Workflow Configuration node contains no secrets', () => {
  const node = wf.nodes.find(n => n.name === CONFIG_NAME);
  const raw  = JSON.stringify(node);
  const checks = [
    { label: 'JWT-like token',   re: /eyJ[A-Za-z0-9_-]{20,}/ },
    { label: 'OpenAI key prefix', re: /sk-[A-Za-z0-9]{20,}/ },
    { label: 'service_role',      re: /service_role/i },
    { label: 'anon_key',          re: /anon.?key/i },
    { label: 'password field',    re: /"password"\s*:/ },
  ];
  for (const { label, re } of checks) {
    assert.ok(!re.test(raw), `"${CONFIG_NAME}" node appears to contain a secret: ${label}`);
  }
});

test('Workflow Configuration node has no credentials attached', () => {
  const node = wf.nodes.find(n => n.name === CONFIG_NAME);
  assert.ok(
    !node.credentials,
    '"Workflow Configuration" must not have credentials — it is a plain Set node'
  );
});

// ─── TS / JSON synchronization ────────────────────────────────────────────────

test('TypeScript source and JSON agree on node names', () => {
  const jsonNames = wf.nodes.map(n => n.name);
  const missing = jsonNames.filter(
    name => !tsRaw.includes(`'${name}'`) && !tsRaw.includes(`"${name}"`)
  );
  assert.deepEqual(
    missing,
    [],
    `Nodes in JSON not referenced in TypeScript source: ${missing.join(', ')}`
  );
});

test('workflow is inactive in JSON (not activated by this file)', () => {
  assert.equal(wf.active, false, 'Workflow must remain inactive in the JSON file');
});

// ─── HTTP body configuration (specifyBody / jsonBody) ─────────────────────────
// Regression guard: HTTP Request v4.4 requires specifyBody='json' + jsonBody
// when sending a JSON body. Using the bare `body` field without specifyBody='string'
// or contentType='raw' causes an INVALID_PARAMETER validation warning in n8n MCP.

const BODY_NODES = [
  'Fail Stuck Tasks',
  'Claim Task Batch',
  'Sign Storage URL',
  'Call OpenAI',
  'Insert CV Analysis',
  'Update Task Status',
];

test('no HTTP node uses bare body parameter (requires specifyBody or contentType=raw)', () => {
  const bodyUsers = wf.nodes.filter(
    n => n.type === 'n8n-nodes-base.httpRequest' && 'body' in (n.parameters ?? {})
  );
  assert.deepEqual(
    bodyUsers.map(n => n.name),
    [],
    `HTTP nodes must not use bare "body"; found: ${bodyUsers.map(n => n.name).join(', ')}`
  );
});

test('body-sending nodes use specifyBody="json"', () => {
  for (const name of BODY_NODES) {
    const n = wf.nodes.find(nd => nd.name === name);
    assert.ok(n, `Node "${name}" not found`);
    assert.equal(
      n.parameters?.specifyBody,
      'json',
      `Node "${name}" must have specifyBody="json"`
    );
  }
});

test('body-sending nodes use jsonBody (not body)', () => {
  for (const name of BODY_NODES) {
    const n = wf.nodes.find(nd => nd.name === name);
    assert.ok(n, `Node "${name}" not found`);
    assert.ok(
      'jsonBody' in (n.parameters ?? {}),
      `Node "${name}" must use jsonBody`
    );
    assert.ok(
      !('body' in (n.parameters ?? {})),
      `Node "${name}" must not use bare body`
    );
  }
});

test('Fail Stuck Tasks jsonBody contains p_lease_minutes', () => {
  const n = wf.nodes.find(nd => nd.name === 'Fail Stuck Tasks');
  const jb = n.parameters?.jsonBody;
  const raw = typeof jb === 'string' ? jb : JSON.stringify(jb);
  assert.ok(raw.includes('p_lease_minutes'), 'Fail Stuck Tasks jsonBody must include p_lease_minutes');
});

test('Claim Task Batch jsonBody contains p_batch_size', () => {
  const n = wf.nodes.find(nd => nd.name === 'Claim Task Batch');
  const jb = n.parameters?.jsonBody;
  const raw = typeof jb === 'string' ? jb : JSON.stringify(jb);
  assert.ok(raw.includes('p_batch_size'), 'Claim Task Batch jsonBody must include p_batch_size');
});

test('Sign Storage URL jsonBody contains expiresIn', () => {
  const n = wf.nodes.find(nd => nd.name === 'Sign Storage URL');
  const jb = n.parameters?.jsonBody;
  const raw = typeof jb === 'string' ? jb : JSON.stringify(jb);
  assert.ok(raw.includes('expiresIn'), 'Sign Storage URL jsonBody must include expiresIn');
});

test('Call OpenAI jsonBody is an expression referencing openAIBody', () => {
  const n = wf.nodes.find(nd => nd.name === 'Call OpenAI');
  const jb = n.parameters?.jsonBody;
  assert.ok(
    typeof jb === 'string' && jb.includes('openAIBody'),
    `Call OpenAI jsonBody must be an expression referencing openAIBody, got: ${JSON.stringify(jb)}`
  );
});

test('Insert CV Analysis jsonBody is an expression referencing insertBody', () => {
  const n = wf.nodes.find(nd => nd.name === 'Insert CV Analysis');
  const jb = n.parameters?.jsonBody;
  assert.ok(
    typeof jb === 'string' && jb.includes('insertBody'),
    `Insert CV Analysis jsonBody must be an expression referencing insertBody, got: ${JSON.stringify(jb)}`
  );
});

test('Update Task Status jsonBody is an expression referencing patchBody', () => {
  const n = wf.nodes.find(nd => nd.name === 'Update Task Status');
  const jb = n.parameters?.jsonBody;
  assert.ok(
    typeof jb === 'string' && jb.includes('patchBody'),
    `Update Task Status jsonBody must be an expression referencing patchBody, got: ${JSON.stringify(jb)}`
  );
});

test('TypeScript source uses specifyBody for all body-sending nodes', () => {
  assert.ok(
    tsRaw.includes("specifyBody: 'json'"),
    'TypeScript source must use specifyBody: \'json\' for HTTP body nodes'
  );
  assert.ok(
    !tsRaw.includes("body: '{{") && !tsRaw.includes("body: expr("),
    'TypeScript source must not use bare body with expressions — use jsonBody instead'
  );
});

// ─── Split Tasks normalization ────────────────────────────────────────────────
// Regression guard for execution #51: n8n HTTP Request v4.4 unwraps JSON array
// responses into individual items. $input.first().json therefore returns a plain
// task object, not an array. The old code used Array.isArray(body) which
// evaluated to false for a single object, returning [] and silently dropping the
// claimed task. The fix uses $input.all() and handles both shapes.

function runSplitTasks(inputItems) {
  const node = wf.nodes.find(n => n.name === 'Split Tasks');
  assert.ok(node, 'Split Tasks node must exist in workflow JSON');
  const code = node.parameters.jsCode;
  const mockInput = {
    all:   () => inputItems,
    first: () => (inputItems.length > 0 ? inputItems[0] : { json: null }),
  };
  return new Function('$input', code)(mockInput);
}

test('Split Tasks: single unwrapped task object returns one item (regression #51)', () => {
  const task = { id: 'uuid-1', user_id: 'user-1', cv_id: 'cv-1', attempt_count: 1 };
  const result = runSplitTasks([{ json: task }]);
  assert.equal(result.length, 1, 'Expected exactly 1 output item');
  assert.deepEqual(result[0].json, task, 'Output item json must equal the input task');
});

test('Split Tasks: multiple unwrapped task objects (n8n batch) returns all items', () => {
  const tasks = [
    { id: 'uuid-1', user_id: 'user-1', cv_id: 'cv-1' },
    { id: 'uuid-2', user_id: 'user-2', cv_id: 'cv-2' },
    { id: 'uuid-3', user_id: 'user-3', cv_id: 'cv-3' },
  ];
  const result = runSplitTasks(tasks.map(t => ({ json: t })));
  assert.equal(result.length, 3, 'Expected 3 output items for a batch of 3');
  assert.deepEqual(result.map(r => r.json), tasks);
});

test('Split Tasks: array-as-single-json (non-unwrapped edge case) returns all tasks', () => {
  const tasks = [
    { id: 'uuid-1', user_id: 'user-1', cv_id: 'cv-1' },
    { id: 'uuid-2', user_id: 'user-2', cv_id: 'cv-2' },
  ];
  const result = runSplitTasks([{ json: tasks }]);
  assert.equal(result.length, 2, 'Array-as-json must be unwrapped into individual items');
});

test('Split Tasks: empty item list returns no items', () => {
  const result = runSplitTasks([]);
  assert.deepEqual(result, [], 'Empty input must produce empty output');
});

test('Split Tasks: null json returns no items', () => {
  const result = runSplitTasks([{ json: null }]);
  assert.deepEqual(result, [], 'Null json must produce empty output');
});

test('Split Tasks: empty object json (missing required fields) is dropped', () => {
  const result = runSplitTasks([{ json: {} }]);
  assert.deepEqual(result, [], 'Object without id/user_id/cv_id must be dropped');
});

test('Split Tasks: object missing cv_id is dropped', () => {
  const result = runSplitTasks([{ json: { id: 'uuid-1', user_id: 'user-1' } }]);
  assert.deepEqual(result, [], 'Object without cv_id must be dropped');
});

test('Split Tasks: mix of valid and invalid items keeps only valid', () => {
  const valid   = { id: 'uuid-1', user_id: 'user-1', cv_id: 'cv-1' };
  const invalid = { id: 'uuid-2' };
  const result  = runSplitTasks([{ json: valid }, { json: invalid }]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].json, valid);
});

test('Split Tasks: code does not use $input.first() (must use $input.all())', () => {
  const node = wf.nodes.find(n => n.name === 'Split Tasks');
  assert.ok(!node.parameters.jsCode.includes('$input.first()'),
    'Split Tasks must not use $input.first() — use $input.all() to handle all claimed tasks');
  assert.ok(node.parameters.jsCode.includes('$input.all()'),
    'Split Tasks must use $input.all()');
});

test('Split Tasks: TypeScript source does not use $input.first() in Split Tasks', () => {
  const match = tsRaw.match(/Split Tasks[\s\S]*?jsCode[\s\S]*?`([\s\S]*?)`/);
  if (match) {
    assert.ok(!match[1].includes('$input.first()'),
      'TypeScript Split Tasks jsCode must not use $input.first()');
    assert.ok(match[1].includes('$input.all()'),
      'TypeScript Split Tasks jsCode must use $input.all()');
  }
});

// ─── For Each Task connection ──────────────────────────────────────────────────

test('Split Tasks connects to For Each Task on output 0', () => {
  const outbound = wf.connections['Split Tasks']?.main?.[0] ?? [];
  assert.ok(
    outbound.some(c => c.node === 'For Each Task'),
    'Split Tasks must connect to "For Each Task"'
  );
});

test('For Each Task batch output (index 1) connects to Load CV Row', () => {
  const batchOut = wf.connections['For Each Task']?.main?.[1] ?? [];
  assert.ok(
    batchOut.some(c => c.node === 'Load CV Row'),
    'For Each Task batch output must connect to "Load CV Row"'
  );
});

test('Update Task Status connects back to For Each Task for next-batch loop', () => {
  const outbound = wf.connections['Update Task Status']?.main?.[0] ?? [];
  assert.ok(
    outbound.some(c => c.node === 'For Each Task'),
    '"Update Task Status" must loop back to "For Each Task"'
  );
});

// ─── Validate CV Context: routing through Check Context Valid ─────────────────

test('Validate CV Context connects to Check Context Valid (not directly to Sign Storage URL)', () => {
  const outbound = wf.connections['Validate CV Context']?.main?.[0] ?? [];
  assert.ok(
    outbound.some(c => c.node === 'Check Context Valid'),
    '"Validate CV Context" must connect to "Check Context Valid"'
  );
  assert.ok(
    !outbound.some(c => c.node === 'Sign Storage URL'),
    '"Validate CV Context" must NOT connect directly to "Sign Storage URL" — route through Check Context Valid'
  );
});

// Automation-1 audit Phase 5: Check Context Valid's true branch now routes
// through the trigger-based extraction-skip gate before reaching Sign
// Storage URL, instead of connecting to it directly.
test('Check Context Valid true branch (output 0) connects to Check Needs Full Extraction', () => {
  const trueBranch = wf.connections['Check Context Valid']?.main?.[0] ?? [];
  assert.ok(
    trueBranch.some(c => c.node === 'Check Needs Full Extraction'),
    '"Check Context Valid" true branch must connect to "Check Needs Full Extraction"'
  );
});

test('Check Needs Full Extraction true branch (output 0) connects to Sign Storage URL', () => {
  const trueBranch = wf.connections['Check Needs Full Extraction']?.main?.[0] ?? [];
  assert.ok(
    trueBranch.some(c => c.node === 'Sign Storage URL'),
    '"Check Needs Full Extraction" true branch must connect to "Sign Storage URL"'
  );
});

test('Check Needs Full Extraction false branch (output 1) connects to Load Prior CV Facts', () => {
  const falseBranch = wf.connections['Check Needs Full Extraction']?.main?.[1] ?? [];
  assert.ok(
    falseBranch.some(c => c.node === 'Load Prior CV Facts'),
    '"Check Needs Full Extraction" false branch must connect to "Load Prior CV Facts"'
  );
});

test('Load Prior CV Facts connects to Normalize CV Context', () => {
  const outbound = wf.connections['Load Prior CV Facts']?.main?.[0] ?? [];
  assert.ok(
    outbound.some(c => c.node === 'Normalize CV Context'),
    '"Load Prior CV Facts" must connect to "Normalize CV Context"'
  );
});

test('Extract PDF Text connects to Normalize CV Context (not directly to Load Preferences)', () => {
  const outbound = wf.connections['Extract PDF Text']?.main?.[0] ?? [];
  assert.ok(
    outbound.some(c => c.node === 'Normalize CV Context'),
    '"Extract PDF Text" must connect to "Normalize CV Context"'
  );
});

test('Normalize CV Context connects to Load Preferences (branch convergence point)', () => {
  const outbound = wf.connections['Normalize CV Context']?.main?.[0] ?? [];
  assert.ok(
    outbound.some(c => c.node === 'Load Preferences'),
    '"Normalize CV Context" must connect to "Load Preferences"'
  );
});

test('Build OpenAI Request reads from Normalize CV Context, not directly from Extract PDF Text', () => {
  assert.ok(
    tsRaw.includes(`$('Normalize CV Context')`),
    'Build OpenAI Request must read the normalized CV context (full or reused) rather than Extract PDF Text directly'
  );
});

test('Check Context Valid false branch (output 1) connects to Handle Context Failure', () => {
  const falseBranch = wf.connections['Check Context Valid']?.main?.[1] ?? [];
  assert.ok(
    falseBranch.some(c => c.node === 'Handle Context Failure'),
    '"Check Context Valid" false branch must connect to "Handle Context Failure"'
  );
});

test('Handle Context Failure connects to Update Task Status', () => {
  const outbound = wf.connections['Handle Context Failure']?.main?.[0] ?? [];
  assert.ok(
    outbound.some(c => c.node === 'Update Task Status'),
    '"Handle Context Failure" must connect to "Update Task Status"'
  );
});

test('Check Context Valid node is an IF node with a condition on cvStoragePath', () => {
  const n = wf.nodes.find(nd => nd.name === 'Check Context Valid');
  assert.ok(n, '"Check Context Valid" node must exist');
  assert.equal(n.type, 'n8n-nodes-base.if', '"Check Context Valid" must be an IF node');
  const raw = JSON.stringify(n.parameters);
  assert.ok(raw.includes('cvStoragePath'), '"Check Context Valid" condition must reference cvStoragePath');
});

// ─── Validate CV Context code: handle direct object (regression #52) ──────────

function makeTaskCtx(overrides) {
  return {
    id: 'task-uuid-1',
    user_id: 'user-uuid-1',
    cv_id: 'cv-uuid-1',
    attempt_count: 1,
    max_attempts: 3,
    ...overrides,
  };
}

function makeValidCvRow(overrides) {
  return {
    id: 'cv-uuid-1',
    storage_path: 'user-uuid-1/file.pdf',
    mime_type: 'application/pdf',
    is_active: true,
    file_name: 'cv.pdf',
    ...overrides,
  };
}

function runValidateCvContext(inputJson, splitTasksJson) {
  const node = wf.nodes.find(n => n.name === 'Validate CV Context');
  assert.ok(node, '"Validate CV Context" node must exist');
  const code = node.parameters.jsCode;
  const mockInput = { item: { json: inputJson } };
  const mockDollar = (nodeName) => ({
    item: { json: nodeName === 'Split Tasks' ? splitTasksJson : null },
  });
  return new Function('$input', '$', code)(mockInput, mockDollar);
}

test('Validate CV Context: direct CV object passes (regression for execution #52 root cause)', () => {
  const taskCtx = makeTaskCtx();
  const cvRow   = makeValidCvRow();
  // n8n HTTP Request v4.4 unwraps the one-element array — arrives as direct object
  const result  = runValidateCvContext(cvRow, taskCtx);
  assert.equal(result.length, 1, 'Must return exactly 1 item');
  assert.equal(result[0].json.cvStoragePath, cvRow.storage_path, 'cvStoragePath must come from the direct object');
  assert.equal(result[0].json.taskId, taskCtx.id);
  assert.equal(result[0].json.userId, taskCtx.user_id);
});

test('Validate CV Context: one-element array is accepted (fallback shape)', () => {
  const taskCtx = makeTaskCtx();
  const cvRow   = makeValidCvRow();
  const result  = runValidateCvContext([cvRow], taskCtx);
  assert.equal(result.length, 1);
  assert.equal(result[0].json.cvStoragePath, cvRow.storage_path);
});

test('Validate CV Context: error from Load CV Row propagates as RETRYABLE', () => {
  const taskCtx = makeTaskCtx();
  assert.throws(
    () => runValidateCvContext({ error: 'network timeout' }, taskCtx),
    /RETRYABLE/,
    'Load CV Row HTTP error must produce a RETRYABLE error'
  );
});

test('Validate CV Context: null input produces PERMANENT not-found error', () => {
  const taskCtx = makeTaskCtx();
  assert.throws(
    () => runValidateCvContext(null, taskCtx),
    /PERMANENT.*CV record not found/
  );
});

test('Validate CV Context: empty object input produces PERMANENT not-found error', () => {
  const taskCtx = makeTaskCtx();
  assert.throws(
    () => runValidateCvContext({}, taskCtx),
    /PERMANENT.*CV record not found/
  );
});

test('Validate CV Context: empty array produces PERMANENT not-found error', () => {
  const taskCtx = makeTaskCtx();
  assert.throws(
    () => runValidateCvContext([], taskCtx),
    /PERMANENT.*CV record not found/
  );
});

test('Validate CV Context: mismatched CV ID produces PERMANENT error', () => {
  const taskCtx = makeTaskCtx({ cv_id: 'cv-uuid-1' });
  const cvRow   = makeValidCvRow({ id: 'cv-uuid-DIFFERENT' });
  assert.throws(
    () => runValidateCvContext(cvRow, taskCtx),
    /PERMANENT.*mismatch/
  );
});

test('Validate CV Context: inactive CV produces PERMANENT error', () => {
  const taskCtx = makeTaskCtx();
  const cvRow   = makeValidCvRow({ is_active: false });
  assert.throws(
    () => runValidateCvContext(cvRow, taskCtx),
    /PERMANENT.*no longer active/
  );
});

test('Validate CV Context: empty storage_path produces PERMANENT error', () => {
  const taskCtx = makeTaskCtx();
  const cvRow   = makeValidCvRow({ storage_path: '' });
  assert.throws(
    () => runValidateCvContext(cvRow, taskCtx),
    /PERMANENT.*storage_path/
  );
});

test('Validate CV Context: null storage_path produces PERMANENT error', () => {
  const taskCtx = makeTaskCtx();
  const cvRow   = makeValidCvRow({ storage_path: null });
  assert.throws(
    () => runValidateCvContext(cvRow, taskCtx),
    /PERMANENT.*storage_path/
  );
});

test('Validate CV Context: non-PDF MIME type produces PERMANENT error', () => {
  const taskCtx = makeTaskCtx();
  const cvRow   = makeValidCvRow({ mime_type: 'image/png' });
  assert.throws(
    () => runValidateCvContext(cvRow, taskCtx),
    /PERMANENT.*Unsupported MIME type/
  );
});

test('Validate CV Context: successful output contains all required fields', () => {
  const taskCtx = makeTaskCtx({ attempt_count: 2, max_attempts: 5 });
  const cvRow   = makeValidCvRow({ file_name: 'My CV.pdf' });
  const result  = runValidateCvContext(cvRow, taskCtx);
  const out     = result[0].json;
  // Required by requirement §7
  assert.equal(out.taskId,        taskCtx.id,             'taskId');
  assert.equal(out.userId,        taskCtx.user_id,        'userId');
  assert.equal(out.cvId,          taskCtx.cv_id,          'cvId');
  assert.equal(out.cvStoragePath, cvRow.storage_path,     'cvStoragePath');
  assert.equal(out.cvMimeType,    cvRow.mime_type,        'cvMimeType');
  assert.equal(out.cvFileName,    cvRow.file_name,        'cvFileName');
  assert.equal(out.attemptCount,  taskCtx.attempt_count,  'attemptCount');
  assert.equal(out.maxAttempts,   taskCtx.max_attempts,   'maxAttempts');
  // Backward-compatible aliases
  assert.equal(out.taskAttempt,     taskCtx.attempt_count, 'taskAttempt alias');
  assert.equal(out.taskMaxAttempts, taskCtx.max_attempts,  'taskMaxAttempts alias');
});

test('Validate CV Context: successful output has no error field', () => {
  const taskCtx = makeTaskCtx();
  const cvRow   = makeValidCvRow();
  const result  = runValidateCvContext(cvRow, taskCtx);
  assert.ok(!result[0].json.error, 'Successful output must not have an error field');
});

// ─── Handle Context Failure code ──────────────────────────────────────────────

function runHandleContextFailure(inputJson, splitTasksJson) {
  const node = wf.nodes.find(n => n.name === 'Handle Context Failure');
  assert.ok(node, '"Handle Context Failure" node must exist');
  const code = node.parameters.jsCode;
  const mockInput = { item: { json: inputJson } };
  const mockDollar = (nodeName) => ({
    item: { json: nodeName === 'Split Tasks' ? splitTasksJson : null },
  });
  return new Function('$input', '$', code)(mockInput, mockDollar);
}

function makeHandleInput(errorMsg) {
  return { error: errorMsg };
}

test('Handle Context Failure: PERMANENT error → status failed', () => {
  const splitCtx = makeTaskCtx({ attempt_count: 1, max_attempts: 3 });
  const result   = runHandleContextFailure(makeHandleInput('PERMANENT: CV record not found'), splitCtx);
  assert.equal(result[0].json.taskId, splitCtx.id);
  assert.equal(result[0].json.patchBody.status, 'failed');
  assert.ok(result[0].json.patchBody.failed_at, 'failed_at must be set');
  assert.ok(!result[0].json.patchBody.error, 'CV prefix must be stripped from last_error');
  assert.equal(result[0].json.patchBody.last_error, 'CV record not found');
});

test('Handle Context Failure: retryable error at attempt 2 of 3 → status pending with backoff', () => {
  const splitCtx = makeTaskCtx({ attempt_count: 2, max_attempts: 3 });
  const result   = runHandleContextFailure(makeHandleInput('RETRYABLE: network error'), splitCtx);
  assert.equal(result[0].json.patchBody.status, 'pending');
  assert.ok(result[0].json.patchBody.available_at, 'available_at must be set');
  assert.equal(result[0].json.patchBody.last_error, 'network error', 'prefix stripped');
  // Backoff for attempt=2: 30s * 2^(2-1) = 60s
  const now    = Date.now();
  const eta    = new Date(result[0].json.patchBody.available_at).getTime();
  assert.ok(eta > now + 50000, 'available_at must be at least 50s in the future');
});

test('Handle Context Failure: retryable error at attempt >= maxAttempts → status failed', () => {
  const splitCtx = makeTaskCtx({ attempt_count: 3, max_attempts: 3 });
  const result   = runHandleContextFailure(makeHandleInput('RETRYABLE: something broke'), splitCtx);
  assert.equal(result[0].json.patchBody.status, 'failed', 'exhausted retries must produce failed status');
});

test('Handle Context Failure: no taskId → skipped sentinel', () => {
  const result = runHandleContextFailure(makeHandleInput('PERMANENT: bad CV'), null);
  assert.equal(result[0].json.skipped, true);
});

test('Handle Context Failure: no error field in input falls back gracefully', () => {
  const splitCtx = makeTaskCtx({ attempt_count: 1, max_attempts: 3 });
  const result   = runHandleContextFailure({}, splitCtx);
  assert.equal(result[0].json.patchBody.status, 'pending', 'unknown error should be treated as retryable');
});

test('Handle Context Failure: taskId always comes from Split Tasks, not from input', () => {
  const splitCtx = makeTaskCtx({ id: 'the-real-task-id' });
  const result   = runHandleContextFailure(makeHandleInput('PERMANENT: bad CV'), splitCtx);
  assert.equal(result[0].json.taskId, 'the-real-task-id');
});

// ─── Controlled failure: invalid context cannot reach OpenAI / Insert ─────────

test('invalid context cannot reach Sign Storage URL (connection routes through IF guard)', () => {
  // Structurally, Validate CV Context now connects to Check Context Valid, not Sign Storage URL.
  // This test confirms the false branch (output[1]) leads to Handle Context Failure,
  // not to any storage, OpenAI, or Insert node.
  const falseBranch = wf.connections['Check Context Valid']?.main?.[1] ?? [];
  const badTargets = ['Sign Storage URL', 'Download CV Binary', 'Extract PDF Text',
                      'Load Preferences', 'Call OpenAI', 'Insert CV Analysis'];
  for (const bad of badTargets) {
    assert.ok(
      !falseBranch.some(c => c.node === bad),
      `Check Context Valid false branch must not connect to "${bad}"`
    );
  }
  assert.ok(
    falseBranch.some(c => c.node === 'Handle Context Failure'),
    'Check Context Valid false branch must lead to "Handle Context Failure"'
  );
});

// ─── Load Preference Roles / Locations URL guard ──────────────────────────────

test('Load Preference Roles URL uses Array.isArray guard (no bare [0] access on error objects)', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Preference Roles');
  assert.ok(n, '"Load Preference Roles" node must exist');
  assert.ok(
    n.parameters.url.includes('Array.isArray'),
    '"Load Preference Roles" URL must guard against error objects using Array.isArray'
  );
});

test('Load Preference Roles URL no longer falls back to "none" (invalid UUID)', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Preference Roles');
  assert.ok(!n.parameters.url.includes("|| 'none'"),
    '"Load Preference Roles" URL must not use "none" as UUID fallback');
  assert.ok(!n.parameters.url.includes('|| "none"'),
    '"Load Preference Roles" URL must not use "none" as UUID fallback');
});

test('Load Preference Locations URL uses Array.isArray guard', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Preference Locations');
  assert.ok(n, '"Load Preference Locations" node must exist');
  assert.ok(
    n.parameters.url.includes('Array.isArray'),
    '"Load Preference Locations" URL must guard against error objects using Array.isArray'
  );
});

test('Load Preference Locations URL no longer falls back to "none" (invalid UUID)', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Preference Locations');
  assert.ok(!n.parameters.url.includes("|| 'none'"),
    '"Load Preference Locations" URL must not use "none" as UUID fallback');
  assert.ok(!n.parameters.url.includes('|| "none"'),
    '"Load Preference Locations" URL must not use "none" as UUID fallback');
});

// ─── alwaysOutputData: empty Supabase [] must not stop the workflow ───────────

test('Load Preference Roles has alwaysOutputData enabled (execution #53 root cause)', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Preference Roles');
  assert.ok(n, '"Load Preference Roles" node must exist');
  assert.strictEqual(n.alwaysOutputData, true,
    '"Load Preference Roles" must have alwaysOutputData: true — empty join-table [] response halted execution #53');
});

test('Load Preference Locations has alwaysOutputData enabled', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Preference Locations');
  assert.ok(n, '"Load Preference Locations" node must exist');
  assert.strictEqual(n.alwaysOutputData, true,
    '"Load Preference Locations" must have alwaysOutputData: true');
});

test('Load Preference Roles URL handles direct-object response from Load Preferences', () => {
  // Regression: the false branch of the Array.isArray ternary returned {} instead of
  // the direct object, so the preference ID was always undefined → nil UUID used.
  const n = wf.nodes.find(nd => nd.name === 'Load Preference Roles');
  assert.ok(
    n.parameters.url.includes("$('Load Preferences').item.json || {}"),
    '"Load Preference Roles" URL false branch must use the direct object, not {}'
  );
});

test('Load Preference Locations URL handles direct-object response from Load Preferences', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Preference Locations');
  assert.ok(
    n.parameters.url.includes("$('Load Preferences').item.json || {}"),
    '"Load Preference Locations" URL false branch must use the direct object, not {}'
  );
});

// ─── Merge Preference Data: regression tests (execution #53) ─────────────────

function runMergePreferenceData({ validateCtxJson, loadPrefsJson, roleItems = [], locationItems = [] }) {
  const node = wf.nodes.find(n => n.name === 'Merge Preference Data');
  assert.ok(node, '"Merge Preference Data" node must exist');
  const code = node.parameters.jsCode;

  const mockInput = {
    item: { json: locationItems[0] ?? {} },
    all:  () => locationItems.map(j => ({ json: j })),
  };

  const mockDollar = (nodeName) => {
    switch (nodeName) {
      case 'Validate CV Context':
        return { item: { json: validateCtxJson }, all: () => [{ json: validateCtxJson }] };
      case 'Load Preferences':
        return { item: { json: loadPrefsJson }, all: () => [{ json: loadPrefsJson }] };
      case 'Load Preference Roles':
        return {
          item: { json: roleItems[0] ?? {} },
          all:  () => roleItems.map(j => ({ json: j })),
        };
      default:
        return { item: { json: null }, all: () => [] };
    }
  };

  return new Function('$input', '$', code)(mockInput, mockDollar);
}

function makePrefsRow(overrides) {
  return {
    id: 'pref-uuid-1',
    user_id: 'user-uuid-1',
    work_arrangement: 'remote',
    job_market_coverage: null,
    job_type: 'full-time',
    experience_level: 'junior',
    additional_notes: null,
    version: 1,
    custom_target_roles: [],
    custom_locations: [],
    ...overrides,
  };
}

function makeCtxJson(overrides) {
  return {
    taskId: 'task-uuid-1',
    userId: 'user-uuid-1',
    cvId: 'cv-uuid-1',
    cvStoragePath: 'user/file.pdf',
    cvMimeType: 'application/pdf',
    ...overrides,
  };
}

test('Merge Preference Data: always emits exactly 1 item', () => {
  const result = runMergePreferenceData({
    validateCtxJson: makeCtxJson(),
    loadPrefsJson: makePrefsRow(),
    roleItems: [],
    locationItems: [],
  });
  assert.equal(result.length, 1, 'must always emit exactly 1 item');
});

test('Merge Preference Data: empty join roles + alwaysOutputData sentinel → falls back to custom_target_roles (execution #53 scenario)', () => {
  // Execution #53: user had 0 relational roles (custom_target_roles: ["AI Developer"]).
  // alwaysOutputData produces one empty sentinel {}. joinRoleNames = [] → custom used.
  const prefs = makePrefsRow({ custom_target_roles: ['AI Developer'], custom_locations: null });
  const result = runMergePreferenceData({
    validateCtxJson: makeCtxJson(),
    loadPrefsJson: prefs,
    roleItems: [{}],       // alwaysOutputData sentinel
    locationItems: [{}],   // alwaysOutputData sentinel
  });
  const snap = result[0].json.preferenceSnapshot;
  assert.deepStrictEqual(snap.target_roles, ['AI Developer'], 'custom_target_roles must be used when join table is empty');
  assert.deepStrictEqual(snap.preferred_locations, [], 'null custom_locations must produce []');
});

test('Merge Preference Data: direct-object Load Preferences (n8n v4.4 unwrap) is extracted correctly', () => {
  // n8n v4.4 unwraps single-element arrays. The old code returned null for direct objects.
  const prefs = makePrefsRow({ custom_target_roles: ['Backend Developer'] });
  const result = runMergePreferenceData({
    validateCtxJson: makeCtxJson(),
    loadPrefsJson: prefs,  // direct object, not [prefs]
    roleItems: [{}],
    locationItems: [{}],
  });
  const snap = result[0].json.preferenceSnapshot;
  assert.deepStrictEqual(snap.target_roles, ['Backend Developer'], 'direct-object prefs must be extracted');
  assert.equal(snap.work_arrangement, 'remote', 'work_arrangement must come from direct-object prefs');
  assert.equal(snap.preferences_version, 1, 'version must come from direct-object prefs');
});

test('Merge Preference Data: relational roles and custom_target_roles are combined when both present', () => {
  // save_job_preferences already deduplicates custom roles against reference role
  // names, so in practice these lists don't overlap. The worker combines both so
  // custom free-text roles (e.g. "Marketing Manager") are included alongside
  // reference roles (e.g. "Software Engineer") in the preference snapshot.
  const prefs = makePrefsRow({ custom_target_roles: ['My Custom Role'] });
  const result = runMergePreferenceData({
    validateCtxJson: makeCtxJson(),
    loadPrefsJson: prefs,
    roleItems: [{ target_roles: { name: 'Software Engineer' } }, { target_roles: { name: 'Backend Developer' } }],
    locationItems: [{}],
  });
  assert.deepStrictEqual(result[0].json.preferenceSnapshot.target_roles,
    ['Software Engineer', 'Backend Developer', 'My Custom Role'],
    'reference roles and custom roles must both be included');
});

test('Merge Preference Data: relational locations and custom_locations are combined when both present', () => {
  const prefs = makePrefsRow({ custom_locations: ['My Custom City'] });
  const result = runMergePreferenceData({
    validateCtxJson: makeCtxJson(),
    loadPrefsJson: prefs,
    roleItems: [{}],
    locationItems: [{ locations: { name: 'Remote' } }, { locations: { name: 'London' } }],
  });
  assert.deepStrictEqual(result[0].json.preferenceSnapshot.preferred_locations,
    ['Remote', 'London', 'My Custom City'],
    'reference locations and custom locations must both be included');
});

test('Merge Preference Data: multiple location items all collected via $input.all()', () => {
  const result = runMergePreferenceData({
    validateCtxJson: makeCtxJson(),
    loadPrefsJson: makePrefsRow(),
    roleItems: [{}],
    locationItems: [
      { locations: { name: 'New York' } },
      { locations: { name: 'San Francisco' } },
      { locations: { name: 'Remote' } },
    ],
  });
  assert.deepStrictEqual(result[0].json.preferenceSnapshot.preferred_locations,
    ['New York', 'San Francisco', 'Remote'],
    'all location items must be collected');
});

test('Merge Preference Data: multi-item input still emits exactly 1 output (uses $input.all())', () => {
  const result = runMergePreferenceData({
    validateCtxJson: makeCtxJson(),
    loadPrefsJson: makePrefsRow({ custom_target_roles: ['Developer'] }),
    roleItems: [{}],
    locationItems: [{}, {}, {}],  // 3 items (e.g. from 3 upstream role rows)
  });
  assert.equal(result.length, 1, 'must emit 1 item even when given 3 location inputs');
});

test('Merge Preference Data: empty string custom roles are filtered out', () => {
  const prefs = makePrefsRow({ custom_target_roles: ['', 'Valid Role'] });
  const result = runMergePreferenceData({
    validateCtxJson: makeCtxJson(),
    loadPrefsJson: prefs,
    roleItems: [{}],
    locationItems: [{}],
  });
  const roles = result[0].json.preferenceSnapshot.target_roles;
  assert.ok(!roles.includes(''), 'empty string must be filtered out');
  assert.ok(roles.includes('Valid Role'), 'non-empty custom role must be preserved');
});

test('Merge Preference Data: null Load Preferences response yields empty snapshot without crashing', () => {
  const result = runMergePreferenceData({
    validateCtxJson: makeCtxJson(),
    loadPrefsJson: null,
    roleItems: [{}],
    locationItems: [{}],
  });
  const snap = result[0].json.preferenceSnapshot;
  assert.deepStrictEqual(snap.target_roles, []);
  assert.deepStrictEqual(snap.preferred_locations, []);
  assert.equal(snap.work_arrangement, null);
  assert.equal(snap.preferences_version, null);
});

test('Merge Preference Data: user_id mismatch throws PERMANENT error', () => {
  const prefs = makePrefsRow({ user_id: 'different-user-id' });
  assert.throws(
    () => runMergePreferenceData({
      validateCtxJson: makeCtxJson({ userId: 'user-uuid-1' }),
      loadPrefsJson: prefs,
      roleItems: [{}],
      locationItems: [{}],
    }),
    /PERMANENT.*user_id/,
    'mismatched user_id must throw PERMANENT error'
  );
});

test('Merge Preference Data uses $input.all() for location collection (not $input.item.json)', () => {
  const n = wf.nodes.find(nd => nd.name === 'Merge Preference Data');
  assert.ok(n.parameters.jsCode.includes('$input.all()'),
    '"Merge Preference Data" must use $input.all() to collect all location items');
  assert.ok(!n.parameters.jsCode.includes('$input.item.json'),
    '"Merge Preference Data" must not use $input.item.json (misses multi-item batches)');
});

test('Merge Preference Data uses $("Load Preference Roles").all() for role collection', () => {
  const n = wf.nodes.find(nd => nd.name === 'Merge Preference Data');
  assert.ok(
    n.parameters.jsCode.includes("$('Load Preference Roles').all()"),
    '"Merge Preference Data" must use $("Load Preference Roles").all() to collect all role items'
  );
});

// ─── Download CV Binary URL: /storage/v1 prefix regression (execution #53) ───
// Root cause of execution #53 404: the Supabase Storage sign endpoint returns a
// signedURL that starts with /object/sign/... (no /storage/v1/ prefix). Without
// inserting /storage/v1 between supabaseBaseUrl and signedURL, the download hits
// the API gateway at /object/sign/... which has no matching route → HTTP 404.

test('Download CV Binary URL includes /storage/v1 between supabaseBaseUrl and signedURL (regression for execution #53 404)', () => {
  const n = wf.nodes.find(nd => nd.name === 'Download CV Binary');
  assert.ok(n, '"Download CV Binary" node must exist');
  const url = n.parameters?.url ?? '';

  const configRef  = `$('Workflow Configuration').first().json.supabaseBaseUrl`;
  const configIdx  = url.indexOf(configRef);
  const storageIdx = url.indexOf('/storage/v1');
  const signedIdx  = url.indexOf('signedURL');

  assert.ok(configIdx  !== -1, '"Download CV Binary" URL must reference Workflow Configuration supabaseBaseUrl');
  assert.ok(storageIdx !== -1, '"Download CV Binary" URL must contain /storage/v1');
  assert.ok(signedIdx  !== -1, '"Download CV Binary" URL must reference signedURL');
  assert.ok(configIdx  <  storageIdx, 'supabaseBaseUrl must appear before /storage/v1 in the URL');
  assert.ok(storageIdx <  signedIdx,  '/storage/v1 must appear before signedURL in the URL');
});

test('Download CV Binary URL does not concatenate supabaseBaseUrl directly onto signedURL (regression for execution #53 404)', () => {
  const n   = wf.nodes.find(nd => nd.name === 'Download CV Binary');
  const url = n.parameters?.url ?? '';
  // Bad pattern: supabaseBaseUrl expression closing }} immediately followed by {{ signedURL
  assert.ok(
    !url.includes('supabaseBaseUrl }}{{ $json.signedURL') &&
    !url.includes('supabaseBaseUrl}}{{$json.signedURL'),
    '"Download CV Binary" URL must not concatenate supabaseBaseUrl directly onto signedURL without /storage/v1'
  );
});

test('TypeScript source Download CV Binary URL includes /storage/v1 before signedURL', () => {
  // Extract the Download CV Binary url value from the TypeScript source.
  // The pattern is: url: expr("={{ ... }}/storage/v1{{ $json.signedURL }}")
  const match = tsRaw.match(/Download CV Binary[\s\S]*?url:\s*expr\(`?["']([^"'`]+)["'`]\)/);
  if (match) {
    const url = match[1];
    const storageIdx = url.indexOf('/storage/v1');
    const signedIdx  = url.indexOf('signedURL');
    assert.ok(storageIdx !== -1, 'TypeScript Download CV Binary URL must contain /storage/v1');
    assert.ok(storageIdx <  signedIdx, 'TypeScript: /storage/v1 must precede signedURL');
  }
  // Also verify the TS source contains the correct pattern as a simple substring check
  assert.ok(
    tsRaw.includes('/storage/v1{{ $json.signedURL }}'),
    'TypeScript source must contain /storage/v1 before signedURL in Download CV Binary URL'
  );
});

// ─── Load Task Feedback node ──────────────────────────────────────────────────

test('Load Task Feedback node exists in workflow JSON', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Task Feedback');
  assert.ok(n, '"Load Task Feedback" node must exist');
  assert.equal(n.type, 'n8n-nodes-base.httpRequest', '"Load Task Feedback" must be an HTTP Request node');
});

test('Load Task Feedback has alwaysOutputData enabled (empty feedback must not halt workflow)', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Task Feedback');
  assert.ok(n, '"Load Task Feedback" node must exist');
  assert.strictEqual(n.alwaysOutputData, true,
    '"Load Task Feedback" must have alwaysOutputData: true — no feedback row on standard tasks would halt the workflow');
});

// Regression test for a real bug found during controlled end-to-end
// verification (live execution 37265, 2026-08-25): a lightweight-trigger
// task for a CV with no prior completed analysis (e.g. the very first task
// ever claimed for that CV, if it happens to carry a lightweight trigger)
// got an empty [] from Supabase. Without alwaysOutputData, that produced
// ZERO output items, so Normalize CV Context — whose job is to detect
// exactly this and raise an explicit PERMANENT error — never ran at all.
// The per-item chain went silently dark and the task stuck at
// status='processing' indefinitely instead of failing explicitly.
test('Load Prior CV Facts has alwaysOutputData enabled (empty prior-facts result must not silently stall the task)', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Prior CV Facts');
  assert.ok(n, '"Load Prior CV Facts" node must exist');
  assert.strictEqual(n.alwaysOutputData, true,
    '"Load Prior CV Facts" must have alwaysOutputData: true — a genuine zero-row result (no prior analysis to reuse) must still reach Normalize CV Context, not silently stall the task');
});

test('Load Task Feedback URL queries analysis_feedback by analysis_task_id', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Task Feedback');
  assert.ok(n, '"Load Task Feedback" node must exist');
  const url = n.parameters?.url ?? '';
  assert.ok(url.includes('analysis_feedback'), '"Load Task Feedback" URL must target the analysis_feedback table');
  assert.ok(url.includes('analysis_task_id=eq.'), '"Load Task Feedback" URL must filter by analysis_task_id');
  assert.ok(url.includes("$('Validate CV Context').item.json.taskId"), '"Load Task Feedback" URL must reference the task ID from Validate CV Context');
});

test('Load Task Feedback URL selects only feedback_type, affected_section, feedback_text', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Task Feedback');
  const url = n.parameters?.url ?? '';
  assert.ok(url.includes('select=feedback_type'), '"Load Task Feedback" must select feedback_type');
  assert.ok(url.includes('affected_section'), '"Load Task Feedback" must select affected_section');
  assert.ok(url.includes('feedback_text'), '"Load Task Feedback" must select feedback_text');
});

test('Load Task Feedback uses Supabase Service Role credentials', () => {
  const n = wf.nodes.find(nd => nd.name === 'Load Task Feedback');
  assert.ok(n?.credentials?.supabaseApi, '"Load Task Feedback" must use supabaseApi credentials');
});

test('Load Task Feedback is positioned between Merge Preference Data and Build OpenAI Request in connections', () => {
  const mergeOut = wf.connections['Merge Preference Data']?.main?.[0] ?? [];
  assert.ok(mergeOut.some(c => c.node === 'Load Task Feedback'),
    '"Merge Preference Data" must connect to "Load Task Feedback"');

  const feedbackOut = wf.connections['Load Task Feedback']?.main?.[0] ?? [];
  assert.ok(feedbackOut.some(c => c.node === 'Build OpenAI Request'),
    '"Load Task Feedback" must connect to "Build OpenAI Request"');
});

test('TypeScript source references Load Task Feedback node by name', () => {
  assert.ok(tsRaw.includes("'Load Task Feedback'"),
    'TypeScript source must reference "Load Task Feedback" by name');
});

// ─── Build OpenAI Request: feedback integration ───────────────────────────────

// Automation-1 audit Phase 5: Build OpenAI Request now reads the converged
// "Normalize CV Context" output (isLightweight/cvText/priorFacts) instead of
// Extract PDF Text directly, so it works uniformly for both the full and
// lightweight-reuse branches.
function runBuildOpenAIRequest({ taskCtxJson, normCtxJson, mergePrefsJson, feedbackItemJson }) {
  const node = wf.nodes.find(n => n.name === 'Build OpenAI Request');
  assert.ok(node, '"Build OpenAI Request" node must exist');
  const code = node.parameters.jsCode;

  const mockDollar = (nodeName) => {
    switch (nodeName) {
      case 'Validate CV Context':   return { item: { json: taskCtxJson } };
      case 'Normalize CV Context':  return { item: { json: normCtxJson } };
      case 'Merge Preference Data': return { item: { json: mergePrefsJson } };
      case 'Load Task Feedback':    return { item: { json: feedbackItemJson } };
      default: return { item: { json: null } };
    }
  };
  // $input is no longer used in Build OpenAI Request (reads from named nodes).
  const mockInput = { item: { json: feedbackItemJson } };
  return new Function('$input', '$', code)(mockInput, mockDollar);
}

function makeNormCtx(text = 'Alice Smith\nSoftware Engineer with 3 years experience.') {
  return { isLightweight: false, cvText: text, priorFacts: null };
}

function makeLightweightNormCtx(priorFacts = {}) {
  return {
    isLightweight: true,
    cvText: null,
    priorFacts: {
      professional_summary: 'Experienced backend engineer.',
      skills: ['Node.js', 'PostgreSQL'],
      education: [{ institution: 'State University', degree: 'BSc Computer Science' }],
      work_experience: [{ title: 'Backend Engineer', organization: 'Acme Corp', highlights: ['Built APIs'] }],
      projects: [],
      certifications: [],
      languages: [{ language: 'English', proficiency: 'Native' }],
      contact_info: null,
      extracted_text: 'Alice Smith full original CV text...',
      ...priorFacts,
    },
  };
}

function makeMergedPrefs(roles = ['Software Engineer'], locs = ['Remote']) {
  return {
    preferenceSnapshot: {
      target_roles: roles,
      preferred_locations: locs,
      work_arrangement: 'remote',
      job_market_coverage: null,
      job_type: 'full-time',
      experience_level: 'junior',
      additional_notes: null,
      preferences_version: 1,
    },
  };
}

function makeBuildCtx(overrides = {}) {
  return {
    taskId: 'task-uuid-1',
    userId: 'user-uuid-1',
    cvId: 'cv-uuid-1',
    taskAttempt: 1,
    taskMaxAttempts: 3,
    ...overrides,
  };
}

test('Build OpenAI Request: no feedback row → single-section user message (JOB PREFERENCES + CV TEXT)', () => {
  // Empty sentinel from alwaysOutputData — no feedback_type field.
  const result = runBuildOpenAIRequest({
    taskCtxJson: makeBuildCtx(),
    normCtxJson: makeNormCtx(),
    mergePrefsJson: makeMergedPrefs(),
    feedbackItemJson: {},
  });
  assert.equal(result.length, 1);
  const messages = result[0].json.openAIBody.messages;
  const userMsg = messages.find(m => m.role === 'user')?.content ?? '';
  assert.ok(userMsg.includes('JOB PREFERENCES:'), 'user message must include JOB PREFERENCES section');
  assert.ok(userMsg.includes('CV TEXT:'), 'user message must include CV TEXT section');
  assert.ok(!userMsg.includes('USER FEEDBACK'), 'user message must NOT include USER FEEDBACK when no feedback row');
});

test('Build OpenAI Request: with feedback row → three-section user message including USER FEEDBACK', () => {
  const feedbackItem = {
    feedback_type: 'cv_correction',
    affected_section: 'Work experience',
    feedback_text: 'The dates for my last job are wrong — I left in 2024, not 2023.',
  };
  const result = runBuildOpenAIRequest({
    taskCtxJson: makeBuildCtx(),
    normCtxJson: makeNormCtx(),
    mergePrefsJson: makeMergedPrefs(),
    feedbackItemJson: feedbackItem,
  });
  const userMsg = result[0].json.openAIBody.messages.find(m => m.role === 'user')?.content ?? '';
  assert.ok(userMsg.includes('JOB PREFERENCES:'), 'section 1: JOB PREFERENCES must be present');
  assert.ok(userMsg.includes('USER FEEDBACK (cv_correction):'), 'section 2: USER FEEDBACK with type must be present');
  assert.ok(userMsg.includes('Section: Work experience'), 'section 2: affected_section must be included');
  assert.ok(userMsg.includes('I left in 2024'), 'section 2: feedback_text must be present');
  assert.ok(userMsg.includes('CV TEXT:'), 'section 3: CV TEXT must be present');
  // Order: preferences, then feedback, then CV text.
  assert.ok(
    userMsg.indexOf('JOB PREFERENCES:') < userMsg.indexOf('USER FEEDBACK'),
    'JOB PREFERENCES must appear before USER FEEDBACK'
  );
  assert.ok(
    userMsg.indexOf('USER FEEDBACK') < userMsg.indexOf('CV TEXT:'),
    'USER FEEDBACK must appear before CV TEXT'
  );
});

test('Build OpenAI Request: feedback without affected_section omits Section: line', () => {
  const feedbackItem = {
    feedback_type: 'recommendation_feedback',
    affected_section: null,
    feedback_text: 'Please suggest more product management roles instead.',
  };
  const result = runBuildOpenAIRequest({
    taskCtxJson: makeBuildCtx(),
    normCtxJson: makeNormCtx(),
    mergePrefsJson: makeMergedPrefs(),
    feedbackItemJson: feedbackItem,
  });
  const userMsg = result[0].json.openAIBody.messages.find(m => m.role === 'user')?.content ?? '';
  assert.ok(!userMsg.includes('Section:'), 'Section: line must be omitted when affected_section is null');
  assert.ok(userMsg.includes('USER FEEDBACK (recommendation_feedback):'), 'feedback type must still appear');
});

test('Build OpenAI Request: feedback → system prompt contains USER FEEDBACK NOTE', () => {
  const feedbackItem = {
    feedback_type: 'user_request',
    affected_section: null,
    feedback_text: 'Please include a summary of my open-source contributions.',
  };
  const result = runBuildOpenAIRequest({
    taskCtxJson: makeBuildCtx(),
    normCtxJson: makeNormCtx(),
    mergePrefsJson: makeMergedPrefs(),
    feedbackItemJson: feedbackItem,
  });
  const sysMsg = result[0].json.openAIBody.messages.find(m => m.role === 'system')?.content ?? '';
  assert.ok(sysMsg.includes('USER FEEDBACK NOTE'), 'system prompt must include USER FEEDBACK NOTE when feedback is present');
  assert.ok(sysMsg.includes('The JSON output format above is fixed'), 'system prompt must reinforce schema immutability');
});

test('Build OpenAI Request: no feedback → system prompt does NOT contain USER FEEDBACK NOTE', () => {
  const result = runBuildOpenAIRequest({
    taskCtxJson: makeBuildCtx(),
    normCtxJson: makeNormCtx(),
    mergePrefsJson: makeMergedPrefs(),
    feedbackItemJson: {},
  });
  const sysMsg = result[0].json.openAIBody.messages.find(m => m.role === 'system')?.content ?? '';
  assert.ok(!sysMsg.includes('USER FEEDBACK NOTE'), 'system prompt must NOT include USER FEEDBACK NOTE when no feedback');
});

test('Build OpenAI Request: reads preferences from Merge Preference Data node (not $input)', () => {
  const n = wf.nodes.find(nd => nd.name === 'Build OpenAI Request');
  const code = n.parameters.jsCode;
  assert.ok(
    code.includes("$('Merge Preference Data').item.json"),
    '"Build OpenAI Request" must read preferences from $("Merge Preference Data") by name'
  );
  // $input.item.json must NOT be used for mergedPrefs now that Load Task Feedback
  // is the direct predecessor — $input would be the feedback row, not preferences.
  assert.ok(
    !code.includes("$input.item.json"),
    '"Build OpenAI Request" must not use $input.item.json (would read feedback row, not preferences)'
  );
});

test('Build OpenAI Request: output always contains taskId, userId, cvId, openAIBody', () => {
  const result = runBuildOpenAIRequest({
    taskCtxJson: makeBuildCtx({ taskId: 'my-task', userId: 'my-user', cvId: 'my-cv' }),
    normCtxJson: makeNormCtx(),
    mergePrefsJson: makeMergedPrefs(),
    feedbackItemJson: {},
  });
  const out = result[0].json;
  assert.equal(out.taskId, 'my-task');
  assert.equal(out.userId, 'my-user');
  assert.equal(out.cvId, 'my-cv');
  assert.ok(out.openAIBody?.messages?.length >= 2, 'openAIBody must have system and user messages');
});

test('Build OpenAI Request: empty CV text throws PERMANENT error', () => {
  assert.throws(
    () => runBuildOpenAIRequest({
      taskCtxJson: makeBuildCtx(),
      normCtxJson: makeNormCtx('   '),
      mergePrefsJson: makeMergedPrefs(),
      feedbackItemJson: {},
    }),
    /PERMANENT.*no extractable text/,
    'empty CV text must produce a PERMANENT error'
  );
});

// ─── Build OpenAI Request: lightweight (reuse) path ────────────────────────────

test('Build OpenAI Request: lightweight path never includes CV TEXT and requests recommendations only', () => {
  const result = runBuildOpenAIRequest({
    taskCtxJson: makeBuildCtx(),
    normCtxJson: makeLightweightNormCtx(),
    mergePrefsJson: makeMergedPrefs(),
    feedbackItemJson: {},
  });
  const messages = result[0].json.openAIBody.messages;
  const userMsg = messages.find(m => m.role === 'user')?.content ?? '';
  const sysMsg = messages.find(m => m.role === 'system')?.content ?? '';

  assert.ok(!userMsg.includes('CV TEXT:'), 'lightweight path must never send the raw CV text');
  assert.ok(userMsg.includes('CV FACTS'), 'lightweight path must include the reused CV facts as context');
  assert.ok(userMsg.includes('Backend Engineer'), 'reused prior facts must actually appear in the prompt');
  assert.ok(!sysMsg.includes('"skills":'), 'lightweight schema must not ask the model to return CV-fact fields');
  assert.ok(sysMsg.includes('"recommended_roles"'), 'lightweight schema must still ask for recommendation fields');
  assert.equal(result[0].json.isLightweight, true);
  assert.equal(result[0].json.cvText, null, 'lightweight output must not carry a cvText value forward');
  assert.ok(result[0].json.priorFacts, 'lightweight output must carry priorFacts forward for Parse AI Response');
});

test('Build OpenAI Request: lightweight path with feedback still includes USER FEEDBACK', () => {
  const feedbackItem = {
    feedback_type: 'recommendation_feedback',
    affected_section: null,
    feedback_text: 'Please suggest more platform engineering roles instead.',
  };
  const result = runBuildOpenAIRequest({
    taskCtxJson: makeBuildCtx(),
    normCtxJson: makeLightweightNormCtx(),
    mergePrefsJson: makeMergedPrefs(),
    feedbackItemJson: feedbackItem,
  });
  const userMsg = result[0].json.openAIBody.messages.find(m => m.role === 'user')?.content ?? '';
  assert.ok(userMsg.includes('USER FEEDBACK (recommendation_feedback):'), 'feedback must still reach the lightweight prompt');
  assert.ok(userMsg.includes('platform engineering'), 'feedback text must be present');
});

test('Build OpenAI Request: lightweight path uses a smaller max_tokens budget than the full path', () => {
  const lightweight = runBuildOpenAIRequest({
    taskCtxJson: makeBuildCtx(),
    normCtxJson: makeLightweightNormCtx(),
    mergePrefsJson: makeMergedPrefs(),
    feedbackItemJson: {},
  });
  const full = runBuildOpenAIRequest({
    taskCtxJson: makeBuildCtx(),
    normCtxJson: makeNormCtx(),
    mergePrefsJson: makeMergedPrefs(),
    feedbackItemJson: {},
  });
  assert.ok(
    lightweight[0].json.openAIBody.max_tokens < full[0].json.openAIBody.max_tokens,
    'a recommendations-only request should budget fewer output tokens than a full extraction'
  );
});

test('Build OpenAI Request: PERMANENT merge error propagates', () => {
  assert.throws(
    () => runBuildOpenAIRequest({
      taskCtxJson: makeBuildCtx(),
      normCtxJson: makeNormCtx(),
      mergePrefsJson: { error: 'PERMANENT: job_preferences user_id does not match task user_id' },
      feedbackItemJson: {},
    }),
    /PERMANENT/,
    'PERMANENT preference merge error must propagate'
  );
});

// ─── Normalize CV Context: branch convergence ──────────────────────────────────

function runNormalizeCvContext({ taskCtxJson, inputJson }) {
  const node = wf.nodes.find(n => n.name === 'Normalize CV Context');
  assert.ok(node, '"Normalize CV Context" node must exist');
  const code = node.parameters.jsCode;

  const mockDollar = (nodeName) => {
    switch (nodeName) {
      case 'Validate CV Context': return { item: { json: taskCtxJson } };
      default: return { item: { json: null } };
    }
  };
  const mockInput = { item: { json: inputJson } };
  return new Function('$input', '$', code)(mockInput, mockDollar);
}

test('Normalize CV Context: full-path trigger takes cvText from Extract PDF Text output', () => {
  const result = runNormalizeCvContext({
    taskCtxJson: { taskTrigger: 'cv_replaced' },
    inputJson: { text: 'Extracted CV text here.' },
  });
  assert.equal(result[0].json.isLightweight, false);
  assert.equal(result[0].json.cvText, 'Extracted CV text here.');
  assert.equal(result[0].json.priorFacts, null);
});

test('Normalize CV Context: onboarding_completed/cv_correction/null trigger also take the full path', () => {
  for (const trigger of ['onboarding_completed', 'cv_correction', null, undefined, 'something_unrecognized']) {
    const result = runNormalizeCvContext({
      taskCtxJson: { taskTrigger: trigger },
      inputJson: { text: 'Extracted text.' },
    });
    assert.equal(result[0].json.isLightweight, false, `trigger=${trigger} must take the full path`);
  }
});

test('Normalize CV Context: preferences_updated/recommendation_feedback/user_request reuse prior facts', () => {
  for (const trigger of ['preferences_updated', 'recommendation_feedback', 'user_request']) {
    const result = runNormalizeCvContext({
      taskCtxJson: { taskTrigger: trigger },
      inputJson: [{ professional_summary: 'Prior summary', skills: ['A', 'B'], extracted_text: 'Prior text' }],
    });
    assert.equal(result[0].json.isLightweight, true, `trigger=${trigger} must take the lightweight path`);
    assert.equal(result[0].json.cvText, null);
    assert.equal(result[0].json.priorFacts.professional_summary, 'Prior summary');
    assert.deepEqual(result[0].json.priorFacts.skills, ['A', 'B']);
  }
});

test('Normalize CV Context: lightweight trigger with no prior completed analysis fails PERMANENT, not silently full-path', () => {
  assert.throws(
    () => runNormalizeCvContext({
      taskCtxJson: { taskTrigger: 'preferences_updated' },
      inputJson: [], // Supabase returned no rows.
    }),
    /PERMANENT.*no prior completed CV analysis/,
    'must fail permanently rather than guess at facts or silently attempt a full path mid-graph'
  );
});

// The real production shape: Load Prior CV Facts' alwaysOutputData sentinel
// for a genuine zero-row Supabase result is {} (an empty object), not [] —
// matching the exact pattern already used by Load Task Feedback/Load
// Preference Roles/Load Preference Locations. Both shapes must be handled
// identically (reproduces the live-execution 37265 scenario precisely).
test('Normalize CV Context: alwaysOutputData {} sentinel (the real production shape) also fails PERMANENT', () => {
  assert.throws(
    () => runNormalizeCvContext({
      taskCtxJson: { taskTrigger: 'preferences_updated' },
      inputJson: {}, // alwaysOutputData sentinel for a genuine zero-row result.
    }),
    /PERMANENT.*no prior completed CV analysis/,
    'the {} alwaysOutputData sentinel must be treated identically to an empty array'
  );
});

// ─── Parse AI Response: lightweight path reuses CV facts verbatim ─────────────
// Automation-1 audit fix: for a lightweight (preferences_updated /
// recommendation_feedback / user_request) task, CV-fact fields must come
// from reqCtx.priorFacts, never from the model's response — even if the
// model returns CV-fact-shaped keys anyway. This is the structural
// guarantee behind "CV facts remain unchanged" (previously only a prompt
// request, not enforced by code).

function runParseAIResponse({ reqCtxJson, aiResponseJson }) {
  const node = wf.nodes.find(n => n.name === 'Parse AI Response');
  assert.ok(node, '"Parse AI Response" node must exist');
  const code = node.parameters.jsCode;

  const mockDollar = (nodeName) => {
    switch (nodeName) {
      case 'Build OpenAI Request': return { item: { json: reqCtxJson } };
      default: return { item: { json: null } };
    }
  };
  const mockInput = { item: { json: aiResponseJson } };
  return new Function('$input', '$', code)(mockInput, mockDollar);
}

function makeAiResponse(contentObj) {
  return { choices: [{ message: { content: JSON.stringify(contentObj) } }] };
}

function makeReqCtx(overrides = {}) {
  return {
    taskId: 'task-uuid-1',
    taskAttempt: 1,
    taskMaxAttempts: 3,
    isLightweight: false,
    cvText: 'Alice Smith full CV text...',
    priorFacts: null,
    preferenceSnapshot: { preferences_version: 1 },
    userId: 'user-uuid-1',
    cvId: 'cv-uuid-1',
    ...overrides,
  };
}

test('Parse AI Response: full path takes CV facts from the model response', () => {
  const result = runParseAIResponse({
    reqCtxJson: makeReqCtx({ isLightweight: false, cvText: 'Real CV text' }),
    aiResponseJson: makeAiResponse({
      skills: ['Python', 'Django'],
      professional_summary: 'A summary from the model.',
      recommended_roles: ['Backend Engineer'],
    }),
  });
  const insertBody = result[0].json.insertBody;
  assert.deepEqual(insertBody.skills, ['Python', 'Django']);
  assert.equal(insertBody.professional_summary, 'A summary from the model.');
  assert.equal(insertBody.extracted_text, 'Real CV text');
});

test('Parse AI Response: lightweight path takes CV facts from priorFacts, ignoring the model response entirely', () => {
  const priorFacts = {
    professional_summary: 'Original verified summary.',
    skills: ['Node.js', 'PostgreSQL'],
    education: [{ institution: 'State University', degree: 'BSc' }],
    work_experience: [],
    projects: [],
    certifications: [],
    languages: [],
    contact_info: null,
    extracted_text: 'Original extracted text.',
  };
  const result = runParseAIResponse({
    reqCtxJson: makeReqCtx({ isLightweight: true, cvText: null, priorFacts }),
    // The model response deliberately includes CV-fact-shaped keys with
    // DIFFERENT values, to prove they are never read for the lightweight path.
    aiResponseJson: makeAiResponse({
      skills: ['Should Never Appear'],
      professional_summary: 'Should never appear either.',
      recommended_roles: ['Platform Engineer'],
      strongest_areas: ['System design'],
      career_recommendations: ['Apply to platform teams.'],
      search_focus: ['Remote roles'],
      development_areas: ['Public speaking'],
      profile_level: 'mid-level',
    }),
  });
  const insertBody = result[0].json.insertBody;

  // CV facts: verbatim from priorFacts, never the model's conflicting values.
  assert.deepEqual(insertBody.skills, ['Node.js', 'PostgreSQL']);
  assert.equal(insertBody.professional_summary, 'Original verified summary.');
  assert.deepEqual(insertBody.education, [{ institution: 'State University', degree: 'BSc' }]);
  assert.equal(insertBody.extracted_text, 'Original extracted text.');

  // Recommendation fields: from the fresh model response, as intended.
  assert.deepEqual(insertBody.recommended_roles, ['Platform Engineer']);
  assert.deepEqual(insertBody.strongest_areas, ['System design']);
  assert.deepEqual(insertBody.career_recommendations, ['Apply to platform teams.']);
  assert.equal(insertBody.profile_level, 'mid-level');

  assert.equal(result[0].json.isLightweight, true);
});

test('Parse AI Response: lightweight path sets candidate_name/candidate_email to null (skips ownership re-check)', () => {
  const result = runParseAIResponse({
    reqCtxJson: makeReqCtx({ isLightweight: true, cvText: null, priorFacts: { skills: [] } }),
    aiResponseJson: makeAiResponse({ candidate_name: 'Someone Else', recommended_roles: [] }),
  });
  assert.equal(result[0].json.candidate_name, null, 'lightweight path must never derive a fresh candidate_name');
  assert.equal(result[0].json.candidate_email, null);
});

test('Parse AI Response: a non-string element in a string[] field is dropped, not inserted (defense against malformed AI output)', () => {
  const result = runParseAIResponse({
    reqCtxJson: makeReqCtx({ isLightweight: false, cvText: 'Real CV text' }),
    aiResponseJson: makeAiResponse({
      // Reproduces the live-observed crash shape: an object where a string was expected.
      career_recommendations: ['A valid recommendation.', { title: 'invalid', detail: 'shape' }, 'Another valid one.'],
      skills: ['Real skill', 42, null, 'Another real skill'],
    }),
  });
  const insertBody = result[0].json.insertBody;
  assert.deepEqual(insertBody.career_recommendations, ['A valid recommendation.', 'Another valid one.']);
  assert.deepEqual(insertBody.skills, ['Real skill', 'Another real skill']);
});

test('Parse AI Response: a non-object element in an object[] field is dropped, not inserted', () => {
  const result = runParseAIResponse({
    reqCtxJson: makeReqCtx({ isLightweight: false, cvText: 'Real CV text' }),
    aiResponseJson: makeAiResponse({
      education: [{ institution: 'Real University' }, 'a stray string', null, 42],
    }),
  });
  assert.deepEqual(result[0].json.insertBody.education, [{ institution: 'Real University' }]);
});

// ─── Merge Preference Data: combine regression (bug fix verification) ─────────

test('Merge Preference Data: combines both reference roles AND custom_target_roles (fixes exclusive-OR bug)', () => {
  // Before the fix: joinRoleNames.length > 0 ? joinRoleNames : customRoles
  // After the fix:  [...joinRoleNames, ...customRoles]
  // A Marketing professional might have both a reference role ("Product Manager")
  // AND a custom role ("Marketing Manager") — both must appear in the snapshot.
  const prefs = makePrefsRow({ custom_target_roles: ['Marketing Manager'] });
  const result = runMergePreferenceData({
    validateCtxJson: makeCtxJson(),
    loadPrefsJson: prefs,
    roleItems: [{ target_roles: { name: 'Product Manager' } }],
    locationItems: [{}],
  });
  const roles = result[0].json.preferenceSnapshot.target_roles;
  assert.ok(roles.includes('Product Manager'), 'reference role must be included');
  assert.ok(roles.includes('Marketing Manager'), 'custom role must be included alongside reference roles');
  assert.equal(roles.length, 2, 'must have exactly one reference + one custom role');
});

// ─── Build Task Update: error-priority ordering (last_error masking fix) ──────
//
// Live execution 37265 showed a task fail with last_error "The value in the
// 'JSON Body' field is not valid JSON" — Call OpenAI's own generic secondary
// symptom of receiving no valid request body — masking the real root cause,
// Normalize CV Context's "PERMANENT: no prior completed CV analysis exists...".
// Build OpenAI Request had already surfaced that same root cause as its own
// .error (it wraps/rethrows whatever upstream problem occurred), but the old
// chain checked Call OpenAI before Build OpenAI Request, so the wrapper's
// error always won whenever both were present.

function runBuildTaskUpdate({
  parseResultJson = {},
  insertResultJson = {},
  validateCtxJson = {},
  splitCtxJson = {},
  nodeJsons = {},
  throwFor = [],
}) {
  const node = wf.nodes.find(n => n.name === 'Build Task Update');
  assert.ok(node, '"Build Task Update" node must exist');
  const code = node.parameters.jsCode;

  const fixedNodes = {
    'Parse AI Response': parseResultJson,
    'Validate CV Context': validateCtxJson,
    'Split Tasks': splitCtxJson,
    ...nodeJsons,
  };

  const mockDollar = (nodeName) => {
    if (throwFor.includes(nodeName)) {
      // Mirrors real n8n behavior: $('Node') throws when that node did not
      // execute for this item's path (e.g. the other branch's nodes).
      throw new Error(`did not execute: ${nodeName}`);
    }
    if (nodeName in fixedNodes) {
      return { item: { json: fixedNodes[nodeName] } };
    }
    return { item: { json: {} } };
  };
  const mockInput = { item: { json: insertResultJson } };
  return new Function('$input', '$', code)(mockInput, mockDollar);
}

function makeParseResultCtx(overrides = {}) {
  return { taskId: 'task-uuid-1', taskAttempt: 1, taskMaxAttempts: 3, ...overrides };
}

test('Build Task Update: a PERMANENT root cause from Build OpenAI Request is preserved, not masked by Call OpenAI\'s generic secondary error', () => {
  const result = runBuildTaskUpdate({
    parseResultJson: makeParseResultCtx(),
    nodeJsons: {
      'Build OpenAI Request': { error: 'PERMANENT: no prior completed CV analysis exists for this lightweight task' },
      'Call OpenAI': { error: "The value in the 'JSON Body' field is not valid JSON" },
    },
  });
  assert.equal(
    result[0].json.patchBody.last_error,
    'no prior completed CV analysis exists for this lightweight task',
    'the specific, more informative upstream error must win over the generic downstream wrapper symptom'
  );
  assert.equal(result[0].json.patchBody.status, 'failed', 'PERMANENT errors must still go straight to failed regardless of attempt count');
});

test('Build Task Update: Call OpenAI\'s own genuine error still surfaces when Build OpenAI Request succeeded', () => {
  const result = runBuildTaskUpdate({
    parseResultJson: makeParseResultCtx({ taskAttempt: 1, taskMaxAttempts: 3 }),
    nodeJsons: {
      'Build OpenAI Request': {},
      'Call OpenAI': { error: 'RATE_LIMIT: OpenAI returned 429' },
    },
  });
  assert.equal(
    result[0].json.patchBody.last_error,
    'OpenAI returned 429',
    'a real Call OpenAI failure (no upstream Build OpenAI Request error) must still be reported verbatim'
  );
  assert.equal(result[0].json.patchBody.status, 'pending', 'rate-limit errors below max attempts still retry, unchanged');
  assert.ok(result[0].json.patchBody.available_at, 'retry path still schedules available_at');
});

test('Build Task Update: retry/backoff and terminal-status transitions are unchanged by the reorder', () => {
  // Below max attempts + non-permanent, non-rate-limit error -> pending retry with 30s-base backoff.
  const retrying = runBuildTaskUpdate({
    parseResultJson: makeParseResultCtx({ taskAttempt: 2, taskMaxAttempts: 3 }),
    nodeJsons: { 'Build OpenAI Request': { error: 'RETRYABLE: transient network error' } },
  });
  assert.equal(retrying[0].json.patchBody.status, 'pending');
  assert.equal(retrying[0].json.patchBody.last_error, 'transient network error');

  // At max attempts, even a non-permanent error must terminate as failed.
  const exhausted = runBuildTaskUpdate({
    parseResultJson: makeParseResultCtx({ taskAttempt: 3, taskMaxAttempts: 3 }),
    nodeJsons: { 'Build OpenAI Request': { error: 'RETRYABLE: transient network error' } },
  });
  assert.equal(exhausted[0].json.patchBody.status, 'failed', 'exhausting max attempts must still terminate the task regardless of error priority ordering');
});

test('Build Task Update: success path is unaffected by the error-chain reorder', () => {
  const result = runBuildTaskUpdate({
    parseResultJson: { ...makeParseResultCtx(), outcome: 'success' },
    insertResultJson: {},
  });
  assert.equal(result[0].json.patchBody.status, 'completed');
  assert.ok(result[0].json.patchBody.completed_at);
});
