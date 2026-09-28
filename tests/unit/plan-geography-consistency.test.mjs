// Phase 18: backend/frontend plan-geography consistency audit. Pure
// source-inspection tests (no component render harness exists in this
// project's test conventions — mirrors the same static-assertion pattern
// already used by tests/workflow/*.test.mjs for cross-file consistency
// checks) plus direct calls into the real, unmodified checkJobEligibility.
//
// Real finding this phase, not fixed (audit-only mandate — see
// docs/LEBANON_GULF_PLAN_CONSISTENCY_AUDIT.md): the backend
// (save_job_preferences RPC, 20260902090010_plan_aware_job_preferences.sql)
// fully supports job_market_coverage's 'remote_mena'/'remote_worldwide'
// tiers, and checkJobEligibility.ts's own tests
// (tests/unit/check-job-eligibility.test.mjs) prove those tiers work
// correctly in isolation — but NO frontend UI control exists anywhere in
// this codebase to actually set job_market_coverage to anything but null.
// src/app/onboarding/preferences/page.tsx hardcodes
// `p_job_market_coverage: null` on every save, for every plan. This test
// pins that real, current fact so a future change to it (adding a UI
// control, or accidentally removing the hardcode) is a deliberate,
// reviewed diff — not a silent behavior change either way.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkJobEligibility } from "../../src/lib/ingestion/checkJobEligibility.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

describe("Phase 18 — job_market_coverage is backend-complete but frontend-unreachable (real, current, not yet fixed)", () => {
  test("onboarding/preferences page hardcodes p_job_market_coverage: null on every save — no UI control sets it to anything else", () => {
    const source = readFileSync(join(repoRoot, "src/app/onboarding/preferences/page.tsx"), "utf8");
    assert.match(
      source,
      /p_job_market_coverage:\s*null,/,
      "if this assertion fails because a real job_market_coverage UI control was added, update docs/LEBANON_GULF_PLAN_CONSISTENCY_AUDIT.md's finding and this test together — do not just delete the assertion"
    );
  });

  test("consequence, proven against the real unmodified checkJobEligibility: a Pro user with international search enabled cannot actually reach the remote_mena/remote_worldwide tiers today, because job_market_coverage is always saved as null", () => {
    // The exact real default the RPC call above always saves + the exact
    // real default checkJobEligibility documents for a null coverage value
    // (see checkJobEligibility.ts's own JobEligibilityInput.jobMarketCoverage
    // doc comment: "treats it the same as remote_lebanon_applicants").
    const usOnlyRemoteJob = { countryCode: "US", workArrangement: "remote", remoteScope: "country:US", locationConfidence: "high" };
    const result = checkJobEligibility({
      job: usOnlyRemoteJob,
      planCode: "pro",
      jobMarketCoverage: null, // what the real onboarding page always sends
      internationalSearchEnabled: true, // the real Pro-only toggle, ON
      willingToRelocate: false,
      relocationMarketCountryCodes: [],
    });
    assert.equal(result.eligible, false, "a Pro user with international search ON still cannot see a non-Lebanon-scoped remote job today — the remote_mena/remote_worldwide tiers are dead code in production until a UI control exists");
    assert.equal(result.reason, "remote_scope_excludes_lebanon");
  });

  test("what Pro's international-search toggle DOES deliver today: Lebanon-inclusive remote jobs (available to every plan, not actually gated by the toggle) and onsite/hybrid Gulf relocation (genuinely plan-gated and working)", () => {
    const worldwideRemote = { countryCode: "US", workArrangement: "remote", remoteScope: "worldwide", locationConfidence: "high" };
    const freeResult = checkJobEligibility({
      job: worldwideRemote, planCode: "free", jobMarketCoverage: null,
      internationalSearchEnabled: false, willingToRelocate: null, relocationMarketCountryCodes: [],
    });
    assert.equal(freeResult.eligible, true, "a worldwide-scoped remote job is eligible for Free too — the Pricing.tsx promise ('roles that accept Lebanon-based applicants') is delivered to every plan, not exclusively unlocked by Pro's toggle");

    const onsiteGulf = { countryCode: "QA", workArrangement: "onsite", remoteScope: null, locationConfidence: "high" };
    const proRelocation = checkJobEligibility({
      job: onsiteGulf, planCode: "pro", jobMarketCoverage: null,
      internationalSearchEnabled: true, willingToRelocate: true, relocationMarketCountryCodes: ["QA"],
    });
    assert.equal(proRelocation.eligible, true, "Gulf relocation (onsite/hybrid) IS a real, working, Pro-exclusive differentiator — unaffected by the job_market_coverage gap above");
  });
});
