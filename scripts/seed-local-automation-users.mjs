#!/usr/bin/env node
// scripts/seed-local-automation-users.mjs
//
// Creates three fictional local-dev test users (Maya/free, Karim/student,
// Lina/pro) with a complete profile, CV upload, job preferences, an
// active subscription, and one pending analysis task each — everything
// the Phase 4 CV-analysis worker will eventually need, and nothing it
// hasn't earned yet (no fake AI results, no fake payments).
//
// LOCAL DEVELOPMENT ONLY. Refuses to run unless NEXT_PUBLIC_SUPABASE_URL
// resolves to 127.0.0.1/localhost AND the connected database's
// public.plans table matches this project's canonical catalog exactly.
//
// Usage (run from the repo root):
//   node scripts/seed-local-automation-users.mjs             # seed (safe to rerun)
//   node scripts/seed-local-automation-users.mjs --dry-run   # print the plan, write nothing
//   node scripts/seed-local-automation-users.mjs --cleanup   # remove ONLY these 3 fixture users
//
// Requires (in .env.local, never committed — see .env.example):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, LOCAL_SEED_USER_PASSWORD

import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`\n[seed-local-automation-users] ERROR: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------
// Env loading — deliberately no "dotenv" dependency. .env.local in this
// repo is always simple KEY=VALUE lines (see the existing file), so a
// tiny parser avoids adding a package for a one-off dev script.
// ---------------------------------------------------------------------
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

const args = new Set(process.argv.slice(2));
const isDryRun = args.has("--dry-run");
const isCleanup = args.has("--cleanup");

// ---------------------------------------------------------------------
// Required env / refuse-to-run guards
// ---------------------------------------------------------------------
const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseSecretKey = getEnv("SUPABASE_SECRET_KEY");
const seedPassword = getEnv("LOCAL_SEED_USER_PASSWORD");

if (!supabaseUrl) fail("NEXT_PUBLIC_SUPABASE_URL is not set (.env.local).");
if (!supabaseSecretKey) {
  fail(
    "SUPABASE_SECRET_KEY is not set (.env.local). This script needs local service-role access to bypass RLS for trusted writes — the same boundary src/lib/supabase/admin.ts uses."
  );
}
if (!seedPassword) {
  fail(
    "LOCAL_SEED_USER_PASSWORD is not set. Refusing to run without an explicit local-only test password.\n" +
      "Add it to .env.local (never commit a real value — .env.example documents the variable name only):\n" +
      "  LOCAL_SEED_USER_PASSWORD=<any local test password, at least 8 characters>"
  );
}
if (seedPassword.length < 8) {
  fail("LOCAL_SEED_USER_PASSWORD must be at least 8 characters (matches the app's real signup rule).");
}

// Positive allow-list, not a denylist: only 127.0.0.1/localhost/[::1] are
// ever accepted, regardless of what the URL claims to be.
function assertLocalSupabaseUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${url}`);
    return;
  }
  const isLocalHost = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (!isLocalHost) {
    fail(
      `Refusing to run: NEXT_PUBLIC_SUPABASE_URL ("${url}") is not a local address.\n` +
        "This script only ever runs against 127.0.0.1/localhost. It will never run against a hosted or production Supabase project."
    );
  }
}
assertLocalSupabaseUrl(supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Confirms this is actually the expected local ai-job-agent project (not
// just some other local Supabase instance) by checking the canonical
// plans catalog matches exactly. Doubles as a "have migrations been
// applied" check.
async function assertExpectedLocalProject() {
  const { data, error } = await supabase
    .from("plans")
    .select("plan_code, job_match_limit, cover_letter_limit");

  if (error) {
    fail(
      `Could not read public.plans (${error.message}). Is this the ai-job-agent local Supabase project, and have all migrations been applied (npx supabase migration up --local)?`
    );
  }

  const byCode = Object.fromEntries((data ?? []).map((p) => [p.plan_code, p]));
  const expected = {
    free: { job_match_limit: 1, cover_letter_limit: 1 },
    student: { job_match_limit: 25, cover_letter_limit: 8 },
    pro: { job_match_limit: 45, cover_letter_limit: 15 },
  };

  for (const [code, limits] of Object.entries(expected)) {
    const row = byCode[code];
    if (!row || row.job_match_limit !== limits.job_match_limit || row.cover_letter_limit !== limits.cover_letter_limit) {
      fail(
        `public.plans does not match the expected ai-job-agent canonical catalog (mismatch on '${code}'). Refusing to seed against an unexpected project or schema.`
      );
    }
  }
}

// ---------------------------------------------------------------------
// Mirrors src/app/onboarding/upload-cv/page.tsx's sanitizeFileName exactly,
// so fixture CV storage paths follow the same convention real uploads use.
// ---------------------------------------------------------------------
function sanitizeFileName(fileName) {
  const lastDot = fileName.lastIndexOf(".");
  const base = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  const ext = lastDot > 0 ? fileName.slice(lastDot) : "";
  const safeBase = base.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").slice(0, 60) || "cv";
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10);
  return `${safeBase}${safeExt}`;
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// ---------------------------------------------------------------------
// Fixture data. CV facts (university, major, program dates) were read
// directly from each attached .docx's real text content, not guessed —
// see the final report for how they were extracted.
// ---------------------------------------------------------------------
const FIXTURES = [
  {
    email: "maya.haddad@test.local",
    fullName: "Maya Haddad",
    university: "Lebanese International University",
    major: "Marketing",
    planCode: "free",
    cvFile: "01_Maya_Haddad_Marketing_CV.docx",
    preferences: {
      target_roles:
        "Junior Digital Marketing Specialist, Social Media Coordinator, Content Marketing Assistant",
      location: "Beirut, Lebanon (also open to Remote)",
      remote_preference: "hybrid",
      job_type: "internship",
      experience_level: "entry-level",
      additional_notes:
        "Also open to remote and on-site (Beirut) work modes, and to full-time roles (not internship-only). " +
        "Industries of interest: marketing agencies, SaaS, e-commerce, education. " +
        "Skills/keywords: social media, content strategy, campaign reporting, basic SEO, email marketing, Canva, GA4. " +
        "Languages: Arabic (native), English (professional), French (intermediate). " +
        "Not open to relocation outside Lebanon. Minimum match threshold: 80. " +
        "Job alerts: enabled, at the cadence permitted by the Free plan.",
    },
  },
  {
    email: "karim.nassar@test.local",
    fullName: "Karim Nassar",
    university: "Lebanese University",
    major: "Computer Science",
    planCode: "student",
    cvFile: "02_Karim_Nassar_Computer_Science_CV.docx",
    preferences: {
      target_roles: "Junior Full-Stack Developer, Frontend Developer, Junior Software Engineer",
      location: "Beirut, Lebanon (also open to Remote MENA)",
      remote_preference: "remote",
      job_type: "full-time",
      experience_level: "entry-level",
      additional_notes:
        "Also open to hybrid work and internship roles. " +
        "Industries of interest: software, SaaS, fintech, technology startups. " +
        "Skills/keywords: TypeScript, JavaScript, React, Next.js, Node.js, Python, SQL, PostgreSQL, Supabase, Git. " +
        "Languages: Arabic (native), English (professional), French (basic). " +
        "Open to relocation within Lebanon; not international relocation by default. Minimum match threshold: 80. " +
        "Job alerts: enabled, at the cadence permitted by the Student plan.",
    },
  },
  {
    email: "lina.mansour@test.local",
    fullName: "Lina Mansour",
    university: "Holy Spirit University of Kaslik",
    major: "Business Administration",
    planCode: "pro",
    cvFile: "03_Lina_Mansour_Business_Administration_CV.docx",
    preferences: {
      target_roles:
        "Operations Coordinator, Customer Success Associate, Junior Project Coordinator, Administrative Coordinator",
      location: "Beirut / Jounieh / Mount Lebanon (also open to Remote MENA)",
      remote_preference: "hybrid",
      job_type: "full-time",
      experience_level: "entry-level",
      additional_notes:
        "Also open to remote and on-site work modes. " +
        "Industries of interest: professional services, retail, logistics, SaaS, NGOs. " +
        "Skills/keywords: operations coordination, customer service, reporting, process mapping, Excel, Google Sheets, scheduling, CRM. " +
        "Languages: Arabic (native), English (professional), French (professional). " +
        "Open to relocation within Lebanon. Minimum match threshold: 80. " +
        "Job alerts: enabled, at the cadence permitted by the Pro plan.",
    },
  },
];

const CV_DIR = path.join(projectRoot, "test-fixtures");
const CV_BUCKET = "cvs";
// Clearly-labeled marker distinguishing local test entitlements from a
// real Whish subscription id — never a fabricated Whish identifier.
const MANUAL_TEST_PROVIDER_SUBSCRIPTION_ID = "local-fixture-seed";

async function findUserByEmail(email) {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) fail(`Failed to list auth users: ${error.message}`);
    const match = data.users.find((u) => u.email === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

const DRY_RUN_ID = null; // no real id exists yet — nothing downstream may query with this

async function ensureAuthUser(fixture) {
  const existing = await findUserByEmail(fixture.email);
  if (existing) {
    console.log(`  [auth] exists — ${fixture.email} (${existing.id})`);
    return existing;
  }

  if (isDryRun) {
    console.log(`  [auth] would create — ${fixture.email}`);
    return { id: DRY_RUN_ID };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: fixture.email,
    password: seedPassword,
    email_confirm: true,
    user_metadata: { full_name: fixture.fullName },
  });
  if (error) fail(`Failed to create auth user ${fixture.email}: ${error.message}`);
  console.log(`  [auth] created — ${fixture.email} (${data.user.id})`);
  return data.user;
}

async function ensureProfile(userId, fixture) {
  if (userId === DRY_RUN_ID) {
    console.log(`  [profiles] would upsert university/major/onboarding_completed_at (new user — nothing to check yet)`);
    return;
  }
  if (isDryRun) {
    console.log(`  [profiles] would upsert university/major/onboarding_completed_at`);
    return;
  }
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fixture.fullName,
      university: fixture.university,
      major: fixture.major,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) fail(`Failed to update profile for ${fixture.email}: ${error.message}`);
  console.log(`  [profiles] updated`);
}

async function ensureCv(userId, fixture) {
  const docxPath = path.join(CV_DIR, fixture.cvFile);
  if (!existsSync(docxPath)) {
    fail(`Fixture CV not found: ${docxPath}`);
  }
  const fileBuffer = readFileSync(docxPath);
  const fileSizeBytes = fileBuffer.byteLength;
  const fileHash = createHash("sha256").update(fileBuffer).digest("hex").slice(0, 12);

  if (userId === DRY_RUN_ID) {
    console.log(`  [cvs] would upload ${fixture.cvFile} (${fileSizeBytes} bytes) and insert cvs row (new user — nothing to check yet)`);
    return { id: DRY_RUN_ID, storagePath: "(dry-run)" };
  }

  const { data: existingCv, error: existingCvError } = await supabase
    .from("cvs")
    .select("id, file_name, storage_path")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingCvError) fail(`Failed to read existing cvs row for ${fixture.email}: ${existingCvError.message}`);

  if (existingCv && existingCv.file_name === fixture.cvFile) {
    console.log(`  [cvs] already seeded — ${existingCv.storage_path}`);
    return { id: existingCv.id, storagePath: existingCv.storage_path };
  }

  if (isDryRun) {
    console.log(`  [cvs] would upload ${fixture.cvFile} (${fileSizeBytes} bytes) and upsert cvs row`);
    return { id: DRY_RUN_ID, storagePath: "(dry-run)" };
  }

  const storagePath = `${userId}/${randomUUID()}-${fileHash}-${sanitizeFileName(fixture.cvFile)}`;

  const { error: uploadError } = await supabase.storage
    .from(CV_BUCKET)
    .upload(storagePath, fileBuffer, { contentType: DOCX_MIME, upsert: false });
  if (uploadError) fail(`Failed to upload CV for ${fixture.email}: ${uploadError.message}`);

  const previousStoragePath = existingCv?.storage_path ?? null;

  const { data: cvRow, error: cvError } = await supabase
    .from("cvs")
    .upsert(
      {
        user_id: userId,
        storage_path: storagePath,
        file_name: fixture.cvFile,
        file_size_bytes: fileSizeBytes,
        mime_type: DOCX_MIME,
        status: "uploaded",
      },
      { onConflict: "user_id" }
    )
    .select("id")
    .single();

  if (cvError) {
    await supabase.storage.from(CV_BUCKET).remove([storagePath]);
    fail(`Failed to upsert cvs row for ${fixture.email}: ${cvError.message}`);
  }

  if (previousStoragePath && previousStoragePath !== storagePath) {
    await supabase.storage.from(CV_BUCKET).remove([previousStoragePath]);
  }

  console.log(`  [cvs] uploaded — ${storagePath}`);
  return { id: cvRow.id, storagePath };
}

async function ensurePreferences(userId, fixture) {
  if (userId === DRY_RUN_ID) {
    console.log(`  [job_preferences] would upsert (new user — nothing to check yet)`);
    return;
  }
  if (isDryRun) {
    console.log(`  [job_preferences] would upsert`);
    return;
  }
  const { error } = await supabase
    .from("job_preferences")
    .upsert({ user_id: userId, ...fixture.preferences }, { onConflict: "user_id" });
  if (error) fail(`Failed to upsert job_preferences for ${fixture.email}: ${error.message}`);
  console.log(`  [job_preferences] upserted`);
}

async function ensureSubscription(userId, fixture) {
  if (userId === DRY_RUN_ID) {
    console.log(
      fixture.planCode === "free"
        ? `  [subscriptions] would be free/active automatically at signup (new user — nothing to check yet)`
        : `  [subscriptions] would activate ${fixture.planCode} via provider=manual_test (new user — nothing to check yet)`
    );
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from("subscriptions")
    .select("plan_code, status, provider")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) fail(`Failed to read subscription for ${fixture.email}: ${existingError.message}`);

  if (fixture.planCode === "free") {
    // The handle_new_user_subscription trigger already grants every new
    // user a trusted free/active/free-provider subscription at signup —
    // nothing to do here beyond verifying it.
    if (!existing || existing.status !== "active" || existing.plan_code !== "free") {
      fail(
        `Expected ${fixture.email} to already have an active free subscription from signup, found: ${JSON.stringify(existing)}`
      );
    }
    console.log(`  [subscriptions] free/active (auto-granted at signup) — verified`);
    return;
  }

  if (existing && existing.status === "active" && existing.plan_code === fixture.planCode) {
    console.log(`  [subscriptions] already ${fixture.planCode}/active — skipping`);
    return;
  }

  if (isDryRun) {
    console.log(`  [subscriptions] would activate ${fixture.planCode} via provider=manual_test`);
    return;
  }

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  // service_role-only RPC (see supabase/migrations/20260802090010_create_subscriptions.sql).
  // provider='manual_test' is the local-only marker added in
  // 20260803090000_allow_manual_test_subscription_provider.sql — this is
  // NEVER a real Whish payment, and no payment_attempts row is created
  // for it, since no payment occurred.
  const { error } = await supabase.rpc("activate_subscription", {
    p_user_id: userId,
    p_plan_code: fixture.planCode,
    p_provider: "manual_test",
    p_provider_customer_id: null,
    p_provider_subscription_id: MANUAL_TEST_PROVIDER_SUBSCRIPTION_ID,
    p_period_start: periodStart.toISOString(),
    p_period_end: periodEnd.toISOString(),
  });
  if (error) fail(`Failed to activate ${fixture.planCode} subscription for ${fixture.email}: ${error.message}`);
  console.log(`  [subscriptions] activated ${fixture.planCode} (provider=manual_test, local fixture only)`);
}

async function ensureAnalysisTask(userId, cvId, fixture) {
  if (isDryRun || cvId === DRY_RUN_ID) {
    console.log(`  [analysis_tasks] would create/reuse pending task for this CV`);
    return null;
  }

  // service_role-only RPC (see supabase/migrations/20260802090030_create_analysis_tasks.sql).
  // Idempotent by construction: reuses any existing pending/processing
  // task for the same cv_id instead of creating a duplicate.
  const { data, error } = await supabase.rpc("create_analysis_task", {
    p_user_id: userId,
    p_cv_id: cvId,
    p_trigger: "onboarding_completed",
  });
  if (error) fail(`Failed to create analysis task for ${fixture.email}: ${error.message}`);
  console.log(`  [analysis_tasks] ${data.status} — id=${data.id}`);
  return data;
}

async function seedFixture(fixture) {
  console.log(`\n=== ${fixture.fullName} (${fixture.email}) — ${fixture.planCode} ===`);
  const user = await ensureAuthUser(fixture);
  await ensureProfile(user.id, fixture);
  const cv = await ensureCv(user.id, fixture);
  await ensurePreferences(user.id, fixture);
  await ensureSubscription(user.id, fixture);
  const task = await ensureAnalysisTask(user.id, cv.id, fixture);
  return { userId: user.id, cvId: cv.id, taskId: task?.id ?? null };
}

async function cleanupFixture(fixture) {
  const user = await findUserByEmail(fixture.email);
  if (!user) {
    console.log(`  [cleanup] ${fixture.email} does not exist — nothing to do`);
    return;
  }

  // Storage objects have no FK to auth.users, so they don't cascade-delete
  // with the user — remove them explicitly first, scoped to this user's
  // own folder only (never a bucket-wide operation).
  const { data: objects, error: listError } = await supabase.storage
    .from(CV_BUCKET)
    .list(user.id);
  if (listError) fail(`Failed to list storage objects for ${fixture.email}: ${listError.message}`);
  if (objects && objects.length > 0) {
    const paths = objects.map((o) => `${user.id}/${o.name}`);
    const { error: removeError } = await supabase.storage.from(CV_BUCKET).remove(paths);
    if (removeError) fail(`Failed to remove storage objects for ${fixture.email}: ${removeError.message}`);
    console.log(`  [cleanup] removed ${paths.length} storage object(s)`);
  }

  // profiles/cvs/job_preferences/subscriptions/analysis_tasks all cascade
  // via "on delete cascade" FKs to auth.users(id) — deleting the auth
  // user is sufficient for everything else.
  const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
  if (deleteError) fail(`Failed to delete auth user ${fixture.email}: ${deleteError.message}`);
  console.log(`  [cleanup] deleted auth user ${fixture.email} (${user.id}) and all owned rows`);
}

async function main() {
  console.log(`[seed-local-automation-users] target: ${supabaseUrl}`);
  console.log(`[seed-local-automation-users] mode: ${isCleanup ? "cleanup" : isDryRun ? "dry-run" : "seed"}`);

  await assertExpectedLocalProject();

  if (isCleanup) {
    for (const fixture of FIXTURES) {
      console.log(`\n=== cleanup: ${fixture.fullName} (${fixture.email}) ===`);
      await cleanupFixture(fixture);
    }
    console.log("\nCleanup complete. Only the 3 fixture users above were touched.");
    return;
  }

  const results = [];
  for (const fixture of FIXTURES) {
    results.push({ fixture, ...(await seedFixture(fixture)) });
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    const fmt = (v) => v ?? "(dry-run, not yet created)";
    console.log(
      `${r.fixture.fullName.padEnd(14)} ${r.fixture.email.padEnd(26)} plan=${r.fixture.planCode.padEnd(8)} user_id=${fmt(r.userId)} cv_id=${fmt(r.cvId)} task_id=${fmt(r.taskId)}`
    );
  }
  console.log(
    isDryRun
      ? "\nDry run complete — no data was written."
      : "\nSeed complete. Re-run this script any time; it will not create duplicates."
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
