// Unit tests for src/lib/matching/rerankPrompt.ts and rerankResponse.ts
// (Phase 06). Pure logic, no DB, no network, no LLM call.
//
// Run: node --test tests/unit/rerank-prompt-and-response.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildRerankPrompt } from "../../src/lib/matching/rerankPrompt.ts";
import { parseRerankResponse } from "../../src/lib/matching/rerankResponse.ts";

describe("buildRerankPrompt", () => {
  const profile = {
    professionalSummary: "Five years of backend experience.",
    skills: ["TypeScript", "PostgreSQL"],
    recommendedRoles: ["Backend Engineer"],
    strongestAreas: ["API design"],
    profileLevel: "mid-level",
  };
  const job = {
    title: "Backend Engineer",
    description: "Build APIs.",
    companyName: "Acme",
    location: "Beirut, Lebanon",
    workArrangement: "onsite",
    seniority: "mid-level",
    employmentType: "full-time",
  };

  test("includes both the profile and job sections", () => {
    const prompt = buildRerankPrompt(profile, job);
    assert.match(prompt, /CANDIDATE PROFILE/);
    assert.match(prompt, /JOB LISTING/);
    assert.match(prompt, /Skills: TypeScript, PostgreSQL/);
    assert.match(prompt, /Title: Backend Engineer/);
  });

  test("instructs the model never to invent facts", () => {
    const prompt = buildRerankPrompt(profile, job);
    assert.match(prompt, /[Nn]ever invent/);
  });

  test("marks the job listing as untrusted content", () => {
    const prompt = buildRerankPrompt(profile, job);
    assert.match(prompt, /untrusted/);
  });

  test("instructs a strict JSON response shape naming every required field", () => {
    const prompt = buildRerankPrompt(profile, job);
    for (const field of ["score", "reason", "strengths", "missing_skills", "preference_alignment"]) {
      assert.match(prompt, new RegExp(field), `prompt must mention "${field}"`);
    }
  });

  test("omits empty profile fields rather than printing 'null' or empty lists", () => {
    const prompt = buildRerankPrompt({ ...profile, skills: [], recommendedRoles: [], strongestAreas: [], professionalSummary: null, profileLevel: null }, job);
    assert.doesNotMatch(prompt, /null/);
  });

  test("is deterministic", () => {
    assert.equal(buildRerankPrompt(profile, job), buildRerankPrompt({ ...profile }, { ...job }));
  });
});

describe("parseRerankResponse — valid responses", () => {
  function validResponse(overrides = {}) {
    return {
      score: 85,
      reason: "Strong alignment on backend skills.",
      strengths: ["TypeScript", "API design"],
      missing_skills: ["Kubernetes"],
      preference_alignment: "Matches the candidate's onsite Beirut preference.",
      ...overrides,
    };
  }

  test("accepts a well-formed object", () => {
    const result = parseRerankResponse(validResponse());
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
      score: 85,
      reason: "Strong alignment on backend skills.",
      strengths: ["TypeScript", "API design"],
      missingSkills: ["Kubernetes"],
      preferenceAlignment: "Matches the candidate's onsite Beirut preference.",
    });
  });

  test("accepts a well-formed JSON string (LLMs sometimes wrap output as a string)", () => {
    const result = parseRerankResponse(JSON.stringify(validResponse()));
    assert.equal(result.ok, true);
  });

  test("accepts empty strengths/missing_skills arrays", () => {
    const result = parseRerankResponse(validResponse({ strengths: [], missing_skills: [] }));
    assert.equal(result.ok, true);
  });

  test("accepts score boundary values 0 and 100", () => {
    assert.equal(parseRerankResponse(validResponse({ score: 0 })).ok, true);
    assert.equal(parseRerankResponse(validResponse({ score: 100 })).ok, true);
  });
});

describe("parseRerankResponse — malformed responses rejected", () => {
  function validResponse(overrides = {}) {
    return {
      score: 85,
      reason: "Strong alignment.",
      strengths: ["TypeScript"],
      missing_skills: [],
      preference_alignment: "Matches.",
      ...overrides,
    };
  }

  test("rejects invalid JSON string", () => {
    assert.equal(parseRerankResponse("not json").ok, false);
  });

  test("rejects a non-object", () => {
    assert.equal(parseRerankResponse(null).ok, false);
    assert.equal(parseRerankResponse([1, 2]).ok, false);
    assert.equal(parseRerankResponse("42").ok, false);
  });

  test("rejects a score outside 0-100", () => {
    assert.equal(parseRerankResponse(validResponse({ score: -1 })).ok, false);
    assert.equal(parseRerankResponse(validResponse({ score: 101 })).ok, false);
  });

  test("rejects a non-integer score", () => {
    assert.equal(parseRerankResponse(validResponse({ score: 85.5 })).ok, false);
  });

  test("rejects a missing or empty reason", () => {
    assert.equal(parseRerankResponse(validResponse({ reason: "" })).ok, false);
    assert.equal(parseRerankResponse({ ...validResponse(), reason: undefined }).ok, false);
  });

  test("rejects a non-array strengths or missing_skills", () => {
    assert.equal(parseRerankResponse(validResponse({ strengths: "TypeScript" })).ok, false);
    assert.equal(parseRerankResponse(validResponse({ missing_skills: "Kubernetes" })).ok, false);
  });

  test("rejects an array field containing a non-string", () => {
    assert.equal(parseRerankResponse(validResponse({ strengths: ["ok", 5] })).ok, false);
  });

  test("rejects a missing or empty preference_alignment", () => {
    assert.equal(parseRerankResponse(validResponse({ preference_alignment: "" })).ok, false);
  });
});
