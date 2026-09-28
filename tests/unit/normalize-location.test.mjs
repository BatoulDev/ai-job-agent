// Unit tests for src/lib/ingestion/normalizeLocation.ts — the pure,
// deterministic raw-location normalizer used by the (future) job
// ingestion pipeline. See docs/OVERNIGHT_BUILD_PROGRESS.md Phase 01.
//
// Fixtures below are drawn from two sources:
// 1. Real target-city/geographic-scope values found in the existing
//    company-source registries (docs/job-source-discovery/*.csv) — this
//    sandboxed session has no live Supabase instance (no `supabase` CLI,
//    no running Postgres), so no real `public.jobs.location` rows could
//    be queried; that gap is recorded in docs/OVERNIGHT_BUILD_PROGRESS.md
//    rather than silently worked around.
// 2. Synthetic edge cases covering ambiguity, multi-region text, hybrid/
//    onsite/flexible arrangements, and relocation signal detection.
//
// Run: node --test tests/unit/normalize-location.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeLocation, isLowConfidenceLocation, isGccCountryCode, isMenaCountryCode } from "../../src/lib/ingestion/normalizeLocation.ts";

describe("normalizeLocation — null/empty input", () => {
  test("null rawLocation returns low confidence, all fields null", () => {
    const result = normalizeLocation({ rawLocation: null });
    assert.equal(result.rawLocation, null);
    assert.equal(result.countryCode, null);
    assert.equal(result.city, null);
    assert.equal(result.workArrangement, null);
    assert.equal(result.remoteScope, null);
    assert.equal(result.relocationSignal, null);
    assert.equal(result.locationConfidence, "low");
    assert.equal(isLowConfidenceLocation(result), true);
  });

  test("empty/whitespace-only string is treated as null", () => {
    const result = normalizeLocation({ rawLocation: "   " });
    assert.equal(result.rawLocation, null);
    assert.equal(result.locationConfidence, "low");
  });
});

describe("normalizeLocation — real registry-derived city/country strings", () => {
  test("'Country-wide' Lebanon target with a Beirut mention resolves high confidence", () => {
    const result = normalizeLocation({ rawLocation: "Beirut, Lebanon" });
    assert.equal(result.countryCode, "LB");
    assert.equal(result.city, "Beirut");
    assert.equal(result.locationConfidence, "high");
  });

  test("country name alone, no city, is medium confidence", () => {
    const result = normalizeLocation({ rawLocation: "Lebanon" });
    assert.equal(result.countryCode, "LB");
    assert.equal(result.city, null);
    assert.equal(result.locationConfidence, "medium");
  });

  test("Riyadh, Saudi Arabia resolves high confidence", () => {
    const result = normalizeLocation({ rawLocation: "Riyadh, Saudi Arabia" });
    assert.equal(result.countryCode, "SA");
    assert.equal(result.city, "Riyadh");
    assert.equal(result.locationConfidence, "high");
    assert.equal(isGccCountryCode(result.countryCode), true);
    assert.equal(isMenaCountryCode(result.countryCode), true);
  });

  test("Dubai, UAE resolves high confidence", () => {
    const result = normalizeLocation({ rawLocation: "Dubai, UAE" });
    assert.equal(result.countryCode, "AE");
    assert.equal(result.city, "Dubai");
    assert.equal(result.locationConfidence, "high");
  });

  test("Doha, Qatar resolves high confidence", () => {
    const result = normalizeLocation({ rawLocation: "Doha, Qatar" });
    assert.equal(result.countryCode, "QA");
    assert.equal(result.city, "Doha");
  });

  test("Kuwait City resolves high confidence", () => {
    const result = normalizeLocation({ rawLocation: "Kuwait City, Kuwait" });
    assert.equal(result.countryCode, "KW");
    assert.equal(result.city, "Kuwait City");
  });
});

describe("normalizeLocation — work arrangement detection", () => {
  test("provider hint 'remote' is trusted over ambiguous text", () => {
    const result = normalizeLocation({ rawLocation: "Beirut", providerWorkArrangement: "Remote" });
    assert.equal(result.workArrangement, "remote");
  });

  test("'Hybrid - Beirut' detects hybrid arrangement and city", () => {
    const result = normalizeLocation({ rawLocation: "Hybrid - Beirut, Lebanon" });
    assert.equal(result.workArrangement, "hybrid");
    assert.equal(result.city, "Beirut");
  });

  test("'On-site, Dubai' detects onsite arrangement", () => {
    const result = normalizeLocation({ rawLocation: "On-site, Dubai" });
    assert.equal(result.workArrangement, "onsite");
  });

  test("'Flexible - Riyadh' detects flexible arrangement", () => {
    const result = normalizeLocation({ rawLocation: "Flexible - Riyadh" });
    assert.equal(result.workArrangement, "flexible");
  });

  test("no arrangement keyword and no provider hint leaves workArrangement null", () => {
    const result = normalizeLocation({ rawLocation: "Beirut, Lebanon" });
    assert.equal(result.workArrangement, null);
  });
});

describe("normalizeLocation — remote scope", () => {
  test("'Remote - Worldwide' is high confidence with worldwide scope", () => {
    const result = normalizeLocation({ rawLocation: "Remote - Worldwide" });
    assert.equal(result.workArrangement, "remote");
    assert.equal(result.remoteScope, "worldwide");
    assert.equal(result.locationConfidence, "high");
  });

  test("'Remote (GCC only)' resolves region:gcc scope", () => {
    const result = normalizeLocation({ rawLocation: "Remote (GCC only)" });
    assert.equal(result.remoteScope, "region:gcc");
    assert.equal(result.locationConfidence, "high");
  });

  test("'Remote (MENA)' resolves region:mena scope", () => {
    const result = normalizeLocation({ rawLocation: "Remote (MENA)" });
    assert.equal(result.remoteScope, "region:mena");
  });

  test("'Remote - Lebanon' resolves country-scoped remote", () => {
    const result = normalizeLocation({ rawLocation: "Remote - Lebanon" });
    assert.equal(result.remoteScope, "country:LB");
    assert.equal(result.countryCode, "LB");
    assert.equal(result.locationConfidence, "high");
  });

  test("bare 'Remote' with no scope signal is medium confidence, null scope", () => {
    const result = normalizeLocation({ rawLocation: "Remote" });
    assert.equal(result.workArrangement, "remote");
    assert.equal(result.remoteScope, null);
    assert.equal(result.locationConfidence, "medium");
  });

  test("non-remote jobs never get a remoteScope even if a country is resolved", () => {
    const result = normalizeLocation({ rawLocation: "Beirut, Lebanon" });
    assert.equal(result.remoteScope, null);
  });
});

describe("normalizeLocation — ambiguity and multi-region fail-closed behavior", () => {
  test("multiple distinct countries in one string never collapses to a single guess", () => {
    const result = normalizeLocation({ rawLocation: "Beirut, Dubai, or Riyadh" });
    assert.equal(result.countryCode, null);
    assert.equal(result.city, null);
    assert.equal(result.locationConfidence, "low");
    assert.equal(isLowConfidenceLocation(result), true);
  });

  test("unrecognized free text is low confidence, not a false negative crash", () => {
    const result = normalizeLocation({ rawLocation: "Planet Earth, Somewhere Else" });
    assert.equal(result.countryCode, null);
    assert.equal(result.workArrangement, null);
    assert.equal(result.locationConfidence, "low");
  });

  test("a bare 'remote' keyword with zero geographic scope is medium, not low — it is a real signal, just an incomplete one", () => {
    const result = normalizeLocation({ rawLocation: "Remote Galaxy" });
    assert.equal(result.workArrangement, "remote");
    assert.equal(result.remoteScope, null);
    assert.equal(result.locationConfidence, "medium");
  });

  test("'Multiple Locations' with no recognizable place is low confidence", () => {
    const result = normalizeLocation({ rawLocation: "Multiple Locations" });
    assert.equal(result.countryCode, null);
    assert.equal(result.locationConfidence, "low");
  });
});

describe("normalizeLocation — relocation signal", () => {
  test("explicit visa sponsorship language is a positive signal", () => {
    const result = normalizeLocation({ rawLocation: "Dubai, UAE — visa sponsorship available" });
    assert.equal(result.relocationSignal, true);
  });

  test("explicit no-relocation language is a negative signal", () => {
    const result = normalizeLocation({ rawLocation: "Riyadh — no relocation assistance, local candidates only" });
    assert.equal(result.relocationSignal, false);
  });

  test("no mention of relocation is null, never inferred", () => {
    const result = normalizeLocation({ rawLocation: "Beirut, Lebanon" });
    assert.equal(result.relocationSignal, null);
  });
});

describe("normalizeLocation — non-English location text (Phase 17 adversarial hardening)", () => {
  test("pure Arabic-script location text (no English city/country names) fails closed — low confidence, null country/city, never a crash or a guess", () => {
    const result = normalizeLocation({ rawLocation: "بيروت، لبنان" });
    assert.equal(result.rawLocation, "بيروت، لبنان");
    assert.equal(result.countryCode, null);
    assert.equal(result.city, null);
    assert.equal(result.locationConfidence, "low");
  });

  test("pure Arabic-script Riyadh text also fails closed, never silently defaulting to a guessed Gulf country", () => {
    const result = normalizeLocation({ rawLocation: "الرياض" });
    assert.equal(result.countryCode, null);
    assert.equal(result.locationConfidence, "low");
  });

  test("mixed English + Arabic parenthetical still resolves correctly via the English portion — Arabic text present doesn't break real matches", () => {
    const result = normalizeLocation({ rawLocation: "Dubai, UAE (دبي)" });
    assert.equal(result.countryCode, "AE");
    assert.equal(result.city, "Dubai");
    assert.equal(result.locationConfidence, "high");
  });
});

describe("normalizeLocation — determinism", () => {
  test("same input always returns an equal (deep) result", () => {
    const input = { rawLocation: "Hybrid - Beirut, Lebanon — visa sponsorship available" };
    const a = normalizeLocation(input);
    const b = normalizeLocation(input);
    assert.deepEqual(a, b);
  });
});
