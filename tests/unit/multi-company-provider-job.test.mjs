// Unit tests for src/lib/ingestion/multiCompanyProviderJob.ts (Phase 13).
// Pure logic, no DB, no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateMultiCompanyProviderJob } from "../../src/lib/ingestion/multiCompanyProviderJob.ts";

function rawJob(overrides = {}) {
  return {
    externalId: "ext-1",
    title: "Software Engineer",
    description: "Build things.",
    companyName: "Acme Remote Co",
    applicationUrl: "https://example.test/apply",
    ...overrides,
  };
}

describe("validateMultiCompanyProviderJob", () => {
  test("accepts a complete multi-company job", () => {
    assert.deepEqual(validateMultiCompanyProviderJob(rawJob(), "remoteok"), { valid: true });
  });

  test("rejects a missing companyName — the one rule this wrapper adds over validateRawProviderJob", () => {
    assert.deepEqual(validateMultiCompanyProviderJob(rawJob({ companyName: undefined }), "remoteok"), {
      valid: false,
      reason: "missing_company_name",
    });
  });

  test("rejects a whitespace-only companyName", () => {
    assert.deepEqual(validateMultiCompanyProviderJob(rawJob({ companyName: "   " }), "remoteok"), {
      valid: false,
      reason: "missing_company_name",
    });
  });

  test("still applies every base validateRawProviderJob rule (missing title)", () => {
    assert.deepEqual(validateMultiCompanyProviderJob(rawJob({ title: null }), "remoteok"), {
      valid: false,
      reason: "missing_title",
    });
  });

  test("still applies the base rule for a malformed application url", () => {
    assert.deepEqual(validateMultiCompanyProviderJob(rawJob({ applicationUrl: "not-a-url" }), "jobicy"), {
      valid: false,
      reason: "invalid_application_url",
    });
  });
});
