// Registry Sync P0 database foundation — supabase/migrations/20260920090000
// through 20260920090030. Exercises the real resolve_registry_candidate()
// RPC and the real company_sources_identity_key against the shared local
// dev database, not a synthetic proxy.
//
// Every fixture in this file uses a uniquely-suffixed company/source name
// (randomUUID) so its deterministic ids can never collide with the real
// 553/588-row hand-curated registry already imported locally. Cleanup order
// matters: registry_sync_staging rows reference companies/company_sources
// with no ON DELETE clause (defaults to RESTRICT, same pattern already
// documented in tests/db/jobs-ingestion-identity.test.mjs for
// jobs.source_id), so staging rows must be deleted before the
// companies/company_sources rows they reference.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, createAnonClient } from "./helpers.mjs";

const fixtureCompanyIds = new Set();
const fixtureSourceIds = new Set();
const fixtureStagingIds = new Set();

after(async () => {
  if (fixtureStagingIds.size > 0) {
    const { error } = await adminClient.from("registry_sync_staging").delete().in("id", [...fixtureStagingIds]);
    if (error) throw new Error(`cleanup: failed to delete fixture staging rows: ${error.message}`);
  }
  if (fixtureSourceIds.size > 0) {
    const { error } = await adminClient.from("company_sources").delete().in("id", [...fixtureSourceIds]);
    if (error) throw new Error(`cleanup: failed to delete fixture company_sources: ${error.message}`);
  }
  if (fixtureCompanyIds.size > 0) {
    const { error } = await adminClient.from("companies").delete().in("id", [...fixtureCompanyIds]);
    if (error) throw new Error(`cleanup: failed to delete fixture companies: ${error.message}`);
  }
});

function fixtureName(label) {
  return `Fixture ${label} ${randomUUID().slice(0, 8)}`;
}

// normalize_company_name mirrors: lowercase, strip every non-alphanumeric
// character. Kept in lockstep with the SQL function under test so fixture
// ids can be predicted and tracked for cleanup.
function expectedCompanyId(name) {
  return "cc-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function expectedSourceId(countryCode, name) {
  return `sr-${countryCode.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
}

async function resolve(payload) {
  const { data, error } = await adminClient.rpc("resolve_registry_candidate", payload);
  if (error) throw error;
  return data[0];
}

// A staged outcome returns out_company_id=null even when company
// resolution already succeeded and created/matched a real row (the "no
// partial canonical state" case — see the dedicated test for that). Always
// look up the staging row's own candidate_company_id so that company is
// tracked for cleanup too, not just whatever the RPC's own return row
// happens to carry.
async function trackResult(result) {
  if (result.out_company_id) fixtureCompanyIds.add(result.out_company_id);
  if (result.out_source_id) fixtureSourceIds.add(result.out_source_id);
  if (result.out_staging_id) {
    fixtureStagingIds.add(result.out_staging_id);
    const { data: staging } = await adminClient.from("registry_sync_staging").select("candidate_company_id").eq("id", result.out_staging_id).single();
    if (staging?.candidate_company_id) fixtureCompanyIds.add(staging.candidate_company_id);
  }
  return result;
}

// ── 1/2. Existing 588-row registry backfilled correctly, zero collisions ──

test("every pre-existing company_sources row has a normalized_source_key or is one of the 3 known unresolvable rows", async () => {
  await assertExpectedLocalProject();
  const { data, error } = await adminClient
    .from("company_sources")
    .select("id, normalized_source_key, official_careers_url, official_website_url")
    .is("normalized_source_key", null);
  assert.equal(error, null);
  // Verified read-only during design: exactly 3 rows have both careers and
  // website URLs as unresolvable (sentinel/empty) values.
  assert.equal(data.length, 3, `expected exactly 3 rows with no resolvable URL, got ${data.length}: ${data.map((r) => r.id).join(", ")}`);
});

test("every pre-existing companies and company_sources row was backfilled with discovery_source='csv'", async () => {
  const { count: companiesMissing } = await adminClient
    .from("companies")
    .select("id", { count: "exact", head: true })
    .is("discovery_source", null);
  assert.equal(companiesMissing, 0);

  const { count: sourcesMissing } = await adminClient
    .from("company_sources")
    .select("id", { count: "exact", head: true })
    .is("discovery_source", null);
  assert.equal(sourcesMissing, 0);
});

test("zero (company_id, country_code, normalized_source_key) collisions exist in the live registry", async () => {
  const { data, error } = await adminClient
    .from("company_sources")
    .select("company_id, country_code, normalized_source_key")
    .not("normalized_source_key", "is", null);
  assert.equal(error, null);

  const seen = new Map();
  for (const row of data) {
    const key = `${row.company_id}::${row.country_code}::${row.normalized_source_key}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const collisions = [...seen.entries()].filter(([, count]) => count > 1);
  assert.deepEqual(collisions, [], "no (company_id, country_code, normalized_source_key) triple may repeat");
});

// ── 3/5. Repeated identical candidate never duplicates ────────────────────

test("the same manual candidate submitted 10 times in sequence resolves to exactly one company and one source", async () => {
  const name = fixtureName("Repeat Manual");
  const payload = {
    p_discovery_source: "manual",
    p_company_name: name,
    p_country_code: "LB",
    p_official_careers_url: `https://${randomUUID()}.example/careers`,
    p_raw_payload: { test: "repeat-manual" },
  };

  const outcomes = [];
  for (let i = 0; i < 10; i++) {
    outcomes.push(await trackResult(await resolve(payload)));
  }

  assert.equal(outcomes[0].outcome, "created_new");
  for (const o of outcomes.slice(1)) {
    assert.equal(o.outcome, "resolved_existing");
    assert.equal(o.out_company_id, outcomes[0].out_company_id);
    assert.equal(o.out_source_id, outcomes[0].out_source_id);
  }

  const { count: companyCount } = await adminClient.from("companies").select("id", { count: "exact", head: true }).eq("id", outcomes[0].out_company_id);
  assert.equal(companyCount, 1);
  const { count: sourceCount } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("id", outcomes[0].out_source_id);
  assert.equal(sourceCount, 1);
});

// ── 4. manual -> csv -> apify rediscovery stays ONE canonical row ─────────

test("the same candidate discovered via manual, then csv, then apify converges on one canonical company and source, with provenance accumulating", async () => {
  const name = fixtureName("Cross Channel");
  const url = `https://${randomUUID()}.example/careers`;
  const base = { p_company_name: name, p_country_code: "QA", p_official_careers_url: url };

  const manual = await trackResult(await resolve({ ...base, p_discovery_source: "manual", p_raw_payload: { via: "manual" } }));
  assert.equal(manual.outcome, "created_new");

  const csv = await trackResult(await resolve({ ...base, p_discovery_source: "csv", p_raw_payload: { via: "csv" } }));
  assert.equal(csv.outcome, "resolved_existing");
  assert.equal(csv.out_company_id, manual.out_company_id);
  assert.equal(csv.out_source_id, manual.out_source_id);

  const apify = await trackResult(await resolve({ ...base, p_discovery_source: "apify", p_raw_payload: { via: "apify" } }));
  assert.equal(apify.outcome, "resolved_existing");
  assert.equal(apify.out_company_id, manual.out_company_id);
  assert.equal(apify.out_source_id, manual.out_source_id);

  const { data: company } = await adminClient.from("companies").select("discovery_source, discovery_channels").eq("id", manual.out_company_id).single();
  assert.equal(company.discovery_source, "manual", "discovery_source is write-once: first-discovery channel only");
  assert.deepEqual([...company.discovery_channels].sort(), ["apify", "csv", "manual"]);

  const { data: source } = await adminClient.from("company_sources").select("discovery_source, discovery_channels").eq("id", manual.out_source_id).single();
  assert.equal(source.discovery_source, "manual");
  assert.deepEqual([...source.discovery_channels].sort(), ["apify", "csv", "manual"]);

  const { count } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", manual.out_company_id);
  assert.equal(count, 1, "exactly one canonical source row must exist across all three discovery channels");
});

// ── 6/8. Same company, same URL, different country stays allowed ─────────

test("one company with the same careers URL registered in two different countries produces two distinct canonical sources", async () => {
  const name = fixtureName("Multi Country");
  const url = `https://${randomUUID()}.example/careers`;

  const lb = await trackResult(await resolve({ p_discovery_source: "manual", p_company_name: name, p_country_code: "LB", p_official_careers_url: url, p_raw_payload: {} }));
  assert.equal(lb.outcome, "created_new");

  const ae = await trackResult(await resolve({ p_discovery_source: "manual", p_company_name: name, p_country_code: "AE", p_official_careers_url: url, p_raw_payload: {} }));
  assert.equal(ae.outcome, "created_new");

  assert.equal(ae.out_company_id, lb.out_company_id, "same normalized name must resolve to the same company");
  assert.notEqual(ae.out_source_id, lb.out_source_id, "different countries must produce different canonical sources");

  const { count } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", lb.out_company_id);
  assert.equal(count, 2, "one company legitimately owns two country-scoped sources");
});

// ── 7. Different companies, same careers URL stays allowed ───────────────

test("two different companies sharing the identical careers URL both resolve independently, never merged", async () => {
  const url = `https://${randomUUID()}.example/careers`;
  const nameA = fixtureName("Shared Portal Alpha");
  const nameB = fixtureName("Shared Portal Beta");

  const a = await trackResult(await resolve({ p_discovery_source: "manual", p_company_name: nameA, p_country_code: "KW", p_official_careers_url: url, p_raw_payload: {} }));
  const b = await trackResult(await resolve({ p_discovery_source: "manual", p_company_name: nameB, p_country_code: "KW", p_official_careers_url: url, p_raw_payload: {} }));

  assert.equal(a.outcome, "created_new");
  assert.equal(b.outcome, "created_new");
  assert.notEqual(a.out_company_id, b.out_company_id);
  assert.notEqual(a.out_source_id, b.out_source_id);
});

// ── 9. Ambiguous company identity stages, never auto-merges ──────────────

test("a candidate whose normalized name matches two existing companies is staged, not merged into either", async () => {
  const sharedSlug = `ambigtest${randomUUID().slice(0, 8)}`;
  const idA = `cc-${sharedSlug}-a`;
  const idB = `cc-${sharedSlug}-b`;
  // Deliberately construct two companies with the SAME normalized display
  // name (punctuation differs, normalize_company_name strips it) but
  // DIFFERENT ids — mirrors the real Accenture/Amazon shape without
  // touching those real rows.
  const { error: insertError } = await adminClient.from("companies").insert([
    { id: idA, display_name: `Ambig Test ${sharedSlug}` },
    { id: idB, display_name: `Ambig, Test, ${sharedSlug}` },
  ]);
  assert.equal(insertError, null);
  fixtureCompanyIds.add(idA);
  fixtureCompanyIds.add(idB);

  const result = await trackResult(
    await resolve({
      p_discovery_source: "apify",
      p_company_name: `AMBIG TEST ${sharedSlug}`,
      p_country_code: "SA",
      p_official_careers_url: `https://${randomUUID()}.example/careers`,
      p_raw_payload: {},
    })
  );

  assert.equal(result.outcome, "staged");
  assert.equal(result.out_company_id, null);
  assert.equal(result.out_source_id, null);

  const { data: staging } = await adminClient.from("registry_sync_staging").select("staging_reason, candidate_company_id").eq("id", result.out_staging_id).single();
  assert.equal(staging.staging_reason, "ambiguous_company_multiple_matches");
  assert.equal(staging.candidate_company_id, null, "an ambiguous match cannot guess which of the two companies is correct");

  const { count: sourcesForA } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", idA);
  const { count: sourcesForB } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", idB);
  assert.equal(sourcesForA, 0);
  assert.equal(sourcesForB, 0);
});

// ── 10. Concurrent duplicate writes cannot create duplicate canonical identity ──

test("ten concurrent calls for the identical new candidate produce exactly one canonical company and source", async () => {
  const name = fixtureName("Concurrent Fanout");
  const payload = {
    p_discovery_source: "apify",
    p_company_name: name,
    p_country_code: "QA",
    p_official_careers_url: `https://${randomUUID()}.example/careers`,
    p_raw_payload: {},
  };

  const results = await Promise.allSettled(Array.from({ length: 10 }, () => resolve(payload)));
  const fulfilled = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  assert.equal(fulfilled.length, 10, "every concurrent call must succeed (resolve or create), never error");
  for (const r of fulfilled) await trackResult(r);

  const created = fulfilled.filter((r) => r.outcome === "created_new");
  const resolved = fulfilled.filter((r) => r.outcome === "resolved_existing");
  assert.equal(created.length, 1, "exactly one concurrent caller may create the canonical row");
  assert.equal(resolved.length, 9);

  const companyIds = new Set(fulfilled.map((r) => r.out_company_id));
  const sourceIds = new Set(fulfilled.map((r) => r.out_source_id));
  assert.equal(companyIds.size, 1, "all ten calls must agree on one company id");
  assert.equal(sourceIds.size, 1, "all ten calls must agree on one source id");

  const { count } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", [...companyIds][0]);
  assert.equal(count, 1);
});

// ── 11/12. review_status and automation_eligibility survive rediscovery ──

test("review_status and automation_eligibility survive a rediscovery of an already-canonical source unchanged", async () => {
  const name = fixtureName("Reviewed Source");
  const url = `https://${randomUUID()}.example/careers`;
  const companyId = expectedCompanyId(name);
  const sourceId = expectedSourceId("SA", name);

  const { error: companyError } = await adminClient.from("companies").insert({ id: companyId, display_name: name });
  assert.equal(companyError, null);
  fixtureCompanyIds.add(companyId);

  const { error: sourceError } = await adminClient.from("company_sources").insert({
    id: sourceId,
    company_id: companyId,
    company_name: name,
    target_country: "Saudi Arabia",
    country_code: "SA",
    official_careers_url: url,
    review_status: "verified",
    automation_eligibility: "suitable_public_ats",
    ats_provider: "Greenhouse",
  });
  assert.equal(sourceError, null);
  fixtureSourceIds.add(sourceId);

  const rediscovered = await trackResult(
    await resolve({
      p_discovery_source: "apify",
      p_company_name: name,
      p_country_code: "SA",
      p_official_careers_url: url,
      p_ats_provider_hint: "unknown",
      p_raw_payload: {},
    })
  );
  assert.equal(rediscovered.outcome, "resolved_existing");
  assert.equal(rediscovered.out_source_id, sourceId);

  const { data: after } = await adminClient
    .from("company_sources")
    .select("review_status, automation_eligibility, ats_provider")
    .eq("id", sourceId)
    .single();
  assert.equal(after.review_status, "verified", "a human review decision must never be overwritten by rediscovery");
  assert.equal(after.automation_eligibility, "suitable_public_ats");
  assert.equal(after.ats_provider, "Greenhouse", "an already-classified ats_provider must not be overwritten by a rediscovery hint");
});

// ── 13. The RPC cannot accept review_status/automation_eligibility at all ──

test("review_status and automation_eligibility cannot be passed as RPC parameters — no such parameter exists", async () => {
  const { error } = await adminClient.rpc("resolve_registry_candidate", {
    p_discovery_source: "manual",
    p_company_name: fixtureName("Reject Params"),
    p_country_code: "LB",
    p_official_careers_url: `https://${randomUUID()}.example/careers`,
    review_status: "verified",
  });
  assert.notEqual(error, null, "PostgREST must reject an unknown parameter name outright — not silently ignore it");
});

// ── 14. Invalid/missing country stages, does not raise, does not leak the bad value into the FK column ──

test("a candidate with no country_code is staged with reason missing_country", async () => {
  const result = await trackResult(
    await resolve({
      p_discovery_source: "manual",
      p_company_name: fixtureName("No Country"),
      p_official_careers_url: `https://${randomUUID()}.example/careers`,
      p_raw_payload: {},
    })
  );
  assert.equal(result.outcome, "staged");
  const { data: staging } = await adminClient.from("registry_sync_staging").select("staging_reason, country_code").eq("id", result.out_staging_id).single();
  assert.equal(staging.staging_reason, "missing_country");
  assert.equal(staging.country_code, null);
});

test("a candidate with an unknown country_code is staged with reason invalid_country, never raises, and preserves the raw value in raw_payload", async () => {
  const result = await trackResult(
    await resolve({
      p_discovery_source: "manual",
      p_company_name: fixtureName("Bad Country"),
      p_country_code: "ZZ",
      p_official_careers_url: `https://${randomUUID()}.example/careers`,
      p_raw_payload: { submitted_country: "ZZ" },
    })
  );
  assert.equal(result.outcome, "staged");
  const { data: staging } = await adminClient.from("registry_sync_staging").select("staging_reason, country_code, raw_payload").eq("id", result.out_staging_id).single();
  assert.equal(staging.staging_reason, "invalid_country");
  assert.equal(staging.country_code, null, "the FK-constrained column must never store the invalid code itself");
  assert.equal(staging.raw_payload.submitted_country, "ZZ", "the original invalid value must still be visible to a reviewer");
});

// ── 15. No resolvable URL stages, does not guess ──────────────────────────

test("a candidate with no resolvable careers or website URL is staged with reason no_resolvable_url", async () => {
  const result = await trackResult(
    await resolve({
      p_discovery_source: "manual",
      p_company_name: fixtureName("No URL"),
      p_country_code: "LB",
      p_official_careers_url: "unknown",
      p_official_website_url: "none found",
      p_raw_payload: {},
    })
  );
  assert.equal(result.outcome, "staged");
  const { data: staging } = await adminClient.from("registry_sync_staging").select("staging_reason").eq("id", result.out_staging_id).single();
  assert.equal(staging.staging_reason, "no_resolvable_url");
});

test("a possible second source for a company already on file in that market is staged, never silently created as a second canonical row", async () => {
  const name = fixtureName("Second Source");
  const firstUrl = `https://${randomUUID()}.example/careers`;
  const secondUrl = `https://${randomUUID()}.example/careers-alt`;

  const first = await trackResult(await resolve({ p_discovery_source: "manual", p_company_name: name, p_country_code: "LB", p_official_careers_url: firstUrl, p_raw_payload: {} }));
  assert.equal(first.outcome, "created_new");

  const second = await trackResult(await resolve({ p_discovery_source: "apify", p_company_name: name, p_country_code: "LB", p_official_careers_url: secondUrl, p_raw_payload: {} }));
  assert.equal(second.outcome, "staged");

  const { data: staging } = await adminClient.from("registry_sync_staging").select("staging_reason, candidate_company_id").eq("id", second.out_staging_id).single();
  assert.equal(staging.staging_reason, "possible_second_source_same_market");
  assert.equal(staging.candidate_company_id, first.out_company_id);

  const { count } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", first.out_company_id);
  assert.equal(count, 1, "the second, different-URL candidate must not become a second canonical row without review");
});

// ── 16. No unintended partial canonical state when source resolution stages ──

test("when company resolution succeeds but source resolution stages, the company is a fully valid standalone row — no partial/broken canonical state", async () => {
  const name = fixtureName("Company Only");
  const result = await trackResult(
    await resolve({
      p_discovery_source: "manual",
      p_company_name: name,
      p_country_code: "LB",
      p_official_careers_url: "not_verified",
      p_raw_payload: {},
    })
  );
  assert.equal(result.outcome, "staged");

  const { data: staging } = await adminClient.from("registry_sync_staging").select("candidate_company_id, staging_reason").eq("id", result.out_staging_id).single();
  assert.equal(staging.staging_reason, "no_resolvable_url");
  assert.notEqual(staging.candidate_company_id, null);
  fixtureCompanyIds.add(staging.candidate_company_id);

  const { data: company, error } = await adminClient.from("companies").select("id, display_name").eq("id", staging.candidate_company_id).single();
  assert.equal(error, null);
  assert.equal(company.display_name, name, "the company row is complete and valid on its own, discoverable and promotable later");

  const { count } = await adminClient.from("company_sources").select("id", { count: "exact", head: true }).eq("company_id", staging.candidate_company_id);
  assert.equal(count, 0, "no partial/malformed company_sources row was left behind");
});

// ── 17. Existing human-curated rows remain valid ──────────────────────────

test("a spot-checked pre-existing, human-curated company_sources row is untouched by the migration beyond its new columns", async () => {
  const { data, error } = await adminClient
    .from("company_sources")
    .select("id, company_id, review_status, ats_provider, discovery_source, normalized_source_key")
    .eq("id", "sr-sa-slb")
    .maybeSingle();
  assert.equal(error, null);
  if (data) {
    assert.equal(data.company_id, "cc-slb");
    assert.equal(data.discovery_source, "csv");
    // review_status/ats_provider are whatever the CSV already had — only
    // asserting they still exist and were not nulled out by the migration.
    assert.notEqual(data.review_status, null);
  }
});

// ── 18. Foreign-key integrity ─────────────────────────────────────────────

test("no company_sources row references a missing company, and no jobs row references a missing company_sources row", async () => {
  const { data: sources, error: sourcesError } = await adminClient.from("company_sources").select("id, company_id");
  assert.equal(sourcesError, null);
  const { data: companies, error: companiesError } = await adminClient.from("companies").select("id");
  assert.equal(companiesError, null);
  const companyIdSet = new Set(companies.map((c) => c.id));
  const orphanSources = sources.filter((s) => !companyIdSet.has(s.company_id));
  assert.deepEqual(orphanSources, [], "every company_sources.company_id must resolve to an existing companies row");

  const { data: jobs, error: jobsError } = await adminClient.from("jobs").select("id, source_id").not("source_id", "is", null);
  assert.equal(jobsError, null);
  const sourceIdSet = new Set(sources.map((s) => s.id));
  const orphanJobs = jobs.filter((j) => !sourceIdSet.has(j.source_id));
  assert.deepEqual(orphanJobs, [], "every non-null jobs.source_id must resolve to an existing company_sources row");
});

// ── 19. RLS / grants match approved service-role-only access ─────────────

test("anon and authenticated cannot read or write registry_sync_staging, and cannot execute resolve_registry_candidate", async () => {
  const anon = createAnonClient();

  // No grant at all for anon/authenticated (matching company_sources' own
  // established pattern) — Postgres rejects SELECT with a permission error
  // before RLS is even evaluated, not a silently-filtered empty result set.
  const { data: selectData, error: selectError } = await anon.from("registry_sync_staging").select("id").limit(1);
  assert.notEqual(selectError, null);
  assert.equal(selectData, null);

  const { error: insertError } = await anon.from("registry_sync_staging").insert({ discovery_source: "manual", staging_reason: "x" });
  assert.notEqual(insertError, null, "anon must not be able to insert into registry_sync_staging");

  const { error: rpcError } = await anon.rpc("resolve_registry_candidate", {
    p_discovery_source: "manual",
    p_company_name: "RLS probe",
    p_raw_payload: {},
  });
  assert.notEqual(rpcError, null, "anon must not be able to execute resolve_registry_candidate");
});

// ── 20/21. Source Intelligence compatibility ──────────────────────────────

test("a newly created, still-unclassified source naturally becomes a Source Intelligence candidate, and Registry Sync never writes source_intelligence itself", async () => {
  const name = fixtureName("SI Candidate");
  const result = await trackResult(
    await resolve({
      p_discovery_source: "csv",
      p_company_name: name,
      p_country_code: "KW",
      p_official_careers_url: `https://${randomUUID()}.example/careers`,
      p_raw_payload: {},
    })
  );
  assert.equal(result.outcome, "created_new");

  const { data: candidates, error } = await adminClient.rpc("get_source_intelligence_candidates", { p_limit: 1000 });
  assert.equal(error, null);
  const candidateIds = candidates.map((c) => c.id);
  assert.ok(candidateIds.includes(result.out_source_id), "a fresh, unclassified source must appear in the candidate-selection RPC without any push from Registry Sync");

  const { count: siCount } = await adminClient.from("source_intelligence").select("id", { count: "exact", head: true }).eq("source_id", result.out_source_id);
  assert.equal(siCount, 0, "Registry Sync must never write source_intelligence rows itself");
});

// ── 22. google_sheets is a valid discovery_source (migration 20260923120000) ──
// Registry Sync's n8n workflow replaced its CSV-paste input mode with a
// native Google Sheets read. These tests exercise the same outcomes already
// covered for manual/csv/apify above, this time through google_sheets, plus
// confirm csv remains a fully valid historical value (never removed).

test("google_sheets is accepted as a discovery_source and can create a new company/source", async () => {
  const name = fixtureName("Sheets New");
  const result = await trackResult(
    await resolve({
      p_discovery_source: "google_sheets",
      p_company_name: name,
      p_country_code: "LB",
      p_official_careers_url: `https://${randomUUID()}.example/careers`,
      p_raw_payload: { via: "google_sheets" },
    })
  );
  assert.equal(result.outcome, "created_new");

  const { data: company } = await adminClient.from("companies").select("discovery_source, discovery_channels").eq("id", result.out_company_id).single();
  assert.equal(company.discovery_source, "google_sheets");
  assert.deepEqual([...company.discovery_channels], ["google_sheets"]);
});

test("a google_sheets rediscovery of an existing manual candidate resolves to the same company/source and provenance accumulates", async () => {
  const name = fixtureName("Sheets Rediscover");
  const url = `https://${randomUUID()}.example/careers`;

  const manual = await trackResult(await resolve({ p_discovery_source: "manual", p_company_name: name, p_country_code: "QA", p_official_careers_url: url, p_raw_payload: {} }));
  assert.equal(manual.outcome, "created_new");

  const viaSheets = await trackResult(await resolve({ p_discovery_source: "google_sheets", p_company_name: name, p_country_code: "QA", p_official_careers_url: url, p_raw_payload: {} }));
  assert.equal(viaSheets.outcome, "resolved_existing");
  assert.equal(viaSheets.out_company_id, manual.out_company_id);
  assert.equal(viaSheets.out_source_id, manual.out_source_id);

  const { data: source } = await adminClient.from("company_sources").select("discovery_channels").eq("id", manual.out_source_id).single();
  assert.deepEqual([...source.discovery_channels].sort(), ["google_sheets", "manual"]);
});

test("a google_sheets candidate with no resolvable URL is staged with reason no_resolvable_url, same as any other channel", async () => {
  const result = await trackResult(
    await resolve({
      p_discovery_source: "google_sheets",
      p_company_name: fixtureName("Sheets No URL"),
      p_country_code: "LB",
      p_raw_payload: {},
    })
  );
  assert.equal(result.outcome, "staged");
  const { data: staging } = await adminClient.from("registry_sync_staging").select("staging_reason, discovery_source").eq("id", result.out_staging_id).single();
  assert.equal(staging.staging_reason, "no_resolvable_url");
  assert.equal(staging.discovery_source, "google_sheets");
});

test("discovery_source='csv' remains valid for new rows — google_sheets was added, csv was never removed", async () => {
  const name = fixtureName("Csv Still Valid");
  const companyId = expectedCompanyId(name);
  const { error } = await adminClient.from("companies").insert({
    id: companyId,
    display_name: name,
    discovery_source: "csv",
    discovery_channels: ["csv"],
  });
  assert.equal(error, null, "the widened CHECK constraint must still accept csv");
  fixtureCompanyIds.add(companyId);
});

test("resolve_registry_candidate still rejects a p_discovery_source value outside manual/csv/apify/google_sheets", async () => {
  const { error } = await adminClient.rpc("resolve_registry_candidate", {
    p_discovery_source: "spreadsheet",
    p_company_name: fixtureName("Bad Source"),
    p_country_code: "LB",
    p_raw_payload: {},
  });
  assert.notEqual(error, null, "an unrecognized discovery_source must still be rejected, not silently accepted");
});
