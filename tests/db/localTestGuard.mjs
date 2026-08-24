// tests/db/localTestGuard.mjs
//
// Positive local-test-environment guard, shared by tests/db/helpers.mjs,
// scripts/run-db-tests.mjs, and scripts/db-test-crash-recovery-sweep.mjs —
// one place, so every entry point that can create or delete fixture data
// proves the same three independent things before doing anything:
//   1. the target host is 127.0.0.1/localhost/[::1] (a positive allowlist,
//      never a denylist)
//   2. LOCAL_TEST_DB_MARKER matches the exact expected local-only value —
//      never hostname alone. A second, independent signal that must be
//      deliberately set in .env.local.
//   3. the connected database is actually this project's canonical
//      ai-job-agent schema (the plans-catalog check; also doubles as an
//      "are migrations applied" check)
//
// No node:test import here, deliberately: this module must be safely
// importable both from `node --test` test files AND from plain Node
// scripts that are not running under the test runner (the crash-recovery
// sweep, the test orchestrator's pre-flight check and post-run cleanup).
// Calling node:test's before/after/test outside of a running test file has
// undefined behavior — keeping this module dependency-free avoids that
// entirely.
//
// Never logs a key, token, or password value — only presence/host checks.

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

export function loadEnvLocal() {
  const envPath = path.join(projectRoot, ".env.local");
  const env = {};
  if (existsSync(envPath)) {
    for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return env;
}

const fileEnv = loadEnvLocal();
export const getEnv = (name) => process.env[name] ?? fileEnv[name];

export function fail(message) {
  throw new Error(`[db-test-guard] ${message}`);
}

// The exact value LOCAL_TEST_DB_MARKER must have in .env.local. Not a
// secret — just a deliberate, independent tripwire so a database can never
// look "local enough" by hostname alone.
export const REQUIRED_LOCAL_TEST_MARKER = "ai-job-agent-local-db-tests";

export const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
export const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
export const supabaseSecretKey = getEnv("SUPABASE_SECRET_KEY");

if (!supabaseUrl) fail("NEXT_PUBLIC_SUPABASE_URL is not set (.env.local).");
if (!supabaseAnonKey) fail("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set (.env.local).");
if (!supabaseSecretKey) {
  fail("SUPABASE_SECRET_KEY is not set (.env.local). Required to create/delete fixture users.");
}

// Guard #1 — positive hostname allowlist, never a denylist. Refuses to run
// against anything but 127.0.0.1/localhost/[::1], regardless of what the
// URL claims to be.
function assertLocalSupabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
    return;
  }
  const isLocalHost = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (!isLocalHost) {
    fail(
      `Refusing to run: NEXT_PUBLIC_SUPABASE_URL's host ("${parsed.hostname}") is not local. ` +
        "Destructive test setup/cleanup only ever runs against 127.0.0.1/localhost/[::1]."
    );
  }
}
assertLocalSupabaseUrl(supabaseUrl);

// Guard #2 — an explicit, independent marker, checked at import time (so it
// fails fast for every consumer of this module, before any client is even
// constructed).
const testMarker = getEnv("LOCAL_TEST_DB_MARKER");
if (testMarker !== REQUIRED_LOCAL_TEST_MARKER) {
  fail(
    "LOCAL_TEST_DB_MARKER is missing or does not match the required value. " +
      `Set LOCAL_TEST_DB_MARKER=${REQUIRED_LOCAL_TEST_MARKER} in .env.local to confirm this is the ` +
      "approved local test database. This is a second, independent guard — never hostname alone " +
      "(see .env.example)."
  );
}

export const adminClient = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Guard #3 — confirms this is actually the expected local ai-job-agent
// project (not just some other local Supabase instance) by checking the
// canonical plans catalog matches exactly. Async, so every caller must
// await this before creating or deleting any fixture data.
export async function assertExpectedLocalProject() {
  const { data, error } = await adminClient
    .from("plans")
    .select("plan_code, job_match_limit, cover_letter_limit");
  if (error) {
    fail(
      `Could not read public.plans (${error.message}). Is this the local ai-job-agent project with migrations applied?`
    );
  }
  const byCode = Object.fromEntries((data ?? []).map((p) => [p.plan_code, p]));
  if (!byCode.free || !byCode.student || !byCode.pro) {
    fail(
      "public.plans does not match the expected ai-job-agent canonical catalog. Refusing to run against an unexpected project."
    );
  }
}
