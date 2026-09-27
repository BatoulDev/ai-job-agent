// Unit tests for src/lib/ingestion/deriveAtsFeedUrl.ts (Phase 12). Pure
// logic, no DB, no network. Test cases mirror real rows found in the
// company_sources registry during the Phase 12 source-coverage audit — see
// docs/SOURCE_COVERAGE_AND_PROVIDER_EXPANSION_AUDIT.md.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveAtsFeedUrl } from "../../src/lib/ingestion/deriveAtsFeedUrl.ts";

describe("deriveAtsFeedUrl", () => {
  test("derives a standard Greenhouse feed URL (real registry row: Alpaca)", () => {
    const result = deriveAtsFeedUrl("Greenhouse", "https://job-boards.greenhouse.io/alpaca");
    assert.deepEqual(result, { sourceType: "greenhouse", feedUrl: "https://boards-api.greenhouse.io/v1/boards/alpaca/jobs?content=true" });
  });

  test("derives an EU Greenhouse feed URL with the correct EU API host (real registry row: Tamara)", () => {
    const result = deriveAtsFeedUrl("Greenhouse", "https://job-boards.eu.greenhouse.io/tamara");
    assert.deepEqual(result, { sourceType: "greenhouse", feedUrl: "https://boards-api.eu.greenhouse.io/v1/boards/tamara/jobs?content=true" });
  });

  test("derives a Lever feed URL, token may contain a dot (real registry row: Wahed)", () => {
    const result = deriveAtsFeedUrl("Lever", "https://jobs.lever.co/wahed.com");
    assert.deepEqual(result, { sourceType: "lever", feedUrl: "https://api.lever.co/v0/postings/wahed.com?mode=json" });
  });

  test("derives a Workable feed URL, ignoring query params (real registry row: Agility)", () => {
    const result = deriveAtsFeedUrl("Workable", "https://apply.workable.com/agility/?lng=en");
    assert.deepEqual(result, { sourceType: "workable", feedUrl: "https://apply.workable.com/api/v1/widget/accounts/agility?details=true" });
  });

  test("returns null when the ATS is embedded on the company's own domain, not derivable (real registry row: Foodics)", () => {
    const result = deriveAtsFeedUrl("Workable", "https://www.foodics.com/careers");
    assert.equal(result, null);
  });

  test("returns null for an unsupported ATS provider (e.g. SAP SuccessFactors — no adapter exists)", () => {
    const result = deriveAtsFeedUrl("SAP SuccessFactors", "https://career55.sapsf.eu/career?company=abcsal");
    assert.equal(result, null);
  });

  test("derives an Ashby feed URL (real registry row: The Utopia Studio — live-verified this phase)", () => {
    const result = deriveAtsFeedUrl("Ashby", "https://jobs.ashbyhq.com/the-studio");
    assert.deepEqual(result, { sourceType: "ashby", feedUrl: "https://api.ashbyhq.com/posting-api/job-board/the-studio" });
  });

  test("returns null when official_careers_url is missing entirely", () => {
    assert.equal(deriveAtsFeedUrl("Greenhouse", null), null);
  });

  test("returns null when ats_provider is missing entirely", () => {
    assert.equal(deriveAtsFeedUrl(null, "https://job-boards.greenhouse.io/alpaca"), null);
  });

  test("ats_provider matching is case-insensitive", () => {
    const result = deriveAtsFeedUrl("greenhouse", "https://job-boards.greenhouse.io/alpaca");
    assert.notEqual(result, null);
  });
});
