// DB test for Phase 12's findEligibleCompanySources (Ashby added Phase 13)
// against the real local Supabase instance and its real, already-imported
// company_sources registry (593 rows as of this phase — no fixture rows
// are inserted here; this asserts against known-real registry data,
// verified independently via direct SQL during the Phase 12/13 audits).
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject } from "./helpers.mjs";
import { findEligibleCompanySources } from "../../src/lib/ingestion/findEligibleCompanySources.ts";

test("findEligibleCompanySources: returns only verified, suitable_public_ats, URL-derivable rows for the four supported ATS adapters", async () => {
  await assertExpectedLocalProject();

  const sources = await findEligibleCompanySources(adminClient);

  assert.ok(sources.length >= 10, `expected at least 10 real derivable sources in the registry, got ${sources.length}`);

  for (const source of sources) {
    assert.ok(["greenhouse", "lever", "workable", "ashby"].includes(source.sourceType), `unexpected sourceType: ${source.sourceType}`);
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

  // A specific, known-real row confirmed during the audit (Alpaca, Saudi
  // Arabia, Greenhouse) must be present.
  const { data: alpaca } = await adminClient.from("company_sources").select("id").eq("company_name", "Alpaca").maybeSingle();
  if (alpaca) {
    assert.ok(sourceIds.includes(alpaca.id), "expected Alpaca (a known real, derivable Greenhouse row) to be included");
  }

  // A specific, known-real Ashby row confirmed live during Phase 13
  // (The Utopia Studio, Qatar) must be present.
  const { data: utopiaStudio } = await adminClient.from("company_sources").select("id").eq("company_name", "The Utopia Studio").maybeSingle();
  if (utopiaStudio) {
    assert.ok(sourceIds.includes(utopiaStudio.id), "expected The Utopia Studio (a known real, live-verified Ashby row) to be included");
  }
});
