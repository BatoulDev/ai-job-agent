// P0 remediation — additive canonical-company + company-source/provenance
// foundation (supabase/migrations/20260914150000_create_companies_and_
// company_sources.sql), exercised against REAL parsed CSV rows via the
// actual import script's own functions (scripts/import-company-registry.mjs)
// — not synthetic placeholder data — so a real regression in the
// convergence map or the parser itself would fail this suite, not just a
// hand-written fixture. Filtered to the 11 rows relevant to the human
// identity decision (docs/job-ingestion-database-readiness-audit.md
// Sections 21-22) to keep the shared local dev database's footprint small;
// the full 588-row import is proven separately by running
// `node scripts/import-company-registry.mjs` directly (see that script's
// own header), not by this automated suite.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadAllRows, buildCompanies, buildCompanySources } from "../../scripts/import-company-registry.mjs";
import { adminClient, assertExpectedLocalProject, createAnonClient, createTestUser, deleteTestUsers } from "./helpers.mjs";

const RELEVANT_CANONICAL_IDS = new Set([
  "cc-amazon-uae",
  "cc-amazon-sa",
  "cc-accenture-sa",
  "cc-accenture-qatar",
  "cc-slb",
  "cc-slb-qatar",
  "cc-slb-formerly-schlumberger",
  "cc-tcs",
  "cc-tata-consultancy-services-qatar",
  "cc-apparel-group",
  "cc-apparel-group-sa",
]);

let companies;
let companySources;
let ordinaryUser;

before(async () => {
  await assertExpectedLocalProject();

  const allRows = loadAllRows();
  const relevantRows = allRows.filter((r) => RELEVANT_CANONICAL_IDS.has(r.canonical_company_id));
  assert.equal(relevantRows.length, 11, "expected exactly 11 real CSV rows for the 5 flagged companies");

  companies = buildCompanies(relevantRows);
  companySources = buildCompanySources(relevantRows);

  const { error: companiesError } = await adminClient.from("companies").upsert(companies, { onConflict: "id" });
  if (companiesError) throw new Error(`fixture companies upsert failed: ${companiesError.message}`);
  const { error: sourcesError } = await adminClient.from("company_sources").upsert(companySources, { onConflict: "id" });
  if (sourcesError) throw new Error(`fixture company_sources upsert failed: ${sourcesError.message}`);

  ordinaryUser = await createTestUser("company-registry-user");
});

after(async () => {
  const sourceIds = companySources.map((s) => s.id);
  const companyIds = companies.map((c) => c.id);
  if (sourceIds.length > 0) {
    const { error } = await adminClient.from("company_sources").delete().in("id", sourceIds);
    if (error) throw new Error(`cleanup: failed to delete fixture company_sources: ${error.message}`);
  }
  if (companyIds.length > 0) {
    const { error } = await adminClient.from("companies").delete().in("id", companyIds);
    if (error) throw new Error(`cleanup: failed to delete fixture companies: ${error.message}`);
  }
  const { data: remaining } = await adminClient.from("company_sources").select("id").in("id", sourceIds);
  assert.equal(remaining?.length ?? 0, 0, "fixture company_sources rows must not survive cleanup");

  await deleteTestUsers([ordinaryUser]);
});

test("Amazon UAE and Amazon Saudi Arabia remain distinct companies after import", async () => {
  const { data: rows } = await adminClient
    .from("company_sources")
    .select("id, company_id, target_country")
    .in("id", ["sr-ae-amazon-uae", "sr-sa-amazon-web-services-amazon"]);
  assert.equal(rows.length, 2);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId["sr-ae-amazon-uae"].company_id, "cc-amazon-uae");
  assert.equal(byId["sr-sa-amazon-web-services-amazon"].company_id, "cc-amazon-sa");
  assert.notEqual(byId["sr-ae-amazon-uae"].company_id, byId["sr-sa-amazon-web-services-amazon"].company_id);

  const { data: companyRows } = await adminClient.from("companies").select("id").in("id", ["cc-amazon-uae", "cc-amazon-sa"]);
  assert.equal(companyRows.length, 2, "both Amazon companies rows must exist separately, not merged into one");
});

test("Accenture Qatar and Accenture Saudi Arabia remain distinct companies after import", async () => {
  const { data: rows } = await adminClient
    .from("company_sources")
    .select("id, company_id")
    .in("id", ["sr-qa-accenture", "sr-sa-accenture-middle-east"]);
  assert.equal(rows.length, 2);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId["sr-qa-accenture"].company_id, "cc-accenture-qatar");
  assert.equal(byId["sr-sa-accenture-middle-east"].company_id, "cc-accenture-sa");

  const { data: companyRows } = await adminClient.from("companies").select("id").in("id", ["cc-accenture-qatar", "cc-accenture-sa"]);
  assert.equal(companyRows.length, 2, "both Accenture companies rows must exist separately, not merged into one");
});

test("SLB's three regional sources converge onto one company, provenance preserved", async () => {
  const { data: rows } = await adminClient
    .from("company_sources")
    .select("id, company_id, target_country")
    .in("id", ["sr-sa-slb", "sr-qa-slb", "sr-kw-slb-formerly-schlumberger"]);
  assert.equal(rows.length, 3, "all three original source rows must still exist independently");
  for (const row of rows) assert.equal(row.company_id, "cc-slb");

  const { data: companyRows } = await adminClient.from("companies").select("id").eq("id", "cc-slb");
  assert.equal(companyRows.length, 1, "exactly one shared companies row, not three");
});

test("TCS's two regional sources converge onto one company", async () => {
  const { data: rows } = await adminClient
    .from("company_sources")
    .select("id, company_id")
    .in("id", ["sr-sa-tata-consultancy-services", "sr-qa-tcs"]);
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.company_id, "cc-tcs");
});

test("Apparel Group's two regional sources converge onto one company", async () => {
  const { data: rows } = await adminClient
    .from("company_sources")
    .select("id, company_id")
    .in("id", ["sr-sa-apparel-group", "sr-kw-apparel-group"]);
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.company_id, "cc-apparel-group");
});

test("needs_manual_review rows remain identifiable as unresolved after import — never silently promoted to verified", async () => {
  const { data: rows } = await adminClient
    .from("company_sources")
    .select("id, review_status")
    .in("id", ["sr-kw-slb-formerly-schlumberger", "sr-kw-apparel-group"]);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.review_status, "needs_manual_review", `${row.id} must stay needs_manual_review, not be treated as approved`);
  }
});

test("repeated company/source imports are idempotent — no duplicates, same counts on rerun", async () => {
  const { error: firstRerunCompanies } = await adminClient.from("companies").upsert(companies, { onConflict: "id" });
  assert.equal(firstRerunCompanies, null);
  const { error: firstRerunSources } = await adminClient.from("company_sources").upsert(companySources, { onConflict: "id" });
  assert.equal(firstRerunSources, null);

  const { data: companyRows } = await adminClient
    .from("companies")
    .select("id")
    .in("id", companies.map((c) => c.id));
  const { data: sourceRows } = await adminClient
    .from("company_sources")
    .select("id")
    .in("id", companySources.map((s) => s.id));
  assert.equal(companyRows.length, companies.length);
  assert.equal(sourceRows.length, companySources.length);
});

test("conflicting company mappings cannot silently overwrite existing provenance", async () => {
  const { error } = await adminClient.from("company_sources").update({ company_id: "cc-accenture-sa" }).eq("id", "sr-sa-slb");
  assert.notEqual(error, null, "remapping an existing source to a different company must be rejected");
  assert.match(error.message, /company_id cannot be changed/);

  const { data: unchanged } = await adminClient.from("company_sources").select("company_id").eq("id", "sr-sa-slb").single();
  assert.equal(unchanged.company_id, "cc-slb", "the original mapping must survive the rejected attempt untouched");
});

test("anon and authenticated roles cannot read company_sources; authenticated can read companies but not write either table", async () => {
  const anon = createAnonClient();
  const { data: anonSources, error: anonSourcesError } = await anon.from("company_sources").select("id").limit(1);
  assert.notEqual(anonSourcesError, null);
  assert.equal(anonSources, null);

  const { data: userSources, error: userSourcesError } = await ordinaryUser.client.from("company_sources").select("id").limit(1);
  assert.notEqual(userSourcesError, null);
  assert.equal(userSources, null);

  const { data: userCompanies, error: userCompaniesError } = await ordinaryUser.client.from("companies").select("id").limit(1);
  assert.equal(userCompaniesError, null);
  assert.ok(Array.isArray(userCompanies));

  const { error: insertError } = await ordinaryUser.client.from("companies").insert({ id: "cc-forged", display_name: "Forged Co" });
  assert.notEqual(insertError, null);

  const { error: sourceInsertError } = await ordinaryUser.client.from("company_sources").insert({
    id: "sr-forged",
    company_id: "cc-amazon-uae",
    company_name: "Forged",
    target_country: "Nowhere",
    review_status: "verified",
  });
  assert.notEqual(sourceInsertError, null);
});

test("service_role can perform the required ingestion mutations (already proven by before()/idempotency tests above, re-asserted directly)", async () => {
  const { data, error } = await adminClient.from("company_sources").select("id, review_status").eq("id", "sr-sa-slb").single();
  assert.equal(error, null);
  assert.equal(data.review_status, "verified");
});
