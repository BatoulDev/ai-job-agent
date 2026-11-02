// Founder-evidence E2E (2026-11-02 checkpoint): drives the REAL cover-letter
// edit -> approve -> download browser flow (same mechanism already proven by
// dashboard-flows.spec.ts) for three substantially different scenarios, and
// captures the exact on-screen/downloaded text for the founder's own E2E
// report. Self-contained setup/teardown — does not touch dashboard-flows'
// shared fixture.
//
// IMPORTANT HONESTY NOTE: the three "generated_content" drafts below are
// hand-authored deterministic fixture text, NOT real OpenAI output — no
// paid AI call was made this session (see the report's own disclosure).
// This spec proves the UI mechanism (edit/save/approve/download) end to
// end against real browser interaction and the real database; it does
// NOT evaluate real AI writing quality or hallucination resistance.
//
// LOCAL ONLY: refuses to run against anything but a local Supabase URL.
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal } from "./loadEnv";

loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SECRET_KEY!;

if (!SUPABASE_URL.includes("127.0.0.1") && !SUPABASE_URL.includes("localhost")) {
  throw new Error("Refusing to run cover-letter-evidence spec against a non-local Supabase URL.");
}

const EMAIL = "e2e-cover-letter-evidence@test.local";
const PASSWORD = "E2eCoverLetterEvidence123!";
const EVIDENCE_DIR = resolve(__dirname, "..", "..", "test-fixtures", "e2e-evidence-output");
const EVIDENCE_PATH = resolve(EVIDENCE_DIR, "cover-letter-evidence.json");

interface Scenario {
  key: string;
  label: string;
  candidateSummary: string;
  jobTitle: string;
  jobDescription: string;
  draftContent: string;
  editedContent: string;
}

const SCENARIOS: Scenario[] = [
  {
    key: "junior",
    label: "Junior candidate -> relevant entry-level role",
    candidateSummary:
      "Nour Saade — final-year Marketing student (Lebanese American University). No professional work experience yet. Coursework: digital marketing, consumer behavior. Personal projects: ran a 500-follower Instagram page for a university club, built two Canva campaign mockups for a class project. Skills: social media basics, Canva, GA4 (coursework level), written English/Arabic.",
    jobTitle: "Marketing Intern",
    jobDescription:
      "Beirut-based e-commerce startup seeking a Marketing Intern to support the social content calendar and assist with weekly campaign reporting. No prior professional experience required; comfort with Canva and an interest in analytics is a plus.",
    draftContent:
      "Dear Hiring Team,\n\nI am writing to apply for the Marketing Intern position. As a final-year Marketing student, I have not yet worked professionally, but I have run a university club's Instagram page and built campaign mockups in Canva for coursework, which taught me the basics of planning a content calendar and reading simple engagement numbers. I am comfortable with Canva and have used GA4 at a coursework level.\n\nI would welcome the chance to bring that same hands-on curiosity to your team's social content and reporting work while I continue to learn on the job.\n\nSincerely,\nNour Saade",
    editedContent:
      "Dear Hiring Team,\n\nI am writing to apply for the Marketing Intern position. As a final-year Marketing student, I have not yet worked professionally, but I ran a university club's Instagram page from 200 to 500 followers and built two campaign mockups in Canva for coursework — hands-on practice with planning a content calendar and reading basic engagement numbers. I am comfortable with Canva and have used GA4 at a coursework level.\n\nI would welcome the chance to bring that same curiosity to your team's social content and reporting work while I continue learning on the job.\n\nSincerely,\nNour Saade",
  },
  {
    key: "experienced",
    label: "Experienced candidate -> role aligned with their skills",
    candidateSummary:
      "Rania Fakhoury — 5 years as a Backend Engineer (PHP/Laravel, then Node.js/PostgreSQL) at two Beirut-based fintech companies. Led a payments-reconciliation service rewrite, mentored two junior engineers, comfortable with REST API design and PostgreSQL performance tuning.",
    jobTitle: "Backend Engineer",
    jobDescription:
      "Series-A fintech hiring a Backend Engineer to own REST API design and PostgreSQL performance for the payments platform. 4+ years backend experience required; Node.js and PostgreSQL strongly preferred.",
    draftContent:
      "Dear Hiring Team,\n\nI am applying for the Backend Engineer role. Over the past five years I have worked as a backend engineer, most recently building and rewriting a payments-reconciliation service in Node.js and PostgreSQL, where I focused on REST API design and query performance tuning. I have also mentored two junior engineers on my team.\n\nYour role's focus on REST API design and PostgreSQL performance for a payments platform maps closely onto the work I have already shipped, and I would welcome the chance to bring that experience directly to your team.\n\nSincerely,\nRania Fakhoury",
    editedContent:
      "Dear Hiring Team,\n\nI am applying for the Backend Engineer role. Over the past five years I have worked as a backend engineer — three years in PHP/Laravel, then two years in Node.js and PostgreSQL — most recently leading a rewrite of a payments-reconciliation service, where I focused on REST API design and query performance tuning. I have also mentored two junior engineers on my team.\n\nYour role's focus on REST API design and PostgreSQL performance for a payments platform maps closely onto the work I have already shipped, and I would welcome the chance to bring that experience directly to your team.\n\nSincerely,\nRania Fakhoury",
  },
  {
    key: "partial",
    label: "Partial alignment -> honesty / hallucination-resistance test",
    candidateSummary:
      "Tarek Abou Jaoude — 1.5 years as a Frontend Developer (React, TypeScript, CSS). No backend production experience. Has completed one personal project using Node.js and a hosted PostgreSQL database for a to-do app, never deployed at scale, no Kubernetes exposure.",
    jobTitle: "Senior Backend Engineer",
    jobDescription:
      "Hiring a Senior Backend Engineer with 5+ years of distributed-systems experience, deep PostgreSQL expertise, and hands-on Kubernetes operations experience to run our production infrastructure.",
    draftContent:
      "Dear Hiring Team,\n\nI am writing to express interest in the Senior Backend Engineer role. My background is primarily as a Frontend Developer (1.5 years, React and TypeScript), and I want to be upfront that I do not have production backend or Kubernetes experience at the seniority this role calls for. I have built one personal project using Node.js with a hosted PostgreSQL database, which gave me a first, small look at backend development, but nothing at the scale or depth your listing describes.\n\nI understand this role is likely not the right fit at my current experience level, but wanted to flag my interest in backend work in case a more junior backend or full-stack opening exists on your team.\n\nSincerely,\nTarek Abou Jaoude",
    editedContent:
      "Dear Hiring Team,\n\nI am writing to express interest in the Senior Backend Engineer role, though I want to be upfront: my background is primarily as a Frontend Developer (1.5 years, React and TypeScript), and I do not have production backend or Kubernetes experience at the seniority this role calls for. I have built one personal to-do app using Node.js with a hosted PostgreSQL database, which gave me a first, small look at backend work, but nothing at the scale your listing describes.\n\nI understand this specific role may not be the right fit today, but wanted to flag my interest in backend work in case a more junior or full-stack opening exists on your team.\n\nSincerely,\nTarek Abou Jaoude",
  },
];

let userId: string;
const jobIds: string[] = [];
const matchIdByScenario: Record<string, string> = {};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email === EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing.id);

  const { data: created, error: createError } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (createError) throw new Error(`create user: ${createError.message}`);
  userId = created.user.id;

  const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error: signInError } = await userClient.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (signInError) throw new Error(`sign in: ${signInError.message}`);

  await admin.from("subscriptions").update({ plan_code: "pro", provider: "whish" }).eq("user_id", userId);

  // Mirrors global-setup.ts exactly: get_onboarding_readiness() checks for
  // a real storage.objects row at the cv's exact storage_path, not just a
  // DB row, so a real (fake-bytes) upload + replace_cv() is required.
  const fakeBytes = new TextEncoder().encode("%PDF-1.4 fake test fixture, not a real CV\n");
  const { error: uploadError } = await userClient.storage.from("cvs").upload(`${userId}/e2e.pdf`, fakeBytes, { contentType: "application/pdf" });
  if (uploadError) throw new Error(`storage upload: ${uploadError.message}`);
  const { data: cv, error: cvInsertError } = await userClient.rpc("replace_cv", {
    p_storage_path: `${userId}/e2e.pdf`,
    p_file_name: "e2e.pdf",
    p_file_size_bytes: fakeBytes.byteLength,
    p_mime_type: "application/pdf",
  });
  if (cvInsertError) throw new Error(`replace_cv: ${cvInsertError.message}`);

  const { data: prefs, error: prefsError } = await admin
    .from("job_preferences")
    .insert({ user_id: userId, work_arrangement: "remote", job_type: "full-time", experience_level: "entry-level" })
    .select("version")
    .single();
  if (prefsError) throw new Error(`job_preferences: ${prefsError.message}`);

  const { data: draftAnalysis, error: analysisError } = await admin
    .from("cv_analyses")
    .insert({
      user_id: userId,
      cv_id: cv.id,
      status: "completed",
      analyzed_at: new Date().toISOString(),
      preference_snapshot: {},
      preferences_version: prefs.version,
      professional_summary: "Synthetic fixture profile for cover-letter evidence scenarios.",
      skills: ["fixture"],
      strongest_areas: ["fixture"],
      profile_level: "mid-level",
    })
    .select()
    .single();
  if (analysisError) throw new Error(`cv_analyses: ${analysisError.message}`);
  const { data: cvAnalysis, error: confirmError } = await userClient.rpc("confirm_cv_analysis", { p_analysis_id: draftAnalysis.id });
  if (confirmError) throw new Error(`confirm_cv_analysis: ${confirmError.message}`);

  for (const scenario of SCENARIOS) {
    const { data: job, error: jobError } = await admin
      .from("jobs")
      .insert({
        title: scenario.jobTitle,
        company_name: "E2E Evidence Co",
        description: scenario.jobDescription,
        application_method: "external_link",
        application_url: "https://example.test/apply",
        source_type: "admin_manual",
        status: "active",
      })
      .select()
      .single();
    if (jobError) throw new Error(`job insert (${scenario.key}): ${jobError.message}`);
    jobIds.push(job.id);

    const { data: match, error: matchError } = await admin
      .from("matches")
      .insert({
        user_id: userId,
        job_id: job.id,
        cv_analysis_id: cvAnalysis.id,
        score: 0,
        score_breakdown: { note: "fixture — no real scoring performed" },
        explanation: "Deterministic fixture match for cover-letter evidence capture — not AI-generated.",
        matching_model: "e2e-fixture",
        status: "user_approved",
        surfaced_at: new Date().toISOString(),
        decided_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (matchError) throw new Error(`match insert (${scenario.key}): ${matchError.message}`);
    matchIdByScenario[scenario.key] = match.id;

    const { error: letterError } = await admin.from("cover_letters").insert({
      user_id: userId,
      match_id: match.id,
      generated_content: scenario.draftContent,
      generation_status: "completed",
    });
    if (letterError) throw new Error(`cover letter insert (${scenario.key}): ${letterError.message}`);
  }
});

test.afterAll(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  await admin.from("applications").delete().eq("user_id", userId);
  await admin.from("cover_letters").delete().eq("user_id", userId);
  await admin.from("matches").delete().eq("user_id", userId);
  await admin.from("cv_analyses").delete().eq("user_id", userId);
  await admin.from("job_preferences").delete().eq("user_id", userId);
  await admin.from("cvs").delete().eq("user_id", userId);
  await admin.storage.from("cvs").remove([`${userId}/e2e.pdf`]);
  if (jobIds.length > 0) await admin.from("jobs").delete().in("id", jobIds);
  await admin.auth.admin.deleteUser(userId);
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  const dismiss = page.getByRole("button", { name: "Not now" });
  const appeared = await dismiss.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false);
  if (appeared) await dismiss.click();
}

const evidence: Record<string, unknown> = { note: "DETERMINISTIC FIXTURE CONTENT — not real AI generation. See spec file header.", scenarios: {} };

for (const scenario of SCENARIOS) {
  test(`cover letter evidence — ${scenario.label}`, async ({ page }) => {
    await login(page);
    await page.getByTestId("tab-approved").click();

    const matchId = matchIdByScenario[scenario.key];
    const card = page.getByTestId(`approved-match-${matchId}`);
    await expect(card).toBeVisible();

    await page.screenshot({ path: resolve(EVIDENCE_DIR, `${scenario.key}-01-draft.png`), fullPage: false });

    const textarea = card.getByRole("textbox");
    await expect(textarea).toBeVisible();
    await textarea.fill(scenario.editedContent);
    await card.getByRole("button", { name: "Save Draft" }).click();
    await expect(card.getByRole("button", { name: "Save Draft" })).toBeVisible();

    await page.screenshot({ path: resolve(EVIDENCE_DIR, `${scenario.key}-02-edited.png`), fullPage: false });

    await card.getByRole("button", { name: "Approve Cover Letter" }).click();
    await expect(card.getByText("Approved", { exact: true })).toBeVisible();

    await page.screenshot({ path: resolve(EVIDENCE_DIR, `${scenario.key}-03-approved.png`), fullPage: false });

    const downloadButton = card.getByRole("button", { name: "Download (.txt)" });
    const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
    const downloadPath = await download.path();
    const downloadedText = downloadPath ? readFileSync(downloadPath, "utf8") : "(download path unavailable)";

    (evidence.scenarios as Record<string, unknown>)[scenario.key] = {
      label: scenario.label,
      candidateSummary: scenario.candidateSummary,
      jobTitle: scenario.jobTitle,
      jobDescription: scenario.jobDescription,
      draftContent: scenario.draftContent,
      editedAndApprovedContent: scenario.editedContent,
      downloadedFileName: download.suggestedFilename(),
      downloadedContentMatchesApproved: downloadedText.trim() === scenario.editedContent.trim(),
    };
    writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2));
  });
}
