// Seeds one real fixture user with real Postgres/Storage state covering
// every stage the Phase 11 spec drives through a real browser: a pending
// match to approve, one to reject, an approved match with an unapproved
// cover-letter draft, an approved email-method match with an already-
// approved cover letter (ready for the Approve & Send gate), and an
// approved external_link match with an application already in
// pending_send (ready for the manual "mark as sent" action). Writes ids +
// credentials to tests/e2e/.fixture.json for the spec file to read.
//
// LOCAL ONLY: refuses to run against anything but a local Supabase URL —
// same guard used throughout tests/db/helpers.mjs.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal } from "./loadEnv";

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SECRET_KEY!;
const FIXTURE_PATH = resolve(__dirname, ".fixture.json");
const JMC_FIXTURE_PATH = resolve(__dirname, ".fixture-job-market-coverage.json");

const EMAIL = "e2e-dashboard-flows@test.local";
const PASSWORD = "E2eDashboardFlows123!";

const JMC_EMAIL = "e2e-job-market-coverage@test.local";
const JMC_PASSWORD = "E2eJobMarketCoverage123!";

export default async function globalSetup() {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase env vars for e2e setup — check .env.local");
  }
  if (!SUPABASE_URL.includes("127.0.0.1") && !SUPABASE_URL.includes("localhost")) {
    throw new Error("Refusing to run e2e setup against a non-local Supabase URL.");
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email === EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing.id);

  const { data: created, error: createError } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (createError) throw new Error(`create user: ${createError.message}`);
  const userId = created.user.id;

  const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error: signInError } = await userClient.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signInError) throw new Error(`sign in: ${signInError.message}`);

  const { data: prefs, error: prefsError } = await admin
    .from("job_preferences")
    .insert({ user_id: userId, work_arrangement: "remote", job_type: "full-time", experience_level: "entry-level" })
    .select("version")
    .single();
  if (prefsError) throw new Error(`job_preferences: ${prefsError.message}`);

  const fakeBytes = new TextEncoder().encode("%PDF-1.4 fake test fixture, not a real CV\n");
  const { error: uploadError } = await userClient.storage.from("cvs").upload(`${userId}/e2e.pdf`, fakeBytes, { contentType: "application/pdf" });
  if (uploadError) throw new Error(`storage upload: ${uploadError.message}`);
  const { data: cv, error: cvError } = await userClient.rpc("replace_cv", {
    p_storage_path: `${userId}/e2e.pdf`,
    p_file_name: "e2e.pdf",
    p_file_size_bytes: fakeBytes.byteLength,
    p_mime_type: "application/pdf",
  });
  if (cvError) throw new Error(`replace_cv: ${cvError.message}`);

  const { data: draftAnalysis, error: analysisError } = await admin
    .from("cv_analyses")
    .insert({
      user_id: userId,
      cv_id: cv.id,
      status: "completed",
      analyzed_at: new Date().toISOString(),
      preference_snapshot: {},
      preferences_version: prefs.version,
      professional_summary: "Five years of backend experience.",
      skills: ["TypeScript", "PostgreSQL"],
      strongest_areas: ["API design"],
      profile_level: "mid-level",
    })
    .select()
    .single();
  if (analysisError) throw new Error(`cv_analyses: ${analysisError.message}`);
  const { data: analysis, error: confirmError } = await userClient.rpc("confirm_cv_analysis", { p_analysis_id: draftAnalysis.id });
  if (confirmError) throw new Error(`confirm_cv_analysis: ${confirmError.message}`);

  const { error: planError } = await admin.from("subscriptions").update({ plan_code: "pro", provider: "whish" }).eq("user_id", userId);
  if (planError) throw new Error(`subscriptions: ${planError.message}`);

  const jobIds: string[] = [];
  async function fixtureJob(title: string, overrides: Record<string, unknown> = {}) {
    const { data, error } = await admin
      .from("jobs")
      .insert({
        title,
        company_name: "E2E Fixture Co",
        description: "A fake job fixture for automated browser tests only.",
        application_method: "external_link",
        application_url: "https://example.test/apply",
        source_type: "admin_manual",
        status: "active",
        ...overrides,
      })
      .select()
      .single();
    if (error) throw new Error(`job insert (${title}): ${error.message}`);
    jobIds.push(data.id);
    return data;
  }

  async function fixtureMatch(job: { id: string }, overrides: Record<string, unknown> = {}) {
    const { data, error } = await admin
      .from("matches")
      .insert({
        user_id: userId,
        job_id: job.id,
        cv_analysis_id: analysis.id,
        score: 85,
        score_breakdown: { strengths: ["TypeScript", "APIs"] },
        explanation: "Strong overlap between your CV and this role.",
        matching_model: "e2e-fixture",
        ...overrides,
      })
      .select()
      .single();
    if (error) throw new Error(`match insert: ${error.message}`);
    return data;
  }

  // 1. Pending match to approve via New Matches tab.
  const jobToApprove = await fixtureJob("E2E Backend Engineer (Approve Me)");
  const matchToApprove = await fixtureMatch(jobToApprove, { status: "pending_review", surfaced_at: new Date().toISOString() });

  // 2. Pending match to reject via New Matches tab.
  const jobToReject = await fixtureJob("E2E Data Entry Clerk (Reject Me)");
  const matchToReject = await fixtureMatch(jobToReject, { status: "pending_review", surfaced_at: new Date().toISOString() });

  // 3. Approved match with an unapproved cover-letter draft (edit + approve flow).
  const jobWithDraftLetter = await fixtureJob("E2E Frontend Engineer (Draft Letter)");
  const matchWithDraftLetter = await fixtureMatch(jobWithDraftLetter, {
    status: "user_approved",
    surfaced_at: new Date().toISOString(),
    decided_at: new Date().toISOString(),
  });
  const { error: draftLetterError } = await admin.from("cover_letters").insert({
    user_id: userId,
    match_id: matchWithDraftLetter.id,
    generated_content: "Dear Hiring Team,\n\nThis is the original AI-generated draft for the frontend role.\n\nSincerely,",
    generation_status: "completed",
  });
  if (draftLetterError) throw new Error(`draft cover letter: ${draftLetterError.message}`);

  // 4. Approved email-method match with an already-approved cover letter (ready for the Approve & Send gate).
  const jobReadyForEmailApp = await fixtureJob("E2E Platform Engineer (Email Apply)", {
    application_method: "email",
    application_email: "jobs@e2e-fixture.test",
  });
  const matchReadyForEmailApp = await fixtureMatch(jobReadyForEmailApp, {
    status: "user_approved",
    surfaced_at: new Date().toISOString(),
    decided_at: new Date().toISOString(),
  });
  const { error: approvedLetterError } = await admin.from("cover_letters").insert({
    user_id: userId,
    match_id: matchReadyForEmailApp.id,
    generated_content: "Dear Hiring Team,\n\nApproved cover letter body for the platform role.\n\nSincerely,",
    generation_status: "completed",
    approval_status: "user_approved",
    approved_content: "Dear Hiring Team,\n\nApproved cover letter body for the platform role.\n\nSincerely,",
    approved_at: new Date().toISOString(),
  });
  if (approvedLetterError) throw new Error(`approved cover letter: ${approvedLetterError.message}`);

  // 5. Approved external_link match with an application already pending_send (mark-as-sent flow).
  const jobForMarkSent = await fixtureJob("E2E Product Manager (Mark As Sent)");
  const matchForMarkSent = await fixtureMatch(jobForMarkSent, {
    status: "user_approved",
    surfaced_at: new Date().toISOString(),
    decided_at: new Date().toISOString(),
  });
  const { data: applicationForMarkSent, error: appError } = await userClient.rpc("create_application", { p_match_id: matchForMarkSent.id });
  if (appError) throw new Error(`create_application for mark-sent fixture: ${appError.message}`);

  const fixture = {
    email: EMAIL,
    password: PASSWORD,
    userId,
    jobIds,
    matchToApproveId: matchToApprove.id,
    matchToRejectId: matchToReject.id,
    matchWithDraftLetterId: matchWithDraftLetter.id,
    matchReadyForEmailAppId: matchReadyForEmailApp.id,
    matchForMarkSentId: matchForMarkSent.id,
    applicationForMarkSentId: applicationForMarkSent.id,
    jobReadyForEmailAppTitle: jobReadyForEmailApp.title,
  };
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2));

  await seedJobMarketCoverageFixture();
}

// Seeds one Pro fixture user for the job_market_coverage E2E spec. Profile
// (university/major) is pre-seeded so /onboarding/preferences loads past
// its combobox-gated fields; job_preferences is deliberately NOT
// pre-seeded — the spec drives the real onboarding form to prove the real
// UI -> RPC -> DB path for job_market_coverage. Creates its own admin
// client rather than taking globalSetup's as a parameter — ReturnType<typeof
// createClient> loses the call-site-inferred schema typing and produces
// spurious `never`-typed table-argument errors under tsc.
async function seedJobMarketCoverageFixture() {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email === JMC_EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing.id);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: JMC_EMAIL,
    password: JMC_PASSWORD,
    email_confirm: true,
  });
  if (createError) throw new Error(`create JMC user: ${createError.message}`);
  const userId = created.user.id;

  const { error: planError } = await admin
    .from("subscriptions")
    .update({ plan_code: "pro", status: "active", provider: "whish", current_period_end: new Date(Date.now() + 86400000).toISOString() })
    .eq("user_id", userId);
  if (planError) throw new Error(`JMC subscriptions: ${planError.message}`);

  const { data: uni, error: uniError } = await admin.from("universities").select("slug").eq("is_active", true).limit(1).single();
  if (uniError) throw new Error(`JMC universities: ${uniError.message}`);
  const { data: major, error: majorError } = await admin.from("majors").select("slug").eq("is_active", true).limit(1).single();
  if (majorError) throw new Error(`JMC majors: ${majorError.message}`);

  const { error: profileError } = await admin.from("profiles").update({ university_id: uni.slug, major_id: major.slug }).eq("id", userId);
  if (profileError) throw new Error(`JMC profiles: ${profileError.message}`);

  const fixture = { email: JMC_EMAIL, password: JMC_PASSWORD, userId };
  writeFileSync(JMC_FIXTURE_PATH, JSON.stringify(fixture, null, 2));
}
