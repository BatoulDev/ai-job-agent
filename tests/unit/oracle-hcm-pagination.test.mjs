// Unit tests for src/lib/ingestion/oracleHcmPagination.ts (2026-10-23
// pagination-safety phase). Pure, synthetic fixtures only — no network, no
// n8n, no database. Covers the exact scenarios this phase's plan required:
// a single-page (AUBMC-shaped, 8 jobs) retrieval, a 3-page 60-job
// retrieval, malformed metadata, a repeated/non-advancing offset, a
// premature empty page, and bounded page-count exhaustion.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  classifyOracleHcmFirstPage,
  classifyOracleHcmNextPage,
  markPaginationBoundExhausted,
  buildOracleHcmNextPageUrl,
  nextPageOffset,
  mergeIncludesEveryValidId,
  ORACLE_PAGINATION_MAX_PAGES,
} from "../../src/lib/ingestion/oracleHcmPagination.ts";

function page(offset, limit, totalJobsCount, jobIds) {
  return {
    items: [
      {
        Offset: offset,
        Limit: limit,
        TotalJobsCount: totalJobsCount,
        requisitionList: jobIds.map((id) => ({ Id: id, Title: `Job ${id}` })),
      },
    ],
  };
}

const CANDIDATE_SITE_URL = "https://example.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1";
const FEED_URL = "https://example.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber=CX_1&expand=requisitionList&limit=50";

describe("classifyOracleHcmFirstPage — 8 real jobs, single page (AUBMC-shaped)", () => {
  test("a complete single page is recognized as complete, no pagination needed", () => {
    const body = page(0, 25, 8, [1, 2, 3, 4, 5, 6, 7, 8]);
    const state = classifyOracleHcmFirstPage(body, CANDIDATE_SITE_URL);

    assert.equal(state.rawJobs.length, 8);
    assert.equal(state.pageOffset, 0);
    assert.equal(state.pageLimit, 25);
    assert.equal(state.pagesFetched, 1);
    assert.equal(state.paginationIncomplete, false);
    assert.equal(state.isComplete, true, "8 offset+items >= TotalJobsCount(8) — the real reported total, not the requested limit=50");
    assert.equal(state.rawJobs[0].candidateSiteUrl, CANDIDATE_SITE_URL);
  });
});

describe("classifyOracleHcmFirstPage + classifyOracleHcmNextPage — 60 jobs across three real pages", () => {
  test("three genuinely advancing pages accumulate all 60 distinct jobs and reach isComplete", () => {
    const page1 = page(0, 25, 60, Array.from({ length: 25 }, (_, i) => i + 1)); // ids 1-25
    let state = classifyOracleHcmFirstPage(page1, CANDIDATE_SITE_URL);
    assert.equal(state.isComplete, false);
    assert.equal(state.rawJobs.length, 25);

    const nextOffset1 = nextPageOffset(state);
    assert.equal(nextOffset1, 25, "offset + the real reported Limit, never the requested one");

    const page2 = page(25, 25, 60, Array.from({ length: 25 }, (_, i) => i + 26)); // ids 26-50
    state = classifyOracleHcmNextPage(page2, state, CANDIDATE_SITE_URL);
    assert.equal(state.isComplete, false);
    assert.equal(state.rawJobs.length, 50);
    assert.equal(state.pagesFetched, 2);

    const nextOffset2 = nextPageOffset(state);
    assert.equal(nextOffset2, 50);

    const page3 = page(50, 25, 60, Array.from({ length: 10 }, (_, i) => i + 51)); // ids 51-60, a short final page
    state = classifyOracleHcmNextPage(page3, state, CANDIDATE_SITE_URL);

    assert.equal(state.isComplete, true, "50 + 10 = 60 >= TotalJobsCount(60)");
    assert.equal(state.paginationIncomplete, false);
    assert.equal(state.rawJobs.length, 60, "all 60 distinct jobs accumulated across three pages");
    assert.equal(state.pagesFetched, 3);
    // Every distinct id 1..60 present exactly once.
    const ids = state.rawJobs.map((j) => j.Id).sort((a, b) => a - b);
    assert.deepEqual(ids, Array.from({ length: 60 }, (_, i) => i + 1));
  });

  test("overlapping/repeated job ids across pages are deduplicated, never double-counted", () => {
    const page1 = page(0, 5, 8, [1, 2, 3, 4, 5]);
    let state = classifyOracleHcmFirstPage(page1, CANDIDATE_SITE_URL);
    // A real, if unusual, overlap: page 2 re-reports job 5 alongside genuinely new jobs.
    const page2 = page(5, 5, 8, [5, 6, 7]);
    state = classifyOracleHcmNextPage(page2, state, CANDIDATE_SITE_URL);

    assert.equal(state.rawJobs.length, 7, "job 5 counted once, not twice");
    assert.equal(state.isComplete, true);
  });
});

describe("classifyOracleHcmFirstPage — malformed metadata fails closed", () => {
  test("missing items array", () => {
    const state = classifyOracleHcmFirstPage({}, CANDIDATE_SITE_URL);
    assert.equal(state.rawJobs.length, 0);
    assert.equal(state.paginationIncomplete, true);
    assert.equal(state.isComplete, false);
  });

  test("non-numeric TotalJobsCount", () => {
    const body = page(0, 25, "eight", [1, 2]);
    const state = classifyOracleHcmFirstPage(body, CANDIDATE_SITE_URL);
    assert.equal(state.paginationIncomplete, true, "a non-numeric total can never be trusted to decide completeness");
    assert.equal(state.rawJobs.length, 0, "fail closed — nothing from an unparseable response is accumulated");
  });

  test("requisitionList is not an array", () => {
    const body = { items: [{ Offset: 0, Limit: 25, TotalJobsCount: 8, requisitionList: "not-an-array" }] };
    const state = classifyOracleHcmFirstPage(body, CANDIDATE_SITE_URL);
    assert.equal(state.paginationIncomplete, true);
  });
});

describe("classifyOracleHcmNextPage — malformed metadata on a later page preserves prior good pages", () => {
  test("a malformed page 2 keeps page 1's already-accumulated jobs, marks incomplete, never discards what was already safe", () => {
    const page1 = page(0, 25, 60, Array.from({ length: 25 }, (_, i) => i + 1));
    const state1 = classifyOracleHcmFirstPage(page1, CANDIDATE_SITE_URL);

    const malformedPage2 = { items: [{ Offset: 25, Limit: "oops", TotalJobsCount: 60, requisitionList: [] }] };
    const state2 = classifyOracleHcmNextPage(malformedPage2, state1, CANDIDATE_SITE_URL);

    assert.equal(state2.rawJobs.length, 25, "page 1's 25 real jobs are preserved, not discarded or zeroed");
    assert.equal(state2.paginationIncomplete, true);
    assert.equal(state2.isComplete, false);
  });
});

describe("classifyOracleHcmNextPage — repeated/non-advancing offset fails closed", () => {
  test("a page that reports the SAME offset as before (API ignored our request) stops pagination, keeps prior jobs", () => {
    const page1 = page(0, 25, 60, Array.from({ length: 25 }, (_, i) => i + 1));
    const state1 = classifyOracleHcmFirstPage(page1, CANDIDATE_SITE_URL);

    // Requested offset=25, but the API echoed back offset=0 again (ignored it) with the same 25 jobs.
    const repeatedPage = page(0, 25, 60, Array.from({ length: 25 }, (_, i) => i + 1));
    const state2 = classifyOracleHcmNextPage(repeatedPage, state1, CANDIDATE_SITE_URL);

    assert.equal(state2.paginationIncomplete, true, "a non-advancing offset can never be trusted to represent real progress");
    assert.equal(state2.rawJobs.length, 25, "unchanged from before — the repeated page's content is never merged in");
  });

  test("an offset that moves BACKWARD is treated the same as non-advancing", () => {
    const page1 = page(25, 25, 60, Array.from({ length: 25 }, (_, i) => i + 26));
    const state1 = classifyOracleHcmFirstPage(page1, CANDIDATE_SITE_URL);
    const backwardPage = page(10, 25, 60, Array.from({ length: 25 }, (_, i) => i + 11));
    const state2 = classifyOracleHcmNextPage(backwardPage, state1, CANDIDATE_SITE_URL);
    assert.equal(state2.paginationIncomplete, true);
  });
});

describe("classifyOracleHcmNextPage — premature empty page fails closed", () => {
  test("zero items returned before the real total is reached is never treated as 'done'", () => {
    const page1 = page(0, 25, 60, Array.from({ length: 25 }, (_, i) => i + 1));
    const state1 = classifyOracleHcmFirstPage(page1, CANDIDATE_SITE_URL);

    const prematureEmptyPage = page(25, 25, 60, []); // offset advanced correctly, but 0 items with 35 real jobs still unseen
    const state2 = classifyOracleHcmNextPage(prematureEmptyPage, state1, CANDIDATE_SITE_URL);

    assert.equal(state2.paginationIncomplete, true, "25 + 0 = 25 < TotalJobsCount(60) — a genuine gap, never silently accepted as complete");
    assert.equal(state2.isComplete, false);
    assert.equal(state2.rawJobs.length, 25, "prior page preserved");
  });

  test("zero items that genuinely exhausts the real total IS the correct completion signal, not premature", () => {
    const page1 = page(0, 25, 8, Array.from({ length: 8 }, (_, i) => i + 1));
    const state1 = classifyOracleHcmFirstPage(page1, CANDIDATE_SITE_URL);
    assert.equal(state1.isComplete, true, "8 items + offset 0 >= TotalJobsCount(8) already, on page 1 alone");

    // The live-confirmed AUBMC case: requesting offset=8 on an 8-job tenant
    // correctly returns 0 items with Offset echoed back as 8.
    const confirmingPage = page(8, 25, 8, []);
    const state2 = classifyOracleHcmNextPage(confirmingPage, state1, CANDIDATE_SITE_URL);
    assert.equal(state2.paginationIncomplete, false, "offset(8) is NOT < TotalJobsCount(8) — this is the real, correct end-of-results signal");
    assert.equal(state2.isComplete, true);
  });
});

// ── 2026-10-24 rawJobs-loss incident: missing/invalid Ids + integrity guard ──
// An isolated n8n diagnostic (executions 300293/300549/300782) proved that
// Array.from(map.values()) AND the [...map.values()] spread form both
// silently return an empty array inside n8n's Set-node inline-expression
// evaluator, despite the Map itself reporting the correct size — while this
// module's own Array.from(map.values()) (running in real Node, not n8n's
// expression sandbox) was never actually broken by that specific defect.
// These tests cover two separate things the incident surfaced: (1) a
// pre-existing logical bug in this module's own key scheme (missing Ids
// sharing one empty-string key) that was real regardless of environment,
// now fixed; (2) the new fail-closed integrity guard added as insurance
// against this entire class of silent accumulation-loss defect recurring,
// here or anywhere this pattern is reused.
describe("dedupeById (via classify) — missing/invalid Ids are never collapsed into each other", () => {
  test("two jobs that both lack an Id are both kept, not collapsed under a shared empty key", () => {
    const body = {
      items: [{ Offset: 0, Limit: 25, TotalJobsCount: 2, requisitionList: [{ Title: "No id A" }, { Title: "No id B" }] }],
    };
    const state = classifyOracleHcmFirstPage(body, CANDIDATE_SITE_URL);
    assert.equal(state.rawJobs.length, 2, "both Id-less jobs survive — they have no real shared identity to dedup by");
    assert.equal(state.paginationIncomplete, false);
  });

  test("a job with a blank-string Id is treated the same as missing, not as a real empty-string identity", () => {
    const body = {
      items: [{ Offset: 0, Limit: 25, TotalJobsCount: 2, requisitionList: [{ Id: "" }, { Id: "   " }] }],
    };
    const state = classifyOracleHcmFirstPage(body, CANDIDATE_SITE_URL);
    assert.equal(state.rawJobs.length, 2, "blank-string Ids are treated as invalid/missing, never deduped against each other");
  });

  test("a mix of valid and missing Ids across two pages: valid Ids dedup normally, missing-Id jobs from both pages all survive", () => {
    const page1 = { items: [{ Offset: 0, Limit: 25, TotalJobsCount: 10, requisitionList: [{ Id: 1 }, { Title: "no id, page 1" }] }] };
    let state = classifyOracleHcmFirstPage(page1, CANDIDATE_SITE_URL);
    assert.equal(state.rawJobs.length, 2);

    const page2 = { items: [{ Offset: 2, Limit: 25, TotalJobsCount: 10, requisitionList: [{ Id: 1 }, { Title: "no id, page 2" }] }] };
    state = classifyOracleHcmNextPage(page2, state, CANDIDATE_SITE_URL);

    assert.equal(state.rawJobs.length, 3, "Id:1 deduped to one (last-wins), both Id-less jobs (one per page) survive distinctly");
    assert.equal(state.paginationIncomplete, false);
  });
});

describe("mergeIncludesEveryValidId — the fail-closed integrity guard, tested directly against the real incident shape", () => {
  test("passes when every valid Id from both inputs survives into the merged output, including the legitimate-duplicate case", () => {
    const prior = [{ Id: 1 }, { Id: 2 }];
    const fresh = [{ Id: 2 }, { Id: 3 }]; // Id 2 legitimately repeats across pages
    const merged = [{ Id: 1 }, { Id: 2 }, { Id: 3 }]; // correctly deduped — set-based check must not flag this
    assert.equal(mergeIncludesEveryValidId(prior, fresh, merged), true);
  });

  test("fails when the merge silently drops a valid Id that was present in an input", () => {
    const prior = [{ Id: 1 }, { Id: 2 }];
    const fresh = [{ Id: 3 }];
    const merged = [{ Id: 1 }, { Id: 2 }]; // Id 3 went missing
    assert.equal(mergeIncludesEveryValidId(prior, fresh, merged), false);
  });

  test("fails on the exact incident shape: merged is empty despite non-empty, valid-Id inputs (Map.size was correct, iteration returned nothing)", () => {
    const prior = [{ Id: 1 }, { Id: 2 }];
    const fresh = [{ Id: 3 }, { Id: 4 }];
    assert.equal(mergeIncludesEveryValidId(prior, fresh, []), false);
  });

  test("fails on an empty merge even when neither input has a valid Id to check by set membership (every job is Id-less)", () => {
    const prior = [{ Title: "no id" }];
    const fresh = [{ Title: "also no id" }];
    assert.equal(mergeIncludesEveryValidId(prior, fresh, []), false, "set-membership alone can't catch this — the explicit non-empty-inputs check must");
  });

  test("passes trivially when both inputs are genuinely empty (nothing to lose)", () => {
    assert.equal(mergeIncludesEveryValidId([], [], []), true);
  });
});

describe("accumulation integrity guard wired into classify — end-to-end happy path stays intact", () => {
  test("classifyOracleHcmFirstPage: every valid Id from the page survives into rawJobs", () => {
    const body = { items: [{ Offset: 0, Limit: 25, TotalJobsCount: 3, requisitionList: [{ Id: 1 }, { Id: 2 }, { Id: 3 }] }] };
    const state = classifyOracleHcmFirstPage(body, CANDIDATE_SITE_URL);
    const ids = state.rawJobs.map((j) => j.Id).sort();
    assert.deepEqual(ids, [1, 2, 3]);
    assert.equal(state.paginationIncomplete, false);
  });

  test("classifyOracleHcmNextPage: a genuinely-advancing, well-formed page never results in fewer surviving jobs than before it", () => {
    const page1 = { items: [{ Offset: 0, Limit: 2, TotalJobsCount: 6, requisitionList: [{ Id: 1 }, { Id: 2 }] }] };
    const state1 = classifyOracleHcmFirstPage(page1, CANDIDATE_SITE_URL);
    assert.equal(state1.rawJobs.length, 2);

    const page2 = { items: [{ Offset: 2, Limit: 2, TotalJobsCount: 6, requisitionList: [{ Id: 3 }, { Id: 4 }] }] };
    const state2 = classifyOracleHcmNextPage(page2, state1, CANDIDATE_SITE_URL);
    assert.equal(state2.rawJobs.length, 4, "all four distinct jobs across both pages must be accumulated");
    assert.equal(state2.paginationIncomplete, false);
  });
});

describe("markPaginationBoundExhausted — the bounded maxPages safety cap", () => {
  test("exhausting the attempt budget without a completion signal forces paginationIncomplete, preserves accumulated jobs", () => {
    const page1 = page(0, 25, 1000, Array.from({ length: 25 }, (_, i) => i + 1));
    let state = classifyOracleHcmFirstPage(page1, CANDIDATE_SITE_URL);
    // Simulate genuinely-advancing pages that never reach completion within the bound.
    for (let i = 1; i < ORACLE_PAGINATION_MAX_PAGES; i++) {
      const nextOffset = nextPageOffset(state);
      const nextPage = page(nextOffset, 25, 1000, Array.from({ length: 25 }, (_, j) => nextOffset + j + 1));
      state = classifyOracleHcmNextPage(nextPage, state, CANDIDATE_SITE_URL);
    }
    assert.equal(state.isComplete, false, "1000 real jobs never completes within this bounded test");
    const exhausted = markPaginationBoundExhausted(state);
    assert.equal(exhausted.paginationIncomplete, true);
    assert.equal(exhausted.isComplete, false);
    assert.ok(exhausted.rawJobs.length > 0, "whatever was accumulated within the bound is preserved, never discarded");
  });
});

describe("buildOracleHcmNextPageUrl — generic, reusable across any Oracle HCM tenant", () => {
  test("inserts offset as a finder variable alongside siteNumber, preserves the rest of the URL unchanged", () => {
    const url = buildOracleHcmNextPageUrl(FEED_URL, 25);
    assert.equal(url, "https://example.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber=CX_1,offset=25&expand=requisitionList&limit=50");
  });

  test("always builds from the ORIGINAL feed URL — calling it twice with different offsets never double-inserts", () => {
    const url1 = buildOracleHcmNextPageUrl(FEED_URL, 25);
    const url2 = buildOracleHcmNextPageUrl(FEED_URL, 50);
    assert.match(url1, /siteNumber=CX_1,offset=25/);
    assert.ok(!url2.includes("offset=25"), "building from the original URL each time, never from a previously-modified one");
    assert.match(url2, /siteNumber=CX_1,offset=50/);
  });

  test("returns null for a feed URL that doesn't match the expected shape — never guesses", () => {
    assert.equal(buildOracleHcmNextPageUrl("https://boards-api.greenhouse.io/v1/boards/acme/jobs", 25), null);
  });
});
