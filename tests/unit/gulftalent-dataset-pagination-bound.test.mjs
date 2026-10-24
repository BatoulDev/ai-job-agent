// 2026-10-23 audit, Phase 3 (dataset pagination risk): `Fetch GulfTalent
// Dataset Items` issues exactly one unpaged GET against
// /v2/datasets/{id}/items. This project has never made (and, per this
// audit's own safety rules, must not make) a live call to confirm Apify's
// real page-size ceiling for this specific actor/dataset — so this test
// does NOT assert any particular Apify API fact. It only guards the one
// thing verifiable from the repo alone: each GulfTalent seed's own
// request_body.maxResults stays at or below a deliberately conservative,
// locally-chosen bound, far below any page-size ceiling this project has
// ever observed for any Apify actor. If a future change ever raises a
// seed's maxResults past this bound, this test fails LOUDLY, forcing a
// real pagination design (see the audit's Phase 3 report) to be built and
// live-verified before volume grows into the truncation risk — rather than
// silently shipping a volume increase that could truncate a dataset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');
const JSON_PATH = resolve(ROOT, 'n8n-workflows/ai-job-agent-01-job-ingestion.json');
const wf = JSON.parse(readFileSync(JSON_PATH, 'utf8'));

// Deliberately conservative — not Apify's real limit (unconfirmed by this
// project), just a tripwire well under any value this project has ever
// requested or billed for.
const SAFE_SINGLE_PAGE_BOUND = 100;

function findNode(name) {
  const n = wf.nodes.find((x) => x.name === name);
  assert.ok(n, `Node "${name}" must exist`);
  return n;
}

test('GulfTalent Source Seeds: every seed\'s maxResults stays within the conservative single-page bound — Fetch GulfTalent Dataset Items makes exactly one unpaged GET', () => {
  const seedsNode = findNode('GulfTalent Source Seeds');
  const parsed = typeof seedsNode.parameters.jsonOutput === 'string' ? JSON.parse(seedsNode.parameters.jsonOutput) : seedsNode.parameters.jsonOutput;
  const seeds = parsed.gulftalent_sources;
  assert.ok(Array.isArray(seeds) && seeds.length > 0, 'at least one GulfTalent seed must exist');

  for (const seed of seeds) {
    assert.ok(
      typeof seed.request_body?.maxResults === 'number' && seed.request_body.maxResults <= SAFE_SINGLE_PAGE_BOUND,
      `GulfTalent seed "${seed.refresh_scope}" requests maxResults=${seed.request_body?.maxResults}, above the conservative single-page bound (${SAFE_SINGLE_PAGE_BOUND}) — ` +
        'before raising this, a real pagination implementation for Fetch GulfTalent Dataset Items must exist and be live-verified (see the 2026-10-23 audit\'s Phase 3 proposal), not assumed safe.'
    );
  }
});

test('Fetch GulfTalent Dataset Items makes exactly one HTTP call per cycle (no existing pagination loop) — confirms the risk is real, not already mitigated', () => {
  const fetchNode = findNode('Fetch GulfTalent Dataset Items');
  assert.equal(fetchNode.type, 'n8n-nodes-base.httpRequest');
  assert.equal(fetchNode.parameters.method, 'GET');
  assert.doesNotMatch(String(fetchNode.parameters.url), /offset|limit=/i, 'the URL has no pagination parameters today — a single unpaged request');

  // Only one reacher into this node per market-loop iteration (the dataset-ID
  // guard's valid case) — confirms there is no existing page-advancing loop
  // wired around it that would already mitigate the risk.
  const reachers = Object.entries(wf.connections)
    .filter(([, c]) => (c.main ?? []).some((output) => (output ?? []).some((t) => t.node === 'Fetch GulfTalent Dataset Items')))
    .map(([name]) => name);
  assert.deepEqual(reachers, ['Check GulfTalent Terminal Dataset ID Valid?'], 'exactly one reacher — no pagination loop exists around this node today');
});
