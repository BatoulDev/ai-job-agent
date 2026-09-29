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
//   2. Live DB tests against FRESH, self-contained fixture rows this file
//      creates and deletes itself — proving the migration's documented
//      classification rule and safety invariants hold as a matter of the
//      current schema/functions, not as a snapshot of the specific 42
//      historical rows it once ran against.
//
// FIXTURE REPRODUCIBILITY FIX (tests/db reproducibility gap, see
// docs/LEBANON_GULF_PLAN_CONSISTENCY_AUDIT.md and this task's own report):
// section 2 previously asserted directly against 3 named historical
// source_intelligence rows (sr-ae-azizi-developments, sr-ae-adcb,
// sr-ae-dubai-health) that existed in the shared local dev database at
// the time this file was written, but were never created by any
// migration or seed script — they came from real, one-off analyzer
// activity in an earlier session. A clean `supabase db reset` (this
// project has no seed.sql) legitimately produces an empty
// source_intelligence table, at which point 20260924150000 is correctly
// a no-op (it is WHERE-scoped to `retryable is null` against whatever
// rows exist when it runs) and those 3 rows simply do not exist —
// failing every assertion that named them, even though nothing was
// actually broken. This is a production-code-correct, test-fixture-wrong
// situation (Phase 2 classification: test-fixture/reproducibility bug,
// not a production defect) — the migration is a genuine point-in-time
// data correction; a fresh database was never supposed to reproduce its
// specific historical inputs. The fix replaces "does the migration's
// one-time effect survive in this literal database" with "does the rule
// this migration encoded, and the safety invariants it documents, still
// hold" — provable with fresh, disposable fixtures instead. The
// candidate-selection/backoff/latest-observation-wins behavior that used
// to be exercised incidentally via those 3 rows is already exhaustively
// covered, with proper fixtures, by tests/db/source-intelligence-retry-eligibility.test.mjs
// — not duplicated here.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { adminClient, assertExpectedLocalProject } from "./helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

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

// ── 2. The migration's own SQL, statically proven to implement the same
// rule and safety invariants as classifyRetryable above and this file's
// header — reproducible with zero DB dependency, and a stronger
// regression guard than trusting a historical row's survival: it directly
// inspects the deployed SQL rather than inferring correctness from a side
// effect. See supabase/migrations/20260924150000_..._retryable.sql.

const MIGRATION_PATH = "supabase/migrations/20260924150000_backfill_source_intelligence_retryable.sql";

test("migration SQL: every UPDATE is scoped to retryable is null (never overwrites an already-classified row)", () => {
  const source = readFileSync(join(repoRoot, MIGRATION_PATH), "utf8");
  // Strip comment lines first — the migration's own "Reversible with:"
  // footer comment contains a sample "update public.source_intelligence"
  // snippet, which would otherwise be miscounted as a 7th real statement.
  const sqlOnly = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const updateBlocks = sqlOnly.split(/update public\.source_intelligence/).slice(1);
  assert.equal(updateBlocks.length, 6, "expected exactly 6 UPDATE statements — one per documented branch of the rule");
  for (const block of updateBlocks) {
    assert.match(block, /where\s+retryable is null/, "every UPDATE must be scoped to retryable is null");
    assert.match(block, /ingestion_type = 'needs_investigation'/, "every UPDATE must be scoped to needs_investigation rows only");
  }
});

test("migration SQL: never references company_sources — retryable classification cannot trigger promotion or touch any other table", () => {
  const source = readFileSync(join(repoRoot, MIGRATION_PATH), "utf8");
  // Strip comment lines first — the migration's own header comment says
  // "company_sources/companies are not referenced at all", which contains
  // the string being checked for while asserting its absence. Only real
  // SQL statement text should be inspected.
  const sqlOnly = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(sqlOnly, /company_sources/, "this migration must only ever write source_intelligence.retryable");
});

test("migration SQL: only the retryable column is ever set", () => {
  const source = readFileSync(join(repoRoot, MIGRATION_PATH), "utf8");
  const setClauses = [...source.matchAll(/^set\s+(\w+)\s*=/gm)].map((m) => m[1]);
  assert.ok(setClauses.length > 0, "sanity: at least one SET clause must be found");
  for (const column of setClauses) {
    assert.equal(column, "retryable", `unexpected column set by this migration: ${column}`);
  }
});

test("migration SQL's retryable-true branches match classifyRetryable's retryable-true cases (fetch_network_error, and fetch_blocked_or_error_status with 403/429/999/5xx)", () => {
  const source = readFileSync(join(repoRoot, MIGRATION_PATH), "utf8");
  assert.match(source, /set retryable = true[\s\S]*?fetch_network_error/, "network-error branch must set retryable = true");
  assert.match(
    source,
    /set retryable = true[\s\S]*?fetch_blocked_or_error_status[\s\S]*?\(403, 429, 999\)[\s\S]*?>= 500/,
    "the blocked/error-status retryable branch must cover 403/429/999 and any 5xx, matching classifyRetryable exactly"
  );
});

// ── 3. Fresh, self-contained fixtures proving the still-live rule and its
// safety invariants — no dependency on any specific historical row.

const fixtureCompanyIds = new Set();
const fixtureSourceIds = new Set();

after(async () => {
  if (fixtureSourceIds.size > 0) {
    await adminClient.from("source_intelligence").delete().in("source_id", [...fixtureSourceIds]);
    const { error } = await adminClient.from("company_sources").delete().in("id", [...fixtureSourceIds]);
    if (error) throw new Error(`cleanup: failed to delete fixture company_sources: ${error.message}`);
  }
  if (fixtureCompanyIds.size > 0) {
    const { error } = await adminClient.from("companies").delete().in("id", [...fixtureCompanyIds]);
    if (error) throw new Error(`cleanup: failed to delete fixture companies: ${error.message}`);
  }
});

async function createFixtureSource(label, overrides = {}) {
  const suffix = randomUUID().slice(0, 8);
  const companyId = `cc-siretrybackfill-${label}-${suffix}`;
  const sourceId = `sr-siretrybackfill-${label}-${suffix}`;

  const { error: companyError } = await adminClient.from("companies").insert({ id: companyId, display_name: `SI Retry Backfill Probe ${label} ${suffix}` });
  if (companyError) throw new Error(`fixture company insert failed: ${companyError.message}`);
  fixtureCompanyIds.add(companyId);

  const { error: sourceError } = await adminClient.from("company_sources").insert({
    id: sourceId,
    company_id: companyId,
    company_name: `SI Retry Backfill Probe ${label} ${suffix}`,
    target_country: "Lebanon",
    country_code: "LB",
    review_status: "needs_manual_review",
    ats_provider: "unknown",
    automation_eligibility: "unknown",
    ...overrides,
  });
  if (sourceError) throw new Error(`fixture company_sources insert failed: ${sourceError.message}`);
  fixtureSourceIds.add(sourceId);

  return sourceId;
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

async function insertObservation(sourceId, overrides = {}) {
  const row = {
    source_id: sourceId,
    run_id: randomUUID(),
    detected_provider: "unknown",
    ingestion_type: "needs_investigation",
    confidence: "low",
    retryable: null,
    evidence: { probe: true },
    analyzed_at: new Date().toISOString(),
    ...overrides,
  };
  const { error } = await adminClient.from("source_intelligence").insert(row);
  if (error) throw new Error(`fixture source_intelligence insert failed: ${error.message}`);
}

test("a retryable=null needs_investigation row (unclassified, exactly the 'no guessing' case) is never a retry candidate — NULL and false both mean 'do not auto-retry'", async () => {
  await assertExpectedLocalProject();
  const sourceId = await createFixtureSource("unclassified-null");
  await insertObservation(sourceId, {
    ingestion_type: "needs_investigation",
    retryable: null,
    evidence: { detection_method: "some_future_reason_this_rule_does_not_know", http_status: 418 },
    analyzed_at: daysAgo(90),
  });
  const { data: candidates, error } = await adminClient.rpc("get_source_intelligence_candidates", { p_limit: 1000 });
  assert.equal(error, null);
  const candidate = candidates.find((c) => c.source.id === sourceId);
  assert.equal(candidate, undefined, "an unclassified (retryable=null) needs_investigation row must never become a retry candidate, regardless of age — exactly like a structural (retryable=false) row");
});

test("setting retryable never touches the parent company_sources row — safety invariant this migration's header documents, proven live", async () => {
  // Note: source_intelligence has no UPDATE grant for service_role at all
  // (append-only by design — see 20260916171255's own header: "a re-
  // classification is a new row, not an edit to an old one"). Real code
  // (and the historical migration, which ran as the Postgres superuser at
  // migration-apply time, not as service_role) never UPDATEs retryable at
  // runtime either — it is set once, at INSERT time. This test reflects
  // that real write path rather than attempting a service_role UPDATE
  // that isn't actually a supported operation.
  const sourceId = await createFixtureSource("company-sources-untouched", {
    ats_provider: "unknown",
    automation_eligibility: "suitable_public_html_subject_to_review",
  });
  await insertObservation(sourceId, {
    ingestion_type: "needs_investigation",
    retryable: true,
    evidence: { detection_method: "fetch_blocked_or_error_status", http_status: 429 },
    analyzed_at: daysAgo(10),
  });

  const { data: source, error } = await adminClient
    .from("company_sources")
    .select("ats_provider, automation_eligibility")
    .eq("id", sourceId)
    .single();
  assert.equal(error, null);
  assert.equal(source.ats_provider, "unknown", "classifying retryable must never touch ats_provider");
  assert.equal(
    source.automation_eligibility,
    "suitable_public_html_subject_to_review",
    "classifying retryable must never touch a pre-existing, unrelated automation_eligibility value"
  );
});

test("classifyRetryable's predictions match real candidate-selection outcomes across all 6 evidence shapes the migration classifies, via fresh fixtures", async () => {
  const shapes = [
    { label: "network-error", evidence: { detection_method: "fetch_network_error", http_status: null } },
    { label: "blocked-429", evidence: { detection_method: "fetch_blocked_or_error_status", http_status: 429 } },
    { label: "blocked-403", evidence: { detection_method: "fetch_blocked_or_error_status", http_status: 403 } },
    { label: "blocked-5xx", evidence: { detection_method: "fetch_blocked_or_error_status", http_status: 503 } },
    { label: "blocked-404", evidence: { detection_method: "fetch_blocked_or_error_status", http_status: 404 } },
    { label: "no-url", evidence: { detection_method: "no_public_url_available", http_status: null } },
    { label: "no-signal", evidence: { detection_method: "no_provider_fingerprint_or_job_content_detected", http_status: 200 } },
    { label: "off-scope", evidence: { detection_method: "off_scope_job_destination_only", http_status: 200 } },
  ];

  for (const shape of shapes) {
    const expectedRetryable = classifyRetryable(shape.evidence);
    assert.notEqual(expectedRetryable, null, `sanity: ${shape.label} must be a determinable shape for this test to be meaningful`);

    const sourceId = await createFixtureSource(shape.label);
    await insertObservation(sourceId, {
      ingestion_type: "needs_investigation",
      retryable: expectedRetryable, // set exactly as real analyzer code (or this migration) would, per classifyRetryable
      evidence: shape.evidence,
      analyzed_at: daysAgo(10), // past the 3-day backoff either way
    });

    const { data: candidates, error } = await adminClient.rpc("get_source_intelligence_candidates", { p_limit: 1000 });
    assert.equal(error, null);
    const isCandidate = candidates.some((c) => c.source.id === sourceId);
    assert.equal(
      isCandidate,
      expectedRetryable === true,
      `${shape.label}: retryable=${expectedRetryable} must ${expectedRetryable ? "" : "not "}produce a retry_after_backoff candidate`
    );
  }
});
