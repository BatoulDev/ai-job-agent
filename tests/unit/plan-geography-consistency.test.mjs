// Phase 18 found (docs/LEBANON_GULF_PLAN_CONSISTENCY_AUDIT.md): the backend
// fully supported job_market_coverage's 'remote_mena'/'remote_worldwide'
// tiers, but no frontend UI control ever set it to anything but null —
// src/app/onboarding/preferences/page.tsx hardcoded
// `p_job_market_coverage: null` on every save, for every plan, making the
// tiers dead code in production.
//
// Resolved (job_market_coverage server-side derivation task,
// supabase/migrations/20260930110000_derive_job_market_coverage_server_side.sql):
// job_market_coverage is no longer a client parameter at all — the
// onboarding page never sends it, and save_job_preferences derives it
// server-side from international_search_enabled + work_arrangement
// (remote_worldwide when international is enabled and work_arrangement is
// remote/flexible, else null). See tests/db/international-job-preferences.test.mjs
// for the real RPC-level derivation tests and
// tests/e2e/preferences-job-market-coverage.spec.ts for the real browser
// -> RPC -> DB proof. This file keeps the original audit's static-assertion
// pattern to pin the resolved state the same way it pinned the bug.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { checkJobEligibility } from "../../src/lib/ingestion/checkJobEligibility.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

describe("Phase 18 job_market_coverage gap — resolved by server-side derivation", () => {
  test("onboarding/preferences page no longer sends a p_job_market_coverage argument — the server derives it, the client only sends intent", () => {
    const source = readFileSync(join(repoRoot, "src/app/onboarding/preferences/page.tsx"), "utf8");
    assert.doesNotMatch(
      source,
      /p_job_market_coverage/,
      "if this assertion fails because job_market_coverage was reintroduced as a client parameter, that reopens the exact client-supplied-entitlement bug this fix closed — derive it server-side instead"
    );
  });

  test("consequence, proven against the real unmodified checkJobEligibility: a Pro user with international search enabled and the derived remote_worldwide coverage CAN reach a worldwide-scoped remote job outside Lebanon", () => {
    const usOnlyRemoteJob = { countryCode: "US", workArrangement: "remote", remoteScope: "country:US", locationConfidence: "high" };
    const result = checkJobEligibility({
      job: usOnlyRemoteJob,
      planCode: "pro",
      jobMarketCoverage: "remote_worldwide", // what save_job_preferences now derives for this exact combination
      internationalSearchEnabled: true,
      willingToRelocate: false,
      relocationMarketCountryCodes: [],
    });
    assert.equal(result.eligible, true, "a Pro user with international search ON and the now-correctly-derived remote_worldwide coverage can see a non-Lebanon-scoped remote job — the tiers are no longer dead code");
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
