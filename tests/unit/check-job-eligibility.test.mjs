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

  test("unknown work arrangement is never eligible", () => {
    const result = checkJobEligibility(
      baseInput({ job: { countryCode: "LB", workArrangement: null, remoteScope: null, locationConfidence: "medium" } }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "work_arrangement_unknown");
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

describe("checkJobEligibility — Pro job_market_coverage tiers", () => {
  const gccRemote = { countryCode: null, workArrangement: "remote", remoteScope: "region:gcc", locationConfidence: "high" };
  const usRemote = { countryCode: "US", workArrangement: "remote", remoteScope: "country:US", locationConfidence: "high" };

  test("pro with no job_market_coverage set behaves exactly like remote_lebanon_applicants (documented default)", () => {
    const result = checkJobEligibility(baseInput({ planCode: "pro", jobMarketCoverage: null, job: gccRemote }));
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "remote_scope_excludes_lebanon");
  });

  test("pro + remote_mena: GCC-scoped remote is eligible", () => {
    const result = checkJobEligibility(baseInput({ planCode: "pro", jobMarketCoverage: "remote_mena", job: gccRemote }));
    assert.equal(result.eligible, true);
  });

  test("pro + remote_mena: US-only remote is still not eligible", () => {
    const result = checkJobEligibility(baseInput({ planCode: "pro", jobMarketCoverage: "remote_mena", job: usRemote }));
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "remote_scope_excludes_lebanon");
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

  test("pro + lebanon_only: GCC-scoped remote is not eligible", () => {
    const result = checkJobEligibility(baseInput({ planCode: "pro", jobMarketCoverage: "lebanon_only", job: gccRemote }));
    assert.equal(result.eligible, false);
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
