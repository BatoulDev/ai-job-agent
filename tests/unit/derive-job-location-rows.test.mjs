// Offline, pure-function tests for deriveJobLocationRows() (Phase 2
// multi-location job support, Checkpoint 2B). No DB, no HTTP, no
// Supabase client — every case here is deterministic given its inputs.
// See src/lib/ingestion/jobLocations.ts for the function's own
// contract/invariant documentation.
//
// "Dubai" (not "Paris") is used throughout as the non-Lebanon example,
// since normalizeLocation.ts only recognizes Lebanon/Gulf-market
// cities and country names — "Paris"/"France" resolve to low/medium
// confidence with no city match, while "Dubai" resolves cleanly to
// AE/Dubai at high confidence, confirmed directly against the real
// function before writing these fixtures.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveJobLocationRows } from "../../src/lib/ingestion/jobLocations.ts";

describe("deriveJobLocationRows", () => {
  test("Beirut-only primary, no additional locations — one high-confidence primary row", () => {
    const rows = deriveJobLocationRows("Beirut", undefined);
    assert.deepEqual(rows, [{ countryCode: "LB", city: "Beirut", isPrimary: true, locationConfidence: "high" }]);
  });

  test("additionalLocations: undefined — treated as no additional candidates, never throws", () => {
    const rows = deriveJobLocationRows("Beirut", undefined);
    assert.equal(rows.length, 1);
  });

  test("additionalLocations: null — treated identically to undefined, never throws, never conflated with []", () => {
    const rows = deriveJobLocationRows("Beirut", null);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].isPrimary, true);
  });

  test("additionalLocations: [] (confirmed empty) — produces just the primary row, same shape as undefined/null at the row-derivation level", () => {
    const rows = deriveJobLocationRows("Beirut", []);
    assert.deepEqual(rows, [{ countryCode: "LB", city: "Beirut", isPrimary: true, locationConfidence: "high" }]);
  });

  test("Dubai primary + Beirut additional — two independently-resolved rows, correct isPrimary flags, neither mislabeled as the other", () => {
    const rows = deriveJobLocationRows("Dubai", ["Beirut"]);
    assert.equal(rows.length, 2);
    const dubai = rows.find((r) => r.city === "Dubai");
    const beirut = rows.find((r) => r.city === "Beirut");
    assert.deepEqual(dubai, { countryCode: "AE", city: "Dubai", isPrimary: true, locationConfidence: "high" });
    assert.deepEqual(beirut, { countryCode: "LB", city: "Beirut", isPrimary: false, locationConfidence: "high" });
  });

  test("duplicate additional location (same city sent twice) collapses to one row, not two", () => {
    const rows = deriveJobLocationRows("Dubai", ["Beirut", "Beirut"]);
    const beirutRows = rows.filter((r) => r.city === "Beirut");
    assert.equal(beirutRows.length, 1);
  });

  test("additional location identical to the primary collapses into the single primary row — never duplicated, never demoted", () => {
    const rows = deriveJobLocationRows("Beirut", ["Beirut"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].isPrimary, true);
  });

  test("an unresolvable additional location (garbled text) is silently dropped, never inserted as a low-confidence row", () => {
    const rows = deriveJobLocationRows("Beirut", ["???unresolvable???"]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].city, "Beirut");
  });

  test("an unresolvable primary with a resolvable additional — primary contributes no row, additional still resolves on its own", () => {
    const rows = deriveJobLocationRows("???unresolvable???", ["Beirut"]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { countryCode: "LB", city: "Beirut", isPrimary: false, locationConfidence: "high" });
  });

  test("everything unresolvable (primary and every additional) — empty array, not an error", () => {
    const rows = deriveJobLocationRows("???unresolvable???", ["???also unresolvable???"]);
    assert.deepEqual(rows, []);
  });

  test("a multi-region primary string (e.g. 'Beirut, Dubai, or Riyadh') resolves to low confidence on its own and is correctly dropped — proves individual per-string normalization, not string concatenation, is what makes Dubai+Beirut work", () => {
    const rows = deriveJobLocationRows("Beirut, Dubai, or Riyadh", undefined);
    assert.deepEqual(rows, []);
  });

  test("no primary at all (null) with no additional locations — empty array", () => {
    const rows = deriveJobLocationRows(null, undefined);
    assert.deepEqual(rows, []);
  });

  test("three additional locations, mixed resolvable/unresolvable — only the resolvable ones produce rows, all correctly non-primary", () => {
    const rows = deriveJobLocationRows("Beirut", ["Dubai", "???unresolvable???", "Tripoli"]);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => (r.city === "Beirut" ? r.isPrimary === true : r.isPrimary === false)));
  });

  test("malformed additionalLocations entries (non-string elements) are skipped, never thrown on", () => {
    const rows = deriveJobLocationRows("Beirut", [42, null, {}, "Dubai"]);
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.city === "Dubai"));
  });

  test("at-most-one-primary invariant: no combination of inputs can ever produce two rows with isPrimary:true", () => {
    const rows = deriveJobLocationRows("Beirut", ["Dubai", "Tripoli", "Beirut", "Dubai"]);
    const primaryRows = rows.filter((r) => r.isPrimary);
    assert.equal(primaryRows.length, 1);
  });
});
