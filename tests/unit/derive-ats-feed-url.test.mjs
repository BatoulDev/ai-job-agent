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

  // 2026-10-02 fix: boards-api.eu.greenhouse.io does not exist (confirmed
  // live — DNS ENOTFOUND). Only the human-facing board page is
  // region-prefixed (job-boards.eu.*); Greenhouse's Job Board API itself is
  // one single global host for every tenant. A live GET against
  // boards-api.greenhouse.io/v1/boards/tamara/jobs?content=true (real
  // registry row: Tamara, an EU-hosted tenant) returned HTTP 200 with 32
  // real jobs, proving the global host is correct for EU boards too.
  test("derives an EU Greenhouse feed URL using the global API host, not a region-prefixed one (real registry row: Tamara — live-verified this phase)", () => {
    const result = deriveAtsFeedUrl("Greenhouse", "https://job-boards.eu.greenhouse.io/tamara");
    assert.deepEqual(result, { sourceType: "greenhouse", feedUrl: "https://boards-api.greenhouse.io/v1/boards/tamara/jobs?content=true" });
  });

  test("preserves a hyphenated token correctly for an EU Greenhouse board", () => {
    const result = deriveAtsFeedUrl("Greenhouse", "https://job-boards.eu.greenhouse.io/some-eu-tenant");
    assert.deepEqual(result, { sourceType: "greenhouse", feedUrl: "https://boards-api.greenhouse.io/v1/boards/some-eu-tenant/jobs?content=true" });
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

  test("derives an Oracle Cloud Recruiting feed URL (real registry row: AUBMC — live-verified this phase, docs/LEBANON_GULF_SOURCE_RESEARCH.md §3)", () => {
    const result = deriveAtsFeedUrl("Oracle Cloud Recruiting", "https://fa-exxn-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2");
    assert.deepEqual(result, {
      sourceType: "oracle_hcm",
      feedUrl: "https://fa-exxn-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber=CX_2&expand=requisitionList&limit=50",
    });
  });

  test("returns null for an Oracle-labeled row whose official_careers_url is a generic company landing page, not the real Oracle tenant URL (real ceiling — most of the 23 registry rows tagged Oracle look like this until researched further)", () => {
    const result = deriveAtsFeedUrl("Oracle HCM", "https://aubmc.org.lb/pages/main/careers.aspx");
    assert.equal(result, null);
  });

  // Workday integration Phase 1 (2026-10-25). Real tenant URLs below are the
  // actual official_careers_url values stored in the local company_sources
  // registry (confirmed via a read-only DB query, not invented) for the 6
  // rows labeled ats_provider "Workday" — 4 genuine Workday tenants, 2
  // mislabeled (careers_url points elsewhere entirely).
  test("derives a Workday feed URL (real registry row: Murex, Lebanon)", () => {
    const result = deriveAtsFeedUrl("Workday", "https://murex.wd3.myworkdayjobs.com/MurexCareerPage1");
    assert.deepEqual(result, { sourceType: "workday", feedUrl: "https://murex.wd3.myworkdayjobs.com/wday/cxs/murex/MurexCareerPage1/jobs" });
  });

  test("derives a Workday feed URL with an underscored site slug (real registry row: DataRobot, Saudi Arabia)", () => {
    const result = deriveAtsFeedUrl("Workday", "https://datarobot.wd1.myworkdayjobs.com/DataRobot_External_Careers");
    assert.deepEqual(result, { sourceType: "workday", feedUrl: "https://datarobot.wd1.myworkdayjobs.com/wday/cxs/datarobot/DataRobot_External_Careers/jobs" });
  });

  test("derives a Workday feed URL with a lowercase underscored site slug (real registry row: NCR Atleos, Saudi Arabia)", () => {
    const result = deriveAtsFeedUrl("Workday", "https://ncratleos.wd1.myworkdayjobs.com/ext_non_usalteos");
    assert.deepEqual(result, { sourceType: "workday", feedUrl: "https://ncratleos.wd1.myworkdayjobs.com/wday/cxs/ncratleos/ext_non_usalteos/jobs" });
  });

  test("derives a Workday feed URL for a different wd-shard number (real registry row: KBR, Qatar)", () => {
    const result = deriveAtsFeedUrl("Workday", "https://kbr.wd5.myworkdayjobs.com/KBR_Careers");
    assert.deepEqual(result, { sourceType: "workday", feedUrl: "https://kbr.wd5.myworkdayjobs.com/wday/cxs/kbr/KBR_Careers/jobs" });
  });

  test("returns null for a Workday-labeled row whose careers_url is not a myworkdayjobs.com tenant at all — safely rejected, not guessed (real registry row: Tivoli Hotels, mislabeled ats_provider)", () => {
    const result = deriveAtsFeedUrl("Workday", "https://www.tivolihotels.com/en/qatar");
    assert.equal(result, null);
  });

  test("returns null for a Workday-labeled row pointing at an unrelated corporate domain — safely rejected, not guessed (real registry row: PwC Kuwait, mislabeled ats_provider)", () => {
    const result = deriveAtsFeedUrl("Workday", "https://www.pwc.com/m1/en/careers.html");
    assert.equal(result, null);
  });

  test("returns null for a non-https Workday-shaped URL (malformed: wrong scheme)", () => {
    const result = deriveAtsFeedUrl("Workday", "http://murex.wd3.myworkdayjobs.com/MurexCareerPage1");
    assert.equal(result, null);
  });

  test("returns null when the wd-shard segment is missing entirely (malformed: not a real Workday tenant host)", () => {
    const result = deriveAtsFeedUrl("Workday", "https://murex.myworkdayjobs.com/MurexCareerPage1");
    assert.equal(result, null);
  });

  test("returns null when the site slug is missing entirely (malformed: no path segment after the tenant host)", () => {
    const result = deriveAtsFeedUrl("Workday", "https://murex.wd3.myworkdayjobs.com/");
    assert.equal(result, null);
  });

  test("returns null when the site slug is missing entirely, no trailing slash either (malformed: bare host)", () => {
    const result = deriveAtsFeedUrl("Workday", "https://murex.wd3.myworkdayjobs.com");
    assert.equal(result, null);
  });

  test("derives a Workday feed URL even with trailing query params or a path suffix, same tolerant-prefix-match convention as the Workable branch above (tenant/site edge case)", () => {
    const result = deriveAtsFeedUrl("Workday", "https://murex.wd3.myworkdayjobs.com/MurexCareerPage1?lang=en");
    assert.deepEqual(result, { sourceType: "workday", feedUrl: "https://murex.wd3.myworkdayjobs.com/wday/cxs/murex/MurexCareerPage1/jobs" });
  });

  test("Workday ats_provider matching is case-insensitive", () => {
    const result = deriveAtsFeedUrl("WORKDAY", "https://murex.wd3.myworkdayjobs.com/MurexCareerPage1");
    assert.notEqual(result, null);
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
