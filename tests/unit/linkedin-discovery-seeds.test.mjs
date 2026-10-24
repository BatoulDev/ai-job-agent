// Unit tests for src/lib/ingestion/linkedinDiscoverySeeds.ts. Pure, no
// network, no DB. Confirms the real safety mechanism (empty seeds while
// disabled) and the exact, evidence-based cost derivation per market.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getLinkedInDiscoverySeeds, buildLinkedInDiscoverySeeds } from "../../src/lib/ingestion/linkedinDiscoverySeeds.ts";
import { isProviderEnabled } from "../../src/lib/ingestion/providerConfig.ts";

describe("getLinkedInDiscoverySeeds — the real safety gate", () => {
  test("returns an empty array while providerConfig.ts's linkedin.enabled stays false — the real paid-call safety gate", () => {
    assert.equal(isProviderEnabled("linkedin"), false, "this test's own premise — if this ever flips, re-check the assertion below");
    assert.deepEqual(getLinkedInDiscoverySeeds(), []);
  });
});

describe("buildLinkedInDiscoverySeeds — the seed content itself", () => {
  const seeds = buildLinkedInDiscoverySeeds();

  test("covers exactly five markets: lebanon, saudi, uae, qatar, kuwait — no more, no fewer", () => {
    assert.deepEqual(seeds.map((s) => s.market), ["lebanon", "saudi", "uae", "qatar", "kuwait"]);
  });

  test("every seed uses the same bebity run-sync-get-dataset-items actor URL", () => {
    for (const seed of seeds) {
      assert.equal(seed.actorUrl, "https://api.apify.com/v2/acts/bebity~linkedin-jobs-scraper/run-sync-get-dataset-items");
    }
  });

  test("no seed sends a title/keyword/category field — broad discovery, per product rule", () => {
    for (const seed of seeds) {
      const keys = Object.keys(seed.requestBody);
      assert.deepEqual(new Set(keys), new Set(["rows", "locations", "companyProfile", "enrichCompany"]));
    }
  });

  test("every seed has a distinct, stable refresh_scope — never shared across markets (cross-partition stale-close safety)", () => {
    const scopes = seeds.map((s) => s.refreshScope);
    assert.equal(new Set(scopes).size, scopes.length, "every refreshScope must be unique");
    assert.deepEqual(scopes, ["linkedin:lebanon", "linkedin:saudi", "linkedin:uae", "linkedin:qatar", "linkedin:kuwait"]);
  });

  test("every market is bounded at the same conservative rows:10 — uniform, since only Lebanon has ever been real-tested", () => {
    for (const seed of seeds) {
      assert.equal(seed.requestBody.rows, 10);
      assert.equal(seed.maxJobsPerRun, 10);
    }
  });

  test("maxTotalChargeUsd is derived exactly from real confirmed pricing (actor-start + rows*per-item), not an arbitrary value", () => {
    const expected = Math.round((0.00005 + 10 * 0.0015) * 1e6) / 1e6;
    for (const seed of seeds) {
      assert.equal(seed.maxTotalChargeUsd, expected);
      assert.ok(seed.maxTotalChargeUsd > 0 && seed.maxTotalChargeUsd < 1, "cap must be small and bounded, never unbounded");
    }
  });

  test("each market's locations field carries exactly one real, human-readable place name", () => {
    const byMarket = Object.fromEntries(seeds.map((s) => [s.market, s.requestBody.locations]));
    assert.deepEqual(byMarket.lebanon, ["Lebanon"]);
    assert.deepEqual(byMarket.saudi, ["Saudi Arabia"]);
    assert.deepEqual(byMarket.uae, ["United Arab Emirates"]);
    assert.deepEqual(byMarket.qatar, ["Qatar"]);
    assert.deepEqual(byMarket.kuwait, ["Kuwait"]);
  });
});
