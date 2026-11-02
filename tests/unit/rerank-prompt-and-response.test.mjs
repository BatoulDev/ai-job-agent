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
    preferredWorkArrangement: null,
    preferredJobType: null,
    targetRoles: [],
    preferredLocations: [],
    experienceLevel: null,
    // Work Authorization Phase 1: "not stated" defaults — every Free/
    // Student user, structurally, plus any Pro user who never opted in.
    willingToRelocate: null,
    workAuthorizationStatus: null,
    relocationMarketCountryCodes: [],
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

  test("instructs the model not to flag a skill the profile already has (or an obvious equivalent) as missing", () => {
    const prompt = buildRerankPrompt(profile, job);
    assert.match(prompt, /missing_skills rules/);
    assert.match(prompt, /genuinely absent/);
    assert.match(prompt, /equivalent/);
  });

  test("instructs the model to return an empty missing_skills array rather than guessing when the job listing is sparse", () => {
    const prompt = buildRerankPrompt(profile, job);
    assert.match(prompt, /does not clearly state required skills.*empty missing_skills array/s);
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

  test("17/18. includes an explicit USER PREFERENCES section with the user's employment-type and work-arrangement preference, distinct from the JOB LISTING section", () => {
    const prompt = buildRerankPrompt({ ...profile, preferredJobType: "part-time", preferredWorkArrangement: "remote" }, job);
    assert.match(prompt, /USER PREFERENCES/);
    assert.match(prompt, /Employment type: part-time/);
    assert.match(prompt, /Work arrangement: remote/);
    // Both the USER PREFERENCES line and the JOB LISTING line exist, and in
    // the right order, proving they're separate sections, not merged.
    const prefIndex = prompt.indexOf("=== USER PREFERENCES ===");
    const jobIndex = prompt.indexOf("=== JOB LISTING ===");
    assert.ok(prefIndex > -1 && jobIndex > -1 && prefIndex < jobIndex);
  });

  test("19. cleanly omits the USER PREFERENCES section when both preferences are null, rather than printing 'null'", () => {
    const prompt = buildRerankPrompt({ ...profile, preferredJobType: null, preferredWorkArrangement: null }, job);
    assert.doesNotMatch(prompt, /=== USER PREFERENCES ===/);
    assert.doesNotMatch(prompt, /null/);
  });

  test("19b. renders only the preference that is actually set when the other is null", () => {
    const prompt = buildRerankPrompt({ ...profile, preferredJobType: "freelance", preferredWorkArrangement: null }, job);
    assert.match(prompt, /=== USER PREFERENCES ===/);
    assert.match(prompt, /Employment type: freelance/);
    assert.doesNotMatch(prompt, /Work arrangement: null/);
  });

  // Preference-to-matching coverage audit: preference_alignment must be
  // judged against the user's actual stated target roles/locations/
  // experience level, not only the AI Career Profile's own derived
  // recommendedRoles/profileLevel — see rerankPrompt.ts's RerankProfileInput.
  test("includes the user's actual target roles and preferred locations, distinct from the AI-derived recommendedRoles", () => {
    const prompt = buildRerankPrompt(
      { ...profile, recommendedRoles: ["Backend Engineer"], targetRoles: ["Software Engineer", "Platform Engineer"], preferredLocations: ["Beirut", "Remote"] },
      job
    );
    assert.match(prompt, /Target roles: Software Engineer, Platform Engineer/);
    assert.match(prompt, /Preferred locations: Beirut, Remote/);
    // Both the user's stated roles and the AI's derived recommendation must
    // be present — they are not the same thing and neither replaces the other.
    assert.match(prompt, /Recommended roles: Backend Engineer/);
  });

  test("includes the user's stated experience-level preference, distinct from the AI-derived profileLevel", () => {
    const prompt = buildRerankPrompt({ ...profile, profileLevel: "mid-level", experienceLevel: "entry-level" }, job);
    assert.match(prompt, /Level: mid-level/);
    assert.match(prompt, /Experience level: entry-level/);
  });

  test("omits target roles / preferred locations / experience level lines when unset, never prints empty labels", () => {
    const prompt = buildRerankPrompt({ ...profile, targetRoles: [], preferredLocations: [], experienceLevel: null }, job);
    assert.doesNotMatch(prompt, /Target roles:/);
    assert.doesNotMatch(prompt, /Preferred locations:/);
    assert.doesNotMatch(prompt, /Experience level:/);
  });
});

// Work Authorization Phase 1 (docs/PRODUCT_MATCHING_RULES.md "Work
// authorization") — advisory-only context, never a hard filter.
describe("buildRerankPrompt — work authorization (advisory only)", () => {
  const profile = {
    professionalSummary: "Five years of backend experience.",
    skills: ["TypeScript", "PostgreSQL"],
    recommendedRoles: ["Backend Engineer"],
    strongestAreas: ["API design"],
    profileLevel: "mid-level",
    preferredWorkArrangement: null,
    preferredJobType: null,
    targetRoles: [],
    preferredLocations: [],
    experienceLevel: null,
    willingToRelocate: null,
    workAuthorizationStatus: null,
    relocationMarketCountryCodes: [],
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

  test("FREE/STUDENT UNCHANGED: with no work-authorization fields set (every Free/Student user, structurally), the WORK AUTHORIZATION section is entirely omitted", () => {
    const prompt = buildRerankPrompt(profile, job);
    assert.doesNotMatch(prompt, /WORK AUTHORIZATION/);
  });

  test("ADVISORY ACCURACY: a stated work_authorization_status and relocation markets are rendered accurately, verbatim", () => {
    const prompt = buildRerankPrompt(
      { ...profile, workAuthorizationStatus: "needs_employer_support", relocationMarketCountryCodes: ["SA", "AE"], willingToRelocate: true },
      job
    );
    assert.match(prompt, /=== WORK AUTHORIZATION \(user-reported, advisory only — not verified\) ===/);
    assert.match(prompt, /User-reported work authorization status: needs_employer_support/);
    assert.match(prompt, /User-selected relocation markets: SA, AE/);
    assert.match(prompt, /User-reported willingness to relocate: yes/);
  });

  test("UNKNOWN NEVER PRESENTED AS VERIFIED: unset fields render as 'not stated', never a guessed or confirmed value", () => {
    const prompt = buildRerankPrompt({ ...profile, willingToRelocate: true }, job);
    assert.match(prompt, /User-reported work authorization status: not stated/);
    assert.match(prompt, /User-selected relocation markets: not stated/);
  });

  test("EMPLOYER SPONSORSHIP NEVER CLAIMED VERIFIED: the section always states sponsorship is unverified unless separately evidenced in the job listing", () => {
    const prompt = buildRerankPrompt({ ...profile, workAuthorizationStatus: "already_authorized" }, job);
    assert.match(prompt, /Employer sponsorship: unverified unless separately evidenced in the JOB LISTING text itself/);
  });

  test("NEVER A HARD FILTER: the model is explicitly instructed that this section cannot change the eligibility decision, which is already final", () => {
    const prompt = buildRerankPrompt({ ...profile, workAuthorizationStatus: "already_authorized" }, job);
    assert.match(prompt, /can NEVER change whether this job is a match/);
    assert.match(prompt, /eligibility for this job has already been decided before this prompt was written/);
  });

  test("NEVER CLAIM VERIFIED AUTHORIZATION: the model is explicitly instructed never to claim the user is legally authorized based only on preference", () => {
    const prompt = buildRerankPrompt({ ...profile, workAuthorizationStatus: "already_authorized" }, job);
    assert.match(prompt, /[Nn]ever claim or imply the user is legally authorized to work in the job's country based only on their stated preference/);
  });

  test("the section renders when ONLY willingToRelocate is set (the other two still null) — any one of the three fields is enough to trigger it", () => {
    const prompt = buildRerankPrompt({ ...profile, willingToRelocate: false }, job);
    assert.match(prompt, /WORK AUTHORIZATION/);
    assert.match(prompt, /User-reported willingness to relocate: no/);
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
