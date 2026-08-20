// Unit tests for CV ownership name-matching logic.
// Run: node --test tests/unit/cv-ownership.test.mjs
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── Mirrored implementation ───────────────────────────────────────────────────
// Must stay in sync with the tokenize + Jaccard logic in the
// "Validate CV Ownership" n8n workflow node (cv-analysis-worker.ts/json).

function tokenize(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function validateOwnership(accountName, candidateName) {
  if (!candidateName || !accountName) return "unable_to_verify";
  const tokA = tokenize(accountName);
  const tokB = tokenize(candidateName);
  if (tokA.length === 0 || tokB.length === 0) return "unable_to_verify";
  const setA = new Set(tokA);
  const setB = new Set(tokB);
  let shared = 0;
  for (const t of setA) {
    if (setB.has(t)) shared++;
  }
  const union = setA.size + setB.size - shared;
  const similarity = union === 0 ? 1 : shared / union;
  if (shared === 0) return "name_mismatch";
  if (similarity >= 0.4) return "verified";
  return "unable_to_verify";
}

// ── Clear matches ─────────────────────────────────────────────────────────────

describe("clear matches => verified", () => {
  test("exact same name", () => {
    assert.equal(
      validateOwnership("Batoul Abedelrahman", "Batoul Abedelrahman"),
      "verified"
    );
  });

  test("case insensitive: uppercase account, lowercase CV", () => {
    assert.equal(
      validateOwnership("BATOUL ABEDELRAHMAN", "batoul abedelrahman"),
      "verified"
    );
  });

  test("first name only in CV (Jaccard 0.5)", () => {
    // tokA=["batoul","abedelrahman"], tokB=["batoul"] => shared 1 / union 2 = 0.5
    assert.equal(
      validateOwnership("Batoul Abedelrahman", "Batoul"),
      "verified"
    );
  });

  test("extra middle name in CV", () => {
    // tokA=["batoul","abedelrahman"], tokB=["batoul","marie","abedelrahman"]
    // shared 2 / union 3 = 0.67
    assert.equal(
      validateOwnership("Batoul Abedelrahman", "Batoul Marie Abedelrahman"),
      "verified"
    );
  });

  test("reversed name order: family name first in CV", () => {
    // Same token set regardless of order
    assert.equal(
      validateOwnership("Abedelrahman Batoul", "Batoul Abedelrahman"),
      "verified"
    );
  });

  test("single-character token filtered, rest still matches", () => {
    // "B. Batoul Abedelrahman" => "b" filtered (len 1), leaves ["batoul","abedelrahman"]
    assert.equal(
      validateOwnership("Batoul Abedelrahman", "B. Batoul Abedelrahman"),
      "verified"
    );
  });

  test("single-token names that match", () => {
    // tokA=["batoul"], tokB=["batoul"] => Jaccard 1.0
    assert.equal(validateOwnership("Batoul", "Batoul"), "verified");
  });
});

// ── Uncertain cases => unable_to_verify (never blocked) ──────────────────────

describe("uncertain cases => unable_to_verify", () => {
  test("Arabic transliteration variant (Jaccard 0.25)", () => {
    // tokA=["batoul","abedelrahman"], tokB=["batoul","abdul","rahman"]
    // shared 1 / union 4 = 0.25 — must NOT block
    assert.equal(
      validateOwnership("Batoul Abedelrahman", "Batoul Abdul Rahman"),
      "unable_to_verify"
    );
  });

  test("low overlap: many-token account, few-token CV (Jaccard 0.2)", () => {
    // tokA=["ahmad","mohammad","ali","hassan"], tokB=["ahmad","farid"]
    // shared 1 / union 5 = 0.2
    assert.equal(
      validateOwnership("Ahmad Mohammad Ali Hassan", "Ahmad Farid"),
      "unable_to_verify"
    );
  });

  test("null candidate name", () => {
    assert.equal(
      validateOwnership("Batoul Abedelrahman", null),
      "unable_to_verify"
    );
  });

  test("empty string candidate name", () => {
    assert.equal(
      validateOwnership("Batoul Abedelrahman", ""),
      "unable_to_verify"
    );
  });

  test("null account name", () => {
    assert.equal(
      validateOwnership(null, "Batoul Abedelrahman"),
      "unable_to_verify"
    );
  });
});

// ── Clear mismatch => name_mismatch (blocked) ─────────────────────────────────

describe("clear mismatch => name_mismatch", () => {
  test("completely different person: Israa signed in, uploaded Batoul's CV", () => {
    // tokA=["israa","hassan"], tokB=["batoul","abedelrahman"] => no shared tokens
    assert.equal(
      validateOwnership("Israa Hassan", "Batoul Abedelrahman"),
      "name_mismatch"
    );
  });

  test("completely different person: different cultural names with no overlap", () => {
    // tokA=["ahmad","mohammad"], tokB=["sarah","williams"] => no shared tokens
    assert.equal(
      validateOwnership("Ahmad Mohammad", "Sarah Williams"),
      "name_mismatch"
    );
  });
});
