// Unit tests for src/lib/ingestion/providerConfig.ts and
// multiCompanyFeedUrls.ts (Phase 13). Pure, no network, no DB.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PROVIDER_CONFIGS, getProviderConfig, isProviderEnabled, getEnabledProviders, getProvidersForMarket } from "../../src/lib/ingestion/providerConfig.ts";
import { getEnabledMultiCompanyFeedSources } from "../../src/lib/ingestion/multiCompanyFeedUrls.ts";

describe("providerConfig", () => {
  test("every config entry has a unique sourceType", () => {
    const types = PROVIDER_CONFIGS.map((p) => p.sourceType);
    assert.equal(new Set(types).size, types.length);
  });

  test("isProviderEnabled is fail-closed for an unlisted source type", () => {
    assert.equal(isProviderEnabled("admin_manual"), false);
  });

  // Lebanon pilot: linkedin IS now listed (adapter + config exist for the
  // pilot build) but stays enabled:false — AGENTS.md §35 rule 6/10
  // requires a completed, documented pilot review and explicit human
  // approval before any production enablement; that is not a default
  // outcome of this implementation.
  test("linkedin is listed but NOT enabled — production enablement requires explicit human approval (AGENTS.md §35 rule 10)", () => {
    assert.equal(isProviderEnabled("linkedin"), false);
    const config = getProviderConfig("linkedin");
    assert.ok(config, "linkedin must have a providerConfig entry for the pilot build");
    assert.equal(config.enabled, false);
    assert.equal(config.requiresCredentialEnvVar, "APIFY_API_TOKEN");
    // Market-expansion phase: the discovery branch now has seeds for all
    // five markets (linkedinDiscoverySeeds.ts), but Gulf/international
    // remain UNVALIDATED — only Lebanon has ever been real-tested with
    // Bebity. enabled stays false for all of them until each market's own
    // bounded real pilot is reviewed (AGENTS.md §35 rule 6/10).
    assert.deepEqual(config.markets, ["lebanon", "saudi-arabia", "uae", "qatar", "kuwait"]);
  });

  test("getEnabledProviders / getProvidersForMarket never include linkedin while it is disabled", () => {
    assert.ok(!getEnabledProviders().some((p) => p.sourceType === "linkedin"));
    assert.ok(!getProvidersForMarket("lebanon").some((p) => p.sourceType === "linkedin"));
  });

  test("Tier-A ATS types (greenhouse/lever/workable/ashby) are all enabled", () => {
    for (const t of ["greenhouse", "lever", "workable", "ashby"]) {
      assert.equal(isProviderEnabled(t), true, `${t} should be enabled`);
    }
  });

  test("live-verified Tier-D multi-company feeds (remoteok/jobicy/arbeitnow) are enabled", () => {
    for (const t of ["remoteok", "jobicy", "arbeitnow"]) {
      assert.equal(isProviderEnabled(t), true, `${t} should be enabled`);
    }
  });

  test("credential/authorization-blocked providers (jsearch/adzuna) are NOT enabled", () => {
    for (const t of ["jsearch", "adzuna"]) {
      assert.equal(isProviderEnabled(t), false, `${t} should not be enabled this phase`);
      const config = getProviderConfig(t);
      assert.ok(config.requiresCredentialEnvVar, `${t} must document which credential it needs`);
    }
  });

  // Phase 21: Bayt/GulfTalent/Indeed went live enabled:true after real
  // bounded benchmarks confirmed their schemas — see providers/bayt.ts,
  // gulftalent.ts, indeed.ts headers and docs/LEBANON_LIVE_SOURCE_EXPANSION.md.
  test("live-verified Apify-sourced providers (bayt/gulftalent/indeed) are enabled", () => {
    for (const t of ["bayt", "gulftalent", "indeed"]) {
      assert.equal(isProviderEnabled(t), true, `${t} should be enabled this phase`);
      const config = getProviderConfig(t);
      assert.ok(config.requiresCredentialEnvVar, `${t} must document which credential it needs`);
    }
  });

  test("getEnabledProviders(multi_company_feed) returns only enabled multi-company providers", () => {
    const enabled = getEnabledProviders("multi_company_feed").map((p) => p.sourceType).sort();
    assert.deepEqual(enabled, ["arbeitnow", "bayt", "gulftalent", "indeed", "jobicy", "remoteok"]);
  });

  test("getProvidersForMarket('international-remote') includes every enabled multi-company feed plus every Tier-A ATS", () => {
    const providers = getProvidersForMarket("international-remote").map((p) => p.sourceType);
    assert.ok(providers.includes("remoteok"));
    assert.ok(providers.includes("jobicy"));
    assert.ok(providers.includes("arbeitnow"));
    assert.ok(providers.includes("greenhouse"));
  });

  test("getProvidersForMarket('lebanon') never includes an international-remote-only provider", () => {
    const providers = getProvidersForMarket("lebanon").map((p) => p.sourceType);
    assert.ok(!providers.includes("remoteok"));
    assert.ok(!providers.includes("jobicy"));
    assert.ok(!providers.includes("arbeitnow"));
  });
});

describe("getEnabledMultiCompanyFeedSources", () => {
  test("returns a feed URL for each enabled multi-company provider with a constructible URL", () => {
    const sources = getEnabledMultiCompanyFeedSources();
    const byType = Object.fromEntries(sources.map((s) => [s.sourceType, s]));
    assert.equal(byType.remoteok.feedUrl, "https://remoteok.com/api");
    assert.match(byType.jobicy.feedUrl, /^https:\/\/jobicy\.com\/api\/v2\/remote-jobs\?count=\d+$/);
    assert.equal(byType.arbeitnow.feedUrl, "https://www.arbeitnow.com/api/job-board-api");
    assert.equal(byType.arbeitnow.paginated, true);
  });

  test("never includes a credential-blocked provider (no URL is guessed for jsearch/adzuna/bayt/gulftalent)", () => {
    const types = getEnabledMultiCompanyFeedSources().map((s) => s.sourceType);
    for (const blocked of ["jsearch", "adzuna", "bayt", "gulftalent"]) {
      assert.ok(!types.includes(blocked), `${blocked} must not appear — no credential/authorization exists`);
    }
  });
});
