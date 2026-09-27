// Unit tests for src/lib/matches/types.ts's mapMatchRow (Phase 07). Pure
// logic, no DB, no network.
//
// Run: node --test tests/unit/match-row-mapping.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mapMatchRow } from "../../src/lib/matches/types.ts";

function baseRow(overrides = {}) {
  return {
    match_id: "match-1",
    score: 82,
    score_breakdown: { strengths: ["TypeScript", "APIs"], preference_alignment: "Matches remote preference." },
    explanation: "Strong technical fit.",
    missing_skills: ["Kubernetes"],
    match_status: "pending_review",
    matching_model: "gpt-4o-mini",
    decided_at: null,
    created_at: "2026-09-01T00:00:00Z",
    job_id: "job-1",
    job_title: "Backend Engineer",
    job_company_name: "Acme",
    job_location: "Beirut, Lebanon",
    job_work_arrangement: "remote",
    job_employment_type: "full-time",
    job_seniority: "mid-level",
    job_application_method: "external_link",
    job_application_url: "https://example.test/apply",
    job_application_email: null,
    job_source_type: "greenhouse",
    job_source_url: "https://boards.greenhouse.io/acme/jobs/1",
    job_status: "active",
    ...overrides,
  };
}

describe("mapMatchRow", () => {
  test("maps a well-formed row into camelCase fields with a nested job", () => {
    const result = mapMatchRow(baseRow());
    assert.equal(result.id, "match-1");
    assert.equal(result.score, 82);
    assert.deepEqual(result.strengths, ["TypeScript", "APIs"]);
    assert.equal(result.preferenceAlignment, "Matches remote preference.");
    assert.deepEqual(result.missingSkills, ["Kubernetes"]);
    assert.equal(result.status, "pending_review");
    assert.equal(result.job.id, "job-1");
    assert.equal(result.job.title, "Backend Engineer");
    assert.equal(result.job.status, "active");
  });

  test("defensively defaults malformed score_breakdown and missing_skills instead of throwing", () => {
    const result = mapMatchRow(baseRow({ score_breakdown: "not an object", missing_skills: null }));
    assert.deepEqual(result.strengths, []);
    assert.equal(result.preferenceAlignment, null);
    assert.deepEqual(result.missingSkills, []);
  });
});
