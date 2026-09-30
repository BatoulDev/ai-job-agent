// Unit tests for src/lib/ingestion/checkJobEligibility.ts (Phase 02 hard
// eligibility) and src/lib/ingestion/jobEligibilityLocation.ts (the
// public.jobs-row adapter). Pure logic, no DB, no network.
//
// Run: node --test tests/unit/check-job-eligibility.test.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkJobEligibility } from "../../src/lib/ingestion/checkJobEligibility.ts";
import { deriveEligibilityLocation } from "../../src/lib/ingestion/jobEligibilityLocation.ts";

function baseInput(overrides = {}) {
  return {
    job: {
      countryCode: "LB",
      workArrangement: "onsite",
      remoteScope: null,
      locationConfidence: "high",
      ...overrides.job,
    },
    planCode: overrides.planCode ?? "free",
    preferredWorkArrangement: overrides.preferredWorkArrangement ?? null,
    jobMarketCoverage: overrides.jobMarketCoverage ?? null,
    internationalSearchEnabled: overrides.internationalSearchEnabled ?? false,
    willingToRelocate: overrides.willingToRelocate ?? null,
    relocationMarketCountryCodes: overrides.relocationMarketCountryCodes ?? [],
  };
}

describe("checkJobEligibility — fail-closed baseline", () => {
  test("low confidence location is never eligible, regardless of plan", () => {
    const result = checkJobEligibility(
      baseInput({ job: { countryCode: null, workArrangement: "onsite", remoteScope: null, locationConfidence: "low" }, planCode: "pro" }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "location_confidence_too_low");
  });
});

// Founder decision (Phase 21 follow-up): missing work-arrangement metadata
// alone must never be a rejection reason. See
// docs/PRODUCT_MATCHING_RULES.md "Work arrangement" and
// docs/LEBANON_LIVE_SOURCE_EXPANSION.md §5 for the real-world evidence
// (Bayt/GulfTalent/Indeed) that motivated this.
describe("checkJobEligibility — work arrangement: match / conflict / unknown", () => {
  test("REGRESSION (the Phase 21 bug): a Lebanon job with unknown work arrangement is eligible, not rejected solely for that reason", () => {
    const result = checkJobEligibility(
      baseInput({ job: { countryCode: "LB", workArrangement: null, remoteScope: null, locationConfidence: "medium" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "unknown");
  });

  test("unknown arrangement never becomes an implicit match or conflict — status is exactly 'unknown', not folded into eligible/ineligible semantics", () => {
    const result = checkJobEligibility(
      baseInput({ job: { countryCode: "LB", workArrangement: null, remoteScope: null, locationConfidence: "medium" } }),
    );
    assert.notEqual(result.workArrangementStatus, "match");
    assert.notEqual(result.workArrangementStatus, "conflict");
  });

  test("unknown job arrangement outside Lebanon still respects plan/geography — a Student user is NOT made eligible for a Gulf job merely because arrangement is unknown", () => {
    const result = checkJobEligibility(
      baseInput({ planCode: "student", job: { countryCode: "AE", workArrangement: null, remoteScope: null, locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "work_arrangement_unknown_and_ineligible");
  });

  test("unknown job arrangement outside Lebanon IS eligible for a Pro user who selected that relocation market (physical-presence interpretation succeeds)", () => {
    const result = checkJobEligibility(
      baseInput({
        planCode: "pro",
        internationalSearchEnabled: true,
        willingToRelocate: true,
        relocationMarketCountryCodes: ["AE"],
        job: { countryCode: "AE", workArrangement: null, remoteScope: null, locationConfidence: "high" },
      }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "unknown");
  });

  test("unknown job arrangement outside Lebanon IS eligible for a Pro user with remote_worldwide coverage (remote interpretation succeeds), even without relocation selected", () => {
    const result = checkJobEligibility(
      baseInput({
        planCode: "pro",
        jobMarketCoverage: "remote_worldwide",
        job: { countryCode: "AE", workArrangement: null, remoteScope: "region:gcc", locationConfidence: "high" },
      }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "unknown");
  });

  // Regression tests 1-9 from the founder decision, verbatim scenarios.
  test("Remote preference + Remote job -> match, normal eligibility applies", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "remote", job: { countryCode: "LB", workArrangement: "remote", remoteScope: "country:LB", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "match");
  });

  test("Remote preference + On-site job -> explicit conflict, rejected regardless of geography", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "remote", job: { countryCode: "LB", workArrangement: "onsite", remoteScope: null, locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "work_arrangement_conflict");
    assert.equal(result.workArrangementStatus, "conflict");
  });

  test("Remote preference + Unknown job -> not rejected solely for arrangement", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "remote", job: { countryCode: "LB", workArrangement: null, remoteScope: null, locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "unknown");
  });

  test("On-site preference + On-site job -> match", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "onsite", job: { countryCode: "LB", workArrangement: "onsite", remoteScope: null, locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "match");
  });

  test("On-site preference + Remote job -> conflict", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "onsite", job: { countryCode: "LB", workArrangement: "remote", remoteScope: "country:LB", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "work_arrangement_conflict");
  });

  test("On-site preference + Unknown job -> not rejected solely for arrangement", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "onsite", job: { countryCode: "LB", workArrangement: null, remoteScope: null, locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "unknown");
  });

  test("Hybrid preference + Hybrid job -> match", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "hybrid", job: { countryCode: "LB", workArrangement: "hybrid", remoteScope: null, locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "match");
  });

  test("Hybrid preference + known conflicting arrangement (remote) -> conflict preserved", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "hybrid", job: { countryCode: "LB", workArrangement: "remote", remoteScope: "country:LB", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "work_arrangement_conflict");
  });

  test("Hybrid preference + Unknown job -> not rejected solely for arrangement", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "hybrid", job: { countryCode: "LB", workArrangement: null, remoteScope: null, locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "unknown");
  });

  test("'flexible' on either side is always compatible, never a conflict — user flexible + job onsite", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "flexible", job: { countryCode: "LB", workArrangement: "onsite", remoteScope: null, locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "match");
  });

  test("'flexible' on either side is always compatible, never a conflict — user remote + job flexible", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "remote", job: { countryCode: "LB", workArrangement: "flexible", remoteScope: "country:LB", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "match");
  });

  // Full combinatorial coverage of Flexible — Section A audit (product
  // completion phase): Flexible means "the user is open to remote, hybrid,
  // and on-site" — a real, explicit preference, never to be confused with
  // an unknown/unspecified job arrangement (a separate branch entirely,
  // covered above). Every pairing below must resolve to "match", never
  // "conflict" or "unknown".
  test("user flexible + job remote -> match", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "flexible", job: { countryCode: "LB", workArrangement: "remote", remoteScope: "country:LB", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "match");
  });

  test("user flexible + job hybrid -> match", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "flexible", job: { countryCode: "LB", workArrangement: "hybrid", remoteScope: null, locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "match");
  });

  test("job flexible + user onsite -> match", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "onsite", job: { countryCode: "LB", workArrangement: "flexible", remoteScope: "country:LB", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "match");
  });

  test("job flexible + user hybrid -> match", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "hybrid", job: { countryCode: "LB", workArrangement: "flexible", remoteScope: "country:LB", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "match");
  });

  test("user flexible + job flexible -> match (both sides open)", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: "flexible", job: { countryCode: "LB", workArrangement: "flexible", remoteScope: "country:LB", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "match");
  });

  test("a known job arrangement with no user preference set is 'unknown' status, not 'match' — nothing to compare against, but geography still uses the real known value", () => {
    const result = checkJobEligibility(
      baseInput({ preferredWorkArrangement: null, job: { countryCode: "LB", workArrangement: "onsite", remoteScope: null, locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
    assert.equal(result.workArrangementStatus, "unknown");
  });

  test("REGRESSION (Phase 21 collapse): a batch dominated by unknown work arrangement does not collapse to near-zero eligible jobs for a Lebanon-market job — tests the rule, not a hardcoded historical count", () => {
    const unknownArrangementLebanonJobs = Array.from({ length: 20 }, () => ({
      countryCode: "LB",
      workArrangement: null,
      remoteScope: null,
      locationConfidence: "high",
    }));
    const results = unknownArrangementLebanonJobs.map((job) => checkJobEligibility(baseInput({ job })));
    const eligibleCount = results.filter((r) => r.eligible).length;
    assert.equal(eligibleCount, unknownArrangementLebanonJobs.length, "every unknown-arrangement Lebanon job must remain eligible — none may be rejected solely for missing work_arrangement");
  });
});

describe("checkJobEligibility — Lebanon onsite/hybrid, every plan", () => {
  for (const planCode of ["free", "student", "pro"]) {
    test(`${planCode}: Lebanon onsite job is eligible`, () => {
      const result = checkJobEligibility(baseInput({ planCode, job: { countryCode: "LB", workArrangement: "onsite", remoteScope: null, locationConfidence: "high" } }));
      assert.equal(result.eligible, true);
    });

    test(`${planCode}: Lebanon hybrid job is eligible`, () => {
      const result = checkJobEligibility(baseInput({ planCode, job: { countryCode: "LB", workArrangement: "hybrid", remoteScope: null, locationConfidence: "high" } }));
      assert.equal(result.eligible, true);
    });
  }
});

describe("checkJobEligibility — onsite/hybrid outside Lebanon (relocation gate)", () => {
  const dubaiJob = { countryCode: "AE", workArrangement: "onsite", remoteScope: null, locationConfidence: "high" };

  test("free plan: never eligible for a foreign onsite job", () => {
    const result = checkJobEligibility(baseInput({ planCode: "free", job: dubaiJob }));
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "onsite_hybrid_outside_lebanon_requires_pro_relocation");
  });

  test("pro plan without international_search_enabled: not eligible", () => {
    const result = checkJobEligibility(baseInput({ planCode: "pro", job: dubaiJob, internationalSearchEnabled: false }));
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "onsite_hybrid_outside_lebanon_requires_pro_relocation");
  });

  test("pro + international enabled but willing_to_relocate false: not eligible", () => {
    const result = checkJobEligibility(
      baseInput({ planCode: "pro", job: dubaiJob, internationalSearchEnabled: true, willingToRelocate: false }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "onsite_hybrid_outside_lebanon_requires_pro_relocation");
  });

  test("pro + willing to relocate but UAE not in selected relocation markets: not eligible", () => {
    const result = checkJobEligibility(
      baseInput({
        planCode: "pro",
        job: dubaiJob,
        internationalSearchEnabled: true,
        willingToRelocate: true,
        relocationMarketCountryCodes: ["SA", "QA"],
      }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "relocation_market_not_selected");
  });

  test("pro + willing to relocate + UAE selected: eligible", () => {
    const result = checkJobEligibility(
      baseInput({
        planCode: "pro",
        job: dubaiJob,
        internationalSearchEnabled: true,
        willingToRelocate: true,
        relocationMarketCountryCodes: ["AE"],
      }),
    );
    assert.equal(result.eligible, true);
  });
});

describe("checkJobEligibility — remote jobs, Lebanon-inclusive scopes are free for everyone", () => {
  test("remote worldwide is eligible on the free plan", () => {
    const result = checkJobEligibility(
      baseInput({ planCode: "free", job: { countryCode: null, workArrangement: "remote", remoteScope: "worldwide", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
  });

  test("remote scoped to Lebanon is eligible on the free plan", () => {
    const result = checkJobEligibility(
      baseInput({ planCode: "free", job: { countryCode: "LB", workArrangement: "remote", remoteScope: "country:LB", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
  });

  test("remote scoped to MENA is eligible on the student plan (Lebanon is MENA)", () => {
    const result = checkJobEligibility(
      baseInput({ planCode: "student", job: { countryCode: null, workArrangement: "remote", remoteScope: "region:mena", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, true);
  });

  test("remote scoped to GCC only is NOT eligible on the free plan (Lebanon is not GCC)", () => {
    const result = checkJobEligibility(
      baseInput({ planCode: "free", job: { countryCode: null, workArrangement: "remote", remoteScope: "region:gcc", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "remote_scope_excludes_lebanon");
  });

  test("remote scoped to a single non-MENA country is NOT eligible on the student plan", () => {
    const result = checkJobEligibility(
      baseInput({ planCode: "student", job: { countryCode: "US", workArrangement: "remote", remoteScope: "country:US", locationConfidence: "high" } }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "remote_scope_excludes_lebanon");
  });

  test("bare remote with no scope is NOT eligible on the free plan (unknown, fails closed)", () => {
    const result = checkJobEligibility(
      baseInput({ planCode: "free", job: { countryCode: null, workArrangement: "remote", remoteScope: null, locationConfidence: "medium" } }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "remote_scope_unknown");
  });
});

// job_market_coverage has exactly one active tier — remote_worldwide —
// per the Pro market-coverage model (docs/PRODUCT_MATCHING_RULES.md
// "Market coverage"). 'remote_mena'/'lebanon_only'/'remote_lebanon_
// applicants' were development-era states, fully retired
// (supabase/migrations/20260930140000_remove_legacy_market_coverage_compatibility.sql):
// impossible at the DB layer (CHECK constraint — see
// tests/db/international-job-preferences.test.mjs) and impossible at the
// type layer (JobMarketCoverage = "remote_worldwide", not a union
// anymore). checkJobEligibility() itself has no special-case branch for
// them either — this describe block proves that directly: any
// non-"remote_worldwide" value (including a legacy string, if one somehow
// reached this pure function) is treated identically to no coverage at
// all, fail-closed, never a separate interpretation.
describe("checkJobEligibility — Pro job_market_coverage: remote_worldwide is the sole active tier", () => {
  const gccRemote = { countryCode: null, workArrangement: "remote", remoteScope: "region:gcc", locationConfidence: "high" };
  const usRemote = { countryCode: "US", workArrangement: "remote", remoteScope: "country:US", locationConfidence: "high" };

  test("pro with no job_market_coverage set (null) is not eligible for a non-Lebanon-inclusive remote scope", () => {
    const result = checkJobEligibility(baseInput({ planCode: "pro", jobMarketCoverage: null, job: gccRemote }));
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "remote_scope_excludes_lebanon");
  });

  test("pro + remote_worldwide: GCC-scoped remote is eligible (remote_worldwide covers every determinable scope, GCC included)", () => {
    const result = checkJobEligibility(baseInput({ planCode: "pro", jobMarketCoverage: "remote_worldwide", job: gccRemote }));
    assert.equal(result.eligible, true);
  });

  test("pro + remote_worldwide: US-only remote is eligible (documented assumption)", () => {
    const result = checkJobEligibility(baseInput({ planCode: "pro", jobMarketCoverage: "remote_worldwide", job: usRemote }));
    assert.equal(result.eligible, true);
  });

  test("pro + remote_worldwide: still fails closed on a genuinely unknown scope", () => {
    const result = checkJobEligibility(
      baseInput({
        planCode: "pro",
        jobMarketCoverage: "remote_worldwide",
        job: { countryCode: null, workArrangement: "remote", remoteScope: null, locationConfidence: "medium" },
      }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "remote_scope_unknown");
  });

  test("a retired legacy value, if it somehow reached this function, is treated exactly like null — no special-case interpretation remains", () => {
    const withLegacyValue = checkJobEligibility(baseInput({ planCode: "pro", jobMarketCoverage: "remote_mena", job: gccRemote }));
    const withNull = checkJobEligibility(baseInput({ planCode: "pro", jobMarketCoverage: null, job: gccRemote }));
    assert.equal(withLegacyValue.eligible, false, "remote_mena must no longer grant GCC-scoped eligibility — that special case is gone");
    assert.deepEqual(withLegacyValue, withNull, "any non-remote_worldwide value produces an identical result to null");
  });
});

describe("deriveEligibilityLocation — public.jobs row adapter", () => {
  test("trusts already-populated structured columns over raw text", () => {
    const result = deriveEligibilityLocation({
      location: "somewhere ambiguous",
      country_code: "AE",
      city: "Dubai",
      work_arrangement: "onsite",
      remote_scope: null,
    });
    assert.equal(result.countryCode, "AE");
    assert.equal(result.workArrangement, "onsite");
    assert.equal(result.locationConfidence, "high");
  });

  test("remote with structured country but no remote_scope is medium confidence", () => {
    const result = deriveEligibilityLocation({
      location: null,
      country_code: "LB",
      city: "Beirut",
      work_arrangement: "remote",
      remote_scope: null,
    });
    assert.equal(result.locationConfidence, "medium");
  });

  test("falls back to normalizeLocation on raw text when no structured country_code exists", () => {
    const result = deriveEligibilityLocation({
      location: "Remote - Worldwide",
      country_code: null,
      city: null,
      work_arrangement: null,
      remote_scope: null,
    });
    assert.equal(result.workArrangement, "remote");
    assert.equal(result.remoteScope, "worldwide");
    assert.equal(result.locationConfidence, "high");
  });

  test("nothing recognizable anywhere is low confidence", () => {
    const result = deriveEligibilityLocation({
      location: null,
      country_code: null,
      city: null,
      work_arrangement: null,
      remote_scope: null,
    });
    assert.equal(result.locationConfidence, "low");
  });
});
