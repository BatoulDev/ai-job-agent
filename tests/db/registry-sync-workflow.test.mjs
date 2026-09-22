// End-to-end local verification for the Registry Sync workflow
// (n8n-workflows/registry-sync.ts / .json). No live n8n execution was
// available in this session (no n8n MCP connection) — this file instead
// chains the workflow's OWN compiled Code-node logic (extracted verbatim
// from registry-sync.json and executed via `new Function`, never
// reimplemented) with real calls to the local resolve_registry_candidate()
// RPC, exercising exactly the sequence the real workflow performs:
// Normalize Candidates -> Validate Candidate -> (Resolve Registry
// Candidate's own field mapping) -> Classify RPC Outcome.
//
// This is real integration coverage of the workflow's actual logic against
// the real local database — the one thing it cannot prove is n8n's own
// node wiring/execution engine itself (covered structurally instead by
// tests/workflow/registry-sync.test.mjs's connection-topology assertions).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { adminClient, assertExpectedLocalProject } from "./helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../");
const wf = JSON.parse(readFileSync(resolve(ROOT, "n8n-workflows/registry-sync.json"), "utf8"));

function findNode(name) {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`Node "${name}" not found in registry-sync.json`);
  return n;
}

function runNode(nodeName, mockDollarImpl, inputItems) {
  const code = findNode(nodeName).parameters.jsCode;
  const mockDollar = (name) => mockDollarImpl(name);
  const mockInput = { first: () => ({ json: inputItems[0] }), all: () => inputItems.map((json) => ({ json })) };
  return new Function("$", "$input", code)(mockDollar, mockInput);
}

// Mirrors exactly what Normalize Candidates -> Validate Candidate does for
// one raw adapter row, using the workflow's own real code.
function normalizeAndValidate(discoverySource, raw, maxCandidatesPerRun = 25) {
  const normalized = runNode(
    "Normalize Candidates",
    (name) => {
      if (name === "Workflow Configuration") return { first: () => ({ json: { maxCandidatesPerRun } }) };
      throw new Error(`unexpected $('${name}')`);
    },
    [{ discovery_source: discoverySource, raw }]
  )[0].json;
  const validated = runNode("Validate Candidate", () => { throw new Error("no $() calls expected"); }, [normalized])[0].json;
  return validated;
}

// Mirrors exactly what Resolve Registry Candidate's jsonBody expression
// sends, and what Classify RPC Outcome does with the response — using the
// real local RPC, not a mock. discoveryRunId mirrors what the real
// Generate Discovery Run ID node produces (a real uuid, generated once per
// simulated "run" — callers share one across processCandidate() calls to
// simulate multiple candidates in the same execution).
async function resolveViaWorkflow(validatedCandidate, discoveryRunId) {
  if (validatedCandidate.validationStatus !== "valid") {
    return runNode("Build Validation Failed Result", () => { throw new Error("no $() expected"); }, [validatedCandidate])[0].json;
  }
  const { data, error } = await adminClient.rpc("resolve_registry_candidate", {
    p_discovery_source: validatedCandidate.discovery_source,
    p_company_name: validatedCandidate.company_name,
    p_country_code: validatedCandidate.country_code,
    p_official_website_url: validatedCandidate.official_website_url,
    p_official_careers_url: validatedCandidate.official_careers_url,
    p_company_id_hint: validatedCandidate.company_id_hint,
    p_ats_provider_hint: validatedCandidate.ats_provider_hint,
    p_discovery_run_id: discoveryRunId,
    p_raw_payload: validatedCandidate.raw_payload ?? {},
  });
  const respShape = error ? { error: error.message } : { statusCode: 200, body: data };
  return runNode(
    "Classify RPC Outcome",
    (name) => {
      if (name === "Validate Candidate") return { first: () => ({ json: validatedCandidate }) };
      throw new Error(`unexpected $('${name}')`);
    },
    [respShape]
  )[0].json;
}

// Defaults to a fresh uuid per call (one candidate = one simulated run)
// unless the caller passes a shared discoveryRunId to simulate several
// candidates processed within the SAME Registry Sync execution.
async function processCandidate(discoverySource, raw, discoveryRunId = randomUUID()) {
  return resolveViaWorkflow(normalizeAndValidate(discoverySource, raw), discoveryRunId);
}

const fixtureCompanyIds = new Set();
const fixtureSourceIds = new Set();
const fixtureStagingIds = new Set();

after(async () => {
  if (fixtureStagingIds.size > 0) {
    await adminClient.from("registry_sync_staging").delete().in("id", [...fixtureStagingIds]);
  }
  if (fixtureSourceIds.size > 0) {
    await adminClient.from("company_sources").delete().in("id", [...fixtureSourceIds]);
  }
  if (fixtureCompanyIds.size > 0) {
    await adminClient.from("companies").delete().in("id", [...fixtureCompanyIds]);
  }
});

// A staged outcome carries company_id=null in the classified result even
// when company resolution already succeeded and created/matched a real
// row (the RPC's own return row nulls company_id/source_id for a staged
// candidate) — the real company reference only lives on the staging row's
// own candidate_company_id. Always resolve it so cleanup actually catches
// every fixture, not just the ones the top-level result happens to expose.
async function track(result) {
  if (result.company_id) fixtureCompanyIds.add(result.company_id);
  if (result.source_id) fixtureSourceIds.add(result.source_id);
  if (result.staging_id) {
    fixtureStagingIds.add(result.staging_id);
    const { data } = await adminClient.from("registry_sync_staging").select("candidate_company_id").eq("id", result.staging_id).single();
    if (data?.candidate_company_id) fixtureCompanyIds.add(data.candidate_company_id);
  }
  return result;
}

function fixtureName(label) {
  return `WF ${label} ${randomUUID().slice(0, 8)}`;
}

// ── A. Manual — brand new company/source ──────────────────────────────────

test("A. Manual: a brand new candidate creates exactly one company and one source", async () => {
  await assertExpectedLocalProject();
  const name = fixtureName("Manual New");
  const url = `https://${randomUUID()}.example/careers`;
  const r = await track(await processCandidate("manual", { company_name: name, country_code: "LB", official_careers_url: url }));
  assert.equal(r.outcome, "created_new");
  const { count } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("id", r.source_id);
  assert.equal(count, 1);
});

// ── B. Manual — exact same candidate twice ─────────────────────────────────

test("B. Manual: the exact same candidate submitted twice resolves existing the second time, no duplicate", async () => {
  const name = fixtureName("Manual Repeat");
  const url = `https://${randomUUID()}.example/careers`;
  const payload = { company_name: name, country_code: "LB", official_careers_url: url };
  const first = await track(await processCandidate("manual", payload));
  const second = await track(await processCandidate("manual", payload));
  assert.equal(first.outcome, "created_new");
  assert.equal(second.outcome, "resolved_existing");
  assert.equal(second.source_id, first.source_id);
  const { count } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", first.company_id);
  assert.equal(count, 1);
});

// ── C. Same source via Manual then CSV ─────────────────────────────────────

test("C. the same source discovered via manual then csv converges on one canonical source with accumulated provenance", async () => {
  const name = fixtureName("Manual Then CSV");
  const url = `https://${randomUUID()}.example/careers`;
  const manual = await track(await processCandidate("manual", { company_name: name, country_code: "QA", official_careers_url: url }));
  const csv = await track(await processCandidate("csv", { company_name: name, country_code: "QA", official_careers_url: url }));
  assert.equal(manual.outcome, "created_new");
  assert.equal(csv.outcome, "resolved_existing");
  assert.equal(csv.source_id, manual.source_id);
  const { data } = await adminClient.from("company_sources").select("discovery_channels").eq("id", manual.source_id).single();
  assert.deepEqual([...data.discovery_channels].sort(), ["csv", "manual"]);
});

// ── D. Same source via Manual -> CSV -> Apify ──────────────────────────────

test("D. manual -> csv -> apify rediscovery of the same source stays one canonical row with all three channels", async () => {
  const name = fixtureName("Triple Channel");
  const url = `https://${randomUUID()}.example/careers`;
  const manual = await track(await processCandidate("manual", { company_name: name, country_code: "KW", official_careers_url: url }));
  const csv = await track(await processCandidate("csv", { company_name: name, country_code: "KW", official_careers_url: url }));
  const apify = await track(await processCandidate("apify", { name, country: "KW", careers_url: url }));
  assert.equal(manual.outcome, "created_new");
  assert.equal(csv.outcome, "resolved_existing");
  assert.equal(apify.outcome, "resolved_existing");
  assert.equal(apify.source_id, manual.source_id);
  const { data } = await adminClient.from("company_sources").select("discovery_channels, discovery_source").eq("id", manual.source_id).single();
  assert.deepEqual([...data.discovery_channels].sort(), ["apify", "csv", "manual"]);
  assert.equal(data.discovery_source, "manual", "first-discovery channel is write-once");
  const { count } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", manual.company_id);
  assert.equal(count, 1);
});

// ── E. Invalid country ──────────────────────────────────────────────────────

test("E. an invalid country_code is staged, never becomes a canonical row", async () => {
  const name = fixtureName("Bad Country");
  const r = await track(await processCandidate("manual", { company_name: name, country_code: "ZZ", official_careers_url: `https://${randomUUID()}.example/careers` }));
  assert.equal(r.outcome, "staged");
  const { count } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_name", name);
  assert.equal(count, 0);
});

// ── F. Missing resolvable URL ──────────────────────────────────────────────

test("F. no resolvable careers/website URL is staged, never becomes a canonical source", async () => {
  const name = fixtureName("No URL");
  const r = await track(await processCandidate("csv", { company_name: name, country_code: "LB", official_careers_url: "unknown", official_website_url: "" }));
  assert.equal(r.outcome, "staged");
  const { count } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_name", name);
  assert.equal(count, 0);
});

// ── G. Ambiguous company ────────────────────────────────────────────────────

test("G. a candidate matching two existing companies by normalized name is staged, never guessed", async () => {
  const suffix = randomUUID().slice(0, 8);
  const idA = `cc-wfambig-${suffix}-a`;
  const idB = `cc-wfambig-${suffix}-b`;
  const { error } = await adminClient.from("companies").insert([
    { id: idA, display_name: `WF Ambig ${suffix}` },
    { id: idB, display_name: `WF, Ambig, ${suffix}` },
  ]);
  assert.equal(error, null);
  fixtureCompanyIds.add(idA);
  fixtureCompanyIds.add(idB);

  const r = await track(await processCandidate("apify", { name: `WF AMBIG ${suffix}`, country: "SA", careers_url: `https://${randomUUID()}.example/careers` }));
  assert.equal(r.outcome, "staged");
  const { count: aCount } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", idA);
  const { count: bCount } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", idB);
  assert.equal(aCount, 0);
  assert.equal(bCount, 0);
});

// ── H. Duplicate rows inside one CSV ───────────────────────────────────────

test("H. two identical rows in the same CSV parse converge on one canonical identity", async () => {
  const name = fixtureName("CSV Dup Rows");
  const url = `https://${randomUUID()}.example/careers`;
  const csvContent =
    "company_name,country_code,official_website_url,official_careers_url\n" +
    `${name},AE,,${url}\n` +
    `${name},AE,,${url}\n`;

  const parsed = runNode("Parse CSV Candidates", (n) => {
    if (n === "Workflow Configuration") return { first: () => ({ json: { csvContent } }) };
    throw new Error(`unexpected $('${n}')`);
  }, []);
  assert.equal(parsed.length, 2, "the parser itself does not deduplicate");

  const results = [];
  for (const item of parsed) {
    results.push(await track(await processCandidate(item.json.discovery_source, item.json.raw)));
  }
  assert.equal(results[0].outcome, "created_new");
  assert.equal(results[1].outcome, "resolved_existing");
  assert.equal(results[1].source_id, results[0].source_id);
});

// ── I. Re-import the same CSV ──────────────────────────────────────────────

test("I. re-processing the identical CSV content a second time produces zero new canonical rows", async () => {
  const name = fixtureName("CSV Reimport");
  const url = `https://${randomUUID()}.example/careers`;
  const csvContent = `company_name,country_code,official_website_url,official_careers_url\n${name},SA,,${url}\n`;

  async function runOnce() {
    const parsed = runNode("Parse CSV Candidates", () => ({ first: () => ({ json: { csvContent } }) }), []);
    return await track(await processCandidate(parsed[0].json.discovery_source, parsed[0].json.raw));
  }

  const firstImport = await runOnce();
  const secondImport = await runOnce();
  assert.equal(firstImport.outcome, "created_new");
  assert.equal(secondImport.outcome, "resolved_existing");
  const { count } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", firstImport.company_id);
  assert.equal(count, 1, "a full CSV re-import must be idempotent at the canonical registry level");
});

// ── J. Concurrent duplicate candidate attempts ─────────────────────────────

test("J. ten concurrent candidate resolutions for the identical new source produce exactly one canonical identity", async () => {
  const name = fixtureName("Concurrent");
  const url = `https://${randomUUID()}.example/careers`;
  const raw = { company_name: name, country_code: "QA", official_careers_url: url };

  const results = await Promise.allSettled(Array.from({ length: 10 }, () => processCandidate("apify", raw)));
  const fulfilled = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  assert.equal(fulfilled.length, 10, "every concurrent attempt must resolve or create, never throw");
  for (const r of fulfilled) await track(r);

  const companyIds = new Set(fulfilled.map((r) => r.company_id));
  const sourceIds = new Set(fulfilled.map((r) => r.source_id));
  assert.equal(companyIds.size, 1, "all concurrent attempts must agree on one company");
  assert.equal(sourceIds.size, 1, "all concurrent attempts must agree on one source");
  const created = fulfilled.filter((r) => r.outcome === "created_new");
  assert.equal(created.length, 1, "exactly one concurrent attempt may create the canonical row");
});

// ── K. One bad row in a batch does not block the others ───────────────────

test("K. one row with a missing company_name is isolated as validation_failed while the other rows in the same batch still resolve", async () => {
  const goodNameA = fixtureName("Batch Good A");
  const goodNameB = fixtureName("Batch Good B");
  const batch = [
    { company_name: goodNameA, country_code: "LB", official_careers_url: `https://${randomUUID()}.example/careers` },
    { company_name: "", country_code: "LB", official_careers_url: `https://${randomUUID()}.example/careers` },
    { company_name: goodNameB, country_code: "LB", official_careers_url: `https://${randomUUID()}.example/careers` },
  ];
  const results = [];
  for (const raw of batch) results.push(await track(await processCandidate("csv", raw)));

  assert.equal(results[0].outcome, "created_new");
  assert.equal(results[1].outcome, "validation_failed");
  assert.equal(results[2].outcome, "created_new", "a bad row must not block subsequent rows in the same batch");
});

// ── M. Apify malformed row is isolated ─────────────────────────────────────

test("M. a malformed Apify row (missing name) is isolated as validation_failed while a well-formed row in the same fetch still resolves", async () => {
  const goodName = fixtureName("Apify Good");
  const apifyItems = [
    { website: "https://malformed.example" }, // no name/company_name at all
    { name: goodName, country: "AE", careers_url: `https://${randomUUID()}.example/careers` },
  ];
  const extracted = runNode("Extract Apify Candidates", (n) => {
    if (n === "Evaluate Apify Fetch") return { first: () => ({ json: { succeeded: true, items: apifyItems } }) };
    if (n === "Workflow Configuration") return { first: () => ({ json: { apifyMaxItems: 50 } }) };
    throw new Error(`unexpected $('${n}')`);
  }, []);
  assert.equal(extracted.length, 2);

  const results = [];
  for (const item of extracted) results.push(await track(await processCandidate(item.json.discovery_source, item.json.raw)));
  assert.equal(results[0].outcome, "validation_failed");
  assert.equal(results[1].outcome, "created_new");
});

// ── N. Existing real canonical source must never be duplicated ────────────

test("N. rediscovering a real, pre-existing canonical source (sr-ae-accor) resolves existing and never duplicates it", async () => {
  const { data: before } = await adminClient.from("company_sources").select("id, company_id, official_careers_url, review_status").eq("id", "sr-ae-accor").maybeSingle();
  if (!before) return; // environment without the seeded registry — nothing to verify here
  const { count: beforeCount } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", before.company_id);

  const r = await processCandidate("apify", { name: "Accor", country: "AE", careers_url: before.official_careers_url });
  assert.equal(r.outcome, "resolved_existing");
  assert.equal(r.source_id, "sr-ae-accor");

  const { count: afterCount } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", before.company_id);
  assert.equal(afterCount, beforeCount, "a real, already-canonical source must never be duplicated");

  const { data: after } = await adminClient.from("company_sources").select("review_status").eq("id", "sr-ae-accor").single();
  assert.equal(after.review_status, before.review_status, "rediscovery must never change an existing review decision");
});

// ── O. discovery_run_id provenance ─────────────────────────────────────────

test("O. a real discoveryRunId reaches both companies.discovery_run_id and company_sources.discovery_run_id for a new candidate", async () => {
  const name = fixtureName("Run Id New");
  const url = `https://${randomUUID()}.example/careers`;
  const runId = randomUUID();
  const r = await track(await processCandidate("apify", { name, country: "LB", careers_url: url }, runId));
  assert.equal(r.outcome, "created_new");
  const { data: company } = await adminClient.from("companies").select("discovery_run_id").eq("id", r.company_id).single();
  const { data: source } = await adminClient.from("company_sources").select("discovery_run_id").eq("id", r.source_id).single();
  assert.equal(company.discovery_run_id, runId);
  assert.equal(source.discovery_run_id, runId);
});

test("P. multiple candidates processed with the same discoveryRunId (one simulated Registry Sync execution) all store that identical value", async () => {
  const runId = randomUUID();
  const nameA = fixtureName("Same Run A");
  const nameB = fixtureName("Same Run B");
  const a = await track(await processCandidate("apify", { name: nameA, country: "SA", careers_url: `https://${randomUUID()}.example/careers` }, runId));
  const b = await track(await processCandidate("apify", { name: nameB, country: "SA", careers_url: `https://${randomUUID()}.example/careers` }, runId));
  assert.equal(a.outcome, "created_new");
  assert.equal(b.outcome, "created_new");
  const { data: companyA } = await adminClient.from("companies").select("discovery_run_id").eq("id", a.company_id).single();
  const { data: companyB } = await adminClient.from("companies").select("discovery_run_id").eq("id", b.company_id).single();
  assert.equal(companyA.discovery_run_id, runId);
  assert.equal(companyB.discovery_run_id, runId, "every candidate in the same simulated run must share the identical discoveryRunId");
});

test("Q. rediscovery with a new discoveryRunId advances discovery_run_id via coalesce, and resolved_existing/dedup still holds", async () => {
  const name = fixtureName("Run Id Rediscover");
  const url = `https://${randomUUID()}.example/careers`;
  const firstRunId = randomUUID();
  const secondRunId = randomUUID();
  const first = await track(await processCandidate("manual", { company_name: name, country_code: "LB", official_careers_url: url }, firstRunId));
  const second = await track(await processCandidate("manual", { company_name: name, country_code: "LB", official_careers_url: url }, secondRunId));
  assert.equal(first.outcome, "created_new");
  assert.equal(second.outcome, "resolved_existing");
  assert.equal(second.source_id, first.source_id, "rediscovery must still resolve to the same canonical source, never duplicate it");
  const { count } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", first.company_id);
  assert.equal(count, 1, "idempotency/dedup is unaffected by discovery_run_id changing");
  const { data: source } = await adminClient.from("company_sources").select("discovery_run_id").eq("id", first.source_id).single();
  assert.equal(source.discovery_run_id, secondRunId, "discovery_run_id must advance to the most recent run that (re)saw this source");
});

// ── Registry Sync never writes source_intelligence, end to end ────────────

test("processing a brand new candidate through the full workflow logic never inserts a source_intelligence row", async () => {
  const name = fixtureName("No SI Write");
  const r = await track(await processCandidate("manual", { company_name: name, country_code: "LB", official_careers_url: `https://${randomUUID()}.example/careers` }));
  assert.equal(r.outcome, "created_new");
  const { count } = await adminClient.from("source_intelligence").select("id", { count: "exact", head: true }).eq("source_id", r.source_id);
  assert.equal(count, 0);
});
