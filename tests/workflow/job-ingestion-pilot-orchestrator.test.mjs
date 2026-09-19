/**
 * Static-analysis + normalization-logic tests for the Job Ingestion Pilot
 * Orchestrator workflow. No database or network connection required —
 * reads the workflow JSON and exercises its Code node jsCode directly via
 * `new Function`, mirroring tests/workflow/cv-analysis-worker.test.mjs.
 *
 * Run: node --test tests/workflow/job-ingestion-pilot-orchestrator.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

const JSON_PATH = resolve(ROOT, 'n8n-workflows/job-ingestion-pilot-orchestrator.json');
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

// ─── 2. Workflow is inactive by default ───────────────────────────────────

test('workflow is inactive in JSON', () => {
  assert.equal(wf.active, false, 'Workflow must remain inactive in the JSON file');
});

// ─── 3. Manual Trigger exists ──────────────────────────────────────────────

test('a Manual Trigger node exists', () => {
  assert.ok(
    wf.nodes.some((n) => n.type === 'n8n-nodes-base.manualTrigger'),
    'Workflow must include a Manual Trigger node'
  );
});

// ─── 4. No active Schedule Trigger ─────────────────────────────────────────

test('no Schedule Trigger node exists in this phase', () => {
  assert.ok(
    !wf.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger'),
    'This pilot phase must not include a Schedule Trigger'
  );
});

// ─── 5. No secrets in the JSON ────────────────────────────────────────────

test('no secrets, credential blocks, or hardcoded keys appear in the workflow JSON', () => {
  const checks = [
    { label: 'credentials block', re: /"credentials"\s*:/ },
    { label: 'JWT-like token', re: /eyJ[A-Za-z0-9_-]{20,}/ },
    { label: 'OpenAI key prefix', re: /sk-[A-Za-z0-9]{20,}/ },
    { label: 'service_role literal', re: /service_role.{0,20}[:=]\s*["'][^"']{10,}/i },
    { label: 'password field', re: /"password"\s*:/ },
  ];
  for (const { label, re } of checks) {
    assert.ok(!re.test(rawText), `Workflow JSON appears to contain: ${label}`);
  }
});

test('no production webhook URLs are present', () => {
  assert.ok(!rawText.includes('n8n-nodes-base.webhook'), 'This workflow must not contain a Webhook trigger');
});

test('no pinned execution data is present', () => {
  assert.ok(!('pinData' in wf), 'Repository JSON must not carry pinned execution data');
});

// ─── 6. Required nodes and connections exist ───────────────────────────────

const REQUIRED_NODES = [
  'Start Pilot Run',
  'Workflow Configuration',
  'Load Approved Pilot Sources',
  'Fetch Source Provenance',
  'Attach Provenance & Guard',
  'Process Sources',
  'Is Source Approved?',
  'Route By ATS Type',
  'Fetch Greenhouse Jobs',
  'Classify & Normalize Greenhouse',
  'Fetch Lever Jobs',
  'Classify & Normalize Lever',
  'Fetch Workable Jobs',
  'Classify & Normalize Workable',
  'Should Write To DB?',
  'Prepare Bounded Write Set',
  'Select Existing Jobs For Source',
  'Compute Diff Plan',
  'Upsert Jobs',
  'Merge Upsert Result',
  'Should Close Stale Jobs?',
  'Close Stale Jobs For Source',
  'Finalize Source Result',
  'Rate Limit Delay',
  'Build Execution Summary',
  'Evaluate Greenhouse Fetch Attempt',
  'Should Retry Greenhouse?',
  'Compute Backoff Greenhouse',
  'Backoff Wait Greenhouse',
  'Evaluate Lever Fetch Attempt',
  'Should Retry Lever?',
  'Compute Backoff Lever',
  'Backoff Wait Lever',
  'Evaluate Workable Fetch Attempt',
  'Should Retry Workable?',
  'Compute Backoff Workable',
  'Backoff Wait Workable',
];

test('every required node exists', () => {
  for (const name of REQUIRED_NODES) findNode(name);
});

test('Start Pilot Run connects to Workflow Configuration', () => {
  const outbound = wf.connections['Start Pilot Run']?.main?.[0] ?? [];
  assert.ok(outbound.some((c) => c.node === 'Workflow Configuration'));
});

test('Process Sources onDone connects to Build Execution Summary, onEachBatch to Is Source Approved?', () => {
  const outputs = wf.connections['Process Sources']?.main ?? [];
  assert.ok(outputs[0]?.some((c) => c.node === 'Build Execution Summary'), 'output 0 (done) must reach Build Execution Summary');
  assert.ok(outputs[1]?.some((c) => c.node === 'Is Source Approved?'), 'output 1 (each batch) must reach Is Source Approved?');
});

test('Finalize Source Result loops back through Rate Limit Delay to Process Sources', () => {
  const finalizeOut = wf.connections['Finalize Source Result']?.main?.[0] ?? [];
  assert.ok(finalizeOut.some((c) => c.node === 'Rate Limit Delay'));
  const waitOut = wf.connections['Rate Limit Delay']?.main?.[0] ?? [];
  assert.ok(waitOut.some((c) => c.node === 'Process Sources'), 'Rate Limit Delay must loop back into Process Sources (nextBatch)');
});

const BOOLEAN_OPERATOR_IF_NODES = ['Is Source Approved?', 'Should Retry Greenhouse?', 'Should Retry Lever?', 'Should Retry Workable?', 'Should Write To DB?', 'Should Close Stale Jobs?'];

test('every boolean-operator IF condition uses a real boolean rightValue matching its operation, never an empty string (regression — a real n8n execution throws "Wrong type: \'\' is a string but was expecting a boolean" when a boolean-type condition\'s rightValue is left as \'\', even with typeValidation:strict/loose and looseTypeValidation both set; only a genuine boolean literal reproduces successfully — caught only by real execution, never by these jsCode-mocking tests, so this structural check is the regression guard)', () => {
  for (const name of BOOLEAN_OPERATOR_IF_NODES) {
    const n = findNode(name);
    const conditions = n.parameters?.conditions?.conditions ?? [];
    const booleanConditions = conditions.filter((c) => c.operator?.type === 'boolean');
    assert.ok(booleanConditions.length > 0, `"${name}" was expected to have at least one boolean-operator condition`);
    for (const c of booleanConditions) {
      const expected = c.operator.operation === 'true';
      assert.equal(typeof c.rightValue, 'boolean', `"${name}"'s boolean condition on ${c.leftValue} must have a real boolean rightValue, not "${JSON.stringify(c.rightValue)}"`);
      assert.equal(c.rightValue, expected, `"${name}"'s boolean condition rightValue must match its own operation (${c.operator.operation})`);
    }
    // looseTypeValidation:true is kept alongside as defense in depth, though the boolean rightValue is the actual fix.
    assert.equal(n.parameters.looseTypeValidation, true, `"${name}" should also set looseTypeValidation:true`);
  }
});

test('Route By ATS Type has 4 outputs: greenhouse, lever, workable, fallback', () => {
  const outputs = wf.connections['Route By ATS Type']?.main ?? [];
  assert.equal(outputs.length, 4);
  assert.ok(outputs[0].some((c) => c.node === 'Fetch Greenhouse Jobs'));
  assert.ok(outputs[1].some((c) => c.node === 'Fetch Lever Jobs'));
  assert.ok(outputs[2].some((c) => c.node === 'Fetch Workable Jobs'));
  assert.ok(outputs[3].some((c) => c.node === 'Build Unsupported ATS Result'));
});

test('every terminal branch (review-required, unsupported-ats, no-write, close-stale done) reaches Finalize Source Result', () => {
  const terminalSources = [
    'Build Review-Required Result',
    'Build Unsupported ATS Result',
    'Close Stale Jobs For Source',
  ];
  for (const name of terminalSources) {
    const out = wf.connections[name]?.main?.[0] ?? [];
    assert.ok(out.some((c) => c.node === 'Finalize Source Result'), `"${name}" must connect to Finalize Source Result`);
  }
  const shouldWriteOut = wf.connections['Should Write To DB?']?.main ?? [];
  assert.ok(shouldWriteOut[1]?.some((c) => c.node === 'Finalize Source Result'), 'Should Write To DB? false branch must reach Finalize Source Result');
  const shouldCloseOut = wf.connections['Should Close Stale Jobs?']?.main ?? [];
  assert.ok(shouldCloseOut[1]?.some((c) => c.node === 'Finalize Source Result'), 'Should Close Stale Jobs? false branch must reach Finalize Source Result');
});

// ─── Fetch nodes: explicit timeout + bounded retry, no schedule reliance ──

const FETCH_NODES = ['Fetch Greenhouse Jobs', 'Fetch Lever Jobs', 'Fetch Workable Jobs'];

test('every fetch node has an explicit network timeout', () => {
  for (const name of FETCH_NODES) {
    const n = findNode(name);
    assert.equal(n.parameters?.options?.timeout, 15000, `"${name}" must set an explicit timeout`);
  }
});

test('every fetch node disables native retry (custom bounded-backoff graph loop replaces it)', () => {
  for (const name of FETCH_NODES) {
    const n = findNode(name);
    assert.equal(n.retryOnFail, false, `"${name}" must explicitly disable native retryOnFail`);
  }
});

const ATS_RETRY_LOOP = [
  { fetch: 'Fetch Greenhouse Jobs', evaluate: 'Evaluate Greenhouse Fetch Attempt', shouldRetry: 'Should Retry Greenhouse?', backoff: 'Compute Backoff Greenhouse', wait: 'Backoff Wait Greenhouse', classify: 'Classify & Normalize Greenhouse' },
  { fetch: 'Fetch Lever Jobs', evaluate: 'Evaluate Lever Fetch Attempt', shouldRetry: 'Should Retry Lever?', backoff: 'Compute Backoff Lever', wait: 'Backoff Wait Lever', classify: 'Classify & Normalize Lever' },
  { fetch: 'Fetch Workable Jobs', evaluate: 'Evaluate Workable Fetch Attempt', shouldRetry: 'Should Retry Workable?', backoff: 'Compute Backoff Workable', wait: 'Backoff Wait Workable', classify: 'Classify & Normalize Workable' },
];

test('every ATS retry loop is wired: Fetch -> Evaluate -> Should Retry? -> (true: Compute Backoff -> Wait -> back to Fetch) / (false: Classify)', () => {
  for (const { fetch, evaluate, shouldRetry, backoff, wait, classify } of ATS_RETRY_LOOP) {
    assert.ok((wf.connections[fetch]?.main?.[0] ?? []).some((c) => c.node === evaluate), `${fetch} -> ${evaluate}`);
    assert.ok((wf.connections[evaluate]?.main?.[0] ?? []).some((c) => c.node === shouldRetry), `${evaluate} -> ${shouldRetry}`);
    const branches = wf.connections[shouldRetry]?.main ?? [];
    assert.ok(branches[0]?.some((c) => c.node === backoff), `${shouldRetry} true -> ${backoff}`);
    assert.ok(branches[1]?.some((c) => c.node === classify), `${shouldRetry} false -> ${classify}`);
    assert.ok((wf.connections[backoff]?.main?.[0] ?? []).some((c) => c.node === wait), `${backoff} -> ${wait}`);
    assert.ok((wf.connections[wait]?.main?.[0] ?? []).some((c) => c.node === fetch), `${wait} loops back to ${fetch}`);
  }
});

// ─── Evaluate Fetch Attempt: bounded exponential backoff with jitter ──────

function runEvaluateFetchAttempt(nodeName, backoffNodeName, srcJson, inputItem, priorAttempt) {
  const node = findNode(nodeName);
  const code = node.parameters.jsCode;
  const mockDollar = (name) => {
    if (name === 'Attach Provenance & Guard') return { item: { json: srcJson } };
    if (name === backoffNodeName) {
      if (priorAttempt == null) throw new Error('no prior attempt (first try)');
      return { item: { json: { attempt: priorAttempt } } };
    }
    throw new Error(`unexpected $('${name}')`);
  };
  const mockInput = { first: () => ({ json: inputItem }) };
  return new Function('$', '$input', code)(mockDollar, mockInput);
}

const RETRY_SRC = { source_id: 'sr-test', ats_type: 'greenhouse', company_name: 'Test Co', feed_url: 'https://x.test/feed' };

test('Evaluate Greenhouse Fetch Attempt: timeout/network error is classified retryable_network_error and marked for retry', () => {
  const result = runEvaluateFetchAttempt('Evaluate Greenhouse Fetch Attempt', 'Compute Backoff Greenhouse', RETRY_SRC, { error: 'ETIMEDOUT' });
  const out = result[0].json;
  assert.equal(out.success, false);
  assert.equal(out.shouldRetry, true);
  assert.equal(out.outcome, 'retryable_network_error');
  assert.equal(out.attempt, 1);
  assert.equal(out.nextAttempt, 2);
});

test('Evaluate Greenhouse Fetch Attempt: HTTP 429 with a numeric Retry-After header drives the next delay', () => {
  const result = runEvaluateFetchAttempt('Evaluate Greenhouse Fetch Attempt', 'Compute Backoff Greenhouse', RETRY_SRC, {
    statusCode: 429,
    headers: { 'retry-after': '3' },
  });
  const out = result[0].json;
  assert.equal(out.outcome, 'retryable_rate_limited');
  assert.equal(out.shouldRetry, true);
  assert.equal(out.nextDelayMs, 3000, 'Retry-After: 3 (seconds) must translate to a 3000ms delay, capped at MAX_DELAY_MS');
});

test('Evaluate Greenhouse Fetch Attempt: retryable 5xx (502/503) is classified retryable_server_error', () => {
  for (const statusCode of [502, 503]) {
    const result = runEvaluateFetchAttempt('Evaluate Greenhouse Fetch Attempt', 'Compute Backoff Greenhouse', RETRY_SRC, { statusCode });
    assert.equal(result[0].json.outcome, 'retryable_server_error');
    assert.equal(result[0].json.shouldRetry, true);
  }
});

test('Evaluate Greenhouse Fetch Attempt: permanent 4xx (404) is never retried', () => {
  const result = runEvaluateFetchAttempt('Evaluate Greenhouse Fetch Attempt', 'Compute Backoff Greenhouse', RETRY_SRC, { statusCode: 404 });
  const out = result[0].json;
  assert.equal(out.outcome, 'permanent_client_error');
  assert.equal(out.shouldRetry, false);
  assert.equal(out.success, false);
});

test('Evaluate Greenhouse Fetch Attempt: a non-retryable 5xx (501, not in the retryable set) is treated as permanent', () => {
  const result = runEvaluateFetchAttempt('Evaluate Greenhouse Fetch Attempt', 'Compute Backoff Greenhouse', RETRY_SRC, { statusCode: 501 });
  const out = result[0].json;
  assert.equal(out.outcome, 'permanent_server_error');
  assert.equal(out.shouldRetry, false);
});

test('Evaluate Greenhouse Fetch Attempt: max attempt count (4) exhausts retries and stops retrying', () => {
  const result = runEvaluateFetchAttempt('Evaluate Greenhouse Fetch Attempt', 'Compute Backoff Greenhouse', RETRY_SRC, { statusCode: 503 }, 4);
  const out = result[0].json;
  assert.equal(out.attempt, 4);
  assert.equal(out.shouldRetry, false, 'attempt 4 of MAX_ATTEMPTS=4 must not retry again');
  assert.ok(out.outcome.endsWith('_retries_exhausted'));
});

test('Evaluate Greenhouse Fetch Attempt: computed backoff delay is capped at MAX_DELAY_MS even for a huge Retry-After', () => {
  const result = runEvaluateFetchAttempt('Evaluate Greenhouse Fetch Attempt', 'Compute Backoff Greenhouse', RETRY_SRC, {
    statusCode: 429,
    headers: { 'retry-after': '600' },
  });
  assert.equal(result[0].json.nextDelayMs, 8000, 'a 600s Retry-After must be capped at the 8000ms MAX_DELAY_MS');
});

test('Evaluate Greenhouse Fetch Attempt: jitter-derived delay is deterministic once Math.random is stubbed', () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const result = runEvaluateFetchAttempt('Evaluate Greenhouse Fetch Attempt', 'Compute Backoff Greenhouse', RETRY_SRC, { statusCode: 502 }, 2);
    // attempt=2 -> exp = min(8000, 500 * 2^(2-1)) = 1000; jitter = 0.5 * 1000 = 500; delay = round((1000+500)/2) = 750
    assert.equal(result[0].json.nextDelayMs, 750);
  } finally {
    Math.random = originalRandom;
  }
});

test('every fetch node continues on failure (one source cannot stop the others)', () => {
  for (const name of FETCH_NODES) {
    const n = findNode(name);
    assert.equal(n.onError, 'continueRegularOutput', `"${name}" must not halt the whole workflow on failure`);
  }
});

test('Upsert Jobs and Close Stale Jobs For Source also continue on failure', () => {
  for (const name of ['Upsert Jobs', 'Close Stale Jobs For Source']) {
    const n = findNode(name);
    assert.equal(n.onError, 'continueRegularOutput');
  }
});

// ─── Dry-run cannot write: Should Write To DB? requires mode === 'local_pilot' ─

test('Should Write To DB? condition requires mode === local_pilot (dry_run never reaches Upsert Jobs)', () => {
  const n = findNode('Should Write To DB?');
  const raw = JSON.stringify(n.parameters);
  assert.ok(raw.includes('local_pilot'), 'condition must reference local_pilot');
  assert.ok(raw.includes("mode"), 'condition must reference the mode field');
});

test('Upsert Jobs targets the source-specific dedup identity (dedup_scope, external_id), never the ATS-category-only (source_type, external_id) — regression guard for the same-ATS/different-company collision fix (20260915170000)', () => {
  const n = findNode('Upsert Jobs');
  assert.ok(n.parameters.url.includes('on_conflict=dedup_scope,external_id'), 'Upsert Jobs must target dedup_scope, not source_type — see supabase/migrations/20260915170000_add_jobs_source_specific_dedup_key.sql');
  assert.ok(!n.parameters.url.includes('on_conflict=source_type,external_id'), 'the old ATS-category-only conflict target must never come back — it silently merges two different companies\' jobs sharing an ATS and an external_id');
});

test('no destructive DELETE calls exist anywhere in the workflow (matches/applications/history preserved)', () => {
  for (const n of wf.nodes) {
    if (n.type !== 'n8n-nodes-base.httpRequest') continue;
    assert.notEqual(n.parameters?.method, 'DELETE', `"${n.name}" must not use HTTP DELETE`);
  }
});

// ─── Normalization logic: extract and run each Classify & Normalize node ──

function runClassify(nodeName, srcJson, evalResultJson) {
  const node = findNode(nodeName);
  const code = node.parameters.jsCode;
  const mockDollar = (name) => {
    if (name === 'Attach Provenance & Guard') return { item: { json: srcJson } };
    throw new Error(`unexpected $('${name}') reference`);
  };
  const mockInput = { first: () => ({ json: evalResultJson }) };
  return new Function('$', '$input', code)(mockDollar, mockInput);
}

const SRC = { source_id: 'sr-test', ats_type: 'greenhouse', company_name: 'Test Co' };

test('Classify & Normalize Greenhouse: valid job normalizes correctly', () => {
  const result = runClassify('Classify & Normalize Greenhouse', SRC, {
    success: true,
    attempt: 1,
    body: {
      jobs: [
        {
          id: 12345,
          title: 'Backend Engineer',
          absolute_url: 'https://job-boards.greenhouse.io/test/jobs/12345',
          content: '<p>We build <strong>things</strong>.</p>',
          location: { name: 'Remote - APAC' },
          first_published: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-10T00:00:00Z',
        },
      ],
    },
  });
  const out = result[0].json;
  assert.equal(out.jobsFetched, 1);
  assert.equal(out.jobsValid, 1);
  assert.equal(out.jobsRejected, 0);
  assert.equal(out.retries, 0);
  const job = out.normalizedJobs[0];
  assert.equal(job.source_type, 'greenhouse');
  assert.equal(job.external_id, '12345');
  assert.equal(job.title, 'Backend Engineer');
  assert.equal(job.description, 'We build things .');
  assert.equal(job.work_arrangement, 'remote');
  assert.equal(job.application_url, 'https://job-boards.greenhouse.io/test/jobs/12345');
  assert.equal(job.source_id, 'sr-test');
});

test('Classify & Normalize Greenhouse: job missing description is rejected, not inserted with empty text', () => {
  const result = runClassify('Classify & Normalize Greenhouse', SRC, {
    success: true,
    attempt: 1,
    body: { jobs: [{ id: 1, title: 'X', absolute_url: 'https://x.test/1', content: '' }] },
  });
  const out = result[0].json;
  assert.equal(out.jobsValid, 0);
  assert.equal(out.jobsRejected, 1);
});

test('Classify & Normalize Greenhouse: a failed fetch attempt (retries exhausted) passes through as a failure with retry count, not re-fetched', () => {
  const result = runClassify('Classify & Normalize Greenhouse', SRC, {
    success: false,
    attempt: 4,
    outcome: 'retryable_rate_limited_retries_exhausted',
    errorMessage: 'HTTP 429 from Greenhouse',
  });
  const out = result[0].json;
  assert.equal(out.succeeded, false);
  assert.equal(out.jobsValid, 0);
  assert.equal(out.outcome, 'retryable_rate_limited_retries_exhausted');
  assert.equal(out.error, 'HTTP 429 from Greenhouse');
  assert.equal(out.retries, 3, 'attempt 4 means 3 retries were used before giving up');
});

test('Classify & Normalize Lever: valid job normalizes correctly with employment/workplace mapping', () => {
  const result = runClassify(
    'Classify & Normalize Lever',
    { ...SRC, ats_type: 'lever' },
    {
      success: true,
      attempt: 1,
      body: [
        {
          id: 'abc-123',
          text: 'Product Designer',
          applyUrl: 'https://jobs.lever.co/test/abc-123',
          descriptionPlain: 'Design things.',
          categories: { commitment: 'Full-time', workplaceType: 'remote', location: 'Beirut' },
          createdAt: 1757000000000,
        },
      ],
    }
  );
  const job = result[0].json.normalizedJobs[0];
  assert.equal(job.source_type, 'lever');
  assert.equal(job.external_id, 'abc-123');
  assert.equal(job.employment_type, 'full-time');
  assert.equal(job.work_arrangement, 'remote');
  assert.equal(job.location, 'Beirut');
});

test('Classify & Normalize Lever: job missing applyUrl/hostedUrl is rejected', () => {
  const result = runClassify(
    'Classify & Normalize Lever',
    { ...SRC, ats_type: 'lever' },
    { success: true, attempt: 1, body: [{ id: '1', text: 'X', descriptionPlain: 'desc' }] }
  );
  assert.equal(result[0].json.jobsValid, 0);
  assert.equal(result[0].json.jobsRejected, 1);
});

test('Classify & Normalize Workable: valid job normalizes correctly with telecommuting -> remote', () => {
  const result = runClassify(
    'Classify & Normalize Workable',
    { ...SRC, ats_type: 'workable' },
    {
      success: true,
      attempt: 1,
      body: {
        jobs: [
          {
            shortcode: 'AB12CD',
            title: 'Accountant',
            application_url: 'https://apply.workable.com/j/AB12CD',
            description: '<p>Do accounting.</p>',
            employment_type: 'Full-time',
            telecommuting: true,
            city: 'Riyadh',
            country: 'Saudi Arabia',
          },
        ],
      },
    }
  );
  const job = result[0].json.normalizedJobs[0];
  assert.equal(job.source_type, 'workable');
  assert.equal(job.external_id, 'AB12CD');
  assert.equal(job.employment_type, 'full-time');
  assert.equal(job.work_arrangement, 'remote');
  assert.equal(job.location, 'Riyadh, Saudi Arabia');
});

test('Classify & Normalize Workable: job with empty description after strip is rejected', () => {
  const result = runClassify(
    'Classify & Normalize Workable',
    { ...SRC, ats_type: 'workable' },
    { success: true, attempt: 1, body: { jobs: [{ shortcode: 'X', title: 'Y', application_url: 'https://x.test', description: '<br/>' }] } }
  );
  assert.equal(result[0].json.jobsValid, 0);
  assert.equal(result[0].json.jobsRejected, 1);
});

// ─── Attach Provenance & Guard: review_status/automation_eligibility gate ──

function runAttachProvenance(sourceItems, provenanceRows) {
  const node = findNode('Attach Provenance & Guard');
  const code = node.parameters.jsCode;
  const mockDollar = (name) => {
    // The graph connects Fetch Source Provenance -> Attach Provenance & Guard
    // directly, so $input (mocked below) IS the provenance rows; the original
    // 4-source pilot list is read back by name from Load Approved Pilot Sources,
    // which ran earlier in the same execution but is not a direct predecessor.
    if (name === 'Load Approved Pilot Sources') return { all: () => sourceItems.map((s) => ({ json: s })) };
    throw new Error(`unexpected $('${name}')`);
  };
  const mockInput = { all: () => provenanceRows.map((r) => ({ json: r })) };
  return new Function('$', '$input', code)(mockDollar, mockInput);
}

test('Attach Provenance & Guard: verified + suitable_public_ats source is approved', () => {
  const result = runAttachProvenance(
    [{ source_id: 'sr-1', ats_type: 'greenhouse' }],
    [{ id: 'sr-1', company_name: 'Co', review_status: 'verified', automation_eligibility: 'suitable_public_ats' }]
  );
  assert.equal(result[0].json.approved, true);
});

test('Attach Provenance & Guard: needs_manual_review source is NOT approved even if hardcoded in the pilot list', () => {
  const result = runAttachProvenance(
    [{ source_id: 'sr-1', ats_type: 'greenhouse' }],
    [{ id: 'sr-1', company_name: 'Co', review_status: 'needs_manual_review', automation_eligibility: 'suitable_public_ats' }]
  );
  assert.equal(result[0].json.approved, false);
  assert.ok(result[0].json.reviewReason.includes('needs_manual_review'));
});

test('Attach Provenance & Guard: missing company_sources row is NOT approved', () => {
  const result = runAttachProvenance([{ source_id: 'sr-missing', ats_type: 'greenhouse' }], []);
  assert.equal(result[0].json.approved, false);
});

test('Attach Provenance & Guard: reads the pilot source list by name, not from $input (regression — $input is wired from Fetch Source Provenance, not Load Approved Pilot Sources)', () => {
  const node = findNode('Attach Provenance & Guard');
  assert.ok(node.parameters.jsCode.includes("$('Load Approved Pilot Sources').all()"), 'must iterate the pilot source list via a named reference, since the direct graph input is Fetch Source Provenance\'s rows');
  const inbound = wf.connections['Fetch Source Provenance']?.main?.[0] ?? [];
  assert.ok(inbound.some((c) => c.node === 'Attach Provenance & Guard'), 'confirms $input really is Fetch Source Provenance\'s output, not a mocking artifact');
});

test('Attach Provenance & Guard: all N fetched provenance rows are matched, not just the first (regression — n8n auto-splits a JSON array response into one item per row)', () => {
  const sources = [
    { source_id: 'sr-1', ats_type: 'greenhouse' },
    { source_id: 'sr-2', ats_type: 'greenhouse' },
    { source_id: 'sr-3', ats_type: 'lever' },
    { source_id: 'sr-4', ats_type: 'workable' },
  ];
  const provenance = [
    { id: 'sr-1', company_name: 'Co1', review_status: 'verified', automation_eligibility: 'suitable_public_ats' },
    { id: 'sr-2', company_name: 'Co2', review_status: 'verified', automation_eligibility: 'suitable_public_ats' },
    { id: 'sr-3', company_name: 'Co3', review_status: 'verified', automation_eligibility: 'suitable_public_ats' },
    { id: 'sr-4', company_name: 'Co4', review_status: 'verified', automation_eligibility: 'suitable_public_ats' },
  ];
  const result = runAttachProvenance(sources, provenance);
  assert.equal(result.length, 4);
  for (const item of result) {
    assert.equal(item.json.approved, true, `${item.json.source_id} must be approved — its provenance row exists among the fetched rows, regardless of fetch order`);
  }
});

// ─── Build Execution Summary aggregation ──────────────────────────────────

function runBuildSummary(cfgJson, perSourceItems) {
  const node = findNode('Build Execution Summary');
  const code = node.parameters.jsCode;
  const mockDollar = (name) => {
    if (name === 'Workflow Configuration') return { first: () => ({ json: cfgJson }) };
    throw new Error(`unexpected $('${name}')`);
  };
  const mockInput = { all: () => perSourceItems.map((s) => ({ json: s })) };
  return new Function('$', '$input', code)(mockDollar, mockInput);
}

test('Build Execution Summary aggregates counts across all sources', () => {
  const cfg = { mode: 'dry_run', environment: 'local', startedAt: new Date(Date.now() - 5000).toISOString() };
  const perSource = [
    { succeeded: true, jobsFetched: 10, jobsValid: 8, jobsRejected: 2, jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0, jobsClosed: 0, retries: 0 },
    { succeeded: false, jobsFetched: 0, jobsValid: 0, jobsRejected: 0, jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0, jobsClosed: 0, retries: 1 },
  ];
  const result = runBuildSummary(cfg, perSource);
  const summary = result[0].json;
  assert.equal(summary.sourcesAttempted, 2);
  assert.equal(summary.sourcesSucceeded, 1);
  assert.equal(summary.sourcesFailed, 1);
  assert.equal(summary.jobsFetched, 10);
  assert.equal(summary.jobsValid, 8);
  assert.equal(summary.jobsRejected, 2);
  assert.equal(summary.retries, 1);
  assert.ok(summary.totalDurationMs >= 5000);
});

// ─── Finalize Source Result: shape convergence across terminal branches ───

function runFinalize(items, mergeUpsertJson) {
  const node = findNode('Finalize Source Result');
  const code = node.parameters.jsCode;
  const mockDollar = (name) => {
    if (name === 'Merge Upsert Result') {
      if (!mergeUpsertJson) throw new Error('no Merge Upsert Result in this lineage');
      return { item: { json: mergeUpsertJson } };
    }
    throw new Error(`unexpected $('${name}')`);
  };
  const mockInput = { all: () => items.map((s) => ({ json: s })) };
  return new Function('$', '$input', code)(mockDollar, mockInput);
}

test('Finalize Source Result: review-required item (no Merge Upsert Result in lineage) passes through unchanged', () => {
  const item = { source_id: 'sr-1', ats_type: 'greenhouse', outcome: 'review_required', succeeded: false, jobsFetched: 0, jobsValid: 0, jobsRejected: 0, error: 'not approved' };
  const result = runFinalize([item], null);
  assert.equal(result[0].json.outcome, 'review_required');
  assert.equal(result[0].json.succeeded, false);
});

test('Finalize Source Result: successful DB write reads Merge Upsert Result and reports jobsClosed from staleExternalIds', () => {
  const passthroughItem = { source_id: 'sr-1' };
  const mergeUpsert = {
    source_id: 'sr-1',
    ats_type: 'greenhouse',
    company_name: 'Co',
    outcome: 'fetched',
    jobsFetched: 3,
    jobsValid: 3,
    jobsRejected: 0,
    writeSucceeded: true,
    jobsCreated: 2,
    jobsUpdated: 1,
    jobsUnchanged: 0,
    staleExternalIds: ['old-1', 'old-2'],
  };
  const result = runFinalize([passthroughItem], mergeUpsert);
  const out = result[0].json;
  assert.equal(out.succeeded, true);
  assert.equal(out.jobsCreated, 2);
  assert.equal(out.jobsUpdated, 1);
  assert.equal(out.jobsClosed, 2);
});

test('Finalize Source Result: failed DB write reports db_write_failed and zero mutation counts', () => {
  const mergeUpsert = { source_id: 'sr-1', ats_type: 'greenhouse', outcome: 'fetched', jobsFetched: 1, jobsValid: 1, writeSucceeded: false, jobsCreated: 0, jobsUpdated: 0, jobsUnchanged: 0, writeError: 'connection refused' };
  const result = runFinalize([{}], mergeUpsert);
  const out = result[0].json;
  assert.equal(out.outcome, 'db_write_failed');
  assert.equal(out.succeeded, false);
  assert.equal(out.error, 'connection refused');
});

// ─── Compute Diff Plan: created/updated/unchanged/stale detection ─────────

function runComputeDiffPlan(preparedJson, existingRows) {
  const node = findNode('Compute Diff Plan');
  const code = node.parameters.jsCode;
  const mockDollar = (name) => {
    if (name === 'Prepare Bounded Write Set') return { item: { json: preparedJson } };
    throw new Error(`unexpected $('${name}')`);
  };
  // Select Existing Jobs For Source has no fullResponse wrapping, so n8n
  // auto-splits its JSON array response into one output item per row — mock
  // $input.all() accordingly, never a single .first() item wrapping an array.
  const mockInput = { all: () => existingRows.map((r) => ({ json: r })) };
  return new Function('$', '$input', code)(mockDollar, mockInput);
}

test('Compute Diff Plan: new external_id is counted as created, preserves fresh first_seen_at', () => {
  const prepared = { boundedJobs: [{ external_id: 'ext-1', title: 'A', description: 'd' }] };
  const result = runComputeDiffPlan(prepared, []);
  const plan = result[0].json;
  assert.equal(plan.diffCreated, 1);
  assert.equal(plan.diffUpdated, 0);
  assert.equal(plan.upsertPayload[0].external_id, 'ext-1');
  assert.ok(plan.upsertPayload[0].first_seen_at);
});

test('Compute Diff Plan: unchanged existing row is counted as unchanged and preserves original first_seen_at', () => {
  const prepared = { boundedJobs: [{ external_id: 'ext-1', title: 'A', description: 'd', application_url: 'u', location: null, work_arrangement: null, employment_type: null }] };
  const existing = [{ external_id: 'ext-1', title: 'A', description: 'd', application_url: 'u', location: null, work_arrangement: null, employment_type: null, first_seen_at: '2020-01-01T00:00:00Z' }];
  const result = runComputeDiffPlan(prepared, existing);
  const plan = result[0].json;
  assert.equal(plan.diffUnchanged, 1);
  assert.equal(plan.upsertPayload[0].first_seen_at, '2020-01-01T00:00:00Z');
});

test('Compute Diff Plan: changed title on existing row is counted as updated', () => {
  const prepared = { boundedJobs: [{ external_id: 'ext-1', title: 'New Title', description: 'd', application_url: 'u', location: null, work_arrangement: null, employment_type: null }] };
  const existing = [{ external_id: 'ext-1', title: 'Old Title', description: 'd', application_url: 'u', location: null, work_arrangement: null, employment_type: null, first_seen_at: '2020-01-01T00:00:00Z' }];
  const result = runComputeDiffPlan(prepared, existing);
  assert.equal(result[0].json.diffUpdated, 1);
});

test('Compute Diff Plan: existing active row absent from current fetch is marked stale (closing candidate)', () => {
  const prepared = { boundedJobs: [{ external_id: 'ext-new', title: 'A', description: 'd' }] };
  const existing = [{ external_id: 'ext-gone', title: 'B', description: 'd', first_seen_at: '2020-01-01T00:00:00Z' }];
  const result = runComputeDiffPlan(prepared, existing);
  assert.deepEqual(result[0].json.staleExternalIds, ['ext-gone']);
});

test('Compute Diff Plan: empty existing set (e.g. after a failed fetch never reaching this node) yields empty stale list', () => {
  const prepared = { boundedJobs: [{ external_id: 'ext-1', title: 'A', description: 'd' }] };
  const result = runComputeDiffPlan(prepared, []);
  assert.deepEqual(result[0].json.staleExternalIds, []);
});

test('Compute Diff Plan: all N existing rows are matched, not just the first (regression — real Supabase REST returns a JSON array that n8n auto-splits into one item per row; a real pilot run with 5 existing rows only ever saw 1 of them before this fix, wrongly reporting 4 of 5 unchanged jobs as newly "created")', () => {
  const prepared = {
    boundedJobs: [
      { external_id: 'a', title: 'A', description: 'd', application_url: 'u', location: null, work_arrangement: null, employment_type: null },
      { external_id: 'b', title: 'B', description: 'd', application_url: 'u', location: null, work_arrangement: null, employment_type: null },
      { external_id: 'c', title: 'C', description: 'd', application_url: 'u', location: null, work_arrangement: null, employment_type: null },
    ],
  };
  const existing = [
    { external_id: 'a', title: 'A', description: 'd', application_url: 'u', location: null, work_arrangement: null, employment_type: null, first_seen_at: '2020-01-01T00:00:00Z' },
    { external_id: 'b', title: 'B', description: 'd', application_url: 'u', location: null, work_arrangement: null, employment_type: null, first_seen_at: '2020-01-01T00:00:00Z' },
    { external_id: 'c', title: 'C', description: 'd', application_url: 'u', location: null, work_arrangement: null, employment_type: null, first_seen_at: '2020-01-01T00:00:00Z' },
  ];
  const result = runComputeDiffPlan(prepared, existing);
  const plan = result[0].json;
  assert.equal(plan.diffCreated, 0, 'none of these 3 should be misreported as created');
  assert.equal(plan.diffUnchanged, 3, 'all 3 pre-existing, unmodified rows must be recognized as unchanged');
});

test('Compute Diff Plan: a placeholder empty item (alwaysOutputData with zero real rows) is not mistaken for an existing row', () => {
  const node = findNode('Compute Diff Plan');
  const code = node.parameters.jsCode;
  const mockDollar = (name) => {
    if (name === 'Prepare Bounded Write Set') return { item: { json: { boundedJobs: [{ external_id: 'ext-1', title: 'A', description: 'd' }] } } };
    throw new Error(`unexpected $('${name}')`);
  };
  const mockInput = { all: () => [{ json: {} }] };
  const result = new Function('$', '$input', code)(mockDollar, mockInput);
  assert.equal(result[0].json.diffCreated, 1, 'the placeholder item must not be treated as a real existing row');
  assert.deepEqual(result[0].json.staleExternalIds, []);
});

// ─── Stale-close guard: truncated/partial/failed results must never close jobs ─

function runPrepareBoundedWriteSet(cfgJson, classifiedJson) {
  const node = findNode('Prepare Bounded Write Set');
  const code = node.parameters.jsCode;
  const mockDollar = (name) => {
    if (name === 'Workflow Configuration') return { first: () => ({ json: cfgJson }) };
    throw new Error(`unexpected $('${name}')`);
  };
  const mockInput = { first: () => ({ json: classifiedJson }) };
  return new Function('$', '$input', code)(mockDollar, mockInput);
}

test('Prepare Bounded Write Set: jobsValid exceeding the per-source cap is marked truncated', () => {
  const cfg = { maxJobsPerSource: 2 };
  const classified = {
    source_id: 'sr-1', ats_type: 'greenhouse', company_name: 'Co', outcome: 'fetched', succeeded: true,
    jobsFetched: 3, jobsValid: 3, jobsRejected: 0, retries: 0, error: null,
    normalizedJobs: [{ external_id: 'a' }, { external_id: 'b' }, { external_id: 'c' }],
  };
  const result = runPrepareBoundedWriteSet(cfg, classified);
  const out = result[0].json;
  assert.equal(out.truncated, true, 'jobsValid (3) > cap (2) must be flagged as truncated');
  assert.equal(out.boundedJobs.length, 2);
});

test('Prepare Bounded Write Set: jobsValid within the cap is not truncated', () => {
  const cfg = { maxJobsPerSource: 5 };
  const classified = {
    source_id: 'sr-1', ats_type: 'greenhouse', company_name: 'Co', outcome: 'fetched', succeeded: true,
    jobsFetched: 2, jobsValid: 2, jobsRejected: 0, retries: 0, error: null,
    normalizedJobs: [{ external_id: 'a' }, { external_id: 'b' }],
  };
  const result = runPrepareBoundedWriteSet(cfg, classified);
  assert.equal(result[0].json.truncated, false);
});

test('Prepare Bounded Write Set: a duplicate external_id from the source (regression — real Workable response returned the same shortcode twice) is collapsed to one row, keeping the first occurrence, before capping', () => {
  const cfg = { maxJobsPerSource: 5 };
  const classified = {
    source_id: 'sr-1', ats_type: 'workable', company_name: 'Co', outcome: 'fetched', succeeded: true,
    jobsFetched: 5, jobsValid: 5, jobsRejected: 0, retries: 0, error: null,
    normalizedJobs: [
      { external_id: 'dup-1', title: 'First listing' },
      { external_id: 'dup-1', title: 'Cross-listed duplicate' },
      { external_id: 'unique-2' },
      { external_id: 'unique-3' },
      { external_id: 'unique-4' },
    ],
  };
  const result = runPrepareBoundedWriteSet(cfg, classified);
  const out = result[0].json;
  const dupCount = out.boundedJobs.filter((j) => j.external_id === 'dup-1').length;
  assert.equal(dupCount, 1, 'a duplicated external_id must appear at most once in the upsert payload, or Postgres rejects the batch with "ON CONFLICT DO UPDATE command cannot affect row a second time"');
  assert.equal(out.boundedJobs.find((j) => j.external_id === 'dup-1').title, 'First listing', 'must keep the first occurrence');
  assert.equal(out.externalIdList.length, new Set(out.externalIdList).size, 'externalIdList itself must contain no duplicates');
});

test('Should Close Stale Jobs? requires truncated === false, so a truncated (bounded/incomplete) fetch can never trigger a close', () => {
  const n = findNode('Should Close Stale Jobs?');
  const conditions = n.parameters?.conditions?.conditions ?? [];
  assert.equal(n.parameters?.conditions?.combinator, 'and', 'all conditions must be AND-combined so truncated=false is mandatory, not optional');
  const truncatedCondition = conditions.find((c) => String(c.leftValue).includes('truncated'));
  assert.ok(truncatedCondition, 'a condition referencing $json.truncated must exist');
  assert.equal(truncatedCondition.operator?.operation, 'false', 'the truncated condition must require truncated === false');
  const writeSucceededCondition = conditions.find((c) => String(c.leftValue).includes('writeSucceeded'));
  assert.ok(writeSucceededCondition, 'a condition requiring writeSucceeded === true must exist (a failed/partial DB write must never close jobs)');
});

test('dry_run mode can never reach Close Stale Jobs For Source (Should Write To DB? gates the entire write branch)', () => {
  const shouldWriteOut = wf.connections['Should Write To DB?']?.main ?? [];
  const trueBranchTargets = (shouldWriteOut[0] ?? []).map((c) => c.node);
  assert.ok(!trueBranchTargets.includes('Close Stale Jobs For Source'), 'Close Stale Jobs For Source must only be reachable through the bounded-write chain, never directly from Should Write To DB?');
  assert.ok(trueBranchTargets.includes('Prepare Bounded Write Set'));
});
