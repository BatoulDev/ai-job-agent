// DB test for Phase 13's findCareerPageExtractionCandidates against the
// real local Supabase instance and its real, already-imported
// company_sources registry — mirrors
// tests/db/find-eligible-company-sources.test.mjs's structure for the
// suitable_public_html_subject_to_review classification instead of
// suitable_public_ats.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject } from "./helpers.mjs";
import { findCareerPageExtractionCandidates } from "../../src/lib/ingestion/findCareerPageExtractionCandidates.ts";

test("findCareerPageExtractionCandidates: returns verified, suitable_public_html_subject_to_review rows with a real careers URL, bounded by limit", async () => {
  await assertExpectedLocalProject();

  const candidates = await findCareerPageExtractionCandidates(adminClient, 5);
  assert.equal(candidates.length, 5, "limit must be honored — the real registry has far more than 5 such rows (Phase 12 found 358)");

  for (const candidate of candidates) {
    assert.ok(candidate.sourceId, "every candidate must have a sourceId");
    assert.match(candidate.careersUrl, /^https?:\/\//);
  }

  // Cross-check independently: every returned sourceId must actually be
  // verified + suitable_public_html_subject_to_review right now.
  const sourceIds = candidates.map((c) => c.sourceId);
  const { data: rows, error } = await adminClient.from("company_sources").select("id, review_status, automation_eligibility").in("id", sourceIds);
  assert.equal(error, null);
  for (const row of rows) {
    assert.equal(row.review_status, "verified");
    assert.equal(row.automation_eligibility, "suitable_public_html_subject_to_review");
  }
});

test("findCareerPageExtractionCandidates: a known real row (Byblos Bank, confirmed during the Phase 13 audit) is present in the unbounded set", async () => {
  const candidates = await findCareerPageExtractionCandidates(adminClient, 500);
  const { data: byblos } = await adminClient.from("company_sources").select("id").eq("company_name", "Byblos Bank").maybeSingle();
  if (byblos) {
    assert.ok(candidates.some((c) => c.sourceId === byblos.id), "expected Byblos Bank (a known real candidate) to be included");
  }
});
