// Unit tests for src/lib/ingestion/rawProviderJob.ts (Phase 03 ingestion
// core: validation + mapping). Pure logic, no DB, no network.
//
// Run: node --test tests/unit/raw-provider-job.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateRawProviderJob, mapRawProviderJobToJobRow } from "../../src/lib/ingestion/rawProviderJob.ts";

function rawJob(overrides = {}) {
  return {
    externalId: "ext-1",
    title: "Software Engineer",
    description: "Build things.",
    rawLocation: "Beirut, Lebanon",
    applicationUrl: "https://example.test/apply",
    ...overrides,
  };
}

describe("validateRawProviderJob — required fields", () => {
  test("accepts a complete job", () => {
    assert.deepEqual(validateRawProviderJob(rawJob(), "greenhouse"), { valid: true });
  });

  test("rejects missing external id", () => {
    const result = validateRawProviderJob(rawJob({ externalId: "" }), "greenhouse");
    assert.deepEqual(result, { valid: false, reason: "missing_external_id" });
  });

  test("rejects missing title", () => {
    assert.deepEqual(validateRawProviderJob(rawJob({ title: null }), "greenhouse"), {
      valid: false,
      reason: "missing_title",
    });
  });

  test("rejects missing description", () => {
    assert.deepEqual(validateRawProviderJob(rawJob({ description: "   " }), "greenhouse"), {
      valid: false,
      reason: "missing_description",
    });
  });

  test("rejects a job with neither application url nor email", () => {
    const result = validateRawProviderJob(rawJob({ applicationUrl: null }), "greenhouse");
    assert.deepEqual(result, { valid: false, reason: "missing_application_target" });
  });

  test("accepts a job with only an application email", () => {
    const result = validateRawProviderJob(rawJob({ applicationUrl: null, applicationEmail: "jobs@example.test" }), "career_page");
    assert.deepEqual(result, { valid: true });
  });

  test("rejects a malformed application url (never inserted with a placeholder)", () => {
    const result = validateRawProviderJob(rawJob({ applicationUrl: "not-a-url" }), "greenhouse");
    assert.deepEqual(result, { valid: false, reason: "invalid_application_url" });
  });

  test("rejects a malformed application email", () => {
    const result = validateRawProviderJob(rawJob({ applicationUrl: null, applicationEmail: "not-an-email" }), "career_page");
    assert.deepEqual(result, { valid: false, reason: "invalid_application_email" });
  });

  test("rejects an employment type outside the schema's enum", () => {
    const result = validateRawProviderJob(rawJob({ employmentType: "freelance" }), "greenhouse");
    assert.deepEqual(result, { valid: false, reason: "invalid_employment_type" });
  });

  test("rejects a seniority outside the schema's enum", () => {
    const result = validateRawProviderJob(rawJob({ seniority: "staff" }), "greenhouse");
    assert.deepEqual(result, { valid: false, reason: "invalid_seniority" });
  });

  test("a LinkedIn-sourced job with only an email target is rejected — never automated-send (AGENTS.md §7)", () => {
    const result = validateRawProviderJob(rawJob({ applicationUrl: null, applicationEmail: "jobs@example.test" }), "linkedin");
    assert.deepEqual(result, { valid: false, reason: "linkedin_email_forbidden" });
  });

  test("a LinkedIn-sourced job with a url is accepted", () => {
    const result = validateRawProviderJob(rawJob(), "linkedin");
    assert.deepEqual(result, { valid: true });
  });
});

describe("mapRawProviderJobToJobRow", () => {
  const context = { sourceId: "sr-lb-test-co", sourceType: "greenhouse", companyName: "Test Co (live)" };

  test("uses the live company_sources company name, never a provider-supplied one", () => {
    const row = mapRawProviderJobToJobRow(rawJob(), context);
    assert.equal(row.company_name, "Test Co (live)");
  });

  test("populates structured geography via normalizeLocation, unlike the pilot's hardcoded null", () => {
    const row = mapRawProviderJobToJobRow(rawJob({ rawLocation: "Beirut, Lebanon" }), context);
    assert.equal(row.country_code, "LB");
    assert.equal(row.city, "Beirut");
    assert.equal(row.status, "active");
  });

  test("a low-confidence location is ingested as pending_review, not dropped", () => {
    const row = mapRawProviderJobToJobRow(rawJob({ rawLocation: "Beirut, Dubai, or Riyadh" }), context);
    assert.equal(row.country_code, null);
    assert.equal(row.status, "pending_review");
  });

  test("application_method/application_url/application_email are derived consistently", () => {
    const row = mapRawProviderJobToJobRow(rawJob(), context);
    assert.equal(row.application_method, "external_link");
    assert.equal(row.application_url, "https://example.test/apply");
    assert.equal(row.application_email, null);
  });

  test("an email-only job maps to application_method 'email'", () => {
    const row = mapRawProviderJobToJobRow(
      rawJob({ applicationUrl: null, applicationEmail: "jobs@example.test" }),
      { ...context, sourceType: "career_page" }
    );
    assert.equal(row.application_method, "email");
    assert.equal(row.application_email, "jobs@example.test");
    assert.equal(row.application_url, null);
  });

  test("carries source provenance through unchanged", () => {
    const row = mapRawProviderJobToJobRow(rawJob(), { ...context, sourceUrl: "https://boards.greenhouse.io/testco/jobs/1" });
    assert.equal(row.source_id, "sr-lb-test-co");
    assert.equal(row.source_type, "greenhouse");
    assert.equal(row.external_id, "ext-1");
    assert.equal(row.source_url, "https://boards.greenhouse.io/testco/jobs/1");
  });

  test("determinism: same input always maps to the same output", () => {
    const a = mapRawProviderJobToJobRow(rawJob(), context);
    const b = mapRawProviderJobToJobRow(rawJob(), context);
    assert.deepEqual(a, b);
  });
});

describe("mapRawProviderJobToJobRow — multi-company feeds (Phase 13)", () => {
  const multiCompanyContext = { sourceId: null, sourceType: "remoteok" };

  test("falls back to raw.companyName when context.companyName is omitted", () => {
    const row = mapRawProviderJobToJobRow(rawJob({ companyName: "Acme Remote Co" }), multiCompanyContext);
    assert.equal(row.company_name, "Acme Remote Co");
  });

  test("source_id is null for a multi-company batch, so dedup_scope falls back to type:sourceType", () => {
    const row = mapRawProviderJobToJobRow(rawJob({ companyName: "Acme Remote Co" }), multiCompanyContext);
    assert.equal(row.source_id, null);
    assert.equal(row.source_type, "remoteok");
  });

  test("context.companyName still wins over raw.companyName when both are somehow present (company-specific adapters never set raw.companyName)", () => {
    const companySpecificContext = { sourceId: "sr-lb-test-co", sourceType: "greenhouse", companyName: "Test Co (live)" };
    const row = mapRawProviderJobToJobRow(rawJob({ companyName: "Should be ignored" }), companySpecificContext);
    assert.equal(row.company_name, "Test Co (live)");
  });

  test("per-job sourceListingUrl overrides the shared context.sourceUrl — preserves per-job provenance for aggregator feeds", () => {
    const row = mapRawProviderJobToJobRow(
      rawJob({ companyName: "Acme Remote Co", sourceListingUrl: "https://remoteok.com/remote-jobs/12345" }),
      { ...multiCompanyContext, sourceUrl: "https://remoteok.com/api" }
    );
    assert.equal(row.source_url, "https://remoteok.com/remote-jobs/12345");
  });

  test("falls back to context.sourceUrl when no per-job sourceListingUrl is given", () => {
    const row = mapRawProviderJobToJobRow(rawJob({ companyName: "Acme Remote Co" }), { ...multiCompanyContext, sourceUrl: "https://remoteok.com/api" });
    assert.equal(row.source_url, "https://remoteok.com/api");
  });

  test("throws (never silently invents a company) when neither context.companyName nor raw.companyName is present", () => {
    assert.throws(() => mapRawProviderJobToJobRow(rawJob(), multiCompanyContext), /no company name available/);
  });
});
