// Reproducibility regression test for sr-lb-aubmc's official_careers_url.
//
// Context: an earlier session manually corrected this row's
// official_careers_url directly in the shared local dev database (the
// generic aubmc.org.lb landing page -> the real Oracle Cloud
// CandidateExperience URL), but never captured that correction back into
// docs/job-source-discovery/lebanon.csv — the actual deterministic source
// of truth scripts/import-company-registry.mjs's loadAllRows()/
// buildCompanySources() read on every import, and that
// tests/db/helpers.mjs's ensureCompanyRegistryImported() re-runs
// automatically against a freshly-reset local DB (company_sources count
// < 500). The fix was silently lost on the next `supabase db reset` (see
// tests/db/find-eligible-company-sources.test.mjs's own header comment,
// which worked around the gap with a synthetic fixture rather than
// depending on this row). This test closes the gap for real: it exercises
// the CSV file itself through the real parser (no DB, no network), so a
// future regression — someone reverting the CSV, or a bad CSV edit —
// fails here instead of being discovered only after a reset silently
// breaks AUBMC discovery again.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadAllRows, buildCompanySources } from "../../scripts/import-company-registry.mjs";
import { deriveAtsFeedUrl } from "../../src/lib/ingestion/deriveAtsFeedUrl.ts";

const OLD_GENERIC_URL = "https://aubmc.org.lb/pages/main/careers.aspx";
const VERIFIED_ORACLE_URL = "https://fa-exxn-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2";

describe("company registry CSV: sr-lb-aubmc Oracle URL reproducibility", () => {
  test("sr-lb-aubmc exists exactly once in the deterministic Lebanon source data", () => {
    const rows = loadAllRows().filter((r) => r.source_record_id === "sr-lb-aubmc");
    assert.equal(rows.length, 1, "expected exactly one sr-lb-aubmc row across all registry CSV files");
  });

  test("its official_careers_url is the verified direct Oracle URL, not the old generic landing page", () => {
    const sources = buildCompanySources(loadAllRows());
    const aubmc = sources.find((s) => s.id === "sr-lb-aubmc");
    assert.ok(aubmc, "sr-lb-aubmc must be present after buildCompanySources()");
    assert.equal(aubmc.official_careers_url, VERIFIED_ORACLE_URL);
    assert.notEqual(aubmc.official_careers_url, OLD_GENERIC_URL, "the old generic URL must no longer be the persisted source-of-truth value");
  });

  test("identity fields are unchanged: source_id, company identity, ats_provider, review_status", () => {
    const sources = buildCompanySources(loadAllRows());
    const aubmc = sources.find((s) => s.id === "sr-lb-aubmc");
    assert.equal(aubmc.id, "sr-lb-aubmc");
    assert.equal(aubmc.company_id, "cc-aubmc");
    assert.equal(aubmc.company_name, "American University of Beirut Medical Center");
    assert.equal(aubmc.ats_provider, "Oracle Cloud Recruiting");
    assert.equal(aubmc.review_status, "verified");
    assert.equal(aubmc.automation_eligibility, "suitable_public_ats");
  });

  test("deriveAtsFeedUrl() returns a non-null oracle_hcm feed for the persisted CSV value", () => {
    const sources = buildCompanySources(loadAllRows());
    const aubmc = sources.find((s) => s.id === "sr-lb-aubmc");
    const derived = deriveAtsFeedUrl(aubmc.ats_provider, aubmc.official_careers_url);
    assert.notEqual(derived, null, "deriveAtsFeedUrl must derive a feed URL from the persisted registry value");
    assert.equal(derived.sourceType, "oracle_hcm");
    assert.match(derived.feedUrl, /siteNumber=CX_2/);
  });
});
