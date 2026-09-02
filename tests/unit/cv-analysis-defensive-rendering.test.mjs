// Unit tests for the defensive-rendering fix in
// src/components/dashboard/cvProfile/AiCareerProfileSection.tsx
// (toDisplayStrings / toDisplayObjects).
//
// Regression coverage for a live-reproduced crash during the Automation-1
// audit: a cv_analyses row whose career_recommendations array contained an
// object instead of a string (React refuses to render an object as a
// child) took down the entire CV Profile page to a full error boundary,
// because TagList/BulletList/CvInformationGroup rendered every array
// element unconditionally, trusting the declared TypeScript type instead of
// validating the actual runtime shape. A matching DB-level backstop was
// also added — see
// supabase/migrations/20260825100020_validate_cv_analysis_array_shapes.sql
// — this file covers the frontend layer, which must hold even for any
// historical row that predates that constraint.
//
// Mirrors the real implementation (see the file header comment convention
// already used by tests/unit/ai-career-profile-popup.test.mjs — a plain
// "use client" React component file can't be imported directly by
// `node --test` without a DOM/React test environment).
//
// Run: node --test tests/unit/cv-analysis-defensive-rendering.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── Inline mirror of AiCareerProfileSection.tsx's defensive helpers ────────

function toDisplayStrings(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (typeof item === "string" ? item : null))
    .filter((item) => !!item && item.trim().length > 0);
}

function toDisplayObjects(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => !!item && typeof item === "object" && !Array.isArray(item));
}

describe("toDisplayStrings", () => {
  test("passes through a well-formed string array unchanged", () => {
    assert.deepEqual(toDisplayStrings(["React", "Node.js"]), ["React", "Node.js"]);
  });

  test("drops a non-string element instead of crashing on render (the reproduced bug)", () => {
    // Exactly the malformed shape that crashed the CV Profile page live:
    // an object where a string was expected.
    const malformed = ["Apply to backend roles.", { title: "Something", detail: "else" }, "Second recommendation."];
    assert.deepEqual(toDisplayStrings(malformed), ["Apply to backend roles.", "Second recommendation."]);
  });

  test("drops null, undefined, numbers, and empty/whitespace-only strings", () => {
    assert.deepEqual(toDisplayStrings([null, undefined, 42, "", "   ", "Valid"]), ["Valid"]);
  });

  test("a non-array input (e.g. a stray object) becomes an empty list, not a crash", () => {
    assert.deepEqual(toDisplayStrings({ not: "an array" }), []);
    assert.deepEqual(toDisplayStrings(null), []);
    assert.deepEqual(toDisplayStrings(undefined), []);
  });
});

describe("toDisplayObjects", () => {
  test("passes through a well-formed object array unchanged", () => {
    const education = [{ institution: "Lebanese University", degree: "BSc" }];
    assert.deepEqual(toDisplayObjects(education), education);
  });

  test("drops a null or non-object element instead of crashing on property access", () => {
    const malformed = [{ institution: "Real University" }, null, "a stray string", 42];
    assert.deepEqual(toDisplayObjects(malformed), [{ institution: "Real University" }]);
  });

  test("drops a nested array element (arrays are objects in JS but not what this expects)", () => {
    assert.deepEqual(toDisplayObjects([{ ok: true }, ["nested", "array"]]), [{ ok: true }]);
  });

  test("a non-array input becomes an empty list, not a crash", () => {
    assert.deepEqual(toDisplayObjects("not an array"), []);
    assert.deepEqual(toDisplayObjects(null), []);
  });
});
