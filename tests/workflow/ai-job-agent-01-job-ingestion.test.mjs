/**
 * Static-analysis tests for the "AI Job Guide / 01 Job Ingestion" workflow
 * (Phase 04, extended Phase 12/13). No database or n8n connection required —
 * reads the exported workflow JSON directly, mirroring
 * tests/workflow/job-ingestion-pilot-orchestrator.test.mjs. All validation/
 * mapping/dedup/persistence logic itself is covered by
 * tests/unit/raw-provider-job.test.mjs, tests/unit/ingestion-providers.test.mjs,
 * tests/unit/multi-company-provider-job.test.mjs, tests/unit/provider-config.test.mjs,
 * tests/unit/extract-career-page-job-postings.test.mjs, tests/unit/derive-ats-feed-url.test.mjs,
 * tests/db/find-eligible-company-sources.test.mjs, tests/db/find-career-page-extraction-candidates.test.mjs,
 * tests/db/ingestion-core-batch.test.mjs, and tests/db/ingest-multi-company-batch.test.mjs
 * — this file only checks that the workflow graph wires those into n8n
 * correctly across all three tiers (retry, rate limiting, error handling,
 * dynamic source discovery, and the Phase 13 fan-out to Tier D/Tier B).
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

// n8n's real API fetch (confirmed this phase, 2026-10-16 production-
// readiness audit) never serializes a switch rule's authoring-time
// `outputKey` label — it is an SDK/UI-only display name, not part of the
// stored node. Case routing is positional (rule index === connection
// output index), so these tests assert on each rule's actual condition
// (rightValue) in order instead of a field that doesn't survive a live
// round-trip.
function switchCaseValues(switchNode) {
  return switchNode.parameters.rules.values.map((v) => v.conditions.conditions[0].rightValue);
}

// Same live-round-trip reality for splitInBatches: n8n omits `batchSize`
// entirely from a GET when it equals the node's own default (1), rather
// than writing it explicitly — confirmed by direct comparison against this
// workflow's live MCP fetch. Treat "absent" and "1" as the same thing.
function assertBatchesOneAtATime(loopNode) {
  assert.equal(loopNode.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loopNode.parameters.batchSize ?? 1, 1);
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

test('exactly one Manual Trigger and exactly one Schedule Trigger (production daily cadence, added alongside the manual entry point for testing/admin use)', () => {
  const manualTriggers = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.manualTrigger');
  assert.equal(manualTriggers.length, 1);
  const scheduleTriggers = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
  assert.equal(scheduleTriggers.length, 1, 'exactly one Schedule Trigger — the daily production cadence');
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

test('List Ingestion Sources fans out to all three tiers (Phase 13) from the same success output — a single discovery call drives Tier A, Tier D, and Tier B', () => {
  const success = wf.connections['List Ingestion Sources']?.main?.[0] ?? [];
  assert.ok(success.some((c) => c.node === 'Split Out Sources'), 'Tier A branch missing');
  assert.ok(success.some((c) => c.node === 'Split Out Multi-Company Sources'), 'Tier D branch missing');
  assert.ok(success.some((c) => c.node === 'Split Out Career Page Candidates'), 'Tier B branch missing');
  assert.equal(success.length, 3, 'exactly three branches must fan out from List Ingestion Sources, no more, no fewer');
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
  for (const name of ['Extract Greenhouse Jobs', 'Extract Lever Jobs', 'Extract Workable Jobs', 'Extract Ashby Jobs', 'Extract Oracle HCM Jobs']) {
    const node = findNode(name);
    assert.equal(node.onError, 'continueErrorOutput', `${name} must continue to its error output, not stop the workflow`);
  }
});

test('every fallible node error output is wired to a Build *Result node, never left hanging', () => {
  const fallible = ['Fetch Source Jobs', 'Call Ingestion Batch Endpoint', 'Extract Greenhouse Jobs', 'Extract Lever Jobs', 'Extract Workable Jobs', 'Extract Ashby Jobs', 'Extract Oracle HCM Jobs'];
  for (const name of fallible) {
    const conns = wf.connections[name]?.main ?? [];
    const errorOutput = conns[1] ?? [];
    assert.ok(errorOutput.length > 0, `${name}'s error output (index 1) must be wired to a failure-result node`);
  }
});

test('Extract Jobs By ATS Type has ashby and oracle_hcm cases (Phase 13/16) routing to their own extraction nodes, alongside greenhouse/lever/workable, with the fallback still catching anything else', () => {
  const switchNode = findNode('Extract Jobs By ATS Type');
  assert.deepEqual(switchCaseValues(switchNode), ['greenhouse', 'lever', 'workable', 'ashby', 'oracle_hcm']);
  const conns = wf.connections['Extract Jobs By ATS Type']?.main ?? [];
  assert.equal(conns.length, 6, 'five defined cases plus one fallback output');
  assert.ok(conns[3]?.some((c) => c.node === 'Extract Ashby Jobs'), 'the ashby case (index 3) must route to Extract Ashby Jobs');
  assert.ok(conns[4]?.some((c) => c.node === 'Extract Oracle HCM Jobs'), 'the oracle_hcm case (index 4) must route to Extract Oracle HCM Jobs');
  assert.ok(conns[5]?.some((c) => c.node === 'Build Unsupported Source Result'), 'the fallback (index 5) must still route to Build Unsupported Source Result');
});

test('Extract Oracle HCM Jobs derives a real candidate-facing apply URL from feed_url and stamps it onto every raw job, then feeds the shared Call Ingestion Batch Endpoint (Phase 16)', () => {
  const node = findNode('Extract Oracle HCM Jobs');
  assert.equal(node.type, 'n8n-nodes-base.set');
  assert.equal(node.onError, 'continueErrorOutput');
  const value = node.parameters.assignments.assignments[0].value;
  assert.match(value, /candidateSiteUrl/, 'must derive and stamp candidateSiteUrl onto each raw job — Oracle\'s REST response carries no candidate-facing URL of its own');
  assert.match(value, /requisitionList/, 'must read the real nested job list shape (items[0].requisitionList), not assume a flat array');
  assert.ok(wf.connections['Extract Oracle HCM Jobs']?.main?.[0]?.some((c) => c.node === 'Call Ingestion Batch Endpoint'), 'success output must feed the shared Tier-A endpoint');
  assert.ok(wf.connections['Extract Oracle HCM Jobs']?.main?.[1]?.some((c) => c.node === 'Build Fetch Failure Result'), 'error output must be wired, never left hanging');
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
  assertBatchesOneAtATime(findNode('Loop Sources (Rate Limited)'));
});

// ── Tier D: multi-company feeds (Phase 13) ─────────────────────────────

test('Fetch Multi-Company Feed has native retry and continues on error', () => {
  const node = findNode('Fetch Multi-Company Feed');
  assert.equal(node.retryOnFail, true);
  assert.ok(node.maxTries >= 2 && node.maxTries <= 5);
  assert.ok(node.waitBetweenTries <= 5000);
  assert.equal(node.onError, 'continueErrorOutput');
});

test('Extract Raw Jobs By Provider Type routes remoteok/jobicy/arbeitnow to their own normalization branch, with a defensive fallback', () => {
  const switchNode = findNode('Extract Raw Jobs By Provider Type');
  assert.deepEqual(switchCaseValues(switchNode), ['remoteok', 'jobicy', 'arbeitnow']);
  const conns = wf.connections['Extract Raw Jobs By Provider Type']?.main ?? [];
  assert.equal(conns.length, 4, 'three defined cases plus one fallback output');
  assert.ok(conns[0]?.some((c) => c.node === 'Aggregate RemoteOK Jobs'));
  assert.ok(conns[1]?.some((c) => c.node === 'Split Out Jobicy Jobs'));
  assert.ok(conns[2]?.some((c) => c.node === 'Split Out Arbeitnow Jobs'));
  assert.ok(conns[3]?.some((c) => c.node === 'Build Multi-Company Failure Result'), 'fallback must never be left hanging, even though providerConfig.ts never actually emits an unknown provider_type');
});

test('all three multi-company provider branches normalize to a common {jobs:[...]} shape before converging on Call Multi-Company Batch Endpoint', () => {
  assert.ok(wf.connections['Aggregate RemoteOK Jobs']?.main?.[0]?.some((c) => c.node === 'Call Multi-Company Batch Endpoint'));
  assert.ok(wf.connections['Aggregate Jobicy Jobs']?.main?.[0]?.some((c) => c.node === 'Call Multi-Company Batch Endpoint'));
  assert.ok(wf.connections['Aggregate Arbeitnow Jobs']?.main?.[0]?.some((c) => c.node === 'Call Multi-Company Batch Endpoint'));
});

test('Arbeitnow branch splits its data array, filters to remote:true only, then aggregates back into one item', () => {
  const splitNode = findNode('Split Out Arbeitnow Jobs');
  assert.equal(splitNode.parameters.fieldToSplitOut, 'data');
  assert.ok(wf.connections['Split Out Arbeitnow Jobs']?.main?.[0]?.some((c) => c.node === 'Filter Arbeitnow Remote Only'));
  const filterNode = findNode('Filter Arbeitnow Remote Only');
  assert.equal(filterNode.type, 'n8n-nodes-base.filter');
  assert.ok(wf.connections['Filter Arbeitnow Remote Only']?.main?.[0]?.some((c) => c.node === 'Aggregate Arbeitnow Jobs'));
});

test('Call Multi-Company Batch Endpoint posts to the run-multi-company-batch route with Bearer auth, retries, and continues on error', () => {
  const node = findNode('Call Multi-Company Batch Endpoint');
  assert.equal(node.parameters.method, 'POST');
  assert.match(node.parameters.url, /\/api\/internal\/ingestion\/run-multi-company-batch$/);
  assert.equal(node.parameters.authentication, 'genericCredentialType');
  assert.equal(node.parameters.genericAuthType, 'httpBearerAuth');
  assert.equal(node.retryOnFail, true);
  assert.equal(node.onError, 'continueErrorOutput');
});

test('every fallible Tier-D node error output is wired to Build Multi-Company Failure Result, never left hanging', () => {
  for (const name of ['Fetch Multi-Company Feed', 'Call Multi-Company Batch Endpoint']) {
    const errorOutput = wf.connections[name]?.main?.[1] ?? [];
    assert.ok(errorOutput.some((c) => c.node === 'Build Multi-Company Failure Result'), `${name}'s error output must be wired`);
  }
});

test('both Tier-D result paths converge on Record Multi-Company Source Result, which rate-limits before looping back', () => {
  for (const name of ['Build Multi-Company Success Result', 'Build Multi-Company Failure Result']) {
    assert.ok(wf.connections[name]?.main?.[0]?.some((c) => c.node === 'Record Multi-Company Source Result'), `${name} must feed Record Multi-Company Source Result`);
  }
  assert.ok(wf.connections['Record Multi-Company Source Result']?.main?.[0]?.some((c) => c.node === 'Multi-Company Rate Limit Delay'));
  assert.ok(wf.connections['Multi-Company Rate Limit Delay']?.main?.[0]?.some((c) => c.node === 'Loop Multi-Company Sources (Rate Limited)'));
});

test('the Tier-D loop batches one provider at a time', () => {
  assertBatchesOneAtATime(findNode('Loop Multi-Company Sources (Rate Limited)'));
});

// ── Tier B: career-page extraction (Phase 13) ──────────────────────────

test('Fetch Career Page HTML fetches as plain text (not JSON) with retry and error handling', () => {
  const node = findNode('Fetch Career Page HTML');
  assert.equal(node.parameters.options?.response?.response?.responseFormat, 'text');
  assert.equal(node.parameters.options?.response?.response?.outputPropertyName, 'html');
  assert.equal(node.retryOnFail, true);
  assert.equal(node.onError, 'continueErrorOutput');
});

test('Call Extract Career Page Jobs Endpoint posts to the extraction route, then Call Career Page Ingestion Batch Endpoint reuses the shared run-batch route with sourceType career_page', () => {
  const extractNode = findNode('Call Extract Career Page Jobs Endpoint');
  assert.match(extractNode.parameters.url, /\/api\/internal\/ingestion\/extract-career-page-jobs$/);
  assert.equal(extractNode.parameters.authentication, 'genericCredentialType');

  const batchNode = findNode('Call Career Page Ingestion Batch Endpoint');
  assert.match(batchNode.parameters.url, /\/api\/internal\/ingestion\/run-batch$/);
  assert.match(batchNode.parameters.jsonBody, /sourceType:\s*'career_page'/);
});

test('the career-page chain is fully wired: fetch -> extract -> ingest, each error output landing on Build Career Page Failure Result', () => {
  assert.ok(wf.connections['Fetch Career Page HTML']?.main?.[0]?.some((c) => c.node === 'Call Extract Career Page Jobs Endpoint'));
  assert.ok(wf.connections['Call Extract Career Page Jobs Endpoint']?.main?.[0]?.some((c) => c.node === 'Call Career Page Ingestion Batch Endpoint'));
  for (const name of ['Fetch Career Page HTML', 'Call Extract Career Page Jobs Endpoint', 'Call Career Page Ingestion Batch Endpoint']) {
    const errorOutput = wf.connections[name]?.main?.[1] ?? [];
    assert.ok(errorOutput.some((c) => c.node === 'Build Career Page Failure Result'), `${name}'s error output must be wired`);
  }
});

test('Build Career Page Success Result treats no_valid_jobs as success, not a failure — an honest zero is not an error', () => {
  const node = findNode('Build Career Page Success Result');
  const succeededField = node.parameters.assignments.assignments.find((a) => a.name === 'succeeded');
  assert.match(succeededField.value, /no_valid_jobs/);
});

test('both Tier-B result paths converge on Record Career Page Source Result, which rate-limits before looping back', () => {
  for (const name of ['Build Career Page Success Result', 'Build Career Page Failure Result']) {
    assert.ok(wf.connections[name]?.main?.[0]?.some((c) => c.node === 'Record Career Page Source Result'), `${name} must feed Record Career Page Source Result`);
  }
  assert.ok(wf.connections['Record Career Page Source Result']?.main?.[0]?.some((c) => c.node === 'Career Page Rate Limit Delay'));
  assert.ok(wf.connections['Career Page Rate Limit Delay']?.main?.[0]?.some((c) => c.node === 'Loop Career Page Candidates (Rate Limited)'));
});

test('the Tier-B loop batches one candidate at a time', () => {
  assertBatchesOneAtATime(findNode('Loop Career Page Candidates (Rate Limited)'));
});

test('exactly 102 nodes total (98 prior + 4 new nodes for the GulfTalent missing/invalid-ID guard fix)', () => {
  assert.equal(wf.nodes.length, 102);
});

test('Apify multi-company branch (Phase 21) is fully isolated — its own seed, split, loop, actor call, aggregate, batch endpoint, success/failure builders, and rate limiter', () => {
  for (const name of [
    'Apify Multi-Company Source Seeds',
    'Split Out Apify Sources',
    'Loop Apify Sources (Rate Limited)',
    'Call Apify Actor',
    'Aggregate Apify Jobs',
    'Call Apify Batch Endpoint',
    'Build Apify Success Result',
    'Build Apify Failure Result',
    'Record Apify Source Result',
    'Apify Rate Limit Delay',
  ]) {
    findNode(name);
  }

  assert.ok(wf.connections['Workflow Configuration'].main[0].some((c) => c.node === 'Apify Multi-Company Source Seeds'), 'Workflow Configuration must fan out to the Apify seed node');
  assert.ok(wf.connections['Loop Apify Sources (Rate Limited)'].main[1].some((c) => c.node === 'Call Apify Actor'), 'the loop branch (index 1) must feed Call Apify Actor');
  assert.ok(wf.connections['Call Apify Actor'].main[0].some((c) => c.node === 'Aggregate Apify Jobs'), 'success output must feed Aggregate Apify Jobs');
  assert.ok(wf.connections['Call Apify Actor'].main[1].some((c) => c.node === 'Build Apify Failure Result'), 'error output must feed Build Apify Failure Result');
  assert.ok(wf.connections['Apify Rate Limit Delay'].main[0].some((c) => c.node === 'Loop Apify Sources (Rate Limited)'), 'the delay must loop back to Loop Apify Sources');

  const callApifyBatchEndpoint = findNode('Call Apify Batch Endpoint');
  assert.match(callApifyBatchEndpoint.parameters.jsonBody, /Split Out Apify Sources/, "Call Apify Batch Endpoint's sourceType expression must resolve its own branch's Split Out node, not the Tier D branch's");
});

// Phase 2 hardening fix: Call Apify Actor is the shared paid, non-idempotent
// run-sync-get-dataset-items call for Bayt/Indeed (both real, confirmed
// PAY_PER_EVENT actors — GulfTalent moved to its own async/polling branch,
// see the GulfTalent reliability-fix tests below). A transport-level retry
// on this 60s-timeout node could start a second full-price actor run while
// the first is still executing/billing — the exact same reasoning already
// correctly applied to Call Data-Slayer Actor below.
test('Call Apify Actor exists exactly once and never auto-retries (paid, non-idempotent actor call shared by Bayt/Indeed)', () => {
  const occurrences = wf.nodes.filter((n) => n.name === 'Call Apify Actor').length;
  assert.equal(occurrences, 1, 'the actor node must appear exactly once — no duplicate/hidden call path');

  const node = findNode('Call Apify Actor');
  assert.equal(node.retryOnFail, false, 'a paid, non-idempotent actor call must never auto-retry (AGENTS.md §18)');

  // Both real remaining seeds (Bayt, Indeed) route through this one shared
  // node via the loop's error-output index 1. GulfTalent no longer does.
  assert.ok(wf.connections['Loop Apify Sources (Rate Limited)'].main[1].some((c) => c.node === 'Call Apify Actor'), 'Bayt/Indeed must still route through the same shared actor node');

  // Downstream failure routing remains intact regardless of the retry fix —
  // onError still reaches an explicit terminal, the branch never silently
  // disappears.
  assert.ok(wf.connections['Call Apify Actor'].main[0].some((c) => c.node === 'Aggregate Apify Jobs'), 'success output must still feed Aggregate Apify Jobs');
  assert.ok(wf.connections['Call Apify Actor'].main[1].some((c) => c.node === 'Build Apify Failure Result'), 'error output must still feed Build Apify Failure Result, never left hanging');
});

// Phase 2 cost-safety hardening: Bayt/Indeed are real, confirmed
// PAY_PER_EVENT actors (free pricing-metadata GET, re-verified live twice
// this phase) — same mechanism Call Data-Slayer Actor already uses.
// GulfTalent's own cost-cap derivation is tested separately below (its own
// seed list, its own async-start node). Per-item prices below are the
// real, live-verified values (apify-default-dataset-item), not assumed.
// Each seed's maxTotalChargeUsd is actor-start (one-time) + max_jobs_per_run
// * per-item — the actor-start term is not an arbitrary buffer; omitting it
// would make the cap trigger before a run that returns exactly
// max_jobs_per_run items finishes.
const APIFY_ACTOR_START_USD = { bayt: 0.0005, indeed: 0.0001 };
const APIFY_PER_ITEM_USD = { bayt: 0.00099, indeed: 0.0001 };

function getApifySeeds() {
  const seedsNode = findNode('Apify Multi-Company Source Seeds');
  const parsed = JSON.parse(seedsNode.parameters.jsonOutput);
  return parsed.apify_sources;
}

function getGulfTalentSeeds() {
  const seedsNode = findNode('GulfTalent Source Seeds');
  const parsed = JSON.parse(seedsNode.parameters.jsonOutput);
  return parsed.gulftalent_sources;
}

test('Call Apify Actor derives maxTotalChargeUsd dynamically from each seed, never a hardcoded shared value', () => {
  const node = findNode('Call Apify Actor');
  assert.match(node.parameters.url, /\$json\.actor_url/, 'must still build the URL from the seed\'s own actor_url');
  assert.match(node.parameters.url, /maxTotalChargeUsd=.*\$json\.max_total_charge_usd/, 'maxTotalChargeUsd must be appended dynamically per-seed, mirroring Call Data-Slayer Actor\'s own pattern');
  // request_body (maxResults/count) must be preserved untouched, separate from the new cap.
  assert.match(node.parameters.jsonBody, /\$json\.request_body/);
  assert.equal(node.retryOnFail, false);
  assert.equal(node.parameters.options.timeout, 60000, 'timeout must be preserved');
});

test('GulfTalent is no longer part of the shared fast-sync Apify seed list (moved to its own async/polling branch)', () => {
  const seeds = getApifySeeds();
  assert.ok(!seeds.some((s) => s.provider_type === 'gulftalent'), 'Apify Multi-Company Source Seeds must no longer contain any gulftalent entry');
});

for (const [providerType, refreshScope, label] of [
  ['bayt', null, 'Bayt'],
  ['indeed', null, 'Indeed'],
]) {
  test(`${label} seed's maxTotalChargeUsd is bounded and derived from its own configured result cap x the verified per-item price`, () => {
    const seeds = getApifySeeds();
    const seed = seeds.find((s) => s.provider_type === providerType && s.refresh_scope === refreshScope);
    assert.ok(seed, `${label} seed must exist`);

    const maxResults = seed.request_body.maxResults ?? seed.request_body.count;
    assert.ok(typeof maxResults === 'number' && maxResults > 0, `${label}'s own maxResults/count must be a positive number`);
    assert.equal(seed.max_jobs_per_run, maxResults, `${label}'s max_jobs_per_run must match its own actor-input result cap`);

    const expected = Math.round((APIFY_ACTOR_START_USD[providerType] + maxResults * APIFY_PER_ITEM_USD[providerType]) * 1e6) / 1e6;
    assert.equal(seed.max_total_charge_usd, expected, `${label}'s maxTotalChargeUsd must equal actor-start + maxResults x per-item price, not an arbitrary value`);
    assert.ok(seed.max_total_charge_usd > 0 && seed.max_total_charge_usd < 1, `${label}'s cap must be a small, real bounded amount, never unbounded`);
  });
}

test('Call Data-Slayer Actor retry safety is unaffected by the Apify actor retry fix (regression against accidental reversion)', () => {
  const node = findNode('Call Data-Slayer Actor');
  assert.equal(node.retryOnFail, false);
});

// ── GulfTalent reliability fix: async actor start + bounded polling ────
// Real evidence from two controlled test runs: GulfTalent's real
// completion time (32s/85s/112s/125s observed) routinely exceeded the
// shared Call Apify Actor node's 60s timeout, discarding already-billed,
// often already-SUCCEEDED results (~$0.025 wasted real spend). Bayt/Indeed
// never showed this (both consistently complete in seconds) so only
// GulfTalent moved to this separate branch — Bayt/Indeed's proven fast
// sync path above is untouched (see the "no longer part of the shared
// fast-sync Apify seed list" test above).

const GULFTALENT_BRANCH_NODES = [
  'GulfTalent Source Seeds',
  'Split Out GulfTalent Sources',
  'Loop GulfTalent Sources (Rate Limited)',
  'Start GulfTalent Actor Run',
  'Build GulfTalent Start Failure Result',
  'Prepare GulfTalent Poll Attempts',
  'Check GulfTalent Actor Start Run ID Valid?',
  'Build GulfTalent Invalid Actor Start ID Result',
  'Split Out GulfTalent Poll Attempts',
  'Loop GulfTalent Poll Attempts (Bounded)',
  'GulfTalent Poll Delay',
  'Poll GulfTalent Run Status',
  'Check GulfTalent Run Terminal?',
  'Build GulfTalent Terminal Failure Result',
  'Build GulfTalent Poll Timeout Result',
  'Check GulfTalent Terminal Dataset ID Valid?',
  'Build GulfTalent Invalid Dataset ID Result',
  'Fetch GulfTalent Dataset Items',
  'Build GulfTalent Dataset Fetch Failure Result',
  'Aggregate GulfTalent Jobs',
  'Call GulfTalent Batch Endpoint',
  'Build GulfTalent Success Result',
  'Build GulfTalent Batch Failure Result',
  'Record GulfTalent Source Result',
  'GulfTalent Rate Limit Delay',
];

test('GulfTalent async/polling branch is fully isolated — every expected node exists, fresh off Workflow Configuration, independent of the Bayt/Indeed branch', () => {
  for (const name of GULFTALENT_BRANCH_NODES) findNode(name);
  const fanOut = wf.connections['Workflow Configuration']?.main?.[0] ?? [];
  assert.ok(fanOut.some((c) => c.node === 'GulfTalent Source Seeds'), 'GulfTalent branch must start fresh off Workflow Configuration, not depend on the Bayt/Indeed branch');
});

test('Saudi/UAE limits (maxResults:15) and cost caps (0.0155) are unchanged by this fix — a reliability fix, not a volume or cost-cap change', () => {
  const seeds = getGulfTalentSeeds();
  assert.equal(seeds.length, 2, 'exactly two GulfTalent seeds — Saudi and UAE/Dubai');
  for (const seed of seeds) {
    assert.equal(seed.request_body.maxResults, 15, 'maxResults must stay 15 — this fix must never increase volume');
    assert.equal(seed.max_jobs_per_run, 15);
    assert.equal(seed.max_total_charge_usd, 0.0155, 'cost cap must stay the original, unchanged 0.0155 value');
  }
  const scopes = seeds.map((s) => s.refresh_scope);
  assert.deepEqual(new Set(scopes), new Set(['country:SA', 'country:AE:location:Dubai']), 'Saudi/UAE refresh scopes must stay distinct and unchanged — the cross-partition stale-close fix this field exists for still applies');
});

test('the paid actor start happens exactly once per market per cycle — one node, retryOnFail:false, never restarted by polling', () => {
  const occurrences = wf.nodes.filter((n) => n.name === 'Start GulfTalent Actor Run').length;
  assert.equal(occurrences, 1, 'the paid start node must appear exactly once — no duplicate/hidden call path');

  const node = findNode('Start GulfTalent Actor Run');
  assert.equal(node.retryOnFail, false, 'a paid, non-idempotent actor start must never auto-retry (AGENTS.md §18)');
  assert.match(node.parameters.url, /\/runs\?maxTotalChargeUsd=/, 'must use the async run-start endpoint (.../runs), not run-sync-get-dataset-items');
  assert.match(node.parameters.url, /\$json\.max_total_charge_usd/, 'maxTotalChargeUsd must still be appended dynamically per-seed, unchanged mechanism');

  // The only two nodes that can ever reach "Start GulfTalent Actor Run" are
  // the outer per-market loop (one start per market) — nothing in the poll
  // loop may ever point back at it.
  const reachers = Object.entries(wf.connections)
    .filter(([, c]) => (c.main ?? []).some((output) => (output ?? []).some((t) => t.node === 'Start GulfTalent Actor Run')))
    .map(([name]) => name);
  assert.deepEqual(reachers, ['Loop GulfTalent Sources (Rate Limited)'], 'only the outer per-market loop may ever start the actor — polling must never restart it');
});

test('polling never starts another paid actor — Poll GulfTalent Run Status is a free, idempotent GET, safe to retry', () => {
  const node = findNode('Poll GulfTalent Run Status');
  assert.equal(node.parameters.method, 'GET', 'polling must be a read, never a POST that could start a new run');
  assert.match(node.parameters.url, /\/actor-runs\//, 'must read run status via the run-metadata endpoint, never .../runs (which would start a new run)');
  assert.equal(node.retryOnFail, true, 'unlike the paid start, a free read-only status check is safe to retry on transient blips');

  const fetchNode = findNode('Fetch GulfTalent Dataset Items');
  assert.equal(fetchNode.parameters.method, 'GET');
  assert.match(fetchNode.parameters.url, /\/datasets\//, 'dataset fetch must read the existing dataset, never start a new run');
});

test('polling is bounded — a fixed, small number of attempts, with a fixed delay between them', () => {
  const prepareNode = findNode('Prepare GulfTalent Poll Attempts');
  const pollAttemptsAssignment = prepareNode.parameters.assignments.assignments.find((a) => a.name === 'poll_attempts');
  assert.match(pollAttemptsAssignment.value, /Array\.from\(\{\s*length:\s*15\s*\}/, 'must build a fixed-length (15) bounded array of poll attempts, not an open-ended loop');

  const delayNode = findNode('GulfTalent Poll Delay');
  assert.equal(delayNode.parameters.amount, 10, 'a fixed 10s delay between polls — bounded total wait of 150s, comfortably above the largest real observed GulfTalent duration (125s)');

  const loopNode = findNode('Loop GulfTalent Poll Attempts (Bounded)');
  assert.equal(loopNode.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loopNode.parameters.batchSize ?? 1, 1, 'one poll attempt per batch');
});

test('Prepare GulfTalent Poll Attempts reads the actor-start response from its real nested shape, not a flat one', () => {
  const prepareNode = findNode('Prepare GulfTalent Poll Attempts');
  const runIdAssignment = prepareNode.parameters.assignments.assignments.find((a) => a.name === 'runId');
  const datasetIdAssignment = prepareNode.parameters.assignments.assignments.find((a) => a.name === 'datasetId');

  // Apify's POST .../runs wraps its payload in a top-level `data` key
  // (real response: {data: {id, defaultDatasetId, status, ...}}) — a flat
  // $json.id / $json.defaultDatasetId silently resolves to undefined.
  // Real incident (2026-10-21 manual test session forensic audit): this
  // exact flat mapping shipped to the tracked source while the live node
  // was hand-corrected and never ported back — five real paid Apify runs
  // ($0.084516 total) happened before this was caught.
  // 2026-10-22 fix: '?.' added so a successful response missing the data
  // envelope entirely resolves to undefined here rather than throwing an
  // uncaught expression error (this Set node has no onError wired) — see
  // Check GulfTalent Actor Start Run ID Valid? for what actually rejects
  // the resulting invalid runId before it reaches the polling HTTP node.
  assert.equal(runIdAssignment.value, '={{ $json.data?.id }}', 'runId must read the nested response shape Apify actually returns, defensively');
  assert.equal(datasetIdAssignment.value, '={{ $json.data?.defaultDatasetId }}', 'datasetId must read the nested response shape Apify actually returns, defensively');

  // Explicitly reject the previously-shipped flat mapping so a future
  // regression fails loudly here instead of only costing money quietly.
  assert.notEqual(runIdAssignment.value, '={{ $json.id }}');
  assert.notEqual(datasetIdAssignment.value, '={{ $json.defaultDatasetId }}');

  // Cross-check against the TypeScript source itself (text-level — this
  // workflow has no deterministic TS→JSON generator, so nothing else
  // keeps the two files honest with each other).
  const tsSource = readFileSync(resolve(ROOT, 'n8n-workflows/ai-job-agent-01-job-ingestion.ts'), 'utf8');
  const prepareNodeSource = tsSource.slice(
    tsSource.indexOf('const prepareGulfTalentPollAttempts'),
    tsSource.indexOf('const splitOutGulfTalentPollAttempts')
  );
  assert.match(prepareNodeSource, /expr\('\{\{ \$json\.data\?\.id \}\}'\)/, 'TypeScript source must agree with the generated JSON on the runId expression');
  assert.match(prepareNodeSource, /expr\('\{\{ \$json\.data\?\.defaultDatasetId \}\}'\)/, 'TypeScript source must agree with the generated JSON on the datasetId expression');
});

// ── Missing/invalid-ID guard (2026-10-22 fix) ───────────────────────────
// Prepare GulfTalent Poll Attempts' '?.' only prevents a throw while
// building runId/datasetId — it does not reject them. These two switch
// nodes are what actually keep an invalid ID from ever reaching a real
// HTTP node, by routing to the existing Record GulfTalent Source Result
// failure-recording architecture instead.

// Mirrors (does not execute) the exact ternary condition expression used
// by Check GulfTalent Actor Start Run ID Valid? — a local JS
// reproduction for offline testing, never an n8n engine invocation.
function mirrorActorStartRunIdValid(json) {
  const runId = json?.runId;
  return (typeof runId === 'string' && runId.trim().length > 0) ? 'valid' : 'invalid';
}

// Mirrors (does not execute) the exact ternary condition expression used
// by Check GulfTalent Terminal Dataset ID Valid?.
function mirrorTerminalDatasetIdValid(json) {
  const datasetId = json?.data?.defaultDatasetId;
  return (typeof datasetId === 'string' && datasetId.trim().length > 0) ? 'valid' : 'invalid';
}

test('Check GulfTalent Actor Start Run ID Valid? exists, is wired between Prepare GulfTalent Poll Attempts and the poll loop, and its invalid case routes to failure recording without reaching the actor-start node or the batch endpoint', () => {
  assert.ok(wf.connections['Prepare GulfTalent Poll Attempts']?.main?.[0]?.some((c) => c.node === 'Check GulfTalent Actor Start Run ID Valid?'), 'Prepare GulfTalent Poll Attempts must route through the run-ID guard first');
  assert.ok(wf.connections['Check GulfTalent Actor Start Run ID Valid?']?.main?.[0]?.some((c) => c.node === 'Split Out GulfTalent Poll Attempts'), 'the valid case must proceed into the poll loop exactly as before');
  assert.ok(wf.connections['Check GulfTalent Actor Start Run ID Valid?']?.main?.[1]?.some((c) => c.node === 'Build GulfTalent Invalid Actor Start ID Result'), 'the invalid case must route to its own failure builder');
  assert.ok(wf.connections['Build GulfTalent Invalid Actor Start ID Result']?.main?.[0]?.some((c) => c.node === 'Record GulfTalent Source Result'));

  const reachesBatch = (wf.connections['Build GulfTalent Invalid Actor Start ID Result']?.main ?? []).some((o) => (o ?? []).some((t) => t.node === 'Call GulfTalent Batch Endpoint'));
  assert.ok(!reachesBatch, 'an invalid run ID must never reach the batch endpoint');

  const reachesActorStart = Object.entries(wf.connections).some(([name, c]) =>
    name.startsWith('Build GulfTalent Invalid') || name.startsWith('Check GulfTalent')
      ? (c.main ?? []).some((o) => (o ?? []).some((t) => t.node === 'Start GulfTalent Actor Run'))
      : false
  );
  assert.ok(!reachesActorStart, 'no guard or invalid-ID failure path may ever restart the actor');
});

test('an invalid actor-start run ID can never reach Poll GulfTalent Run Status — static reachability check', () => {
  const invalidTargets = (wf.connections['Check GulfTalent Actor Start Run ID Valid?']?.main?.[1] ?? []).map((t) => t.node);
  assert.deepEqual(invalidTargets, ['Build GulfTalent Invalid Actor Start ID Result']);
});

for (const [label, json, expected] of [
  ['valid run ID and dataset ID (historical shape)', { data: { id: 'qxNwKp3b7Zek70sXt', defaultDatasetId: 'PfXFN8QlhTArfYf2H', status: 'READY' }, runId: 'qxNwKp3b7Zek70sXt' }, 'valid'],
  ['missing data envelope entirely', {}, 'invalid'],
  ['data: null', { data: null }, 'invalid'],
  ['missing run ID', { runId: undefined }, 'invalid'],
  ['empty run ID', { runId: '' }, 'invalid'],
  ['whitespace-only run ID', { runId: '   ' }, 'invalid'],
  ['non-string run ID (number)', { runId: 12345 }, 'invalid'],
  ['non-string run ID (object)', { runId: { id: 'x' } }, 'invalid'],
  ['run ID with surrounding whitespace is still a usable string', { runId: '  qxNwKp3b7Zek70sXt  ' }, 'valid'],
]) {
  test(`Check GulfTalent Actor Start Run ID Valid? predicate (mirrored offline): ${label}`, () => {
    assert.equal(mirrorActorStartRunIdValid(json), expected);
  });
}

test('Check GulfTalent Terminal Dataset ID Valid? exists, is wired between Check GulfTalent Run Terminal? and the dataset fetch, and its invalid case routes to failure recording without reaching the dataset-fetch node or the batch endpoint', () => {
  assert.ok(wf.connections['Check GulfTalent Run Terminal?']?.main?.[0]?.some((c) => c.node === 'Check GulfTalent Terminal Dataset ID Valid?'), 'the SUCCEEDED case must route through the dataset-ID guard first');
  assert.ok(wf.connections['Check GulfTalent Terminal Dataset ID Valid?']?.main?.[0]?.some((c) => c.node === 'Fetch GulfTalent Dataset Items'), 'the valid case must proceed to the real dataset fetch exactly as before');
  assert.ok(wf.connections['Check GulfTalent Terminal Dataset ID Valid?']?.main?.[1]?.some((c) => c.node === 'Build GulfTalent Invalid Dataset ID Result'), 'the invalid case must route to its own failure builder');
  assert.ok(wf.connections['Build GulfTalent Invalid Dataset ID Result']?.main?.[0]?.some((c) => c.node === 'Record GulfTalent Source Result'));

  const invalidTargets = (wf.connections['Check GulfTalent Terminal Dataset ID Valid?']?.main?.[1] ?? []).map((t) => t.node);
  assert.deepEqual(invalidTargets, ['Build GulfTalent Invalid Dataset ID Result'], 'an invalid terminal dataset ID must never reach Fetch GulfTalent Dataset Items');

  const reachesBatch = (wf.connections['Build GulfTalent Invalid Dataset ID Result']?.main ?? []).some((o) => (o ?? []).some((t) => t.node === 'Call GulfTalent Batch Endpoint'));
  assert.ok(!reachesBatch, 'an invalid dataset ID must never reach the batch endpoint');
});

for (const [label, json, expected] of [
  ['valid dataset ID (historical shape)', { data: { id: 'qxNwKp3b7Zek70sXt', status: 'SUCCEEDED', defaultDatasetId: 'PfXFN8QlhTArfYf2H' } }, 'valid'],
  ['missing data envelope entirely', {}, 'invalid'],
  ['data: null', { data: null }, 'invalid'],
  ['missing dataset ID', { data: { status: 'SUCCEEDED' } }, 'invalid'],
  ['empty dataset ID', { data: { status: 'SUCCEEDED', defaultDatasetId: '' } }, 'invalid'],
  ['non-string dataset ID', { data: { status: 'SUCCEEDED', defaultDatasetId: 42 } }, 'invalid'],
]) {
  test(`Check GulfTalent Terminal Dataset ID Valid? predicate (mirrored offline): ${label}`, () => {
    assert.equal(mirrorTerminalDatasetIdValid(json), expected);
  });
}

test('neither new ID guard changed the bounded polling configuration or existing GulfTalent node connectivity', () => {
  assert.equal(findNode('Prepare GulfTalent Poll Attempts').parameters.assignments.assignments.find((a) => a.name === 'poll_attempts').value, '={{ Array.from({ length: 15 }, (_, i) => i) }}');
  assert.equal(findNode('GulfTalent Poll Delay').parameters.amount, 10);
  for (const name of GULFTALENT_BRANCH_NODES) findNode(name);
});

test('a successful actor run is eventually fetched exactly once — SUCCEEDED routes to the dataset fetch, never re-polled', () => {
  const switchNode = findNode('Check GulfTalent Run Terminal?');
  const rules = switchNode.parameters.rules.values;
  assert.equal(rules[0].conditions.conditions[0].rightValue, 'SUCCEEDED', 'case 0 must check for the real SUCCEEDED status string');

  assert.ok(wf.connections['Check GulfTalent Run Terminal?']?.main?.[0]?.some((c) => c.node === 'Check GulfTalent Terminal Dataset ID Valid?'), 'the SUCCEEDED case (output 0) must route to the dataset-ID guard before the dataset fetch');
  assert.ok(wf.connections['Check GulfTalent Terminal Dataset ID Valid?']?.main?.[0]?.some((c) => c.node === 'Fetch GulfTalent Dataset Items'), 'the valid case (output 0) of the dataset-ID guard must route to the dataset fetch');
  assert.ok(wf.connections['Fetch GulfTalent Dataset Items']?.main?.[0]?.some((c) => c.node === 'Aggregate GulfTalent Jobs'));
  assert.ok(wf.connections['Aggregate GulfTalent Jobs']?.main?.[0]?.some((c) => c.node === 'Call GulfTalent Batch Endpoint'));

  const fetchOccurrences = wf.nodes.filter((n) => n.name === 'Fetch GulfTalent Dataset Items').length;
  assert.equal(fetchOccurrences, 1, 'the dataset fetch node must appear exactly once — reached only via the SUCCEEDED case, never from inside the poll loop directly');
});

test('a real terminal failure (FAILED/TIMED-OUT/ABORTED) never persists junk and is never retried', () => {
  const switchNode = findNode('Check GulfTalent Run Terminal?');
  const rules = switchNode.parameters.rules.values;
  const terminalValues = rules[1].conditions.conditions.map((c) => c.rightValue);
  assert.deepEqual(new Set(terminalValues), new Set(['FAILED', 'TIMED-OUT', 'ABORTED']), 'case 1 must cover all three real terminal-failure status strings');
  assert.equal(rules[1].conditions.combinator, 'or', 'the three terminal statuses must be OR-combined — any one of them is terminal');

  assert.ok(wf.connections['Check GulfTalent Run Terminal?']?.main?.[1]?.some((c) => c.node === 'Build GulfTalent Terminal Failure Result'), 'the terminal-failure case (output 1) must route to its own failure builder, never to the dataset fetch');
  assert.ok(wf.connections['Build GulfTalent Terminal Failure Result']?.main?.[0]?.some((c) => c.node === 'Record GulfTalent Source Result'), 'terminal failure must converge on Record GulfTalent Source Result and stop there — no batch endpoint call, nothing persisted');
});

test('poll-limit exhaustion is handled as its own terminal state, never silently dropped and never restarting the actor', () => {
  assert.ok(wf.connections['Loop GulfTalent Poll Attempts (Bounded)']?.main?.[0]?.some((c) => c.node === 'Build GulfTalent Poll Timeout Result'), "the poll loop's done output (all attempts exhausted without a terminal status) must be wired to its own timeout-result builder");
  assert.ok(wf.connections['Build GulfTalent Poll Timeout Result']?.main?.[0]?.some((c) => c.node === 'Record GulfTalent Source Result'));

  const reachers = Object.entries(wf.connections)
    .filter(([, c]) => (c.main ?? []).some((output) => (output ?? []).some((t) => t.node === 'Build GulfTalent Poll Timeout Result')))
    .map(([name]) => name);
  assert.deepEqual(reachers, ['Loop GulfTalent Poll Attempts (Bounded)'], 'only poll-exhaustion may reach the timeout-result builder');
});

test("a failed/timed-out/poll-exhausted GulfTalent refresh never closes that market's existing jobs — the batch endpoint (and its stale-close sweep) is simply never called for that partition this run", () => {
  // None of the four failure-terminal builders have any path to Call
  // GulfTalent Batch Endpoint — only a real SUCCEEDED dataset fetch does.
  const failureBuilders = ['Build GulfTalent Start Failure Result', 'Build GulfTalent Terminal Failure Result', 'Build GulfTalent Poll Timeout Result', 'Build GulfTalent Dataset Fetch Failure Result'];
  for (const name of failureBuilders) {
    const reachesBatchEndpoint = (wf.connections[name]?.main ?? []).some((output) => (output ?? []).some((t) => t.node === 'Call GulfTalent Batch Endpoint'));
    assert.ok(!reachesBatchEndpoint, `${name} must never reach Call GulfTalent Batch Endpoint — a failed refresh is not evidence old jobs disappeared`);
  }
  const batchEndpointCallers = Object.entries(wf.connections)
    .filter(([, c]) => (c.main ?? []).some((output) => (output ?? []).some((t) => t.node === 'Call GulfTalent Batch Endpoint')))
    .map(([name]) => name);
  assert.deepEqual(batchEndpointCallers, ['Aggregate GulfTalent Jobs'], 'the batch endpoint (which performs the stale-close sweep server-side) must only ever be reachable after a real successful dataset fetch');
});

test('GulfTalent Saudi/UAE refresh scopes remain isolated from each other and from every other source partition', () => {
  const seeds = getGulfTalentSeeds();
  const scopes = seeds.map((s) => s.refresh_scope);
  assert.equal(new Set(scopes).size, 2, 'Saudi and UAE must never share a refresh_scope');

  // And distinct from every other Apify-style partition in the workflow.
  const apifyScopes = getApifySeeds().map((s) => s.refresh_scope).filter(Boolean);
  for (const scope of scopes) {
    assert.ok(!apifyScopes.includes(scope), `GulfTalent's refresh_scope "${scope}" must not collide with any Bayt/Indeed partition`);
  }
});

test('GulfTalent batch endpoint call resolves its own branch\'s Split Out node, not the Bayt/Indeed branch\'s', () => {
  const node = findNode('Call GulfTalent Batch Endpoint');
  assert.match(node.parameters.jsonBody, /Split Out GulfTalent Sources/, "sourceType/maxJobsPerSource/refreshScope must resolve this branch's own split node");
  assert.ok(!/Split Out Apify Sources/.test(node.parameters.jsonBody), 'must never reference the Bayt/Indeed branch\'s split node');
  assert.equal(node.retryOnFail, true, 'the batch persistence call itself is a safe, idempotent internal API call — unlike the paid actor start, retry is fine here');
});

test('GulfTalent converges on its own Record/Rate-Limit-Delay/loop-back, fully independent of the Bayt/Indeed branch\'s own', () => {
  assert.notEqual(findNode('Record GulfTalent Source Result').id, findNode('Record Apify Source Result').id, 'GulfTalent must not share the Bayt/Indeed branch\'s convergence node — that node already loops back into a different loop');
  assert.ok(wf.connections['Record GulfTalent Source Result']?.main?.[0]?.some((c) => c.node === 'GulfTalent Rate Limit Delay'));
  assert.ok(wf.connections['GulfTalent Rate Limit Delay']?.main?.[0]?.some((c) => c.node === 'Loop GulfTalent Sources (Rate Limited)'), 'the delay must loop back into GulfTalent\'s own outer per-market loop, never the Bayt/Indeed one');
});

test('unrelated sources remain structurally unchanged by the GulfTalent fix', () => {
  assert.equal(findNode('Call Apify Actor').retryOnFail, false);
  assert.equal(findNode('Call Data-Slayer Actor').retryOnFail, false);
  assert.ok(wf.connections['Loop Apify Sources (Rate Limited)'].main[1].some((c) => c.node === 'Call Apify Actor'));
  assert.ok(wf.connections['Apify Rate Limit Delay'].main[0].some((c) => c.node === 'Loop Apify Sources (Rate Limited)'));
});

test('unrelated safe-read/internal-API retry policies are unchanged by the Apify actor retry fix', () => {
  // Call Apify Batch Endpoint is the safe, idempotent internal API call
  // (not a paid external side effect) — its retry must remain untouched.
  const batchEndpoint = findNode('Call Apify Batch Endpoint');
  assert.equal(batchEndpoint.retryOnFail, true);
  assert.equal(batchEndpoint.maxTries, 2);

  // Spot-check a handful of other provider-facing/internal nodes elsewhere
  // in the graph to confirm this was a scoped, single-node fix.
  assert.equal(findNode('Fetch Source Jobs').retryOnFail, true);
  assert.equal(findNode('Fetch Multi-Company Feed').retryOnFail, true);
  assert.equal(findNode('List LinkedIn Enrichment Queue').retryOnFail, true);
});

test('Lever case routes through Aggregate Lever Jobs before Extract Lever Jobs (Phase 14 fix — Lever\'s bare top-level array response gets auto-split into one item per job by n8n, so the raw array must be re-collected before extraction)', () => {
  const switchConns = wf.connections['Extract Jobs By ATS Type']?.main ?? [];
  assert.ok(switchConns[1]?.some((c) => c.node === 'Aggregate Lever Jobs'), 'the lever case (index 1) must route to Aggregate Lever Jobs, not directly to Extract Lever Jobs');
  assert.ok(wf.connections['Aggregate Lever Jobs']?.main?.[0]?.some((c) => c.node === 'Extract Lever Jobs'), 'Aggregate Lever Jobs must feed Extract Lever Jobs');

  const aggregateNode = findNode('Aggregate Lever Jobs');
  assert.equal(aggregateNode.type, 'n8n-nodes-base.aggregate');
  assert.equal(aggregateNode.parameters.aggregate, 'aggregateAllItemData');
  assert.equal(aggregateNode.parameters.destinationFieldName, 'jobs');

  const extractLever = findNode('Extract Lever Jobs');
  assert.equal(
    extractLever.parameters.assignments.assignments[0].value,
    '={{ $json.jobs }}',
    'must read the aggregated jobs array, not assume $json is still the whole raw response'
  );
});

// ── LinkedIn enrichment (data-slayer exact-ID pass) ────────────────────
// Added during the 2026-10-16 production-readiness audit — this branch was
// synced to the live workflow in a prior session but had no regression
// coverage of its own; the six failures this audit found when reading the
// real live-fetched JSON (see switchCaseValues/assertBatchesOneAtATime
// above) proved this suite can silently drift from the live workflow it
// claims to test. This section closes that gap for the newest branch.

test('LinkedIn branch is its own fifth independent branch off Workflow Configuration — a failure here cannot block Tier A/D/B/Apify ingestion', () => {
  const fanOut = wf.connections['Workflow Configuration']?.main?.[0] ?? [];
  assert.ok(fanOut.some((c) => c.node === 'List Ingestion Sources'));
  assert.ok(fanOut.some((c) => c.node === 'Apify Multi-Company Source Seeds'));
  assert.ok(fanOut.some((c) => c.node === 'List LinkedIn Enrichment Queue'), 'LinkedIn branch must start fresh off Workflow Configuration, not depend on any other branch succeeding first');
});

test('List LinkedIn Enrichment Queue has Bearer auth, bounded retry, and a wired error output (never a hanging failure)', () => {
  const node = findNode('List LinkedIn Enrichment Queue');
  assert.equal(node.parameters.method, 'POST');
  assert.match(node.parameters.url, /\/api\/internal\/ingestion\/list-linkedin-enrichment-queue$/);
  assert.equal(node.parameters.authentication, 'genericCredentialType');
  assert.equal(node.parameters.genericAuthType, 'httpBearerAuth');
  assert.equal(node.retryOnFail, true);
  assert.equal(node.onError, 'continueErrorOutput');
  assert.ok(wf.connections['List LinkedIn Enrichment Queue']?.main?.[1]?.some((c) => c.node === 'Log List Queue Failure'), 'error output must be wired, never left hanging');
});

test('zero eligible jobs is a safe terminal, never the pricing/actor path', () => {
  assert.ok(wf.connections['Check Eligible Jobs Exist']?.main?.[0]?.some((c) => c.node === 'Fetch Data-Slayer Pricing Metadata'), 'has_jobs case must lead to the pricing check');
  assert.ok(wf.connections['Check Eligible Jobs Exist']?.main?.[1]?.some((c) => c.node === 'Build No Eligible Jobs Result'), 'no_jobs fallback must terminate safely, never reach pricing or the actor');
});

test('pricing metadata failure and price-too-high both abort before the actor is ever called', () => {
  assert.ok(wf.connections['Fetch Data-Slayer Pricing Metadata']?.main?.[1]?.some((c) => c.node === 'Build Pricing Metadata Failure Result'), 'pricing metadata error output must be wired');
  assert.ok(wf.connections['Check Data-Slayer Price']?.main?.[1]?.some((c) => c.node === 'Build Pricing Aborted Result'), 'price-too-high fallback must be wired');
  const actorCallers = Object.entries(wf.connections)
    .filter(([, c]) => (c.main ?? []).some((output) => (output ?? []).some((t) => t.node === 'Call Data-Slayer Actor')))
    .map(([name]) => name);
  assert.deepEqual(actorCallers, ['Check Data-Slayer Price'], 'the actor must only ever be reachable through the price_ok case — no other path may call it');
});

test('Call Data-Slayer Actor is exact-ID only, bounded, and never auto-retried (non-idempotent paid call)', () => {
  const node = findNode('Call Data-Slayer Actor');
  assert.equal(node.retryOnFail, false, 'a paid, non-idempotent actor call must never auto-retry (AGENTS.md §18/§35)');
  assert.match(node.parameters.url, /maxItems=/);
  assert.match(node.parameters.url, /maxTotalChargeUsd=/);
  assert.match(node.parameters.jsonBody, /job_ids_or_urls/);
  assert.match(node.parameters.jsonBody, /include_hiring_team:\s*false/);
  assert.ok(!/keyword|location/i.test(node.parameters.jsonBody), 'must never send a keyword/location filter — this actor is exact-ID enrichment only, never discovery');
  assert.equal((wf.connections['Call Data-Slayer Actor']?.main ?? []).length, 2, 'exactly one success + one error output');
  assert.ok(wf.connections['Call Data-Slayer Actor']?.main?.[1]?.some((c) => c.node === 'Build Actor Failure Result'), 'actor error output must be wired, never left hanging');
});

test('actor success flows through dataset aggregation to server-side reconciliation, never applied twice', () => {
  const actorOccurrences = wf.nodes.filter((n) => n.name === 'Call Data-Slayer Actor').length;
  assert.equal(actorOccurrences, 1, 'the actor node must appear exactly once — no duplicate/hidden call path');
  assert.ok(wf.connections['Call Data-Slayer Actor']?.main?.[0]?.some((c) => c.node === 'Aggregate Data-Slayer Dataset'));
  assert.ok(wf.connections['Aggregate Data-Slayer Dataset']?.main?.[0]?.some((c) => c.node === 'Call LinkedIn Enrichment Batch Endpoint'));

  const applyNode = findNode('Call LinkedIn Enrichment Batch Endpoint');
  assert.equal(applyNode.retryOnFail, false, 'retrying an already-applied dataset would double-count attempts — must never auto-retry');
  assert.match(applyNode.parameters.url, /\/api\/internal\/ingestion\/run-linkedin-enrichment-batch$/);
  assert.match(applyNode.parameters.jsonBody, /requestedJobIds/);
  assert.match(applyNode.parameters.jsonBody, /rawDatasetItems/);
  assert.ok(wf.connections['Call LinkedIn Enrichment Batch Endpoint']?.main?.[1]?.some((c) => c.node === 'Build Apply Call Failure Result'), 'apply-call error output must be wired');
});

test('every LinkedIn branch terminal path converges on Record LinkedIn Enrichment Result — no path is left unobserved', () => {
  const terminals = [
    'Log List Queue Failure',
    'Build No Eligible Jobs Result',
    'Build Pricing Metadata Failure Result',
    'Build Pricing Aborted Result',
    'Build Actor Failure Result',
    'Build Apply Call Failure Result',
    'Build Enrichment Success Result',
  ];
  for (const name of terminals) {
    assert.ok(wf.connections[name]?.main?.[0]?.some((c) => c.node === 'Record LinkedIn Enrichment Result'), `${name} must feed Record LinkedIn Enrichment Result`);
  }
});

test('the LinkedIn branch has no loop/rate-limit-delay node — one run is already one bounded <=25-id batch, by design', () => {
  assert.ok(!wf.nodes.some((n) => n.name === 'LinkedIn Rate Limit Delay'), 'no rate-limit loop should exist for this branch');
  const splitBatchesNearLinkedIn = wf.nodes.filter(
    (n) => n.type === 'n8n-nodes-base.splitInBatches' && n.name.toLowerCase().includes('linkedin')
  );
  assert.equal(splitBatchesNearLinkedIn.length, 0, 'List LinkedIn Enrichment Queue already bounds one run to one batch — no fan-out loop is needed or present');
});

// ── Daily production Schedule Trigger ──────────────────────────────────
// Added once the production-readiness audit (and the explicit, approved
// bounded LinkedIn pilot decision) closed out — see this workflow's own
// overview sticky note: "stays inactive until a human reviews a run and
// decides on a schedule." Kept alongside the Manual Trigger, never
// replacing it, mirroring the exact same pattern already proven in
// source-intelligence-analyzer.ts/.test.mjs.

test('Daily 09:00 Beirut Trigger exists as a real Schedule Trigger node, alongside (never instead of) Start Job Ingestion Run', () => {
  const schedule = findNode('Daily 09:00 Beirut Trigger');
  assert.equal(schedule.type, 'n8n-nodes-base.scheduleTrigger');
  findNode('Start Job Ingestion Run');
});

test('the schedule rule is daily at 09:00 (hour/minute), not a cron expression and not some other interval unit', () => {
  const schedule = findNode('Daily 09:00 Beirut Trigger');
  const rule = schedule.parameters.rule.interval[0];
  assert.equal(rule.field, 'days', 'must be a days-interval rule, not seconds/minutes/hours/weeks/months/cronExpression');
  assert.equal(rule.daysInterval, 1, 'must fire every day, not every N days');
  assert.equal(rule.triggerAtHour, 9);
  assert.equal(rule.triggerAtMinute, 0);
});

test('both the Manual Trigger and the Schedule Trigger converge on the same Workflow Configuration node — two independent entry points, one pipeline', () => {
  assert.ok(wf.connections['Start Job Ingestion Run']?.main?.[0]?.some((c) => c.node === 'Workflow Configuration'), 'Manual Trigger must still feed Workflow Configuration');
  assert.ok(wf.connections['Daily 09:00 Beirut Trigger']?.main?.[0]?.some((c) => c.node === 'Workflow Configuration'), 'Schedule Trigger must feed Workflow Configuration');
});

test('Workflow Configuration fans out to exactly 4 branches (List Ingestion Sources, Apify Multi-Company Source Seeds, List LinkedIn Enrichment Queue, GulfTalent Source Seeds) — the GulfTalent reliability fix added its own branch as a fourth sibling, not a change to any existing branch', () => {
  const fanOut = wf.connections['Workflow Configuration']?.main?.[0] ?? [];
  assert.equal(fanOut.length, 4, 'exactly 4 parallel branches off Workflow Configuration');
  assert.ok(fanOut.some((c) => c.node === 'List Ingestion Sources'));
  assert.ok(fanOut.some((c) => c.node === 'Apify Multi-Company Source Seeds'));
  assert.ok(fanOut.some((c) => c.node === 'List LinkedIn Enrichment Queue'));
  assert.ok(fanOut.some((c) => c.node === 'GulfTalent Source Seeds'));
});

test('workflow-level timezone: if set, must be the real IANA identifier Asia/Beirut (never a fixed UTC offset, so Lebanon\'s DST transitions resolve automatically); if unset, this is the documented, still-pending manual n8n UI step (same confirmed SDK/MCP limitation as Error Workflow attachment — see the trigger node\'s own notes)', () => {
  if (wf.settings.timezone !== undefined) {
    assert.equal(wf.settings.timezone, 'Asia/Beirut');
  }
});

test('the workflow remains inactive after adding the production schedule — going live is still a separate, explicit decision', () => {
  assert.equal(wf.active, false);
});
