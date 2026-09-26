// Unit tests for src/lib/coverLetters/prompt.ts and response.ts (Phase 08).
// Pure logic, no DB, no network, no LLM call.
//
// Run: node --test tests/unit/cover-letter-prompt-and-response.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildCoverLetterPrompt } from "../../src/lib/coverLetters/prompt.ts";
import { parseCoverLetterResponse } from "../../src/lib/coverLetters/response.ts";

describe("buildCoverLetterPrompt", () => {
  const profile = {
    professionalSummary: "Five years of backend experience.",
    skills: ["TypeScript", "PostgreSQL"],
    strongestAreas: ["API design"],
    profileLevel: "mid-level",
  };
  const job = {
    title: "Backend Engineer",
    description: "Build APIs.",
    companyName: "Acme",
    location: "Beirut, Lebanon",
    workArrangement: "remote",
  };
  const match = { explanation: "Strong overlap in backend skills.", strengths: ["TypeScript", "APIs"] };

  test("includes the profile, job, and fit sections", () => {
    const prompt = buildCoverLetterPrompt(profile, job, match);
    assert.match(prompt, /CANDIDATE PROFILE/);
    assert.match(prompt, /JOB LISTING/);
    assert.match(prompt, /WHY THIS IS A GOOD FIT/);
    assert.match(prompt, /Acme/);
    assert.match(prompt, /Backend Engineer/);
    assert.match(prompt, /Strong overlap in backend skills\./);
  });

  test("instructs the model never to fabricate facts or use a placeholder company name", () => {
    const prompt = buildCoverLetterPrompt(profile, job, match);
    assert.match(prompt, /never invent/i);
    assert.match(prompt, /never a placeholder/i);
  });

  test("treats the job listing as untrusted data, not instructions", () => {
    const prompt = buildCoverLetterPrompt(profile, job, match);
    assert.match(prompt, /untrusted external content/);
  });

  test("omits null optional fields cleanly", () => {
    const prompt = buildCoverLetterPrompt(
      { professionalSummary: null, skills: [], strongestAreas: [], profileLevel: null },
      { ...job, location: null, workArrangement: null },
      { explanation: null, strengths: [] }
    );
    assert.match(prompt, /Skills: \(none listed\)/);
    assert.match(prompt, /\(no additional notes\)/);
  });
});

describe("parseCoverLetterResponse", () => {
  const validLetter = "Dear Hiring Team,\n\n" + "This is a well-written cover letter body. ".repeat(5) + "\n\nSincerely,";

  test("accepts a plain string response within length bounds", () => {
    const result = parseCoverLetterResponse(validLetter);
    assert.equal(result.ok, true);
    assert.equal(result.value, validLetter.trim());
  });

  test("accepts an object with a content field", () => {
    const result = parseCoverLetterResponse({ content: validLetter });
    assert.equal(result.ok, true);
    assert.equal(result.value, validLetter.trim());
  });

  test("rejects a too-short response", () => {
    const result = parseCoverLetterResponse("Too short.");
    assert.equal(result.ok, false);
  });

  test("rejects a too-long response", () => {
    const result = parseCoverLetterResponse("x".repeat(5000));
    assert.equal(result.ok, false);
  });

  test("rejects a non-string, non-content-object response", () => {
    const result = parseCoverLetterResponse({ score: 90 });
    assert.equal(result.ok, false);
  });

  test("rejects null and undefined", () => {
    assert.equal(parseCoverLetterResponse(null).ok, false);
    assert.equal(parseCoverLetterResponse(undefined).ok, false);
  });
});
