/**
 * Static-analysis + pure-logic tests for the Source Intelligence Analyzer
 * workflow's PROMOTION branch (Is Auto-Promotable? / Promote Source /
 * Evaluate Promotion Attempt), plus the surrounding structural invariants
 * that make dry_run safe. Mirrors tests/workflow/registry-sync.test.mjs's
 * own pattern: reads the workflow JSON and exercises Code node jsCode
 * directly via `new Function`. No database or network connection required.
 *
 * This is the first workflow-logic test file for this workflow — it is
 * deliberately scoped to the promotion feature only, not a retroactive
 * full-pipeline suite for the pre-existing classification nodes (Detect
 * Provider Fingerprint, Evaluate Fetch Attempt, etc.), which is a known,
 * separately-tracked gap.
 *
 * Run: node --test tests/workflow/source-intelligence-analyzer.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

const JSON_PATH = resolve(ROOT, 'n8n-workflows/source-intelligence-analyzer.json');
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
  assert.equal(wf.active, false, 'Workflow must remain inactive by default in the repo');
});

test('no duplicate node names or ids', () => {
  const names = wf.nodes.map((n) => n.name);
  assert.equal(new Set(names).size, names.length, 'node names must be unique (connections are keyed by name)');
  const ids = wf.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'node ids must be unique');
});

// ─── 2. Required nodes exist, including the new promotion branch ─────────

const REQUIRED_NODES = [
  'Start Source Intelligence Run',
  'Daily Schedule Trigger',
  'Workflow Configuration',
  'Load Candidate Sources',
  'Bound Candidate Sources',
  'Process Sources',
  'Choose Fetch Target',
  'Has Fetchable URL?',
  'Fetch Source Page',
  'Evaluate Fetch Attempt',
  'Fetch Succeeded?',
  'Detect Provider Fingerprint',
  'Build No-URL Result',
  'Build Blocked Result',
  'Finalize Classification Result',
  'Is Write Mode?',
  'Insert Source Intelligence Observation',
  'Evaluate Insert Attempt',
  'Is Auto-Promotable?',
  'Promote Source',
  'Evaluate Promotion Attempt',
  'Rate Limit Delay',
  'Build Run Summary',
];

test('every required node exists, including the new promotion nodes', () => {
  for (const name of REQUIRED_NODES) findNode(name);
});

// ─── 3. Promotion branch topology ──────────────────────────────────────────

test('Evaluate Insert Attempt connects to Is Auto-Promotable? (not directly to Rate Limit Delay anymore)', () => {
  const outbound = wf.connections['Evaluate Insert Attempt']?.main?.[0] ?? [];
  assert.ok(outbound.some((c) => c.node === 'Is Auto-Promotable?'));
  assert.ok(!outbound.some((c) => c.node === 'Rate Limit Delay'), 'must route through the promotion gate first, never skip it');
});

test('Is Auto-Promotable? routes true to Promote Source, false to Rate Limit Delay', () => {
  const outputs = wf.connections['Is Auto-Promotable?']?.main ?? [];
  assert.ok(outputs[0]?.some((c) => c.node === 'Promote Source'), 'output 0 (true) must reach Promote Source');
  assert.ok(outputs[1]?.some((c) => c.node === 'Rate Limit Delay'), 'output 1 (false) must reach Rate Limit Delay, skipping promotion');
});

test('Promote Source connects to Evaluate Promotion Attempt, which connects to Rate Limit Delay', () => {
  const fromPromote = wf.connections['Promote Source']?.main?.[0] ?? [];
  assert.ok(fromPromote.some((c) => c.node === 'Evaluate Promotion Attempt'));
  const fromEvaluate = wf.connections['Evaluate Promotion Attempt']?.main?.[0] ?? [];
  assert.ok(fromEvaluate.some((c) => c.node === 'Rate Limit Delay'));
});

test('dry_run structurally never reaches Insert/Promote: Is Write Mode? false branch goes straight to Rate Limit Delay', () => {
  const outputs = wf.connections['Is Write Mode?']?.main ?? [];
  assert.ok(outputs[1]?.some((c) => c.node === 'Rate Limit Delay'), 'the false (dry_run) branch must bypass Insert/Evaluate/Promote entirely');
  assert.ok(!outputs[1]?.some((c) => c.node === 'Insert Source Intelligence Observation'));
});

test('promotion is reachable ONLY through the write-mode branch — no other path leads to Promote Source', () => {
  const incomingToPromote = Object.entries(wf.connections)
    .filter(([, v]) => (v.main ?? []).some((branch) => branch.some((c) => c.node === 'Promote Source')))
    .map(([from]) => from);
  assert.deepEqual(incomingToPromote, ['Is Auto-Promotable?'], 'Promote Source must have exactly one inbound edge, from the auto-promotable gate');
});

// ─── 4. Is Auto-Promotable? — structural rule check ────────────────────────
// IF-node conditions are not executable JS, so this asserts the exact
// clause shape rather than running it — proving the client-side gate
// matches the approved rule (ingestion_type=ats_adapter AND confidence=high
// AND detected_provider<>unknown AND insertPerformed=true) without
// duplicating a second copy of the rule's logic in this test file.

test('Is Auto-Promotable? checks exactly insertPerformed, ingestion_type=ats_adapter, confidence=high, detected_provider<>unknown (AND combinator)', () => {
  const n = findNode('Is Auto-Promotable?');
  const c = n.parameters.conditions;
  assert.equal(c.combinator, 'and');
  assert.equal(c.conditions.length, 4);

  const byLeft = Object.fromEntries(c.conditions.map((cond) => [cond.leftValue, cond]));

  assert.equal(byLeft['={{ $json.insertPerformed }}'].operator.operation, 'true');

  assert.equal(byLeft['={{ $json.ingestion_type }}'].operator.operation, 'equals');
  assert.equal(byLeft['={{ $json.ingestion_type }}'].rightValue, 'ats_adapter');

  assert.equal(byLeft['={{ $json.confidence }}'].operator.operation, 'equals');
  assert.equal(byLeft['={{ $json.confidence }}'].rightValue, 'high');

  assert.equal(byLeft['={{ $json.detected_provider }}'].operator.operation, 'notEquals');
  assert.equal(byLeft['={{ $json.detected_provider }}'].rightValue, 'unknown');
});

// ─── 5. Promote Source — calls the RPC, never a raw PATCH/UPDATE ─────────

test('Promote Source calls promote_source_intelligence_observation via RPC, never a direct PATCH on company_sources', () => {
  const n = findNode('Promote Source');
  assert.equal(n.parameters.method, 'POST');
  assert.match(n.parameters.url, /\/rest\/v1\/rpc\/promote_source_intelligence_observation$/);
  assert.match(n.parameters.jsonBody, /p_source_id:\s*\$json\.source_id/);
  assert.ok(!/\/rest\/v1\/company_sources/.test(n.parameters.url), 'must never target company_sources directly');
  assert.equal(n.onError, 'continueRegularOutput', 'a promotion failure must never crash the whole run');
});

test('Promote Source only ever sends p_source_id — never company_id, review_status, or any other field the RPC does not accept', () => {
  const n = findNode('Promote Source');
  const body = n.parameters.jsonBody;
  for (const forbidden of ['company_id', 'review_status', 'p_review_status', 'p_company_id']) {
    assert.ok(!body.includes(forbidden), `Promote Source must never send ${forbidden}`);
  }
});

// ─── 6. Credentials — declared, never bound/embedded ───────────────────────

test('no credentials block is embedded anywhere — every credential must be bound manually in n8n', () => {
  assert.ok(!wf.nodes.some((n) => n.credentials), 'no node may carry a bound credential in the repository JSON');
  assert.ok(!rawText.includes('"credentials"'), 'the raw JSON text must not contain a credentials key at all');
});

test('no secrets, credential blocks, or hardcoded keys appear in the workflow JSON', () => {
  const checks = [
    { label: 'JWT-like token', re: /eyJ[A-Za-z0-9_-]{20,}/ },
    { label: 'service_role literal value', re: /service_role.{0,20}[:=]\s*["'][^"']{10,}/i },
    { label: 'password field', re: /"password"\s*:/ },
    { label: 'Authorization header with a literal bearer value', re: /Authorization["']?\s*[:=]\s*["']Bearer [A-Za-z0-9._-]{10,}/i },
  ];
  for (const { label, re } of checks) {
    assert.ok(!re.test(rawText), `Workflow JSON appears to contain: ${label}`);
  }
});

test('no pinned execution data is present', () => {
  assert.ok(!('pinData' in wf), 'Repository JSON must not carry pinned execution data');
});

// ─── 7. Pure-logic tests — extract jsCode, execute with mocked $/$input ────

function runNode(nodeName, mockDollarImpl, inputItems, execution = { id: 'exec-1' }) {
  const code = findNode(nodeName).parameters.jsCode;
  const mockDollar = (name) => mockDollarImpl(name);
  const mockInput = {
    first: () => ({ json: inputItems[0] }),
    all: () => inputItems.map((json) => ({ json })),
  };
  return new Function('$', '$input', '$execution', code)(mockDollar, mockInput, execution);
}

// -- Finalize Classification Result: promotion fields initialized safe --

test('Finalize Classification Result: initializes promotionAttempted/promotionApplied/promotionReason to a safe not-yet-attempted default', () => {
  const out = runNode('Finalize Classification Result', () => { throw new Error('should not call $()'); }, [
    { source_id: 'sr-x', detected_provider: 'unknown', ingestion_type: 'needs_investigation', confidence: 'low' },
  ]);
  assert.equal(out[0].json.promotionAttempted, false);
  assert.equal(out[0].json.promotionApplied, false);
  assert.equal(out[0].json.promotionReason, null);
  // Existing insert-field initialization must be preserved unchanged.
  assert.equal(out[0].json.insertAttempted, false);
  assert.equal(out[0].json.insertPerformed, false);
});

// -- Evaluate Promotion Attempt --

test('Evaluate Promotion Attempt: a 2xx response with promoted=true is recorded as applied', () => {
  const out = runNode(
    'Evaluate Promotion Attempt',
    (name) => {
      if (name === 'Evaluate Insert Attempt') return { first: () => ({ json: { source_id: 'sr-x', detected_provider: 'greenhouse' } }) };
      throw new Error(`unexpected $('${name}')`);
    },
    [{ statusCode: 200, body: [{ promoted: true, reason: 'promoted', resulting_ats_provider: 'greenhouse' }] }]
  );
  assert.equal(out[0].json.promotionAttempted, true);
  assert.equal(out[0].json.promotionApplied, true);
  assert.equal(out[0].json.promotionReason, 'promoted');
  assert.equal(out[0].json.source_id, 'sr-x', 'must preserve upstream fields via spread');
});

test('Evaluate Promotion Attempt: promoted=false (not eligible) is recorded as attempted but not applied, with the RPC reason preserved', () => {
  const out = runNode(
    'Evaluate Promotion Attempt',
    () => ({ first: () => ({ json: { source_id: 'sr-x' } }) }),
    [{ statusCode: 200, body: [{ promoted: false, reason: 'not_eligible_for_auto_promotion' }] }]
  );
  assert.equal(out[0].json.promotionAttempted, true);
  assert.equal(out[0].json.promotionApplied, false);
  assert.equal(out[0].json.promotionReason, 'not_eligible_for_auto_promotion');
});

test('Evaluate Promotion Attempt: a network error is recorded as attempted, not applied, with the error message captured', () => {
  const out = runNode(
    'Evaluate Promotion Attempt',
    () => ({ first: () => ({ json: { source_id: 'sr-x' } }) }),
    [{ error: 'ETIMEDOUT' }]
  );
  assert.equal(out[0].json.promotionAttempted, true);
  assert.equal(out[0].json.promotionApplied, false);
  assert.ok(out[0].json.promotionReason.includes('ETIMEDOUT'));
});

test('Evaluate Promotion Attempt: a non-2xx status is recorded as attempted, not applied', () => {
  const out = runNode(
    'Evaluate Promotion Attempt',
    () => ({ first: () => ({ json: { source_id: 'sr-x' } }) }),
    [{ statusCode: 500, body: { message: 'internal error' } }]
  );
  assert.equal(out[0].json.promotionAttempted, true);
  assert.equal(out[0].json.promotionApplied, false);
  assert.ok(out[0].json.promotionReason.includes('internal error'));
});

// -- Build Run Summary: new promotion counters --

test('Build Run Summary: counts promotionsAttempted/promotionsApplied independently of insert counts', () => {
  const results = [
    { insertAttempted: true, insertPerformed: true, promotionAttempted: true, promotionApplied: true, outcome: undefined, detected_provider: 'greenhouse', ingestion_type: 'ats_adapter' },
    { insertAttempted: true, insertPerformed: true, promotionAttempted: true, promotionApplied: false, detected_provider: 'greenhouse', ingestion_type: 'ats_adapter' },
    { insertAttempted: true, insertPerformed: true, promotionAttempted: false, promotionApplied: false, detected_provider: 'unknown', ingestion_type: 'needs_investigation' },
    { insertAttempted: false, insertPerformed: false, promotionAttempted: false, promotionApplied: false, detected_provider: 'unknown', ingestion_type: 'needs_investigation' },
  ];
  const out = runNode('Build Run Summary', (name) => {
    if (name === 'Workflow Configuration') return { first: () => ({ json: { mode: 'write', environment: 'local', maxSourcesPerRun: 10, startedAt: new Date(Date.now() - 1000).toISOString() } }) };
    throw new Error(`unexpected $('${name}')`);
  }, results);
  const s = out[0].json;
  assert.equal(s.insertsAttempted, 3);
  assert.equal(s.insertsPerformed, 3);
  assert.equal(s.promotionsAttempted, 2, 'only the two insert-succeeded, eligible items attempted promotion');
  assert.equal(s.promotionsApplied, 1, 'only one of those two was actually promoted');
});

test('Build Run Summary: dry_run produces zero inserts and zero promotions, same as before this change', () => {
  const results = [
    { insertAttempted: false, insertPerformed: false, promotionAttempted: false, promotionApplied: false, detected_provider: 'unknown', ingestion_type: 'needs_investigation' },
  ];
  const out = runNode('Build Run Summary', (name) => {
    if (name === 'Workflow Configuration') return { first: () => ({ json: { mode: 'dry_run', environment: 'local', maxSourcesPerRun: 10, startedAt: new Date(Date.now() - 1000).toISOString() } }) };
    throw new Error(`unexpected $('${name}')`);
  }, results);
  const s = out[0].json;
  assert.equal(s.writeMode, false);
  assert.equal(s.insertsAttempted, 0);
  assert.equal(s.promotionsAttempted, 0);
  assert.equal(s.promotionsApplied, 0);
});

// ─── 8. Retry / re-analysis eligibility — Build Blocked Result's retryable computation ───
// Evidence-grounded against the 42 real historical needs_investigation
// rows (see supabase/migrations/20260924140000_add_source_intelligence_retry_eligibility.sql):
// network error, 403/429/999/5xx -> retryable; 404/401/other 4xx -> not.

test('Build Blocked Result: HTTP 429 is retryable', () => {
  const out = runNode('Build Blocked Result', () => { throw new Error('should not call $()'); }, [
    { source_id: 'sr-x', company_name: 'X', fetchUrl: 'https://example.com', httpStatus: 429, fetchError: null, existing_ats_provider: 'unknown', existing_automation_eligibility: 'unknown', runId: 'exec-1' },
  ]);
  assert.equal(out[0].json.retryable, true);
  assert.equal(out[0].json.ingestion_type, 'needs_investigation');
});

test('Build Blocked Result: HTTP 403 is retryable', () => {
  const out = runNode('Build Blocked Result', () => { throw new Error('should not call $()'); }, [
    { source_id: 'sr-x', fetchUrl: 'https://example.com', httpStatus: 403, fetchError: null, runId: 'exec-1' },
  ]);
  assert.equal(out[0].json.retryable, true);
});

test('Build Blocked Result: HTTP 999 (bot-block convention) is retryable', () => {
  const out = runNode('Build Blocked Result', () => { throw new Error('should not call $()'); }, [
    { source_id: 'sr-x', fetchUrl: 'https://example.com', httpStatus: 999, fetchError: null, runId: 'exec-1' },
  ]);
  assert.equal(out[0].json.retryable, true);
});

test('Build Blocked Result: HTTP 500/503 (server error) is retryable', () => {
  for (const status of [500, 502, 503]) {
    const out = runNode('Build Blocked Result', () => { throw new Error('should not call $()'); }, [
      { source_id: 'sr-x', fetchUrl: 'https://example.com', httpStatus: status, fetchError: null, runId: 'exec-1' },
    ]);
    assert.equal(out[0].json.retryable, true, `status ${status} must be retryable`);
  }
});

test('Build Blocked Result: a network error (no HTTP status at all) is retryable', () => {
  const out = runNode('Build Blocked Result', () => { throw new Error('should not call $()'); }, [
    { source_id: 'sr-x', fetchUrl: 'https://example.com', httpStatus: null, fetchError: 'ETIMEDOUT', runId: 'exec-1' },
  ]);
  assert.equal(out[0].json.retryable, true);
  assert.equal(out[0].json.evidence.detection_method, 'fetch_network_error');
});

test('Build Blocked Result: HTTP 404 is NOT retryable — the page genuinely does not exist', () => {
  const out = runNode('Build Blocked Result', () => { throw new Error('should not call $()'); }, [
    { source_id: 'sr-x', fetchUrl: 'https://example.com', httpStatus: 404, fetchError: null, runId: 'exec-1' },
  ]);
  assert.equal(out[0].json.retryable, false);
});

test('Build Blocked Result: HTTP 401 is NOT retryable — missing credentials this workflow will never have', () => {
  const out = runNode('Build Blocked Result', () => { throw new Error('should not call $()'); }, [
    { source_id: 'sr-x', fetchUrl: 'https://example.com', httpStatus: 401, fetchError: null, runId: 'exec-1' },
  ]);
  assert.equal(out[0].json.retryable, false);
});

test('Build Blocked Result: an unlisted 4xx (e.g. 400) is NOT retryable', () => {
  const out = runNode('Build Blocked Result', () => { throw new Error('should not call $()'); }, [
    { source_id: 'sr-x', fetchUrl: 'https://example.com', httpStatus: 400, fetchError: null, runId: 'exec-1' },
  ]);
  assert.equal(out[0].json.retryable, false);
});

// -- Build No-URL Result: always structural, never retryable --

test('Build No-URL Result: retryable is always false — a missing URL is a data problem, not transient', () => {
  const out = runNode('Build No-URL Result', () => { throw new Error('should not call $()'); }, [
    { source_id: 'sr-x', company_name: 'X', existing_ats_provider: 'unknown', existing_automation_eligibility: 'unknown', runId: 'exec-1' },
  ]);
  assert.equal(out[0].json.retryable, false);
  assert.equal(out[0].json.ingestion_type, 'needs_investigation');
});

// -- Detect Provider Fingerprint: retryable per branch --

function runFingerprint(fetchUrl, bodyText) {
  return runNode('Detect Provider Fingerprint', () => { throw new Error('should not call $()'); }, [
    { source_id: 'sr-x', company_name: 'X', fetchUrl, bodyText, httpStatus: 200, existing_ats_provider: 'unknown', existing_automation_eligibility: 'unknown', runId: 'exec-1' },
  ]);
}

test('Detect Provider Fingerprint: a known-ATS hit has retryable=null (not applicable — a successful classification)', () => {
  const out = runFingerprint('https://boards-api.greenhouse.io/v1/boards/example/jobs', '<html></html>');
  assert.equal(out[0].json.ingestion_type, 'ats_adapter');
  assert.equal(out[0].json.retryable, null);
});

test('Detect Provider Fingerprint: an html candidate (JobPosting schema) has retryable=null', () => {
  const body = '<script type="application/ld+json">{"@type":"JobPosting"}</script>';
  const out = runFingerprint('https://example.com/careers', body);
  assert.equal(out[0].json.ingestion_type, 'html');
  assert.equal(out[0].json.retryable, null);
});

test('Detect Provider Fingerprint: an SPA-shell custom_parser candidate has retryable=null', () => {
  const body = '<script></script>'.repeat(6);
  const out = runFingerprint('https://example.com/careers', body);
  assert.equal(out[0].json.ingestion_type, 'custom_parser');
  assert.equal(out[0].json.retryable, null);
});

test('Detect Provider Fingerprint: a genuinely-inconclusive needs_investigation result has retryable=false (structural, fetched fine but no signal)', () => {
  const out = runFingerprint('https://example.com/about', '<html><body>Nothing relevant here.</body></html>');
  assert.equal(out[0].json.ingestion_type, 'needs_investigation');
  assert.equal(out[0].json.retryable, false);
});

// -- Finalize Classification Result: wouldBeAutoPromotable (dry_run visibility) --

test('Finalize Classification Result: wouldBeAutoPromotable is true for a high-confidence known-ATS result', () => {
  const out = runNode('Finalize Classification Result', () => { throw new Error('should not call $()'); }, [
    { source_id: 'sr-x', company_name: 'X', detected_provider: 'greenhouse', ingestion_type: 'ats_adapter', confidence: 'high', retryable: null },
  ]);
  assert.equal(out[0].json.wouldBeAutoPromotable, true);
});

test('Finalize Classification Result: wouldBeAutoPromotable is false for medium confidence', () => {
  const out = runNode('Finalize Classification Result', () => { throw new Error('should not call $()'); }, [
    { source_id: 'sr-x', company_name: 'X', detected_provider: 'greenhouse', ingestion_type: 'ats_adapter', confidence: 'medium', retryable: null },
  ]);
  assert.equal(out[0].json.wouldBeAutoPromotable, false);
});

// -- Bound Candidate Sources: reads the new nested RPC response shape --

test('Bound Candidate Sources: reads the nested source composite and threads selectionReason/previous* through', () => {
  const out = runNode(
    'Bound Candidate Sources',
    (name) => {
      if (name === 'Workflow Configuration') return { first: () => ({ json: { maxSourcesPerRun: 10 } }) };
      throw new Error(`unexpected $('${name}')`);
    },
    [
      {
        source: { id: 'sr-retry-1', company_name: 'Retry Co', official_careers_url: 'https://example.com/careers', official_website_url: null, ats_provider: 'unknown', automation_eligibility: 'unknown', researcher_notes: null },
        selection_reason: 'retry_after_backoff',
        previous_ingestion_type: 'needs_investigation',
        previous_confidence: 'low',
        previous_analyzed_at: '2026-09-20T00:00:00.000Z',
      },
    ]
  );
  assert.equal(out[0].json.source_id, 'sr-retry-1');
  assert.equal(out[0].json.company_name, 'Retry Co');
  assert.equal(out[0].json.selectionReason, 'retry_after_backoff');
  assert.equal(out[0].json.previousIngestionType, 'needs_investigation');
  assert.equal(out[0].json.previousConfidence, 'low');
  assert.equal(out[0].json.previousAnalyzedAt, '2026-09-20T00:00:00.000Z');
});

test('Bound Candidate Sources: a never-analyzed candidate has null previous* fields', () => {
  const out = runNode(
    'Bound Candidate Sources',
    () => ({ first: () => ({ json: { maxSourcesPerRun: 10 } }) }),
    [
      {
        source: { id: 'sr-new-1', company_name: 'New Co', official_careers_url: null, official_website_url: 'https://example.com', ats_provider: 'unknown', automation_eligibility: 'unknown', researcher_notes: null },
        selection_reason: 'never_analyzed',
        previous_ingestion_type: null,
        previous_confidence: null,
        previous_analyzed_at: null,
      },
    ]
  );
  assert.equal(out[0].json.selectionReason, 'never_analyzed');
  assert.equal(out[0].json.previousIngestionType, null);
});

// -- Build Run Summary: new retry/selection visibility counters --

test('Build Run Summary: counts newSources/retriedSources and retryable/structural needsInvestigation breakdown', () => {
  const results = [
    { selectionReason: 'never_analyzed', ingestion_type: 'ats_adapter', detected_provider: 'greenhouse' },
    { selectionReason: 'never_analyzed', ingestion_type: 'needs_investigation', detected_provider: 'unknown', retryable: false },
    { selectionReason: 'retry_after_backoff', ingestion_type: 'needs_investigation', detected_provider: 'unknown', retryable: true },
    { selectionReason: 'retry_after_backoff', ingestion_type: 'ats_adapter', detected_provider: 'lever', wouldBeAutoPromotable: true },
  ];
  const out = runNode('Build Run Summary', (name) => {
    if (name === 'Workflow Configuration') return { first: () => ({ json: { mode: 'dry_run', environment: 'local', maxSourcesPerRun: 10, startedAt: new Date(Date.now() - 1000).toISOString() } }) };
    throw new Error(`unexpected $('${name}')`);
  }, results);
  const s = out[0].json;
  assert.equal(s.newSources, 2);
  assert.equal(s.retriedSources, 2);
  assert.equal(s.retryableNeedsInvestigation, 1);
  assert.equal(s.structuralNeedsInvestigation, 1, 'retryable=false counts as structural');
  assert.equal(s.wouldBeAutoPromotedDryRun, 1);
});

// ─── 9. Error Workflow attachment — documented gap, not silently missing ──
// n8n's per-workflow "Error Workflow" setting cannot be set via the SDK
// (`workflow(...).settings(...)` is rejected — confirmed this session) or
// via n8n-mcp's update_workflow (no workflow-level-settings operation
// exists). The repo JSON therefore cannot and does not represent this
// attachment — it requires one manual step in the n8n UI (Settings →
// Error Workflow → "AI Job Agent - Error Handler"), documented in both
// this workflow's own .ts header and error-handler.ts's header. This test
// pins that fact down so a future reader sees it as a known, intentional
// gap rather than rediscovering it.

test('repo JSON has no errorWorkflow setting — attachment to AI Job Agent - Error Handler is a documented manual n8n UI step, not repo-representable', () => {
  assert.equal(wf.settings.errorWorkflow, undefined, 'confirms the repo cannot represent this n8n-only setting; see this workflow\'s own header comment for the required manual step');
});
