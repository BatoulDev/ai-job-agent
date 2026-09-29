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

// Legacy market-coverage cleanup, final phase
// (docs/LEBANON_GULF_PLAN_CONSISTENCY_AUDIT.md §9-§10): 'remote_mena',
// 'lebanon_only', and 'remote_lebanon_applicants' are fully retired —
// this project has no production database or users, so the previous
// task's stop condition (an unverified historical onboarding UI picker
// that could have written any of the four raw values to a real
// production row) no longer applies. 20260930140000 removed all three
// from the job_preferences_job_market_coverage_check CHECK constraint
// entirely (impossible column values, not just unreachable ones) and
// simplified checkJobEligibility.ts to drop its legacy-tier branches.
// This suite pins that final, permanent state via static source
// inspection — the DB-level proof (CHECK constraint rejection) lives in
// tests/db/international-job-preferences.test.mjs.
describe("Legacy market-coverage cleanup — retired values are structurally impossible, not just unused", () => {
  test("the CHECK constraint permits only 'remote_worldwide' (and, implicitly, null) — no retired value remains a legal column value", () => {
    const source = readFileSync(
      join(repoRoot, "supabase/migrations/20260930140000_remove_legacy_market_coverage_compatibility.sql"),
      "utf8"
    );
    assert.match(
      source,
      /check \(job_market_coverage in \('remote_worldwide'\)\)/,
      "if this assertion fails because the constraint was widened again to include a retired value, that reopens exactly the legacy-value surface this migration closed"
    );
  });

  test("checkJobEligibility.ts no longer contains any remote_mena/lebanon_only/remote_lebanon_applicants branch", () => {
    const source = readFileSync(join(repoRoot, "src/lib/ingestion/checkJobEligibility.ts"), "utf8");
    for (const retired of ["remote_mena", "lebanon_only", "remote_lebanon_applicants"]) {
      assert.doesNotMatch(
        source,
        new RegExp(`===\\s*"${retired}"|===\\s*'${retired}'`),
        `checkJobEligibility.ts must not branch on ${retired} — that is exactly the dead legacy logic this cleanup removed`
      );
    }
  });

  test("JobMarketCoverage is now a single-value type ('remote_worldwide'), not a union of legacy tiers", () => {
    const source = readFileSync(join(repoRoot, "src/lib/jobPreferences/types.ts"), "utf8");
    assert.match(source, /export type JobMarketCoverage = "remote_worldwide";/);
  });

  test("a retired value passed to checkJobEligibility at runtime behaves identically to null — no special-case interpretation survives in application code", () => {
    const gccRemote = { countryCode: null, workArrangement: "remote", remoteScope: "region:gcc", locationConfidence: "high" };
    const baseArgs = {
      job: gccRemote,
      planCode: "pro",
      preferredWorkArrangement: null,
      internationalSearchEnabled: true,
      willingToRelocate: false,
      relocationMarketCountryCodes: [],
    };
    const nullResult = checkJobEligibility({ ...baseArgs, jobMarketCoverage: null });
    for (const retired of ["remote_mena", "lebanon_only", "remote_lebanon_applicants"]) {
      const retiredResult = checkJobEligibility({ ...baseArgs, jobMarketCoverage: retired });
      assert.deepEqual(retiredResult, nullResult, `${retired} must produce an identical result to null — proves no legacy branch remains reachable`);
    }
  });
});
