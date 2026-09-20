/**
 * Static-analysis + pure-logic tests for the Registry Sync workflow. No
 * database or network connection required — reads the workflow JSON and
 * exercises its Code node jsCode directly via `new Function`, mirroring
 * tests/workflow/job-ingestion-pilot-orchestrator.test.mjs.
 *
 * Run: node --test tests/workflow/registry-sync.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

const JSON_PATH = resolve(ROOT, 'n8n-workflows/registry-sync.json');
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
  assert.equal(wf.active, false, 'Workflow must remain inactive by default');
});

test('a Manual Trigger node exists, and no Schedule Trigger or Webhook exists in this phase', () => {
  assert.ok(wf.nodes.some((n) => n.type === 'n8n-nodes-base.manualTrigger'), 'Must include a Manual Trigger');
  assert.ok(!wf.nodes.some((n) => n.type === 'n8n-nodes-base.scheduleTrigger'), 'Must not include a Schedule Trigger — manual activation only');
  assert.ok(!wf.nodes.some((n) => n.type === 'n8n-nodes-base.webhook'), 'Must not expose a public Webhook endpoint');
});

test('no duplicate node names or ids', () => {
  const names = wf.nodes.map((n) => n.name);
  assert.equal(new Set(names).size, names.length, 'node names must be unique (connections are keyed by name)');
  const ids = wf.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'node ids must be unique');
});

// ─── 2. Required nodes exist ───────────────────────────────────────────────

const REQUIRED_NODES = [
  'Start Registry Sync Run',
  'Workflow Configuration',
  'Manual Candidates Input',
  'Is Manual Mode?',
  'Is CSV Mode?',
  'Load Manual Candidates',
  'Parse CSV Candidates',
  'Fetch Apify Dataset',
  'Evaluate Apify Fetch',
  'Should Retry Apify Fetch?',
  'Compute Apify Backoff',
  'Apify Backoff Wait',
  'Extract Apify Candidates',
  'Normalize Candidates',
  'Process Candidates',
  'Validate Candidate',
  'Is Candidate Valid?',
  'Build Validation Failed Result',
  'Resolve Registry Candidate',
  'Classify RPC Outcome',
  'Build Run Summary',
];

test('every required node exists', () => {
  for (const name of REQUIRED_NODES) findNode(name);
});

// ─── 3. Connection topology — the exact things that must be right ─────────

test('Start Registry Sync Run connects to Workflow Configuration', () => {
  const outbound = wf.connections['Start Registry Sync Run']?.main?.[0] ?? [];
  assert.ok(outbound.some((c) => c.node === 'Workflow Configuration'));
});

test('all three input adapters converge on Normalize Candidates', () => {
  const manualOut = wf.connections['Load Manual Candidates']?.main?.[0] ?? [];
  const csvOut = wf.connections['Parse CSV Candidates']?.main?.[0] ?? [];
  const apifyOut = wf.connections['Extract Apify Candidates']?.main?.[0] ?? [];
  assert.ok(manualOut.some((c) => c.node === 'Normalize Candidates'), 'manual adapter must reach Normalize Candidates');
  assert.ok(csvOut.some((c) => c.node === 'Normalize Candidates'), 'csv adapter must reach Normalize Candidates');
  assert.ok(apifyOut.some((c) => c.node === 'Normalize Candidates'), 'apify adapter must reach Normalize Candidates');
});

test('Is Manual Mode? routes true to Load Manual Candidates, false toward Is CSV Mode?', () => {
  const outputs = wf.connections['Is Manual Mode?']?.main ?? [];
  assert.ok(outputs[0]?.some((c) => c.node === 'Load Manual Candidates'));
  assert.ok(outputs[1]?.some((c) => c.node === 'Is CSV Mode?'));
});

test('Is CSV Mode? routes true to Parse CSV Candidates, false to Fetch Apify Dataset', () => {
  const outputs = wf.connections['Is CSV Mode?']?.main ?? [];
  assert.ok(outputs[0]?.some((c) => c.node === 'Parse CSV Candidates'));
  assert.ok(outputs[1]?.some((c) => c.node === 'Fetch Apify Dataset'));
});

test('Should Retry Apify Fetch? routes true to Compute Apify Backoff (loop), false to Extract Apify Candidates (proceed)', () => {
  const outputs = wf.connections['Should Retry Apify Fetch?']?.main ?? [];
  assert.ok(outputs[0]?.some((c) => c.node === 'Compute Apify Backoff'));
  assert.ok(outputs[1]?.some((c) => c.node === 'Extract Apify Candidates'));
});

test('Apify Backoff Wait loops back to Fetch Apify Dataset (bounded retry, not a dead end)', () => {
  const outbound = wf.connections['Apify Backoff Wait']?.main?.[0] ?? [];
  assert.ok(outbound.some((c) => c.node === 'Fetch Apify Dataset'));
});

test('Process Candidates onDone connects to Build Run Summary, onEachBatch to Validate Candidate', () => {
  const outputs = wf.connections['Process Candidates']?.main ?? [];
  assert.ok(outputs[0]?.some((c) => c.node === 'Build Run Summary'), 'output 0 (done) must reach Build Run Summary');
  assert.ok(outputs[1]?.some((c) => c.node === 'Validate Candidate'), 'output 1 (each batch) must reach Validate Candidate');
});

test('Is Candidate Valid? routes true to Resolve Registry Candidate, false to Build Validation Failed Result', () => {
  const outputs = wf.connections['Is Candidate Valid?']?.main ?? [];
  assert.ok(outputs[0]?.some((c) => c.node === 'Resolve Registry Candidate'));
  assert.ok(outputs[1]?.some((c) => c.node === 'Build Validation Failed Result'));
});

test('both the valid and invalid item paths loop back into Process Candidates (next batch)', () => {
  const fromValid = wf.connections['Classify RPC Outcome']?.main?.[0] ?? [];
  const fromInvalid = wf.connections['Build Validation Failed Result']?.main?.[0] ?? [];
  assert.ok(fromValid.some((c) => c.node === 'Process Candidates'), 'a resolved item must advance the batch loop');
  assert.ok(fromInvalid.some((c) => c.node === 'Process Candidates'), 'a validation-failed item must also advance the batch loop, never dead-end the run');
});

// ─── 4. Central write-path discipline ──────────────────────────────────────

test('resolve_registry_candidate is the only write path into companies/company_sources/registry_sync_staging', () => {
  const urls = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest').map((n) => n.parameters.url);
  const writesRpc = urls.filter((u) => typeof u === 'string' && u.includes('/rest/v1/rpc/resolve_registry_candidate'));
  assert.equal(writesRpc.length, 1, 'exactly one HTTP node may call resolve_registry_candidate');
  for (const u of urls) {
    assert.ok(!/\/rest\/v1\/(companies|company_sources|registry_sync_staging)(\?|$)/.test(u), `no node may write directly to a canonical table: ${u}`);
  }
});

test('no HTTP node or Code node ever references the source_intelligence or jobs tables (documentation prose in sticky notes is exempt)', () => {
  for (const n of wf.nodes) {
    if (n.type === 'n8n-nodes-base.stickyNote') continue;
    const haystack = JSON.stringify(n.parameters);
    assert.ok(!haystack.includes('source_intelligence'), `${n.name} must never reference source_intelligence`);
    assert.ok(!/\/rest\/v1\/jobs\b/.test(haystack), `${n.name} must never reference the jobs table`);
  }
});

test('the RPC request body never includes review_status or automation_eligibility', () => {
  const rpcNode = findNode('Resolve Registry Candidate');
  const body = rpcNode.parameters.jsonBody;
  assert.ok(!body.includes('review_status'), 'review_status must never be sent by this workflow');
  assert.ok(!body.includes('automation_eligibility'), 'automation_eligibility must never be sent by this workflow');
});

test('the RPC request body matches the exact resolve_registry_candidate parameter names', () => {
  const rpcNode = findNode('Resolve Registry Candidate');
  const body = rpcNode.parameters.jsonBody;
  for (const param of [
    'p_discovery_source', 'p_company_name', 'p_country_code', 'p_official_website_url',
    'p_official_careers_url', 'p_company_id_hint', 'p_ats_provider_hint', 'p_discovery_run_id', 'p_raw_payload',
  ]) {
    assert.ok(body.includes(param), `RPC body must include ${param}`);
  }
});

// ─── 5. Credentials — declared, never bound/embedded ───────────────────────

test('no credentials block is embedded anywhere — every credential must be bound manually in n8n', () => {
  assert.ok(!wf.nodes.some((n) => n.credentials), 'no node may carry a bound credential in the repository JSON');
  assert.ok(!rawText.includes('"credentials"'), 'the raw JSON text must not contain a credentials key at all');
});

test('Resolve Registry Candidate declares supabaseApi as its credential type', () => {
  const n = findNode('Resolve Registry Candidate');
  assert.equal(n.parameters.nodeCredentialType, 'supabaseApi');
  assert.equal(n.parameters.authentication, 'predefinedCredentialType');
});

test('Fetch Apify Dataset declares httpHeaderAuth as its credential type (generic, portable, no Apify-specific credential dependency)', () => {
  const n = findNode('Fetch Apify Dataset');
  assert.equal(n.parameters.nodeCredentialType, 'httpHeaderAuth');
  assert.equal(n.parameters.authentication, 'predefinedCredentialType');
});

// ─── 6. No secrets, no production URLs ─────────────────────────────────────

test('no secrets, credential blocks, or hardcoded keys appear in the workflow JSON', () => {
  const checks = [
    { label: 'JWT-like token', re: /eyJ[A-Za-z0-9_-]{20,}/ },
    { label: 'Apify token prefix', re: /apify_api_[A-Za-z0-9]{10,}/i },
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

test('only the two documented Supabase/Apify base URLs appear — no accidental production URL', () => {
  const urlLike = rawText.match(/https?:\/\/[^\s"']+/g) ?? [];
  for (const u of urlLike) {
    const allowed =
      u.includes('host.docker.internal:55321') ||
      u.startsWith('https://api.apify.com/v2/datasets/') ||
      u.includes('example.com'); // only in placeholder/pinned output data, never a live target
    assert.ok(allowed, `Unexpected URL in workflow JSON: ${u}`);
  }
});

// ─── 7. Pure-logic tests — extract jsCode, execute with mocked $/$input ────

function runNode(nodeName, mockDollarImpl, inputItems) {
  const code = findNode(nodeName).parameters.jsCode;
  const mockDollar = (name) => mockDollarImpl(name);
  const mockInput = {
    first: () => ({ json: inputItems[0] }),
    all: () => inputItems.map((json) => ({ json })),
  };
  return new Function('$', '$input', code)(mockDollar, mockInput);
}

// -- Parse CSV Candidates --

test('Parse CSV Candidates: parses a well-formed CSV with a quoted field containing a comma', () => {
  const csv = 'company_name,country_code,official_website_url,official_careers_url\n' + '"Acme, Inc.",LB,https://acme.test,https://acme.test/careers\n';
  const out = runNode('Parse CSV Candidates', (name) => {
    if (name === 'Workflow Configuration') return { first: () => ({ json: { csvContent: csv } }) };
    throw new Error(`unexpected $('${name}')`);
  }, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].json.discovery_source, 'csv');
  assert.equal(out[0].json.raw.company_name, 'Acme, Inc.');
  assert.equal(out[0].json.raw.country_code, 'LB');
});

test('Parse CSV Candidates: a missing column value becomes an empty string, not a crash, not a dropped row', () => {
  const csv = 'company_name,country_code,official_website_url,official_careers_url\n' + 'No URL Co,LB,,\n';
  const out = runNode('Parse CSV Candidates', () => ({ first: () => ({ json: { csvContent: csv } }) }), []);
  assert.equal(out.length, 1);
  assert.equal(out[0].json.raw.official_careers_url, '');
});

test('Parse CSV Candidates: empty csvContent produces zero rows, not an error', () => {
  const out = runNode('Parse CSV Candidates', () => ({ first: () => ({ json: { csvContent: '' } }) }), []);
  assert.deepEqual(out, []);
});

test('Parse CSV Candidates: duplicate rows in the same CSV both pass through unchanged (dedup is the RPC\'s job, not the parser\'s)', () => {
  const csv =
    'company_name,country_code,official_website_url,official_careers_url\n' +
    'Dup Co,LB,https://dup.test,https://dup.test/careers\n' +
    'Dup Co,LB,https://dup.test,https://dup.test/careers\n';
  const out = runNode('Parse CSV Candidates', () => ({ first: () => ({ json: { csvContent: csv } }) }), []);
  assert.equal(out.length, 2, 'the parser itself must not deduplicate — resolve_registry_candidate does');
});

// -- Normalize Candidates --

test('Normalize Candidates: maps manual/csv/apify raw shapes into the identical common contract', () => {
  const cfgDollar = (name) => {
    if (name === 'Workflow Configuration') return { first: () => ({ json: { maxCandidatesPerRun: 25 } }) };
    throw new Error(`unexpected $('${name}')`);
  };
  const items = [
    { discovery_source: 'manual', raw: { company_name: 'Manual Co', country_code: 'LB', official_website_url: 'https://m.test', official_careers_url: 'https://m.test/careers' } },
    { discovery_source: 'csv', raw: { company_name: 'CSV Co', country_code: 'AE', official_website_url: 'https://c.test', official_careers_url: '' } },
    { discovery_source: 'apify', raw: { name: 'Apify Co', country: 'QA', website: 'https://a.test', careers_url: 'https://a.test/careers' } },
  ];
  const out = runNode('Normalize Candidates', cfgDollar, items);
  assert.equal(out.length, 3);
  assert.equal(out[0].json.company_name, 'Manual Co');
  assert.equal(out[1].json.official_careers_url, null, 'blank string must normalize to null, not an empty string');
  assert.equal(out[2].json.company_name, 'Apify Co', 'apify\'s "name" field maps to company_name');
  assert.equal(out[2].json.country_code, 'QA', 'apify\'s "country" field maps to country_code');
  assert.equal(out[2].json.official_website_url, 'https://a.test', 'apify\'s "website" field maps to official_website_url');
  for (const item of out) {
    assert.ok('raw_payload' in item.json, 'raw provenance must be preserved for staging/debugging');
  }
});

test('Normalize Candidates: enforces maxCandidatesPerRun as a hard bound regardless of adapter', () => {
  const cfgDollar = () => ({ first: () => ({ json: { maxCandidatesPerRun: 2 } }) });
  const items = Array.from({ length: 10 }, (_, i) => ({ discovery_source: 'csv', raw: { company_name: `Co ${i}` } }));
  const out = runNode('Normalize Candidates', cfgDollar, items);
  assert.equal(out.length, 2, 'must never process more than maxCandidatesPerRun candidates in one execution');
});

// -- Validate Candidate --

test('Validate Candidate: a present company_name is valid', () => {
  const out = runNode('Validate Candidate', () => { throw new Error('should not call $()'); }, [{ company_name: 'Real Co' }]);
  assert.equal(out[0].json.validationStatus, 'valid');
  assert.equal(out[0].json.validationReason, null);
});

test('Validate Candidate: a missing or blank company_name is validation_failed', () => {
  for (const bad of [{ company_name: null }, { company_name: '' }, { company_name: '   ' }, {}]) {
    const out = runNode('Validate Candidate', () => { throw new Error('should not call $()'); }, [bad]);
    assert.equal(out[0].json.validationStatus, 'validation_failed');
    assert.ok(out[0].json.validationReason.includes('company_name'));
  }
});

test('Validate Candidate: does not itself reject a missing/invalid country or URL — that is the RPC\'s job', () => {
  const out = runNode('Validate Candidate', () => { throw new Error('should not call $()'); }, [{ company_name: 'Real Co', country_code: null, official_careers_url: null }]);
  assert.equal(out[0].json.validationStatus, 'valid', 'country/URL problems must reach the RPC, never be pre-filtered here');
});

// -- Classify RPC Outcome --

function runClassify(candidateJson, respJson) {
  return runNode('Classify RPC Outcome', (name) => {
    if (name === 'Validate Candidate') return { first: () => ({ json: candidateJson }) };
    throw new Error(`unexpected $('${name}')`);
  }, [respJson]);
}

test('Classify RPC Outcome: a 2xx response with outcome=created_new is classified created_new, not a failure', () => {
  const out = runClassify(
    { discovery_source: 'manual', company_name: 'Co', country_code: 'LB' },
    { statusCode: 200, body: [{ outcome: 'created_new', out_company_id: 'cc-co', out_source_id: 'sr-lb-co', out_staging_id: null }] }
  );
  assert.equal(out[0].json.outcome, 'created_new');
  assert.equal(out[0].json.company_id, 'cc-co');
});

test('Classify RPC Outcome: outcome=staged is classified staged, never treated as a failure', () => {
  const out = runClassify(
    { discovery_source: 'apify', company_name: 'Ambiguous Co', country_code: 'LB' },
    { statusCode: 200, body: [{ outcome: 'staged', out_company_id: null, out_source_id: null, out_staging_id: 'st-1' }] }
  );
  assert.equal(out[0].json.outcome, 'staged');
  assert.equal(out[0].json.staging_id, 'st-1');
});

test('Classify RPC Outcome: a network error is classified infrastructure_failed, distinct from a business outcome', () => {
  const out = runClassify({ discovery_source: 'csv', company_name: 'Co', country_code: 'LB' }, { error: 'ETIMEDOUT' });
  assert.equal(out[0].json.outcome, 'infrastructure_failed');
  assert.ok(out[0].json.reason.includes('ETIMEDOUT'));
});

test('Classify RPC Outcome: a non-2xx status is classified infrastructure_failed', () => {
  const out = runClassify({ discovery_source: 'csv', company_name: 'Co', country_code: 'LB' }, { statusCode: 500, body: { message: 'internal error' } });
  assert.equal(out[0].json.outcome, 'infrastructure_failed');
  assert.ok(out[0].json.reason.includes('internal error'));
});

// -- Build Validation Failed Result --

test('Build Validation Failed Result: outcome is validation_failed, never null/empty', () => {
  const out = runNode('Build Validation Failed Result', () => { throw new Error('should not call $()'); }, [
    { discovery_source: 'manual', company_name: '', country_code: null, validationReason: 'company_name is required and was missing or blank' },
  ]);
  assert.equal(out[0].json.outcome, 'validation_failed');
  assert.equal(out[0].json.company_id, null);
  assert.equal(out[0].json.source_id, null);
});

// -- Evaluate Apify Fetch --

function runEvaluateApifyFetch(datasetId, priorAttempt, resp) {
  return runNode('Evaluate Apify Fetch', (name) => {
    if (name === 'Compute Apify Backoff') {
      if (priorAttempt == null) throw new Error('no prior attempt (first try)');
      return { item: { json: { attempt: priorAttempt } } };
    }
    if (name === 'Workflow Configuration') return { first: () => ({ json: { apifyDatasetId: datasetId } }) };
    throw new Error(`unexpected $('${name}')`);
  }, [resp]);
}

test('Evaluate Apify Fetch: no dataset id configured -> not retried, clearly labeled, never a silent empty success', () => {
  const out = runEvaluateApifyFetch('', null, { statusCode: 200, body: [] });
  assert.equal(out[0].json.succeeded, false);
  assert.equal(out[0].json.shouldRetry, false);
  assert.equal(out[0].json.error, 'apify_dataset_id_not_configured');
});

test('Evaluate Apify Fetch: a 2xx response with a real array body succeeds', () => {
  const out = runEvaluateApifyFetch('abc123', null, { statusCode: 200, body: [{ company_name: 'X' }] });
  assert.equal(out[0].json.succeeded, true);
  assert.equal(out[0].json.items.length, 1);
});

test('Evaluate Apify Fetch: a timeout is retryable while under the attempt cap', () => {
  const out = runEvaluateApifyFetch('abc123', null, { error: 'ETIMEDOUT' });
  assert.equal(out[0].json.shouldRetry, true);
});

test('Evaluate Apify Fetch: HTTP 429 is retryable', () => {
  const out = runEvaluateApifyFetch('abc123', 2, { statusCode: 429 });
  assert.equal(out[0].json.shouldRetry, true);
});

test('Evaluate Apify Fetch: a genuine 401/404 is never retried', () => {
  const out401 = runEvaluateApifyFetch('abc123', null, { statusCode: 401 });
  assert.equal(out401[0].json.shouldRetry, false);
  const out404 = runEvaluateApifyFetch('abc123', null, { statusCode: 404 });
  assert.equal(out404[0].json.shouldRetry, false);
});

test('Evaluate Apify Fetch: retries are bounded — the 4th attempt is never marked retryable again', () => {
  const out = runEvaluateApifyFetch('abc123', 4, { error: 'ETIMEDOUT' });
  assert.equal(out[0].json.shouldRetry, false, 'must not retry forever');
});

// -- Compute Apify Backoff --

test('Compute Apify Backoff: delay grows exponentially and stays capped', () => {
  const out1 = runNode('Compute Apify Backoff', () => { throw new Error('no $() calls'); }, [{ attempt: 1 }]);
  const out2 = runNode('Compute Apify Backoff', () => { throw new Error('no $() calls'); }, [{ attempt: 2 }]);
  const out3 = runNode('Compute Apify Backoff', () => { throw new Error('no $() calls'); }, [{ attempt: 3 }]);
  assert.ok(out1[0].json.delayMs >= 1000 && out1[0].json.delayMs <= 1250);
  assert.ok(out2[0].json.delayMs >= 2000 && out2[0].json.delayMs <= 2500);
  assert.ok(out3[0].json.delayMs >= 4000 && out3[0].json.delayMs <= 5000);
  assert.equal(out1[0].json.attempt, 2);
});

// -- Extract Apify Candidates --

test('Extract Apify Candidates: a failed fetch (never succeeded) yields zero candidates, not fabricated ones', () => {
  const out = runNode('Extract Apify Candidates', (name) => {
    if (name === 'Evaluate Apify Fetch') return { first: () => ({ json: { succeeded: false, items: [] } }) };
    if (name === 'Workflow Configuration') return { first: () => ({ json: { apifyMaxItems: 50 } }) };
    throw new Error(`unexpected $('${name}')`);
  }, []);
  assert.deepEqual(out, []);
});

test('Extract Apify Candidates: bounds items by apifyMaxItems even if the dataset ignored the limit query param', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ company_name: `Co ${i}` }));
  const out = runNode('Extract Apify Candidates', (name) => {
    if (name === 'Evaluate Apify Fetch') return { first: () => ({ json: { succeeded: true, items } }) };
    if (name === 'Workflow Configuration') return { first: () => ({ json: { apifyMaxItems: 3 } }) };
    throw new Error(`unexpected $('${name}')`);
  }, []);
  assert.equal(out.length, 3);
  assert.ok(out.every((i) => i.json.discovery_source === 'apify'));
});

// -- Build Run Summary --

test('Build Run Summary: counts every outcome category independently and lists failed items without dumping raw payloads', () => {
  const results = [
    { outcome: 'created_new', company_name: 'A', reason: null },
    { outcome: 'resolved_existing', company_name: 'B', reason: null },
    { outcome: 'staged', company_name: 'C', reason: null },
    { outcome: 'validation_failed', company_name: '', reason: 'company_name is required and was missing or blank' },
    { outcome: 'infrastructure_failed', company_name: 'D', reason: 'ETIMEDOUT' },
  ];
  const out = runNode('Build Run Summary', (name) => {
    if (name === 'Workflow Configuration') return { first: () => ({ json: { discoveryRunId: 'run-1', mode: 'csv', environment: 'local', startedAt: new Date(Date.now() - 1000).toISOString() } }) };
    throw new Error(`unexpected $('${name}')`);
  }, results);
  const s = out[0].json;
  assert.equal(s.inputCount, 5);
  assert.equal(s.createdNew, 1);
  assert.equal(s.resolvedExisting, 1);
  assert.equal(s.staged, 1);
  assert.equal(s.validationFailed, 1);
  assert.equal(s.infrastructureFailed, 1);
  assert.equal(s.validCount, 4, 'validCount excludes only validation_failed, staged/infra-failed still count as processed candidates');
  assert.equal(s.failedItems.length, 2);
  assert.ok(!('raw_payload' in s.failedItems[0]), 'summary must never carry full raw payloads');
});
