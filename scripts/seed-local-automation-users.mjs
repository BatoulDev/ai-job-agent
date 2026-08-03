#!/usr/bin/env node
// scripts/seed-local-automation-users.mjs
//
// Creates four fictional local-dev test users — Maya/free (Lebanon),
// Karim/student (Lebanon), Lina/pro (Lebanon), and Zain/pro (international,
// Jordan, remote-only) — covering the country-of-residence/plan
// eligibility rules added in supabase/migrations/20260806090090_enforce_
// job_preferences_eligibility_trigger.sql. Each fixture gets a complete
// profile (country, university/major reference or custom values), an
// active subscription, job preferences (work arrangement, job-market
// coverage where eligible, target roles, locations), and — where a real
// local CV file exists — a CV upload and one pending analysis task.
// Nothing is fabricated: Zain has no local CV fixture file, so no CV or
// analysis task is created for him (see FIXTURES below).
//
// LOCAL DEVELOPMENT ONLY. Refuses to run unless NEXT_PUBLIC_SUPABASE_URL
// resolves to 127.0.0.1/localhost AND the connected database's
// public.plans table matches this project's canonical catalog exactly.
//
// Usage (run from the repo root, or via the package.json scripts below):
//   node scripts/seed-local-automation-users.mjs             # seed (safe to rerun)
//   node scripts/seed-local-automation-users.mjs --dry-run   # print the plan, write nothing
//   node scripts/seed-local-automation-users.mjs --cleanup   # remove ONLY these 4 fixture users
//
//   npm run seed:local             # same as plain seed
//   npm run seed:local:dry-run
//   npm run seed:local:cleanup
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
// Fixture data. Maya/Karim/Lina's CV facts (university, major, program
// dates) were read directly from each attached .docx's real text content,
// not guessed — see the final report for how they were extracted. Their
// identities, CVs, and notes are unchanged from the original three
// fixtures. Zain is a new, clearly-fictional fourth fixture added to
// cover the international/Pro/Remote-only eligibility path introduced by
// the country-of-residence work — there is no local CV fixture file for
// him, so cvFile is null and no CV/analysis-task rows are created (see
// ensureCv/seedFixture below, which honor that instead of fabricating a
// CV upload).
//
// university/major are now expressed as reference-table ids
// (universityId/majorId, matching public.universities/public.majors)
// where a real match exists, or a custom free-text value
// (customUniversity/customMajor) otherwise — mirroring exactly what the
// onboarding preferences UI itself would save. Likewise, targetRoleIds/
// locationIds reference public.target_roles/public.locations, with
// customTargetRoles/customLocations for anything without a clean
// reference match (never inventing a role/location name that isn't
// either a real reference row or the person's own original free text).
const FIXTURES = [
  {
    email: "maya.haddad@test.local",
    fullName: "Maya Haddad",
    countryOfResidence: "LB",
    universityId: "lebanese-international-university",
    majorId: "marketing",
    planCode: "free",
    cvFile: "01_Maya_Haddad_Marketing_CV.docx",
    preferences: {
      work_arrangement: "hybrid",
      job_market_coverage: null, // Free plan never gets Pro-only coverage.
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
    targetRoleIds: ["digital-marketing-specialist", "social-media-specialist"],
    customTargetRoles: ["Content Marketing Assistant"],
    locationIds: ["beirut"],
    customLocations: [],
  },
  {
    email: "karim.nassar@test.local",
    fullName: "Karim Nassar",
    countryOfResidence: "LB",
    universityId: "lebanese-university",
    majorId: "computer-science",
    planCode: "student",
    cvFile: "02_Karim_Nassar_Computer_Science_CV.docx",
    preferences: {
      work_arrangement: "remote",
      // Student is never eligible for job_market_coverage regardless of
      // work arrangement (enforce_job_preferences_eligibility_trigger
      // rejects it) — deliberately null here, not "remote_mena", even
      // though his own notes below mention MENA interest.
      job_market_coverage: null,
      job_type: "full-time",
      experience_level: "entry-level",
      additional_notes:
        "Also open to hybrid work and internship roles. " +
        "Industries of interest: software, SaaS, fintech, technology startups. " +
        "Skills/keywords: TypeScript, JavaScript, React, Next.js, Node.js, Python, SQL, PostgreSQL, Supabase, Git. " +
        "Languages: Arabic (native), English (professional), French (basic). " +
        "Open to relocation within Lebanon; not international relocation by default. Minimum match threshold: 80. " +
        "Interested in MENA-wide remote roles, though Student plan currently covers the Lebanon market only. " +
        "Job alerts: enabled, at the cadence permitted by the Student plan.",
    },
    targetRoleIds: ["full-stack-developer", "frontend-developer", "software-engineer"],
    customTargetRoles: [],
    // Remote — no physical location required or shown.
    locationIds: [],
    customLocations: [],
  },
  {
    email: "lina.mansour@test.local",
    fullName: "Lina Mansour",
    countryOfResidence: "LB",
    universityId: "holy-spirit-university-of-kaslik",
    majorId: "business-administration",
    planCode: "pro",
    cvFile: "03_Lina_Mansour_Business_Administration_CV.docx",
    preferences: {
      // Flexible (not just hybrid) matches her own notes ("also open to
      // remote and on-site work modes") and demonstrates the Lebanon +
      // Pro + Flexible combination: both job-market coverage AND
      // preferred physical locations apply at once.
      work_arrangement: "flexible",
      job_market_coverage: "remote_mena", // matches her original "also open to Remote MENA" note.
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
    targetRoleIds: ["operations-coordinator", "project-coordinator"],
    customTargetRoles: ["Customer Success Associate", "Administrative Coordinator"],
    locationIds: ["beirut", "jounieh", "mount-lebanon"],
    customLocations: [],
  },
  {
    email: "zain.khalil@test.local",
    fullName: "Zain Khalil",
    countryOfResidence: "JO", // Jordan — international, non-Lebanon.
    universityId: null,
    customUniversity: "University of Jordan", // no matching reference row — legitimate "Other university" case.
    majorId: "finance",
    planCode: "pro",
    cvFile: null, // No real local CV fixture file exists for this persona — no CV/analysis task is created.
    preferences: {
      // International residents are restricted to Remote by
      // enforce_job_preferences_eligibility_trigger — this is the only
      // legal value for him, enforced server-side, not just by this seed.
      work_arrangement: "remote",
      // job_market_coverage is a Lebanon-Pro-only concept — always null
      // for a non-Lebanon resident, even on Pro.
      job_market_coverage: null,
      job_type: "full-time",
      experience_level: "entry-level",
      additional_notes:
        "International fixture (Jordan) — no local CV file on hand, so this account has no CV or analysis task. " +
        "Exists to exercise the Pro + non-Lebanon + Remote-only eligibility path: on-site/hybrid roles outside " +
        "Lebanon are not supported yet, and only remote opportunities that accept applicants based in Jordan apply.",
    },
    targetRoleIds: ["business-analyst", "financial-analyst"],
    customTargetRoles: [],
    // International — physical locations are not offered/required.
    locationIds: [],
    customLocations: [],
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
    console.log(`  [profiles] would upsert country_of_residence/university/major/onboarding_completed_at (new user — nothing to check yet)`);
    return;
  }
  if (isDryRun) {
    console.log(`  [profiles] would upsert country_of_residence/university/major/onboarding_completed_at`);
    return;
  }
  // university/major here are the new reference-table-backed columns —
  // the legacy free-text profiles.university/major columns are frozen
  // (see supabase/migrations/20260806090050_extend_profiles_residence_and_references.sql)
  // and intentionally left untouched by new code, including this script.
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fixture.fullName,
      country_of_residence: fixture.countryOfResidence,
      university_id: fixture.universityId ?? null,
      custom_university: fixture.universityId ? null : (fixture.customUniversity ?? null),
      major_id: fixture.majorId ?? null,
      custom_major: fixture.majorId ? null : (fixture.customMajor ?? null),
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) fail(`Failed to update profile for ${fixture.email}: ${error.message}`);
  console.log(`  [profiles] updated (country=${fixture.countryOfResidence})`);
}

async function ensureCv(userId, fixture) {
  if (!fixture.cvFile) {
    console.log(`  [cvs] skipped — no local CV fixture file for this persona (by design, not a fake upload)`);
    return { id: null, storagePath: null };
  }

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

// Mirrors what public.save_job_preferences(...) does — upsert the scalar
// row, then replace both join tables' rows — but via direct service-role
// table writes instead of the RPC itself. The RPC is `security invoker`
// (auth.uid()-based, by design — see supabase/migrations/20260806090100_create_save_job_preferences_rpc.sql),
// so calling it from this service-role script would see a null auth.uid()
// and fail "Not authenticated". Direct writes still go through
// enforce_job_preferences_eligibility_trigger (triggers fire regardless
// of role), so the same country/plan eligibility rules are enforced here
// too — not bypassed, just reached via a different, equally valid path.
async function ensurePreferences(userId, fixture) {
  if (userId === DRY_RUN_ID) {
    console.log(`  [job_preferences] would upsert preferences + target roles + locations (new user — nothing to check yet)`);
    return;
  }
  if (isDryRun) {
    console.log(`  [job_preferences] would upsert preferences + target roles + locations`);
    return;
  }

  const { data: prefRow, error: prefError } = await supabase
    .from("job_preferences")
    .upsert(
      {
        user_id: userId,
        work_arrangement: fixture.preferences.work_arrangement,
        job_market_coverage: fixture.preferences.job_market_coverage ?? null,
        job_type: fixture.preferences.job_type,
        experience_level: fixture.preferences.experience_level,
        additional_notes: fixture.preferences.additional_notes ?? null,
        custom_target_roles: fixture.customTargetRoles ?? [],
        custom_locations: fixture.customLocations ?? [],
      },
      { onConflict: "user_id" }
    )
    .select("id")
    .single();
  if (prefError) fail(`Failed to upsert job_preferences for ${fixture.email}: ${prefError.message}`);

  const { error: deleteRolesError } = await supabase
    .from("job_preference_target_roles")
    .delete()
    .eq("job_preference_id", prefRow.id);
  if (deleteRolesError) fail(`Failed to clear target roles for ${fixture.email}: ${deleteRolesError.message}`);

  if (fixture.targetRoleIds?.length) {
    const { error: insertRolesError } = await supabase
      .from("job_preference_target_roles")
      .insert(fixture.targetRoleIds.map((target_role_id) => ({ job_preference_id: prefRow.id, target_role_id })));
    if (insertRolesError) fail(`Failed to insert target roles for ${fixture.email}: ${insertRolesError.message}`);
  }

  const { error: deleteLocationsError } = await supabase
    .from("job_preference_locations")
    .delete()
    .eq("job_preference_id", prefRow.id);
  if (deleteLocationsError) fail(`Failed to clear locations for ${fixture.email}: ${deleteLocationsError.message}`);

  if (fixture.locationIds?.length) {
    const { error: insertLocationsError } = await supabase
      .from("job_preference_locations")
      .insert(fixture.locationIds.map((location_id) => ({ job_preference_id: prefRow.id, location_id })));
    if (insertLocationsError) fail(`Failed to insert locations for ${fixture.email}: ${insertLocationsError.message}`);
  }

  console.log(
    `  [job_preferences] upserted (${fixture.targetRoleIds?.length ?? 0} reference role(s) + ${fixture.customTargetRoles?.length ?? 0} custom, ${fixture.locationIds?.length ?? 0} reference location(s) + ${fixture.customLocations?.length ?? 0} custom)`
  );
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
  // Profile and subscription must both be in place BEFORE preferences are
  // written: enforce_job_preferences_eligibility_trigger reads the
  // caller's current country_of_residence and plan_code at write time
  // (e.g. Lina's job_market_coverage requires her subscription to already
  // be "pro", not still the default "free").
  await ensureProfile(user.id, fixture);
  await ensureSubscription(user.id, fixture);
  await ensurePreferences(user.id, fixture);
  const cv = await ensureCv(user.id, fixture);
  const task = cv.id ? await ensureAnalysisTask(user.id, cv.id, fixture) : null;
  if (!cv.id && !isDryRun) {
    console.log(`  [analysis_tasks] skipped — no CV for this fixture`);
  }
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
  // via "on delete cascade" FKs to auth.users(id), and
  // job_preference_target_roles/job_preference_locations cascade in turn
  // from job_preferences(id) — deleting the auth user is sufficient for
  // everything else.
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
    console.log(`\nCleanup complete. Only the ${FIXTURES.length} fixture users above were touched.`);
    return;
  }

  const results = [];
  for (const fixture of FIXTURES) {
    results.push({ fixture, ...(await seedFixture(fixture)) });
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    const fmtUser = (v) => v ?? "(dry-run, not yet created)";
    const fmtCv = (v, fixture) =>
      v ?? (fixture.cvFile ? "(dry-run, not yet created)" : "(none — no local CV fixture file)");
    console.log(
      `${r.fixture.fullName.padEnd(14)} ${r.fixture.email.padEnd(26)} plan=${r.fixture.planCode.padEnd(8)} user_id=${fmtUser(r.userId)} cv_id=${fmtCv(r.cvId, r.fixture)} task_id=${fmtCv(r.taskId, r.fixture)}`
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
