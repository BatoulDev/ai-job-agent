// Repository-wide branding check: no active user-facing "AI Job Agent"
// string may remain — the product was renamed to "AI Job Guide" (founder
// decision, product-completion phase, Section D). This scans the actual
// user-facing and product-facing surfaces (app source, email templates,
// n8n workflow definitions) for the literal old name.
//
// ALLOWLIST (documented, not silent):
// - docs/**, root-level dated/phase-numbered *.md audit reports, and
//   supabase/migrations/** are historical records — they may continue to
//   say "AI Job Agent" if that accurately described the product at that
//   date, and are intentionally NOT scanned here.
// - package.json / package-lock.json keep the npm package name
//   "ai-job-agent" (lowercase-hyphenated) — a stable technical identifier,
//   not a rendered brand string, and out of scope for this check.
// - Lowercase-hyphenated technical identifiers (localStorage keys, the
//   Supabase project_id, test-guard markers, the ingestion User-Agent
//   string, filenames like ai-job-agent-01-job-ingestion.ts) never match
//   the exact "AI Job Agent" phrase this check looks for, so they need no
//   special-casing.
// - n8n-workflows/registry-sync.ts contains one dated, factual comment
//   (2026-09-24) describing the live n8n instance's name AT THAT TIME —
//   rewriting it would misrepresent history — explicitly allowlisted below.
//
// Run: node --test tests/unit/branding-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OLD_NAME = "AI Job Agent";

const ALLOWLISTED_LINES = new Set([
  // n8n-workflows/registry-sync.ts: dated factual reconciliation comment,
  // see header note above.
  'n8n-workflows/registry-sync.ts:* n8n workflow "AI Job Agent - Registry Sync - step 1 (manual)"',
  'n8n-workflows/registry-sync.ts:* "AI Job Agent - ...". This file\'s own workflow() display name below was',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function findViolations(baseDir) {
  const violations = [];
  for (const file of walk(join(ROOT, baseDir))) {
    const text = readFileSync(file, "utf8");
    if (!text.includes(OLD_NAME)) continue;
    const relPath = relative(ROOT, file).split("\\").join("/");
    text.split("\n").forEach((line, i) => {
      if (!line.includes(OLD_NAME)) return;
      const key = `${relPath}:${line.trim().slice(0, 90)}`;
      if (ALLOWLISTED_LINES.has(key)) return;
      violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
    });
  }
  return violations;
}

test("no user-facing 'AI Job Agent' string remains in app source (src/)", () => {
  const violations = findViolations("src");
  assert.deepEqual(violations, [], `found unrenamed branding:\n${violations.join("\n")}`);
});

test("no user-facing 'AI Job Agent' string remains in email templates (supabase/templates/)", () => {
  const violations = findViolations("supabase/templates");
  assert.deepEqual(violations, [], `found unrenamed branding:\n${violations.join("\n")}`);
});

test("no user-facing 'AI Job Agent' string remains in n8n workflow definitions (n8n-workflows/), except the documented historical exception", () => {
  const violations = findViolations("n8n-workflows");
  assert.deepEqual(violations, [], `found unrenamed branding:\n${violations.join("\n")}`);
});

test("supabase/config.toml email subject uses the current product name", () => {
  const text = readFileSync(join(ROOT, "supabase/config.toml"), "utf8");
  assert.ok(!text.includes(OLD_NAME), "supabase/config.toml must not reference the old product name");
});
