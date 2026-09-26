// Unit tests for src/lib/ingestion/providers/* (Phase 04 provider adapters).
// Pure field-mapping logic, no network — fixtures shaped exactly like the
// real Greenhouse/Lever/Workable API responses documented (and
// live-verified) in docs/job-ingestion-pilot.md §2/§5.
//
// Run: node --test tests/unit/ingestion-providers.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mapGreenhouseJob } from "../../src/lib/ingestion/providers/greenhouse.ts";
import { mapLeverJob } from "../../src/lib/ingestion/providers/lever.ts";
import { mapWorkableJob } from "../../src/lib/ingestion/providers/workable.ts";
import { getProviderAdapter } from "../../src/lib/ingestion/providers/index.ts";
import { validateRawProviderJob } from "../../src/lib/ingestion/rawProviderJob.ts";

describe("mapGreenhouseJob", () => {
  const raw = {
    id: 6789012,
    title: "Backend Engineer",
    absolute_url: "https://boards.greenhouse.io/scaleai/jobs/6789012",
    content: "<p>Build <b>things</b>.&nbsp;Join us!</p>",
    location: { name: "Remote - US" },
    first_published: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-15T00:00:00Z",
  };

  test("maps required fields and strips HTML from the description", () => {
    const job = mapGreenhouseJob(raw);
    assert.equal(job.externalId, "6789012");
    assert.equal(job.title, "Backend Engineer");
    assert.equal(job.description, "Build things . Join us!");
    assert.equal(job.applicationUrl, "https://boards.greenhouse.io/scaleai/jobs/6789012");
  });

  test("detects a remote work-arrangement hint from the location name", () => {
    const job = mapGreenhouseJob(raw);
    assert.equal(job.providerWorkArrangement, "remote");
    assert.equal(job.rawLocation, "Remote - US");
  });

  test("a non-remote location produces no work-arrangement hint", () => {
    const job = mapGreenhouseJob({ ...raw, location: { name: "Doha, Qatar" } });
    assert.equal(job.providerWorkArrangement, null);
  });

  test("passes rawProviderJob validation end-to-end", () => {
    const job = mapGreenhouseJob(raw);
    assert.deepEqual(validateRawProviderJob(job, "greenhouse"), { valid: true });
  });

  test("a job missing an id maps to an empty externalId, which validation then rejects", () => {
    const job = mapGreenhouseJob({ ...raw, id: undefined });
    assert.equal(job.externalId, "");
    assert.deepEqual(validateRawProviderJob(job, "greenhouse"), { valid: false, reason: "missing_external_id" });
  });
});

describe("mapLeverJob", () => {
  const raw = {
    id: "a1b2c3d4-0000-0000-0000-000000000000",
    text: "Product Designer",
    hostedUrl: "https://jobs.lever.co/wahed/a1b2c3d4",
    descriptionPlain: "Design delightful product experiences.",
    categories: { location: "Beirut, Lebanon", commitment: "Full-time", workplaceType: "hybrid" },
    createdAt: 1735689600000,
  };

  test("maps required fields", () => {
    const job = mapLeverJob(raw);
    assert.equal(job.externalId, raw.id);
    assert.equal(job.title, "Product Designer");
    assert.equal(job.description, "Design delightful product experiences.");
    assert.equal(job.applicationUrl, raw.hostedUrl);
    assert.equal(job.rawLocation, "Beirut, Lebanon");
  });

  test("maps categories.workplaceType and commitment through the shared vocab maps", () => {
    const job = mapLeverJob(raw);
    assert.equal(job.providerWorkArrangement, "hybrid");
    assert.equal(job.employmentType, "full-time");
  });

  test("prefers applyUrl over hostedUrl when both are present", () => {
    const job = mapLeverJob({ ...raw, applyUrl: "https://jobs.lever.co/wahed/a1b2c3d4/apply" });
    assert.equal(job.applicationUrl, "https://jobs.lever.co/wahed/a1b2c3d4/apply");
  });

  test("converts createdAt epoch-ms to an ISO publishedAt", () => {
    const job = mapLeverJob(raw);
    assert.equal(job.publishedAt, new Date(raw.createdAt).toISOString());
  });

  test("passes rawProviderJob validation end-to-end", () => {
    const job = mapLeverJob(raw);
    assert.deepEqual(validateRawProviderJob(job, "lever"), { valid: true });
  });
});

describe("mapWorkableJob", () => {
  const raw = {
    shortcode: "ABCDE123",
    title: "Sales Associate",
    application_url: "https://apply.workable.com/salla/j/ABCDE123",
    description: "<div>Sell <em>great</em> products.</div>",
    employment_type: "Full-time",
    city: "Riyadh",
    country: "Saudi Arabia",
    telecommuting: false,
    published_on: "2026-08-10",
  };

  test("maps required fields and strips HTML", () => {
    const job = mapWorkableJob(raw);
    assert.equal(job.externalId, "ABCDE123");
    assert.equal(job.title, "Sales Associate");
    assert.equal(job.description, "Sell great products.");
    assert.equal(job.applicationUrl, raw.application_url);
  });

  test("joins city and country into rawLocation", () => {
    const job = mapWorkableJob(raw);
    assert.equal(job.rawLocation, "Riyadh, Saudi Arabia");
  });

  test("telecommuting:true maps to a remote work-arrangement hint", () => {
    const job = mapWorkableJob({ ...raw, telecommuting: true });
    assert.equal(job.providerWorkArrangement, "remote");
  });

  test("maps employment_type through the shared vocab map", () => {
    const job = mapWorkableJob(raw);
    assert.equal(job.employmentType, "full-time");
  });

  test("passes rawProviderJob validation end-to-end", () => {
    const job = mapWorkableJob(raw);
    assert.deepEqual(validateRawProviderJob(job, "workable"), { valid: true });
  });
});

describe("getProviderAdapter — registry", () => {
  test("returns an adapter for each of the three proven ATS types", () => {
    assert.equal(typeof getProviderAdapter("greenhouse"), "function");
    assert.equal(typeof getProviderAdapter("lever"), "function");
    assert.equal(typeof getProviderAdapter("workable"), "function");
  });

  test("returns null for a source type with no automated adapter", () => {
    assert.equal(getProviderAdapter("admin_manual"), null);
    assert.equal(getProviderAdapter("linkedin"), null);
    assert.equal(getProviderAdapter("career_page"), null);
    assert.equal(getProviderAdapter("ashby"), null);
  });
});
