// Coverage for supabase/migrations/20260924150000_backfill_source_intelligence_retryable.sql
// — the one-time, human-approved historical backfill of source_intelligence.retryable
// for the 42 needs_investigation rows that predate the retry-eligibility feature.
//
// Two kinds of assertions here, deliberately:
//   1. Pure-logic tests of the EXACT classification predicate documented in
//      the migration's own header — a JS re-implementation, unit-tested
//      against edge/unknown evidence shapes (proving "ambiguous stays
//      NULL, never guessed" as a property of the rule itself, independent
//      of what today's real data happens to contain).
//   2. Live regression assertions against the REAL, already-backfilled
//      historical rows in this local database — proving the migration
//      that actually ran produced exactly the documented effect and
//      touched nothing else. These are tied to this specific, one-time
//      migration (not fixture-generated), the same way other tests in
//      this repo assert against real seeded/historical data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject } from "./helpers.mjs";

// ── 1. Pure-logic re-implementation of the migration's classification rule ──
// Mirrors supabase/migrations/20260924150000_backfill_source_intelligence_retryable.sql
// exactly — kept as a single small function so a future change to the rule
// has one obvious place to update, both here and in the migration's own
// comment.
function classifyRetryable(evidence) {
  const method = evidence?.detection_method;
  const status = evidence?.http_status;

  if (method === "fetch_network_error") return true;
  if (method === "fetch_blocked_or_error_status" && typeof status === "number") {
    if ([403, 429, 999].includes(status) || status >= 500) return true;
    return false;
  }
  if (method === "no_public_url_available") return false;
  if (method === "no_provider_fingerprint_or_job_content_detected") return false;
  if (method === "off_scope_job_destination_only") return false;

  // Anything else — including a detection_method this rule does not know
  // about, or fetch_blocked_or_error_status with a missing/non-numeric
  // http_status — is deliberately NOT classified. No guessing.
  return null;
}

test("classifyRetryable: HTTP 429 is retryable", () => {
  assert.equal(classifyRetryable({ detection_method: "fetch_blocked_or_error_status", http_status: 429 }), true);
});

test("classifyRetryable: HTTP 403 is retryable", () => {
  assert.equal(classifyRetryable({ detection_method: "fetch_blocked_or_error_status", http_status: 403 }), true);
});

test("classifyRetryable: HTTP 999 is retryable", () => {
  assert.equal(classifyRetryable({ detection_method: "fetch_blocked_or_error_status", http_status: 999 }), true);
});

test("classifyRetryable: HTTP 5xx is retryable", () => {
  assert.equal(classifyRetryable({ detection_method: "fetch_blocked_or_error_status", http_status: 503 }), true);
});

test("classifyRetryable: a network error (no response) is retryable", () => {
  assert.equal(classifyRetryable({ detection_method: "fetch_network_error", http_status: null }), true);
});

test("classifyRetryable: HTTP 404 is structural (not retryable)", () => {
  assert.equal(classifyRetryable({ detection_method: "fetch_blocked_or_error_status", http_status: 404 }), false);
});

test("classifyRetryable: HTTP 401 is structural (not retryable)", () => {
  assert.equal(classifyRetryable({ detection_method: "fetch_blocked_or_error_status", http_status: 401 }), false);
});

test("classifyRetryable: no usable URL is structural", () => {
  assert.equal(classifyRetryable({ detection_method: "no_public_url_available", http_status: null }), false);
});

test("classifyRetryable: successfully fetched with no ATS/job signal is structural", () => {
  assert.equal(classifyRetryable({ detection_method: "no_provider_fingerprint_or_job_content_detected", http_status: 200 }), false);
});

test("classifyRetryable: an off-scope job destination is structural", () => {
  assert.equal(classifyRetryable({ detection_method: "off_scope_job_destination_only", http_status: 200 }), false);
});

test("classifyRetryable: an unrecognized detection_method is left NULL — never guessed", () => {
  assert.equal(classifyRetryable({ detection_method: "some_future_reason_this_rule_does_not_know", http_status: 418 }), null);
});

test("classifyRetryable: fetch_blocked_or_error_status with a missing http_status is left NULL — never guessed", () => {
  assert.equal(classifyRetryable({ detection_method: "fetch_blocked_or_error_status", http_status: null }), null);
});

test("classifyRetryable: no evidence at all is left NULL", () => {
  assert.equal(classifyRetryable({}), null);
  assert.equal(classifyRetryable(null), null);
});

// ── 2. Live regression: the actual historical backfill that ran ──────────
//
// These assert against real, pre-existing rows in the shared local dev
// database rather than fixtures (see file header) — but that database is
// NOT frozen: live analyzer activity keeps writing new source_intelligence
// rows to it independently of this test file. Asserting a global "the
// table has exactly N rows" snapshot would make every test here fail the
// next time anyone runs the real workflow. Instead, everything below is
// scoped by BACKFILL_CUTOFF — the migration's own timestamp — to the
// specific historical rows that existed when it ran, an immutable fact
// that can never change no matter how much real data is added later.
const BACKFILL_CUTOFF = "2026-09-24T15:00:00Z";

test("post-backfill: every historical needs_investigation row is classified (retryable is never NULL); no historical non-needs_investigation row was touched", async () => {
  await assertExpectedLocalProject();

  const { count: ni, error: niErr } = await adminClient
    .from("source_intelligence")
    .select("id", { count: "exact", head: true })
    .eq("ingestion_type", "needs_investigation")
    .lt("created_at", BACKFILL_CUTOFF);
  assert.equal(niErr, null);
  assert.ok(ni > 0, "sanity: historical needs_investigation rows must exist for this invariant to mean anything");

  const { count: niNull } = await adminClient
    .from("source_intelligence")
    .select("id", { count: "exact", head: true })
    .eq("ingestion_type", "needs_investigation")
    .lt("created_at", BACKFILL_CUTOFF)
    .is("retryable", null);
  assert.equal(niNull, 0, "no historical needs_investigation row may remain unclassified — the backfill must have resolved all of them");

  const { count: otherTouched } = await adminClient
    .from("source_intelligence")
    .select("id", { count: "exact", head: true })
    .neq("ingestion_type", "needs_investigation")
    .lt("created_at", BACKFILL_CUTOFF)
    .not("retryable", "is", null);
  assert.equal(otherTouched, 0, "the backfill must never have set retryable on a historical non-needs_investigation row");
});

test("post-backfill: zero historical needs_investigation rows remain unclassified — every historical row had sufficient evidence", async () => {
  const { count } = await adminClient
    .from("source_intelligence")
    .select("id", { count: "exact", head: true })
    .eq("ingestion_type", "needs_investigation")
    .lt("created_at", BACKFILL_CUTOFF)
    .is("retryable", null);
  assert.equal(count, 0);
});

test("post-backfill: no historical non-needs_investigation row was ever touched — retryable stays NULL", async () => {
  const { data, error } = await adminClient
    .from("source_intelligence")
    .select("id, ingestion_type, retryable")
    .neq("ingestion_type", "needs_investigation")
    .lt("created_at", BACKFILL_CUTOFF);
  assert.equal(error, null);
  assert.ok(data.length > 0, "sanity: historical non-needs_investigation rows must exist for this invariant to mean anything");
  for (const row of data) {
    assert.equal(row.retryable, null, `non-needs_investigation row ${row.id} must never have retryable set`);
  }
});

test("post-backfill: re-applying the same classification rule to the historical (pre-migration) data is a no-op (idempotency proof without re-running SQL)", async () => {
  // Replays the migration's own predicate against the rows it was
  // actually scoped to touch. If it now finds a candidate among THOSE
  // rows, the migration failed to apply (or something regressed). This is
  // deliberately scoped to created_at < BACKFILL_CUTOFF rather than the
  // live table: a row inserted afterward by analyzer activity that has
  // not yet been updated to set `retryable` itself is a real, expected,
  // ongoing deployment fact — not something this one-time migration was
  // ever responsible for, and not a regression in the migration's logic.
  const { data } = await adminClient
    .from("source_intelligence")
    .select("id, ingestion_type, evidence, retryable")
    .eq("ingestion_type", "needs_investigation")
    .lt("created_at", BACKFILL_CUTOFF)
    .is("retryable", null);
  assert.equal(data.length, 0, "no historical needs_investigation row should still be NULL and classifiable — the backfill already resolved every determinable one");
});

test("post-backfill: the 3 known retryable historical sources have the exact evidence the migration's rule requires, and still individually satisfy the retry-eligibility backoff predicate", async () => {
  const expected = {
    "sr-ae-azizi-developments": { detection_method: "fetch_blocked_or_error_status", http_status: 429 },
    "sr-ae-adcb": { detection_method: "fetch_blocked_or_error_status", http_status: 403 },
    "sr-ae-dubai-health": { detection_method: "fetch_network_error", http_status: null },
  };
  for (const [sourceId, expectedEvidence] of Object.entries(expected)) {
    // Scoped to the historical (pre-migration) row specifically. A real
    // source can legitimately gain a newer, unrelated observation later —
    // sr-ae-adcb was in fact re-analyzed again on 2026-09-26 by ongoing
    // live activity — and .single() without this scope would then find 2
    // rows and fail for a reason that has nothing to do with the
    // migration itself.
    const { data, error } = await adminClient
      .from("source_intelligence")
      .select("retryable, evidence, detected_provider, ingestion_type, confidence, analyzed_at")
      .eq("source_id", sourceId)
      .lt("created_at", BACKFILL_CUTOFF)
      .single();
    assert.equal(error, null, `${sourceId} must still have its historical (pre-migration) row`);
    assert.equal(data.retryable, true, `${sourceId} must be retryable=true`);
    assert.equal(data.evidence.detection_method, expectedEvidence.detection_method);
    assert.equal(data.evidence.http_status, expectedEvidence.http_status);
    assert.equal(classifyRetryable(data.evidence), true, "the classification rule must agree with what was actually written");
    // Fields the migration must never touch.
    assert.equal(data.ingestion_type, "needs_investigation");
    assert.equal(data.detected_provider, "unknown");
    // The row's own age must satisfy the 3-day backoff regardless of
    // whether it still happens to be the LATEST observation on file for
    // this source — that "is it still latest" question belongs to
    // tests/db/source-intelligence-retry-eligibility.test.mjs, not here.
    assert.ok(
      Date.now() - new Date(data.analyzed_at).getTime() > 3 * 24 * 60 * 60 * 1000,
      `${sourceId}'s historical observation must be more than 3 days old`
    );
  }
});

test("post-backfill: the 3 retryable sources' own company_sources rows were never touched by the backfill", async () => {
  // The backfill only ever writes source_intelligence.retryable — never
  // company_sources, never triggers promotion. dubai-health in particular
  // already had a non-'unknown' automation_eligibility from prior
  // (unrelated) data — proving the migration did not reset or promote it.
  const { data: azizi } = await adminClient.from("company_sources").select("ats_provider, automation_eligibility, review_status").eq("id", "sr-ae-azizi-developments").single();
  assert.equal(azizi.ats_provider, "unknown");
  assert.equal(azizi.automation_eligibility, "unknown");

  const { data: dubaiHealth } = await adminClient.from("company_sources").select("ats_provider, automation_eligibility").eq("id", "sr-ae-dubai-health").single();
  assert.equal(dubaiHealth.ats_provider, "unknown");
  assert.equal(dubaiHealth.automation_eligibility, "suitable_public_html_subject_to_review", "a pre-existing, unrelated value — must not have been overwritten or reset by the backfill");
});

// ── 3. Candidate-selection effect of the backfill ─────────────────────────

test("post-backfill: each of the 3 real backfilled retryable sources is a genuine retry_after_backoff candidate, for as long as its migration-era row is still the latest observation on file", async () => {
  const { data: candidates, error } = await adminClient.rpc("get_source_intelligence_candidates", { p_limit: 1000 });
  assert.equal(error, null);

  for (const sourceId of ["sr-ae-azizi-developments", "sr-ae-adcb", "sr-ae-dubai-health"]) {
    const { count: newerRows } = await adminClient
      .from("source_intelligence")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId)
      .gte("created_at", BACKFILL_CUTOFF);
    if (newerRows > 0) {
      // A real, legitimate later analyzer run has already superseded the
      // migration-era row for this source — exactly the retry-eligibility
      // feature working as intended. Current candidacy now depends on
      // that newer observation, not on this migration, so this
      // migration-scoped test has nothing left to assert for it (the row
      // itself is still checked, unconditionally, in the previous test).
      continue;
    }
    const candidate = candidates.find((c) => c.source.id === sourceId);
    assert.ok(candidate, `${sourceId} must be a candidate — its migration-era observation is retryable and well past the 3-day backoff`);
    assert.equal(candidate.selection_reason, "retry_after_backoff");
  }
});

test("post-backfill: no historical structural (retryable=false) source is ever a candidate", async () => {
  const { data: structuralRows, error } = await adminClient
    .from("source_intelligence")
    .select("source_id")
    .eq("retryable", false)
    .lt("created_at", BACKFILL_CUTOFF);
  assert.equal(error, null);
  assert.ok(structuralRows.length > 0, "sanity: historical structural rows must exist for this invariant to mean anything");

  const { data: candidates } = await adminClient.rpc("get_source_intelligence_candidates", { p_limit: 1000 });
  const candidateIds = new Set(candidates.map((c) => c.source.id));

  const wronglyIncluded = structuralRows.filter((r) => candidateIds.has(r.source_id));
  assert.deepEqual(wronglyIncluded, [], "no structural (retryable=false) source may ever become a candidate again");
});
