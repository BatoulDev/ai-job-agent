// One-shot executor for a single proposed Apify run from proposed-apify-input.json.
// Usage: node run-one-batch.js <run_id>
// Reads APIFY_API_TOKEN from .env.local (never printed). Saves raw/<run_id>.json
// in the same wrapper shape used by the completed Lebanon pilot.
const https = require('https');
const fs = require('fs');
const path = require('path');

const runId = process.argv[2];
if (!runId) { console.error('Usage: node run-one-batch.js <run_id>'); process.exit(1); }

const root = path.join(__dirname, '..', '..', '..', '..');
const envPath = path.join(root, '.env.local');
const tokenMatch = fs.readFileSync(envPath, 'utf8').match(/^APIFY_API_TOKEN=(.+)$/m);
if (!tokenMatch) { console.error('APIFY_API_TOKEN not found'); process.exit(1); }
const token = tokenMatch[1].trim();

const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'proposed-apify-input.json'), 'utf8'));
const runSpec = plan.proposed_runs.find(r => r.run_id === runId);
if (!runSpec) { console.error('run_id not found in plan:', runId); process.exit(1); }

// Fix scrapeSocialMediaProfiles: actor's live schema (checked 2026-09-07) requires an
// object of per-platform booleans, not the plain boolean documented in the Lebanon-era plan.
const input = { ...runSpec.input };
input.scrapeSocialMediaProfiles = { facebooks: false, instagrams: false, youtubes: false, tiktoks: false, twitters: false };
// Actor's live schema (checked 2026-09-07) renamed the "all places" website-filter value.
if (input.website === 'all') input.website = 'allPlaces';

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request('https://api.apify.com/v2' + urlPath, {
      method,
      headers: Object.assign(
        { Authorization: 'Bearer ' + token },
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
      ),
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  console.log('Starting run', runId, 'searchStrings:', input.searchStringsArray, 'location:', input.locationQuery);
  const startRes = await req('POST', '/acts/compass~crawler-google-places/runs', input);
  if (startRes.status !== 201) {
    console.error('START FAILED', startRes.status, startRes.body.slice(0, 500));
    process.exit(1);
  }
  const startData = JSON.parse(startRes.body).data;
  const apifyRunId = startData.id;
  const startedAt = startData.startedAt;
  console.log('apify_run_id', apifyRunId, 'status', startData.status);

  let finalStatus = null, usageTotalUsd = null, datasetId = null, finishedAt = null;
  const maxPolls = 90; // up to ~7.5 min
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await req('GET', '/actor-runs/' + apifyRunId, null);
    const pj = JSON.parse(pollRes.body).data;
    if (i % 4 === 0) console.log('  poll', i, pj.status, 'usageTotalUsd', pj.usageTotalUsd);
    if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(pj.status)) {
      finalStatus = pj.status;
      usageTotalUsd = pj.usageTotalUsd;
      datasetId = pj.defaultDatasetId;
      finishedAt = pj.finishedAt;
      break;
    }
  }
  if (!finalStatus) {
    console.error('TIMED OUT WAITING FOR RUN TO FINISH (still processing on Apify side)');
    console.log(JSON.stringify({ run_id: runId, apify_run_id: apifyRunId, status: 'CLIENT_POLL_TIMEOUT' }));
    process.exit(2);
  }

  let items = [];
  if (finalStatus === 'SUCCEEDED' && datasetId) {
    const itemsRes = await req('GET', '/datasets/' + datasetId + '/items?clean=true', null);
    items = JSON.parse(itemsRes.body);
  }

  const outDir = path.join(__dirname, 'raw');
  const outPath = path.join(outDir, runId + '.json');
  const wrapped = {
    run_id: runId,
    apify_run_id: apifyRunId,
    dataset_id: datasetId,
    status: finalStatus,
    usageTotalUsd,
    startedAt,
    finishedAt,
    input,
    item_count: items.length,
    items,
  };
  fs.writeFileSync(outPath, JSON.stringify(wrapped, null, 2));
  console.log('SAVED', outPath, 'status', finalStatus, 'usageTotalUsd', usageTotalUsd, 'item_count', items.length);
  console.log('RESULT_JSON:' + JSON.stringify({ run_id: runId, status: finalStatus, usageTotalUsd, item_count: items.length }));
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
