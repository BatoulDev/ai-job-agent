// Unit tests for linkedinEnrichment.ts — data-slayer exact-ID enrichment
// resolution logic. Pure functions only; DB-layer behavior (attempt
// counting persisted to jobs.linkedin_enrichment_attempts, partial batch
// handling) is covered separately in tests/db/linkedin-enrichment-batch.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateEnrichmentResponseItem,
  resolveStructuredWorkArrangement,
  resolveWorkArrangement,
  resolveEmploymentType,
  isEligibleForEnrichment,
  classifyAttemptOutcome,
  checkDataSlayerPrice,
  computeMaxTotalChargeUsd,
  buildEnrichmentItemsFromDataset,
  MAX_ENRICHMENT_ATTEMPTS,
  DATA_SLAYER_MAX_ACCEPTABLE_PRICE_PER_JOB_USD,
} from "../../src/lib/ingestion/linkedinEnrichment.ts";

const FETCHED_AT = "2026-10-16T12:00:00Z";

describe("resolveStructuredWorkArrangement — exact normalization", () => {
  test("[ONSITE] -> onsite", () => {
    const r = resolveStructuredWorkArrangement(["ONSITE"]);
    assert.deepEqual(r, { status: "resolved", value: "onsite" });
  });

  test("[HYBRID] -> hybrid", () => {
    const r = resolveStructuredWorkArrangement(["HYBRID"]);
    assert.deepEqual(r, { status: "resolved", value: "hybrid" });
  });

  test("[REMOTE] -> remote", () => {
    const r = resolveStructuredWorkArrangement(["REMOTE"]);
    assert.deepEqual(r, { status: "resolved", value: "remote" });
  });

  test("[] -> unresolved", () => {
    const r = resolveStructuredWorkArrangement([]);
    assert.equal(r.status, "unresolved");
  });

  test("multiple workplace types -> unresolved + warning, never guessed", () => {
    const r = resolveStructuredWorkArrangement(["ONSITE", "HYBRID"]);
    assert.equal(r.status, "unresolved_multiple_values");
    assert.match(r.warning, /2 workplace_types values/);
  });

  test("unknown/unexpected string -> unresolved + warning, never fuzzy-mapped", () => {
    const r = resolveStructuredWorkArrangement(["Remote"]); // lowercase/title-case variant, not the real enum spelling
    assert.equal(r.status, "unresolved_unknown_value");
    assert.match(r.warning, /unrecognized workplace_types value/);
  });
});

describe("validateEnrichmentResponseItem — identity and schema validation", () => {
  test("valid matching response", () => {
    const v = validateEnrichmentResponseItem("123", { job_posting_id: "123", workplace_types: ["ONSITE"], employment_status: "Full-time" }, FETCHED_AT);
    assert.equal(v.ok, true);
    assert.equal(v.result.returnedJobId, "123");
    assert.deepEqual(v.result.structuredWorkplaceTypes, ["ONSITE"]);
    assert.equal(v.result.employmentStatusRaw, "Full-time");
    assert.equal(v.workplaceTypesMalformed, false);
  });

  test("numeric job_posting_id is coerced to string and matched", () => {
    const v = validateEnrichmentResponseItem("123", { job_posting_id: 123, workplace_types: [] }, FETCHED_AT);
    assert.equal(v.ok, true);
    assert.equal(v.result.returnedJobId, "123");
  });

  test("requested ID != returned ID -> rejected as id_mismatch", () => {
    const v = validateEnrichmentResponseItem("123", { job_posting_id: "999", workplace_types: [] }, FETCHED_AT);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "id_mismatch");
  });

  test("missing job_posting_id -> rejected", () => {
    const v = validateEnrichmentResponseItem("123", { workplace_types: [] }, FETCHED_AT);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "missing_job_posting_id");
  });

  test("malformed response (not an object) -> rejected", () => {
    const v = validateEnrichmentResponseItem("123", "not-an-object", FETCHED_AT);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "malformed_response");
  });

  test("null response -> rejected as malformed", () => {
    const v = validateEnrichmentResponseItem("123", null, FETCHED_AT);
    assert.equal(v.ok, false);
    assert.equal(v.reason, "malformed_response");
  });

  test("workplace_types present but not an array -> accepted (ID matched), flagged malformed, treated as empty", () => {
    const v = validateEnrichmentResponseItem("123", { job_posting_id: "123", workplace_types: "ONSITE" }, FETCHED_AT);
    assert.equal(v.ok, true);
    assert.equal(v.workplaceTypesMalformed, true);
    assert.deepEqual(v.result.structuredWorkplaceTypes, []);
  });

  test("workplace_types array containing a non-string -> flagged malformed, treated as empty", () => {
    const v = validateEnrichmentResponseItem("123", { job_posting_id: "123", workplace_types: [42] }, FETCHED_AT);
    assert.equal(v.ok, true);
    assert.equal(v.workplaceTypesMalformed, true);
  });

  test("unknown extra fields are ignored, not rejected", () => {
    const v = validateEnrichmentResponseItem("123", { job_posting_id: "123", workplace_types: [], company_followers: 99999, salary: null, random_new_field: "x" }, FETCHED_AT);
    assert.equal(v.ok, true);
  });

  test("employment_status present but not a string -> treated as null, never crashes", () => {
    const v = validateEnrichmentResponseItem("123", { job_posting_id: "123", workplace_types: [], employment_status: 123 }, FETCHED_AT);
    assert.equal(v.ok, true);
    assert.equal(v.result.employmentStatusRaw, null);
  });
});

describe("resolveWorkArrangement — QUALITY-FIRST pipeline (data-slayer structured -> classifier -> null)", () => {
  test("structured data-slayer WA wins even when the description alone would classify differently", () => {
    const r = resolveWorkArrangement({
      structuredWorkplaceTypes: ["REMOTE"],
      title: "Senior Accountant",
      description: "This is a fully on-site position at our Beirut office.",
    });
    assert.equal(r.workArrangement, "remote");
    assert.equal(r.origin, "data_slayer_structured");
  });

  test("data-slayer empty -> classifier used", () => {
    const r = resolveWorkArrangement({
      structuredWorkplaceTypes: [],
      title: "Senior Accountant",
      description: "This is a fully remote role based anywhere.",
    });
    assert.equal(r.workArrangement, "remote");
    assert.equal(r.origin, "classifier");
  });

  test("both unresolved -> null", () => {
    const r = resolveWorkArrangement({
      structuredWorkplaceTypes: [],
      title: "Senior Accountant",
      description: "Join our growing finance team and make an impact.",
    });
    assert.equal(r.workArrangement, null);
    assert.equal(r.origin, "unresolved");
  });

  test("MCI regression: [] workplace_types must fall through to the classifier, is_remote_allowed is never read by this function at all", () => {
    // resolveWorkArrangement's input type has no is_remote_allowed field —
    // this test proves the real text drives the result, not any boolean.
    const r = resolveWorkArrangement({
      structuredWorkplaceTypes: [],
      title: "Remote Call Center Representative",
      description: "Remote Work-at-Home POSITION OVERVIEW. Enjoy working from home with flexible hours.",
    });
    assert.equal(r.workArrangement, "remote");
    assert.notEqual(r.workArrangement, "onsite");
    assert.equal(r.origin, "classifier");
  });

  test("multiple structured values -> falls through to classifier with a warning carried along", () => {
    const r = resolveWorkArrangement({
      structuredWorkplaceTypes: ["ONSITE", "REMOTE"],
      title: "Engineer",
      description: "This is a fully remote role.",
    });
    assert.equal(r.origin, "classifier");
    assert.equal(r.workArrangement, "remote");
    assert.match(r.warning, /2 workplace_types values/);
  });

  test("unknown structured value -> falls through to classifier with a warning carried along", () => {
    const r = resolveWorkArrangement({
      structuredWorkplaceTypes: ["Flexible"],
      title: "Engineer",
      description: "No explicit arrangement stated here.",
    });
    assert.equal(r.origin, "unresolved");
    assert.equal(r.workArrangement, null);
    assert.match(r.warning, /unrecognized workplace_types value/);
  });
});

describe("resolveEmploymentType — Bebity authoritative, data-slayer gap-fill only", () => {
  test("Bebity present -> remains authoritative even when data-slayer agrees", () => {
    const r = resolveEmploymentType("full-time", "Full-time");
    assert.equal(r.employmentType, "full-time");
    assert.equal(r.conflict, null);
  });

  test("Bebity null -> data-slayer fills the gap", () => {
    const r = resolveEmploymentType(null, "Part-time");
    assert.equal(r.employmentType, "part-time");
    assert.equal(r.conflict, null);
  });

  test("conflict -> Bebity retained, conflict surfaced for logging", () => {
    const r = resolveEmploymentType("full-time", "Contract");
    assert.equal(r.employmentType, "full-time");
    assert.deepEqual(r.conflict, { bebity: "full-time", dataSlayer: "contract" });
  });

  test("both null -> null, no conflict", () => {
    const r = resolveEmploymentType(null, null);
    assert.equal(r.employmentType, null);
    assert.equal(r.conflict, null);
  });

  test("data-slayer value not in the supported enum -> never invented, treated as null", () => {
    const r = resolveEmploymentType(null, "Temporary");
    assert.equal(r.employmentType, null);
    assert.equal(r.conflict, null);
  });
});

describe("isEligibleForEnrichment — bounded retry queue rule", () => {
  test("attempts 0, WA null -> eligible", () => {
    assert.equal(isEligibleForEnrichment(null, 0), true);
  });

  test("attempts 1, WA null -> eligible (one retry remaining)", () => {
    assert.equal(isEligibleForEnrichment(null, 1), true);
  });

  test("attempts 2, WA null -> NOT eligible (cap reached)", () => {
    assert.equal(isEligibleForEnrichment(null, 2), false);
  });

  test("WA non-null -> NOT eligible regardless of attempts", () => {
    assert.equal(isEligibleForEnrichment("remote", 0), false);
    assert.equal(isEligibleForEnrichment("onsite", 5), false);
  });

  test("MAX_ENRICHMENT_ATTEMPTS is exactly 2", () => {
    assert.equal(MAX_ENRICHMENT_ATTEMPTS, 2);
  });
});

describe("classifyAttemptOutcome — valid vs. not-counted responses", () => {
  test("a valid identified response (even with empty WA) counts as an attempt", () => {
    const v = validateEnrichmentResponseItem("123", { job_posting_id: "123", workplace_types: [] }, FETCHED_AT);
    assert.equal(classifyAttemptOutcome(v), "counted");
  });

  test("an ID mismatch does not count as an attempt", () => {
    const v = validateEnrichmentResponseItem("123", { job_posting_id: "999", workplace_types: [] }, FETCHED_AT);
    assert.equal(classifyAttemptOutcome(v), "not_counted");
  });

  test("a malformed response does not count as an attempt", () => {
    const v = validateEnrichmentResponseItem("123", null, FETCHED_AT);
    assert.equal(classifyAttemptOutcome(v), "not_counted");
  });
});

describe("buildEnrichmentItemsFromDataset — orchestration reconciliation (matches by value, never by position)", () => {
  test("full success: every requested id gets its matching item", () => {
    const items = buildEnrichmentItemsFromDataset(
      ["A", "B"],
      [
        { job_posting_id: "A", workplace_types: ["ONSITE"] },
        { job_posting_id: "B", workplace_types: ["REMOTE"] },
      ]
    );
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], { requestedJobId: "A", rawItem: { job_posting_id: "A", workplace_types: ["ONSITE"] } });
    assert.deepEqual(items[1], { requestedJobId: "B", rawItem: { job_posting_id: "B", workplace_types: ["REMOTE"] } });
  });

  test("partial response: 25 requested, 22 returned — the 3 missing get rawItem: null, never synthesized as empty responses", () => {
    const requestedJobIds = Array.from({ length: 25 }, (_, i) => String(i));
    const rawDatasetItems = Array.from({ length: 22 }, (_, i) => ({ job_posting_id: String(i), workplace_types: [] }));
    const items = buildEnrichmentItemsFromDataset(requestedJobIds, rawDatasetItems);
    assert.equal(items.length, 25);
    const missing = items.filter((i) => i.rawItem === null);
    assert.equal(missing.length, 3);
    assert.deepEqual(
      missing.map((i) => i.requestedJobId),
      ["22", "23", "24"]
    );
    // The 22 present ones are not null and keep their real raw item.
    assert.equal(items.filter((i) => i.rawItem !== null).length, 22);
  });

  test("total actor failure: empty dataset — every requested id gets rawItem: null", () => {
    const items = buildEnrichmentItemsFromDataset(["A", "B", "C"], []);
    assert.ok(items.every((i) => i.rawItem === null));
  });

  test("an item in the dataset for an id we never requested is ignored, never force-attached to a different job", () => {
    const items = buildEnrichmentItemsFromDataset(["A"], [{ job_posting_id: "UNRELATED" }, { job_posting_id: "A", workplace_types: ["HYBRID"] }]);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].rawItem, { job_posting_id: "A", workplace_types: ["HYBRID"] });
  });

  test("reordered dataset still matches correctly — matching is by value, never by array position", () => {
    const items = buildEnrichmentItemsFromDataset(
      ["A", "B", "C"],
      [{ job_posting_id: "C" }, { job_posting_id: "A" }, { job_posting_id: "B" }]
    );
    assert.deepEqual(items.map((i) => i.requestedJobId), ["A", "B", "C"]);
    assert.deepEqual(
      items.map((i) => i.rawItem.job_posting_id),
      ["A", "B", "C"]
    );
  });

  test("an item with a numeric job_posting_id is matched against a string-requested id", () => {
    const items = buildEnrichmentItemsFromDataset(["123"], [{ job_posting_id: 123 }]);
    assert.notEqual(items[0].rawItem, null);
  });

  test("a malformed item (no usable job_posting_id) in the dataset is safely ignored, never crashes", () => {
    const items = buildEnrichmentItemsFromDataset(["A"], ["not-an-object", null, { no_id_field: true }, { job_posting_id: "A" }]);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].rawItem, { job_posting_id: "A" });
  });

  test("a duplicate id in the dataset: first occurrence wins, deterministic, never a crash", () => {
    const items = buildEnrichmentItemsFromDataset(["A"], [{ job_posting_id: "A", workplace_types: ["ONSITE"] }, { job_posting_id: "A", workplace_types: ["REMOTE"] }]);
    assert.deepEqual(items[0].rawItem.workplace_types, ["ONSITE"]);
  });
});

describe("cost safety helpers", () => {
  test("price at or below the configured maximum passes", () => {
    assert.deepEqual(checkDataSlayerPrice(0.004), { ok: true });
    assert.deepEqual(checkDataSlayerPrice(DATA_SLAYER_MAX_ACCEPTABLE_PRICE_PER_JOB_USD), { ok: true });
  });

  test("price above the configured maximum is rejected, never silently paid", () => {
    const r = checkDataSlayerPrice(0.01);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "price_above_threshold");
  });

  test("computeMaxTotalChargeUsd has no slack multiplier", () => {
    assert.equal(computeMaxTotalChargeUsd(25), 25 * DATA_SLAYER_MAX_ACCEPTABLE_PRICE_PER_JOB_USD);
    assert.equal(computeMaxTotalChargeUsd(1), DATA_SLAYER_MAX_ACCEPTABLE_PRICE_PER_JOB_USD);
  });
});
