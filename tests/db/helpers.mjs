// tests/db/helpers.mjs
//
// Shared setup for the local database/RLS integration tests
// (node --test tests/db/*.test.mjs). LOCAL DATABASE ONLY — mirrors
// scripts/seed-local-automation-users.mjs's exact safety pattern:
// a positive allowlist on the target host (never a denylist), plus a
// canonical-catalog check that this is actually the ai-job-agent project,
// not just some other local Supabase instance. Every test creates its own
// randomly-suffixed fixture users and deletes them in an `after` hook, so
// re-running never accumulates duplicate data and can never touch anyone
// else's rows even if run concurrently with another suite.
//
// Never logs a key, token, or password value — only presence/host checks.

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

function loadEnvLocal() {
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
const getEnv = (name) => process.env[name] ?? fileEnv[name];

const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const supabaseSecretKey = getEnv("SUPABASE_SECRET_KEY");

function fail(message) {
  throw new Error(`[tests/db] ${message}`);
}

if (!supabaseUrl) fail("NEXT_PUBLIC_SUPABASE_URL is not set (.env.local).");
if (!supabaseAnonKey) fail("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set (.env.local).");
if (!supabaseSecretKey) fail("SUPABASE_SECRET_KEY is not set (.env.local). Required to create/delete fixture users.");

// Positive allowlist, not a denylist — identical guard to
// scripts/seed-local-automation-users.mjs. Refuses to run against
// anything but 127.0.0.1/localhost/[::1], regardless of what the URL
// claims to be.
function assertLocalSupabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL.`);
    return;
  }
  const isLocalHost = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (!isLocalHost) {
    fail(
      `Refusing to run database tests: NEXT_PUBLIC_SUPABASE_URL's host ("${parsed.hostname}") is not local. ` +
        "These tests only ever run against 127.0.0.1/localhost/[::1]."
    );
  }
}
assertLocalSupabaseUrl(supabaseUrl);

export { supabaseUrl, supabaseAnonKey };

export const adminClient = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// A fresh, unauthenticated client for the same local project — for tests
// that need to confirm anon access is correctly rejected.
export function createAnonClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Doubles as an "are migrations applied" check and confirms this is
// actually the ai-job-agent local project, not just some other local
// Supabase instance — same reasoning as the seed script's
// assertExpectedLocalProject.
export async function assertExpectedLocalProject() {
  const { data, error } = await adminClient
    .from("plans")
    .select("plan_code, job_match_limit, cover_letter_limit");
  if (error) {
    fail(`Could not read public.plans (${error.message}). Is this the local ai-job-agent project with migrations applied?`);
  }
  const byCode = Object.fromEntries((data ?? []).map((p) => [p.plan_code, p]));
  if (!byCode.free || !byCode.student || !byCode.pro) {
    fail("public.plans does not match the expected ai-job-agent canonical catalog. Refusing to run against an unexpected project.");
  }
}

const TEST_PASSWORD_PREFIX = "db-test-";
function randomTestPassword() {
  return `${TEST_PASSWORD_PREFIX}${randomUUID()}`;
}

// Creates a fresh, uniquely-named, local-only fixture user and returns
// both an admin-scoped handle (id) and a real per-user Supabase client
// authenticated as them (via signInWithPassword against the local GoTrue
// instance) — queries through this client are evaluated under RLS exactly
// as a real browser session would be, which is what makes these
// integration tests meaningful rather than mocked.
export async function createTestUser(label) {
  const email = `db-test-${label}-${randomUUID()}@test.local`;
  const password = randomTestPassword();

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) fail(`Failed to create test user ${label}: ${createError.message}`);

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) fail(`Failed to sign in test user ${label}: ${signInError.message}`);

  return {
    id: created.user.id,
    email,
    client: userClient,
    session: signIn.session,
  };
}

// Deletes exactly the given fixture users (cascades every owned row via
// each table's `on delete cascade` to auth.users) plus any storage objects
// under their folder (which have no FK and would not otherwise cascade).
export async function deleteTestUsers(users) {
  for (const user of users) {
    if (!user?.id) continue;
    const { data: objects } = await adminClient.storage.from("cvs").list(user.id);
    if (objects && objects.length > 0) {
      await adminClient.storage.from("cvs").remove(objects.map((o) => `${user.id}/${o.name}`));
    }
    const { error } = await adminClient.auth.admin.deleteUser(user.id);
    if (error) {
      // Non-fatal: log without any sensitive value and continue cleaning
      // up the rest of the fixtures rather than aborting the whole suite.
      console.error(`[tests/db] cleanup: failed to delete ${user.email}: ${error.message}`);
    }
  }
}

// A minimal, valid fake CV upload — never a real user's file. Used
// wherever a test needs a cvs row to exist before exercising
// replace_cv/analysis/matches.
export async function uploadFakeCv(user, fileName = "fake-cv.pdf") {
  const storagePath = `${user.id}/${randomUUID()}-${fileName}`;
  const fakeBytes = new TextEncoder().encode("%PDF-1.4 fake test fixture, not a real CV\n");
  const { error: uploadError } = await user.client.storage
    .from("cvs")
    .upload(storagePath, fakeBytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) fail(`Failed to upload fake CV for ${user.email}: ${uploadError.message}`);

  const { data, error } = await user.client.rpc("replace_cv", {
    p_storage_path: storagePath,
    p_file_name: fileName,
    p_file_size_bytes: fakeBytes.byteLength,
    p_mime_type: "application/pdf",
  });
  if (error) fail(`replace_cv failed for ${user.email}: ${error.message}`);
  return data;
}

// Inserts a minimal, valid, already-completed cv_analyses row directly via
// the admin client — standing in for a future AI worker, which this
// mission does not build. Not approved by default.
export async function insertFakeAnalysis(user, cvId, overrides = {}) {
  const { data, error } = await adminClient
    .from("cv_analyses")
    .insert({
      user_id: user.id,
      cv_id: cvId,
      status: "completed",
      analyzed_at: new Date().toISOString(),
      preference_snapshot: {},
      ...overrides,
    })
    .select()
    .single();
  if (error) fail(`Failed to insert fake analysis for ${user.email}: ${error.message}`);
  return data;
}

export async function insertFakeJob(overrides = {}) {
  const { data, error } = await adminClient
    .from("jobs")
    .insert({
      title: "Fake Test Job",
      company_name: "Fake Test Co",
      description: "A fake job fixture for automated tests only.",
      application_method: "external_link",
      application_url: "https://example.test/apply",
      source_type: "admin_manual",
      status: "active",
      ...overrides,
    })
    .select()
    .single();
  if (error) fail(`Failed to insert fake job: ${error.message}`);
  return data;
}

export async function deleteFakeJobs(ids) {
  if (!ids.length) return;
  await adminClient.from("jobs").delete().in("id", ids);
}
