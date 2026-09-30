// DB tests for Phase 08's cover-letter generation pipeline
// (src/lib/coverLetters/candidates.ts, saveCoverLetter.ts) against the real
// local Supabase instance — no real LLM call (that only happens inside the
// n8n workflow).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers, uploadFakeCv, insertFakeAnalysis, deleteFakeJobs } from "./helpers.mjs";
import { findCoverLetterCandidates } from "../../src/lib/coverLetters/candidates.ts";
import { saveCoverLetterDraft } from "../../src/lib/coverLetters/saveCoverLetter.ts";

const jobIdsToClean = [];
let user;
let analysis;

before(async () => {
  await assertExpectedLocalProject();
  user = await createTestUser("cover-letter-gen");
  const cv = await uploadFakeCv(user, "cover-letter-gen.pdf");
  const created = await insertFakeAnalysis(user, cv.id, {
    professional_summary: "Five years of backend experience.",
    skills: ["TypeScript", "PostgreSQL"],
    strongest_areas: ["API design"],
    profile_level: "mid-level",
  });
  const { data: approved, error } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
  if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);
  analysis = approved;
});

after(async () => {
  const { data: matches } = await adminClient.from("matches").select("id").eq("user_id", user.id);
  const matchIds = (matches ?? []).map((m) => m.id);
  if (matchIds.length > 0) {
    await adminClient.from("cover_letters").delete().in("match_id", matchIds);
  }
  await adminClient.from("matches").delete().eq("user_id", user.id);
  await deleteFakeJobs(jobIdsToClean);
  await deleteTestUsers([user]);
});

async function insertFixtureJob(overrides = {}) {
  const { data, error } = await adminClient
    .from("jobs")
    .insert({
      title: "Fixture Cover Letter Job",
      company_name: "Fixture Co",
      description: "A fake job fixture for automated tests only.",
      application_method: "external_link",
      application_url: "https://example.test/apply",
      source_type: "admin_manual",
      status: "active",
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`fixture job insert failed: ${error.message}`);
  jobIdsToClean.push(data.id);
  return data;
}

async function insertFixtureMatch(jobId, overrides = {}) {
  const { data, error } = await adminClient
    .from("matches")
    .insert({
      user_id: user.id,
      job_id: jobId,
      cv_analysis_id: analysis.id,
      score: 85,
      score_breakdown: { strengths: ["TypeScript", "APIs"] },
      explanation: "Strong overlap in backend skills.",
      status: "user_approved",
      matching_model: "test-fixture",
      surfaced_at: new Date().toISOString(),
      decided_at: new Date().toISOString(),
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`fixture match insert failed: ${error.message}`);
  return data;
}

test("findCoverLetterCandidates: finds an approved match with no cover_letters row yet, with a grounded prompt", async () => {
  const job = await insertFixtureJob({ title: "Backend Engineer" });
  const match = await insertFixtureMatch(job.id);

  const candidates = await findCoverLetterCandidates(adminClient, 50);
  const found = candidates.find((c) => c.matchId === match.id);
  assert.ok(found, "expected the approved match to be a candidate");
  assert.match(found.prompt, /Backend Engineer/);
  assert.match(found.prompt, /Strong overlap in backend skills\./);
});

test("findCoverLetterCandidates: excludes a match that already has a completed cover letter", async () => {
  const job = await insertFixtureJob({ title: "Already Drafted Job" });
  const match = await insertFixtureMatch(job.id);
  await adminClient.from("cover_letters").insert({ user_id: user.id, match_id: match.id, generated_content: "x".repeat(150), generation_status: "completed" });

  const candidates = await findCoverLetterCandidates(adminClient, 50);
  assert.ok(!candidates.some((c) => c.matchId === match.id));
});

test("findCoverLetterCandidates: excludes a match that isn't approved", async () => {
  const job = await insertFixtureJob({ title: "Pending Job" });
  const match = await insertFixtureMatch(job.id, { status: "pending_review", decided_at: null });

  const candidates = await findCoverLetterCandidates(adminClient, 50);
  assert.ok(!candidates.some((c) => c.matchId === match.id));
});

test("findCoverLetterCandidates: never exceeds the user's plan cover_letter_limit, and never exceeds a used-up quota", async () => {
  // Isolated fresh user (not the shared file-level `user`, whose quota is
  // already exercised by earlier tests in this file) — free plan has
  // cover_letter_limit 1.
  const quotaUser = await createTestUser("cover-letter-quota");
  const quotaJobIds = [];
  try {
    const cv = await uploadFakeCv(quotaUser, "cover-letter-quota.pdf");
    const created = await insertFakeAnalysis(quotaUser, cv.id);
    const { data: quotaAnalysis, error } = await quotaUser.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
    if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);

    async function quotaJob(title) {
      const { data, error: jobError } = await adminClient
        .from("jobs")
        .insert({
          title,
          company_name: "Fixture Co",
          description: "A fake job fixture for automated tests only.",
          application_method: "external_link",
          application_url: "https://example.test/apply",
          source_type: "admin_manual",
          status: "active",
        })
        .select()
        .single();
      if (jobError) throw new Error(`fixture job insert failed: ${jobError.message}`);
      quotaJobIds.push(data.id);
      return data;
    }
    async function quotaMatch(jobId, score) {
      const { data, error: matchError } = await adminClient
        .from("matches")
        .insert({
          user_id: quotaUser.id,
          job_id: jobId,
          cv_analysis_id: quotaAnalysis.id,
          score,
          status: "user_approved",
          matching_model: "test-fixture",
          surfaced_at: new Date().toISOString(),
          decided_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (matchError) throw new Error(`fixture match insert failed: ${matchError.message}`);
      return data;
    }

    const jobA = await quotaJob("Quota Job A");
    const jobB = await quotaJob("Quota Job B");
    const matchA = await quotaMatch(jobA.id, 90);
    const matchB = await quotaMatch(jobB.id, 80);

    const candidates = await findCoverLetterCandidates(adminClient, 50);
    const ours = candidates.filter((c) => c.matchId === matchA.id || c.matchId === matchB.id);
    assert.equal(ours.length, 1, "free plan must never surface more than its cover_letter_limit as candidates in one run");
    assert.equal(ours[0].matchId, matchA.id, "the highest-scoring match must be the one prioritized");

    // Now simulate that one letter was actually generated — the quota is
    // fully used, so no further candidate (including the still-pending
    // matchB) should ever surface again.
    await adminClient.from("cover_letters").insert({ user_id: quotaUser.id, match_id: matchA.id, generated_content: "x".repeat(150), generation_status: "completed" });
    const candidatesAfter = await findCoverLetterCandidates(adminClient, 50);
    assert.ok(!candidatesAfter.some((c) => c.matchId === matchB.id), "free plan's single cover letter was already used, so no further candidates should surface");
  } finally {
    await adminClient.from("matches").delete().eq("user_id", quotaUser.id);
    await deleteFakeJobs(quotaJobIds);
    await deleteTestUsers([quotaUser]);
  }
});

for (const planCode of ["student", "pro"]) {
  test(`findCoverLetterCandidates: a real '${planCode}' subscription gets its own real, higher plans.cover_letter_limit — never the Free plan's limit`, async () => {
    // Reads the real catalog limit rather than hardcoding it, so this test
    // proves the code follows plans.cover_letter_limit (server-authoritative,
    // AGENTS.md §6/§27 "never trust a client-supplied plan or usage count")
    // instead of re-asserting an invented number.
    const { data: plan, error: planError } = await adminClient.from("plans").select("cover_letter_limit").eq("plan_code", planCode).single();
    if (planError) throw new Error(`plan lookup failed: ${planError.message}`);
    const limit = plan.cover_letter_limit;
    assert.ok(limit > 1, `${planCode}'s cover_letter_limit must exceed the free plan's (1) for this test to be meaningful — got ${limit}`);

    const planUser = await createTestUser(`cover-letter-${planCode}`);
    const planJobIds = [];
    try {
      await adminClient
        .from("subscriptions")
        .update({
          plan_code: planCode,
          status: "active",
          provider: "whish",
          current_period_start: new Date(Date.now() - 86400000).toISOString(),
          current_period_end: new Date(Date.now() + 86400000).toISOString(),
        })
        .eq("user_id", planUser.id);

      const cv = await uploadFakeCv(planUser, `cover-letter-${planCode}.pdf`);
      const created = await insertFakeAnalysis(planUser, cv.id);
      const { data: planAnalysis, error } = await planUser.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
      if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);

      const matchIds = [];
      for (let i = 0; i < limit + 1; i++) {
        const { data: job, error: jobError } = await adminClient
          .from("jobs")
          .insert({ title: `${planCode} Quota Job ${i}`, company_name: "Fixture Co", description: "Fixture.", application_method: "external_link", application_url: "https://example.test/apply", source_type: "admin_manual", status: "active" })
          .select()
          .single();
        if (jobError) throw new Error(`fixture job insert failed: ${jobError.message}`);
        planJobIds.push(job.id);

        const { data: match, error: matchError } = await adminClient
          .from("matches")
          .insert({ user_id: planUser.id, job_id: job.id, cv_analysis_id: planAnalysis.id, score: 90 - i, status: "user_approved", matching_model: "test-fixture", surfaced_at: new Date().toISOString(), decided_at: new Date().toISOString() })
          .select()
          .single();
        if (matchError) throw new Error(`fixture match insert failed: ${matchError.message}`);
        matchIds.push(match.id);
      }

      // Use up exactly `limit - 1` of the quota directly (cheap — mirrors a
      // real generation's end state without paying for real LLM calls),
      // leaving exactly 1 slot of real remaining quota across the 2
      // still-unused matches.
      for (let i = 0; i < limit - 1; i++) {
        const { error: letterError } = await adminClient.from("cover_letters").insert({ user_id: planUser.id, match_id: matchIds[i], generated_content: "x".repeat(150), generation_status: "completed" });
        if (letterError) throw new Error(`fixture cover_letters insert failed: ${letterError.message}`);
      }

      const candidates = await findCoverLetterCandidates(adminClient, 50);
      const ours = candidates.filter((c) => matchIds.includes(c.matchId));
      assert.equal(ours.length, 1, `${planCode}'s real limit (${limit}) minus ${limit - 1} already-used must leave exactly 1 remaining candidate slot — this fails if the code fell back to Free's limit of 1, since ${limit - 1} already-used would already read as exhausted`);
      assert.equal(ours[0].matchId, matchIds[limit - 1], "of the 2 still-unused matches, the higher-scoring one must be the candidate that fills the 1 remaining slot");
    } finally {
      await adminClient.from("cover_letters").delete().eq("user_id", planUser.id);
      await adminClient.from("matches").delete().eq("user_id", planUser.id);
      await deleteFakeJobs(planJobIds);
      await deleteTestUsers([planUser]);
    }
  });
}

for (const planCode of ["student", "pro"]) {
  test(`findCoverLetterCandidates: a '${planCode}' subscription's cover-letter allowance is scoped to the current billing period and resets on a new period — never a lifetime cap`, async () => {
    const { data: plan, error: planError } = await adminClient.from("plans").select("cover_letter_limit").eq("plan_code", planCode).single();
    if (planError) throw new Error(`plan lookup failed: ${planError.message}`);
    const limit = plan.cover_letter_limit;

    const periodUser = await createTestUser(`cover-letter-period-${planCode}`);
    const periodJobIds = [];
    try {
      const periodAStart = new Date(Date.now() - 20 * 86400000).toISOString(); // 20 days ago
      const periodAEnd = new Date(Date.now() - 5 * 86400000).toISOString(); // 5 days ago — already elapsed, but current_period_* has not been rolled forward yet (mirrors a real subscription right up until renewal is verified)
      await adminClient
        .from("subscriptions")
        .update({ plan_code: planCode, status: "active", provider: "whish", current_period_start: periodAStart, current_period_end: periodAEnd })
        .eq("user_id", periodUser.id);

      const cv = await uploadFakeCv(periodUser, `cover-letter-period-${planCode}.pdf`);
      const created = await insertFakeAnalysis(periodUser, cv.id);
      const { data: periodAnalysis, error } = await periodUser.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
      if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);

      async function fixtureMatchWithLetter(index, createdAtIso) {
        const { data: job, error: jobError } = await adminClient
          .from("jobs")
          .insert({ title: `${planCode} Period Job ${index}`, company_name: "Fixture Co", description: "Fixture.", application_method: "external_link", application_url: "https://example.test/apply", source_type: "admin_manual", status: "active" })
          .select()
          .single();
        if (jobError) throw new Error(`fixture job insert failed: ${jobError.message}`);
        periodJobIds.push(job.id);

        const { data: match, error: matchError } = await adminClient
          .from("matches")
          .insert({ user_id: periodUser.id, job_id: job.id, cv_analysis_id: periodAnalysis.id, score: 90 - index, status: "user_approved", matching_model: "test-fixture", surfaced_at: new Date().toISOString(), decided_at: new Date().toISOString() })
          .select()
          .single();
        if (matchError) throw new Error(`fixture match insert failed: ${matchError.message}`);

        const { error: letterError } = await adminClient
          .from("cover_letters")
          .insert({ user_id: periodUser.id, match_id: match.id, generated_content: "x".repeat(150), generation_status: "completed", created_at: createdAtIso });
        if (letterError) throw new Error(`fixture cover_letters insert failed: ${letterError.message}`);
        return match;
      }

      // Fully use up period A's allowance — `limit` real cover_letters rows,
      // all created inside [periodAStart, periodAEnd).
      const midPeriodA = new Date(Date.parse(periodAStart) + 1000).toISOString();
      for (let i = 0; i < limit; i++) {
        await fixtureMatchWithLetter(i, midPeriodA);
      }

      // One more approved match, still within period A conceptually (quota
      // exhausted) — must be blocked (the "limit + 1"th generation of the period).
      const { data: blockedJob, error: blockedJobError } = await adminClient
        .from("jobs")
        .insert({ title: `${planCode} Period Blocked Job`, company_name: "Fixture Co", description: "Fixture.", application_method: "external_link", application_url: "https://example.test/apply", source_type: "admin_manual", status: "active" })
        .select()
        .single();
      if (blockedJobError) throw new Error(`fixture job insert failed: ${blockedJobError.message}`);
      periodJobIds.push(blockedJob.id);
      const { data: blockedMatch, error: blockedMatchError } = await adminClient
        .from("matches")
        .insert({ user_id: periodUser.id, job_id: blockedJob.id, cv_analysis_id: periodAnalysis.id, score: 99, status: "user_approved", matching_model: "test-fixture", surfaced_at: new Date().toISOString(), decided_at: new Date().toISOString() })
        .select()
        .single();
      if (blockedMatchError) throw new Error(`fixture match insert failed: ${blockedMatchError.message}`);

      const candidatesStillInPeriodA = await findCoverLetterCandidates(adminClient, 50);
      assert.ok(
        !candidatesStillInPeriodA.some((c) => c.matchId === blockedMatch.id),
        `${planCode}'s period-A allowance (${limit}) is fully used — the next generation must be blocked, not silently allowed past the limit`
      );

      // A real renewal has happened: roll the subscription's billing period
      // forward (exactly what mark_payment_verified/activate_subscription do
      // on a real renewal — see 20260903090000_add_price_versioning_and_
      // upgrade_locking.sql). No cron/reset job is involved: the quota is
      // derived from the period window, so simply having a new period is
      // sufficient for it to read as fully available again.
      const periodBStart = new Date(Date.now() - 1000).toISOString();
      const periodBEnd = new Date(Date.now() + 25 * 86400000).toISOString();
      await adminClient.from("subscriptions").update({ current_period_start: periodBStart, current_period_end: periodBEnd }).eq("user_id", periodUser.id);

      const candidatesInPeriodB = await findCoverLetterCandidates(adminClient, 50);
      assert.ok(
        candidatesInPeriodB.some((c) => c.matchId === blockedMatch.id),
        `${planCode}'s allowance must be fully available again in a new billing period, even though ${limit} letters were generated in the previous period (not reset by a cron job — derived from the period window)`
      );
    } finally {
      await adminClient.from("cover_letters").delete().eq("user_id", periodUser.id);
      await adminClient.from("matches").delete().eq("user_id", periodUser.id);
      await deleteFakeJobs(periodJobIds);
      await deleteTestUsers([periodUser]);
    }
  });
}

test("findCoverLetterCandidates: a Student-to-Pro upgrade that preserves the billing period (the existing mark_payment_verified 'upgrade never moves the period' rule) counts already-consumed Student letters against the new Pro limit in that same period", async () => {
  const { data: studentPlan } = await adminClient.from("plans").select("cover_letter_limit").eq("plan_code", "student").single();
  const { data: proPlan } = await adminClient.from("plans").select("cover_letter_limit").eq("plan_code", "pro").single();
  const studentLimit = studentPlan.cover_letter_limit;
  const proLimit = proPlan.cover_letter_limit;
  assert.ok(proLimit > studentLimit, "this test assumes Pro's limit exceeds Student's");

  const upgradeUser = await createTestUser("cover-letter-upgrade");
  const upgradeJobIds = [];
  try {
    const periodStart = new Date(Date.now() - 86400000).toISOString();
    const periodEnd = new Date(Date.now() + 25 * 86400000).toISOString();
    await adminClient
      .from("subscriptions")
      .update({ plan_code: "student", status: "active", provider: "whish", current_period_start: periodStart, current_period_end: periodEnd })
      .eq("user_id", upgradeUser.id);

    const cv = await uploadFakeCv(upgradeUser, "cover-letter-upgrade.pdf");
    const created = await insertFakeAnalysis(upgradeUser, cv.id);
    const { data: analysisRow, error } = await upgradeUser.client.rpc("confirm_cv_analysis", { p_analysis_id: created.id });
    if (error) throw new Error(`confirm_cv_analysis failed: ${error.message}`);

    // Consume the full Student allowance within the current period.
    for (let i = 0; i < studentLimit; i++) {
      const { data: job } = await adminClient
        .from("jobs")
        .insert({ title: `Upgrade Job ${i}`, company_name: "Fixture Co", description: "Fixture.", application_method: "external_link", application_url: "https://example.test/apply", source_type: "admin_manual", status: "active" })
        .select()
        .single();
      upgradeJobIds.push(job.id);
      const { data: match } = await adminClient
        .from("matches")
        .insert({ user_id: upgradeUser.id, job_id: job.id, cv_analysis_id: analysisRow.id, score: 90 - i, status: "user_approved", matching_model: "test-fixture", surfaced_at: new Date().toISOString(), decided_at: new Date().toISOString() })
        .select()
        .single();
      await adminClient.from("cover_letters").insert({ user_id: upgradeUser.id, match_id: match.id, generated_content: "x".repeat(150), generation_status: "completed" });
    }

    // Upgrade to Pro WITHOUT changing the billing period — this is exactly
    // what activate_subscription does for a real upgrade (period preserved,
    // only plan_code/status change; see mark_payment_verified's 'upgrade'
    // branch, which explicitly never touches current_period_start/end).
    await adminClient.from("subscriptions").update({ plan_code: "pro" }).eq("user_id", upgradeUser.id);

    const remainingQuotaMatches = [];
    for (let i = 0; i < proLimit - studentLimit + 1; i++) {
      const { data: job } = await adminClient
        .from("jobs")
        .insert({ title: `Upgrade Extra Job ${i}`, company_name: "Fixture Co", description: "Fixture.", application_method: "external_link", application_url: "https://example.test/apply", source_type: "admin_manual", status: "active" })
        .select()
        .single();
      upgradeJobIds.push(job.id);
      const { data: match } = await adminClient
        .from("matches")
        .insert({ user_id: upgradeUser.id, job_id: job.id, cv_analysis_id: analysisRow.id, score: 50 - i, status: "user_approved", matching_model: "test-fixture", surfaced_at: new Date().toISOString(), decided_at: new Date().toISOString() })
        .select()
        .single();
      remainingQuotaMatches.push(match.id);
    }

    const candidates = await findCoverLetterCandidates(adminClient, 50);
    const ours = candidates.filter((c) => remainingQuotaMatches.includes(c.matchId));
    assert.equal(
      ours.length,
      proLimit - studentLimit,
      `after upgrading mid-period, remaining allowance must be Pro's limit (${proLimit}) minus the ${studentLimit} already consumed as Student in this SAME period — not a fresh Pro allowance and not zero`
    );
  } finally {
    await adminClient.from("cover_letters").delete().eq("user_id", upgradeUser.id);
    await adminClient.from("matches").delete().eq("user_id", upgradeUser.id);
    await deleteFakeJobs(upgradeJobIds);
    await deleteTestUsers([upgradeUser]);
  }
});

test("cover_letters.match_id has a real DB uniqueness constraint — the final defense against a duplicate row from a concurrent generation race", async () => {
  const job = await insertFixtureJob({ title: "Duplicate Race Job" });
  const match = await insertFixtureMatch(job.id);

  await adminClient.from("cover_letters").insert({ user_id: user.id, match_id: match.id, generated_content: "x".repeat(150), generation_status: "completed" });
  const { error } = await adminClient.from("cover_letters").insert({ user_id: user.id, match_id: match.id, generated_content: "y".repeat(150), generation_status: "completed" });
  assert.notEqual(error, null, "a second cover_letters row for the same match must be rejected by the DB, not merely relied on application-level check-then-act logic");

  const { data: rows } = await adminClient.from("cover_letters").select("id").eq("match_id", match.id);
  assert.equal(rows.length, 1, "exactly one cover_letters row must exist per match, even after a concurrent duplicate-write attempt");
});

test("saveCoverLetterDraft: creates a new row for a first-time draft", async () => {
  const job = await insertFixtureJob({ title: "Save Draft Job" });
  const match = await insertFixtureMatch(job.id);

  const outcome = await saveCoverLetterDraft(adminClient, {
    matchId: match.id,
    content: "x".repeat(150),
    modelProvider: "openai",
    modelVersion: "gpt-4o-mini",
  });
  assert.equal(outcome, "saved");

  const { data: row } = await adminClient.from("cover_letters").select("*").eq("match_id", match.id).single();
  assert.equal(row.generation_status, "completed");
  assert.equal(row.generated_content, "x".repeat(150));
  assert.equal(row.user_id, user.id);
});

test("saveCoverLetterDraft: refuses to write for a match that is no longer approved", async () => {
  const job = await insertFixtureJob({ title: "No Longer Approved Job" });
  const match = await insertFixtureMatch(job.id, { status: "user_rejected" });

  const outcome = await saveCoverLetterDraft(adminClient, {
    matchId: match.id,
    content: "x".repeat(150),
    modelProvider: "openai",
    modelVersion: "gpt-4o-mini",
  });
  assert.equal(outcome, "match_not_approved");
  const { data: row } = await adminClient.from("cover_letters").select("id").eq("match_id", match.id).maybeSingle();
  assert.equal(row, null);
});

test("saveCoverLetterDraft: never overwrites an already-approved cover letter", async () => {
  const job = await insertFixtureJob({ title: "Already Approved Letter Job" });
  const match = await insertFixtureMatch(job.id);
  await adminClient.from("cover_letters").insert({
    user_id: user.id,
    match_id: match.id,
    generated_content: "original draft".repeat(20),
    generation_status: "completed",
    approval_status: "user_approved",
    approved_content: "the frozen approved version",
    approved_at: new Date().toISOString(),
  });

  const outcome = await saveCoverLetterDraft(adminClient, {
    matchId: match.id,
    content: "a brand new regenerated draft".repeat(20),
    modelProvider: "openai",
    modelVersion: "gpt-4o-mini",
  });
  assert.equal(outcome, "already_approved");

  const { data: row } = await adminClient.from("cover_letters").select("approved_content").eq("match_id", match.id).single();
  assert.equal(row.approved_content, "the frozen approved version");
});
