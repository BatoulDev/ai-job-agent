// Unit tests for src/lib/matching/embeddingText.ts and cosineSimilarity.ts
// (Phase 05). Pure logic, no DB, no network, no embedding provider.
//
// Run: node --test tests/unit/matching-embedding-text.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildJobEmbeddingText, buildProfileEmbeddingText, hashEmbeddingText } from "../../src/lib/matching/embeddingText.ts";
import { cosineSimilarity } from "../../src/lib/matching/cosineSimilarity.ts";

describe("buildJobEmbeddingText", () => {
  const baseJob = {
    title: "Backend Engineer",
    description: "Build APIs.",
    company_name: "Acme",
    location: "Beirut, Lebanon",
    work_arrangement: "onsite",
    seniority: "mid-level",
    employment_type: "full-time",
  };

  test("includes every provided field", () => {
    const text = buildJobEmbeddingText(baseJob);
    assert.match(text, /Title: Backend Engineer/);
    assert.match(text, /Company: Acme/);
    assert.match(text, /Seniority: mid-level/);
    assert.match(text, /Employment type: full-time/);
    assert.match(text, /Work arrangement: onsite/);
    assert.match(text, /Location: Beirut, Lebanon/);
    assert.match(text, /Description: Build APIs\./);
  });

  test("omits null fields rather than printing 'null'", () => {
    const text = buildJobEmbeddingText({ ...baseJob, location: null, seniority: null, employment_type: null, work_arrangement: null });
    assert.doesNotMatch(text, /null/);
    assert.doesNotMatch(text, /Location:/);
  });

  test("is deterministic", () => {
    assert.equal(buildJobEmbeddingText(baseJob), buildJobEmbeddingText({ ...baseJob }));
  });
});

describe("buildProfileEmbeddingText", () => {
  const baseProfile = {
    professionalSummary: "Five years of backend experience.",
    skills: ["TypeScript", "PostgreSQL"],
    recommendedRoles: ["Backend Engineer"],
    strongestAreas: ["API design"],
    profileLevel: "mid-level",
    targetRoles: ["Software Engineer"],
    preferredLocations: ["Beirut"],
    jobType: "full-time",
    experienceLevel: "mid",
  };

  test("includes every non-empty field", () => {
    const text = buildProfileEmbeddingText(baseProfile);
    assert.match(text, /Summary: Five years/);
    assert.match(text, /Skills: TypeScript, PostgreSQL/);
    assert.match(text, /Recommended roles: Backend Engineer/);
    assert.match(text, /Target roles: Software Engineer/);
    assert.match(text, /Preferred locations: Beirut/);
  });

  test("omits empty arrays and null fields", () => {
    const text = buildProfileEmbeddingText({
      ...baseProfile,
      skills: [],
      recommendedRoles: [],
      strongestAreas: [],
      targetRoles: [],
      preferredLocations: [],
      professionalSummary: null,
      profileLevel: null,
      jobType: null,
      experienceLevel: null,
    });
    assert.doesNotMatch(text, /Skills:/);
    assert.doesNotMatch(text, /null/);
  });

  test("never invents facts not present in the input", () => {
    const text = buildProfileEmbeddingText({ ...baseProfile, skills: ["TypeScript"] });
    assert.doesNotMatch(text, /Python/);
  });
});

describe("hashEmbeddingText", () => {
  test("same text always hashes the same", () => {
    assert.equal(hashEmbeddingText("hello"), hashEmbeddingText("hello"));
  });

  test("different text hashes differently", () => {
    assert.notEqual(hashEmbeddingText("hello"), hashEmbeddingText("hello world"));
  });

  test("detects a content change end-to-end via buildJobEmbeddingText", () => {
    const job = { title: "A", description: "x", company_name: "C", location: null, work_arrangement: null, seniority: null, employment_type: null };
    const hashBefore = hashEmbeddingText(buildJobEmbeddingText(job));
    const hashAfter = hashEmbeddingText(buildJobEmbeddingText({ ...job, description: "y" }));
    assert.notEqual(hashBefore, hashAfter);
  });
});

describe("cosineSimilarity", () => {
  test("identical vectors have similarity 1", () => {
    assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
  });

  test("orthogonal vectors have similarity 0", () => {
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  });

  test("opposite vectors have similarity -1", () => {
    assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  });

  test("a zero vector never divides by zero", () => {
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  });

  test("throws on mismatched vector lengths rather than silently truncating", () => {
    assert.throws(() => cosineSimilarity([1, 2], [1, 2, 3]));
  });
});
