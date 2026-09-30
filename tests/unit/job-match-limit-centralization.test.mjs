// Proves the 45/95 job-match-limit change (founder decision, 2026-09-30 —
// see supabase/migrations/20260930150000_update_student_pro_job_match_limits.sql)
// has exactly one authoritative source (public.plans.job_match_limit) and is
// never duplicated as a literal into the matching pipeline's own code. A
// static-source check, not a DB test: this is about what the CODE contains,
// not what the database currently holds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

// Every file that actually implements shortlist/rerank/candidate-selection
// or match surfacing — the places a hardcoded plan number could silently
// creep in and drift from public.plans.job_match_limit.
const MATCHING_PIPELINE_FILES = [
  "src/lib/matching/shortlist.ts",
  "src/lib/matching/rerankCandidates.ts",
  "src/lib/matching/rerankPrompt.ts",
  "src/lib/matching/saveMatch.ts",
  "src/app/api/internal/matching/prepare-rerank/route.ts",
  "src/app/api/internal/matching/prepare-rerank/parsePrepareRerankRequest.ts",
  "src/app/api/internal/matching/save-rerank-results/route.ts",
  "n8n-workflows/ai-job-agent-02-job-matching.ts",
];

const LITERAL_JOB_COUNT_PATTERN = /\b(45|95)\b/;

for (const relativePath of MATCHING_PIPELINE_FILES) {
  test(`${relativePath} does not hardcode the plan job-match-limit values (45/95) — the matching pipeline must read them only through public.plans`, () => {
    const filePath = path.join(projectRoot, relativePath);
    const content = readFileSync(filePath, "utf8");
    const match = content.match(LITERAL_JOB_COUNT_PATTERN);
    assert.equal(
      match,
      null,
      `found a literal "${match?.[0]}" in ${relativePath} — plan job-match limits must live only in public.plans.job_match_limit, never duplicated into matching code`
    );
  });
}

// surface_new_matches_for_user() was redefined by 20260930160000 (Model C) —
// this is the CURRENT authoritative function body (create or replace
// supersedes the original 20260928090000 definition). That original
// migration file is left untouched (never edit an already-applied
// migration) but its function text is no longer what actually runs, so the
// centralization check below targets the real current source.
const CURRENT_SURFACING_MIGRATION = "supabase/migrations/20260930160000_add_model_c_active_capacity_and_daily_limits.sql";

test("public.plans.job_match_limit and public.plans.daily_new_match_limit are the only values surface_new_matches_for_user() reads for its caps — both live in public.plans, never a literal", () => {
  const migrationPath = path.join(projectRoot, CURRENT_SURFACING_MIGRATION);
  const content = readFileSync(migrationPath, "utf8");
  assert.match(
    content,
    /select p\.job_match_limit, p\.daily_new_match_limit into v_active_capacity, v_daily_limit/,
    "surface_new_matches_for_user must read both caps from public.plans in one query, not a literal"
  );
});

test("surface_new_matches_for_user()'s body contains no literal 45/95/5/10 — every number it uses for a cap comes from a variable populated by the public.plans query above", () => {
  const migrationPath = path.join(projectRoot, CURRENT_SURFACING_MIGRATION);
  const content = readFileSync(migrationPath, "utf8");
  const functionStart = content.indexOf("create or replace function public.surface_new_matches_for_user()");
  const functionEnd = content.indexOf("\n$$;", functionStart);
  assert.ok(functionStart !== -1 && functionEnd !== -1, "could not locate the surface_new_matches_for_user() function body in the migration");
  const functionBody = content.slice(functionStart, functionEnd);
  // 2147483647 is the documented "no daily gate" sentinel for a NULL
  // daily_new_match_limit (Free) — not a plan number, so it's excluded here.
  const withoutSentinel = functionBody.replace(/2147483647/g, "");
  assert.doesNotMatch(withoutSentinel, /\b(45|95|5|10)\b/, "found a literal plan-cap-looking number inside the function body — every cap must come from the public.plans query, never a hardcoded value");
});

test("count_active_matches_for_user() — the one authoritative active-capacity predicate — is defined exactly once across all migrations, and surface_new_matches_for_user() is its only caller", () => {
  const migrationsDir = path.join(projectRoot, "supabase", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  let definitionCount = 0;
  let callerCount = 0;
  for (const file of files) {
    const content = readFileSync(path.join(migrationsDir, file), "utf8");
    definitionCount += (content.match(/create or replace function public\.count_active_matches_for_user\(/g) ?? []).length;
    callerCount += (content.match(/public\.count_active_matches_for_user\(v_user_id\)/g) ?? []).length;
  }
  assert.equal(definitionCount, 1, "the active-capacity predicate must be defined in exactly one place — no duplicated logic");
  assert.equal(callerCount, 1, "exactly one caller (surface_new_matches_for_user) — the predicate must not be re-derived anywhere else");
});
