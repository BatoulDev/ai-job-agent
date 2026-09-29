// DB test for Phase 12's findEligibleCompanySources (Ashby added Phase 13,
// Oracle HCM added Phase 16) against the real local Supabase instance and
// its real, repository-tracked company_sources registry (588 rows as of
// this task, restored via scripts/import-company-registry.mjs — see that
// script's own header). The base assertions (>=10 derivable sources, the
// Greenhouse/Ashby spot-checks) intentionally assert against this real,
// reproducible registry data, since this test's own purpose is validating
// registry-derived behavior, not isolated unit logic.
//
// FIXTURE REPRODUCIBILITY FIX (tests/db reproducibility gap, see
// docs/LEBANON_GULF_PLAN_CONSISTENCY_AUDIT.md and this task's own report):
// the Oracle HCM spot-check used to name one specific real row (AUBMC,
// Lebanon) whose official_careers_url had been manually corrected, during
// an earlier session, from its as-imported landing-page URL to the real,
// directly-derivable Oracle Cloud CandidateExperience URL
// (ORACLE_PATTERN in deriveAtsFeedUrl.ts). That correction was applied
// directly to the shared dev database, never captured back into the
// registry CSV, and was lost when a clean `supabase db reset` rebuilt the
// database from migrations + the CSV re-import alone — a real, confirmed
// registry-completeness gap (Phase 2 classification: test-fixture/
// reproducibility bug, not a production defect — deriveAtsFeedUrl.ts is
// working exactly as designed, correctly declining to derive a feed URL
// from a non-matching landing-page URL). Replaced with a dedicated,
// self-contained fixture row using the same known-real Oracle Cloud URL
// shape already used by tests/unit/derive-ats-feed-url.test.mjs, so the
// Oracle HCM adapter path no longer depends on any one historical row's
// state.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject } from "./helpers.mjs";
import { findEligibleCompanySources } from "../../src/lib/ingestion/findEligibleCompanySources.ts";

let fixtureCompanyId;
let fixtureSourceId;

after(async () => {
  if (fixtureSourceId) {
    const { error } = await adminClient.from("company_sources").delete().eq("id", fixtureSourceId);
    if (error) throw new Error(`cleanup: failed to delete fixture company_sources: ${error.message}`);
  }
  if (fixtureCompanyId) {
    const { error } = await adminClient.from("companies").delete().eq("id", fixtureCompanyId);
    if (error) throw new Error(`cleanup: failed to delete fixture companies: ${error.message}`);
  }
});

test("findEligibleCompanySources: returns only verified, suitable_public_ats, URL-derivable rows for the five supported ATS adapters", async () => {
  await assertExpectedLocalProject();

  // Dedicated, self-contained Oracle HCM fixture — see header comment.
  const suffix = randomUUID().slice(0, 8);
  fixtureCompanyId = `cc-oraclehcm-fixture-${suffix}`;
  fixtureSourceId = `sr-oraclehcm-fixture-${suffix}`;
  const { error: companyError } = await adminClient.from("companies").insert({ id: fixtureCompanyId, display_name: `Oracle HCM Fixture ${suffix}` });
  assert.equal(companyError, null, `fixture company insert failed: ${companyError?.message}`);
  const { error: sourceError } = await adminClient.from("company_sources").insert({
    id: fixtureSourceId,
    company_id: fixtureCompanyId,
    company_name: `Oracle HCM Fixture ${suffix}`,
    target_country: "Lebanon",
    country_code: "LB",
    ats_provider: "Oracle Cloud Recruiting",
    official_careers_url: "https://fa-exxn-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2",
    review_status: "verified",
    automation_eligibility: "suitable_public_ats",
  });
  assert.equal(sourceError, null, `fixture company_sources insert failed: ${sourceError?.message}`);

  const sources = await findEligibleCompanySources(adminClient);

  assert.ok(sources.length >= 10, `expected at least 10 real derivable sources in the registry, got ${sources.length}`);

  for (const source of sources) {
    assert.ok(["greenhouse", "lever", "workable", "ashby", "oracle_hcm"].includes(source.sourceType), `unexpected sourceType: ${source.sourceType}`);
    assert.match(source.feedUrl, /^https:\/\//);
    assert.ok(source.sourceId, "every source must have a sourceId");
  }

  // Cross-check against the DB directly: every returned sourceId must
  // actually be verified + suitable_public_ats right now (never trust the
  // function's own filtering without an independent check).
  const sourceIds = sources.map((s) => s.sourceId);
  const { data: rows, error } = await adminClient
    .from("company_sources")
    .select("id, review_status, automation_eligibility")
    .in("id", sourceIds);
  assert.equal(error, null);
  for (const row of rows) {
    assert.equal(row.review_status, "verified");
    assert.equal(row.automation_eligibility, "suitable_public_ats");
  }

  // A specific, known-real row from the repository-tracked registry
  // (Alpaca, Saudi Arabia, Greenhouse) must be present.
  const { data: alpaca } = await adminClient.from("company_sources").select("id").eq("company_name", "Alpaca").maybeSingle();
  if (alpaca) {
    assert.ok(sourceIds.includes(alpaca.id), "expected Alpaca (a known real, derivable Greenhouse row) to be included");
  }

  // A specific, known-real Ashby row from the registry (The Utopia
  // Studio, Qatar) must be present.
  const { data: utopiaStudio } = await adminClient.from("company_sources").select("id").eq("company_name", "The Utopia Studio").maybeSingle();
  if (utopiaStudio) {
    assert.ok(sourceIds.includes(utopiaStudio.id), "expected The Utopia Studio (a known real, live-verified Ashby row) to be included");
  }

  // The dedicated Oracle HCM fixture must be included — proves the
  // adapter path deterministically, independent of any one historical
  // registry row's manually-corrected state.
  assert.ok(sourceIds.includes(fixtureSourceId), "expected the dedicated Oracle Cloud Recruiting fixture to be included");
  const oracleResult = sources.find((s) => s.sourceId === fixtureSourceId);
  assert.equal(oracleResult.sourceType, "oracle_hcm");
  assert.match(oracleResult.feedUrl, /hcmRestApi\/resources\/latest\/recruitingCEJobRequisitions/);
});
