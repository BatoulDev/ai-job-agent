// tests/db/save-rerank-result-real-path.test.mjs
//
// Checkpoint 2E audit-remediation requirement: a guarded local DB test
// exercising the FULL real path — a real signed candidate token issued by
// the actual candidate-generation path (findRerankCandidates), processed
// through the actual saveOneRerankResult(), with actual save-time
// revalidation against the real database. Everything up to this file was
// either pure-unit (mocked Supabase) or used saveMatchResult directly,
// bypassing saveOneRerankResult/revalidation entirely — this file closes
// that specific coverage gap found in the final audit.
//
// LOCAL DATABASE ONLY — see tests/db/localTestGuard.mjs. Job fixtures are
// created through the real upsert_job_with_locations RPC (service_role has
// SELECT-only grants on job_locations — the RPC is the only write path).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  adminClient,
  assertExpectedLocalProject,
  createTestUser,
  deleteTestUsers,
  uploadFakeCv,
  insertFakeAnalysis,
} from "./helpers.mjs";
import { findRerankCandidates } from "../../src/lib/matching/rerankCandidates.ts";
import { saveOneRerankResult } from "../../src/lib/matching/saveRerankResult.ts";

const EMBEDDING = Array(1536).fill(0.01);
const VALID_RESPONSE = {
  score: 82,
  reason: "Strong real-path fit.",
  strengths: ["Relevant experience"],
  missing_skills: [],
  preference_alignment: "Matches stated preferences.",
};

let user;
let approvedAnalysis;
const jobIds = [];

async function createFixtureJob({ title, countryCode, city, additionalLocation, status = "active", workArrangement = "onsite" }) {
  const suffix = randomUUID();
  const locations = [{ country_code: countryCode, city, is_primary: true, location_confidence: "high" }];
  if (additionalLocation) {
    locations.push({ country_code: additionalLocation.countryCode, city: additionalLocation.city, is_primary: false, location_confidence: "high" });
  }
  const { data, error } = await adminClient.rpc("upsert_job_with_locations", {
    p_job: {
      title,
      company_name: "Checkpoint 2E Real-Path Fixture Co",
      description: "Real-path audit-remediation fixture job.",
      application_method: "external_link",
      application_url: "https://example.test/apply",
      source_type: "admin_manual",
      external_id: `checkpoint-2e-real-path-${suffix}`,
      work_arrangement: workArrangement,
      country_code: countryCode,
      city,
    },
    p_locations: locations,
    p_replace_locations: true,
  });
  if (error) throw new Error(`createFixtureJob (${title}) failed: ${error.message}`);
  const jobId = data[0].out_job_id;
  jobIds.push(jobId);

  const { error: embeddingError } = await adminClient.from("jobs").update({ embedding: EMBEDDING, status }).eq("id", jobId);
  if (embeddingError) throw new Error(`createFixtureJob (${title}): failed to set embedding/status: ${embeddingError.message}`);
  return jobId;
}

async function replaceJobLocations(jobId, { countryCode, city, workArrangement, locations }) {
  const { data: existing, error: lookupError } = await adminClient
    .from("jobs")
    .select("title, external_id")
    .eq("id", jobId)
    .single();
  if (lookupError) throw new Error(`replaceJobLocations: failed to look up existing job: ${lookupError.message}`);

  const { error } = await adminClient.rpc("upsert_job_with_locations", {
    p_job: {
      title: existing.title,
      company_name: "Checkpoint 2E Real-Path Fixture Co",
      description: "Real-path audit-remediation fixture job (locations updated since discovery).",
      application_method: "external_link",
      application_url: "https://example.test/apply",
      source_type: "admin_manual",
      external_id: existing.external_id,
      work_arrangement: workArrangement,
      country_code: countryCode,
      city,
    },
    p_locations: locations,
    p_replace_locations: true,
  });
  if (error) throw new Error(`replaceJobLocations failed: ${error.message}`);
}

async function discoverCandidateFor(jobId, analysisId = approvedAnalysis.id) {
  const candidates = await findRerankCandidates(adminClient, { userLimit: 50, jobsPerUser: 50, candidatePoolSize: 200 });
  const candidate = candidates.find((c) => c.jobId === jobId && c.cvAnalysisId === analysisId);
  assert.ok(candidate, `expected a real discovery-time candidate for job ${jobId} / analysis ${analysisId}`);
  return candidate;
}

async function matchExists(jobId, analysisId = approvedAnalysis.id) {
  const { data, error } = await adminClient
    .from("matches")
    .select("id, hard_filter_passed, score")
    .eq("user_id", user.id)
    .eq("job_id", jobId)
    .eq("cv_analysis_id", analysisId)
    .maybeSingle();
  if (error) throw new Error(`matchExists lookup failed: ${error.message}`);
  return data;
}

before(async () => {
  await assertExpectedLocalProject();
  user = await createTestUser("2e-real-path");
  const cv = await uploadFakeCv(user, "checkpoint-2e-real-path.pdf");
  const analysis = await insertFakeAnalysis(user, cv.id);
  const { data: confirmed, error: confirmError } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });
  if (confirmError) throw new Error(`confirm_cv_analysis failed: ${confirmError.message}`);
  await adminClient.from("cv_analyses").update({ profile_embedding: EMBEDDING }).eq("id", confirmed.id);
  approvedAnalysis = confirmed;
});

after(async () => {
  if (jobIds.length > 0) {
    await adminClient.from("matches").delete().in("job_id", jobIds);
    const { error } = await adminClient.from("jobs").delete().in("id", jobIds);
    if (error) throw new Error(`cleanup: failed to delete fixture jobs: ${error.message}`);
  }
  if (user) await deleteTestUsers([user]);
});

test("REAL PATH: a real signed token from findRerankCandidates, processed through saveOneRerankResult, persists a valid match", async () => {
  const jobId = await createFixtureJob({
    title: "Real-Path Valid Save Job",
    countryCode: "FR",
    city: "Paris",
    additionalLocation: { countryCode: "LB", city: "Beirut" },
  });
  const candidate = await discoverCandidateFor(jobId);

  const outcome = await saveOneRerankResult(adminClient, "checkpoint-2e-test-model", candidate.candidateId, VALID_RESPONSE);
  assert.equal(outcome, "saved");

  const match = await matchExists(jobId);
  assert.ok(match, "a real match row must exist after a successful save");
  assert.equal(match.hard_filter_passed, true);
  assert.equal(match.score, 82);
});

test("REAL PATH: a job that went inactive since discovery is rejected at save time — no match is created", async () => {
  const jobId = await createFixtureJob({ title: "Real-Path Inactive-At-Save Job", countryCode: "LB", city: "Beirut" });
  const candidate = await discoverCandidateFor(jobId);

  // The job was active and eligible when discovered; it closes before the
  // (real, still-valid) token is ever presented for saving.
  const { error } = await adminClient.from("jobs").update({ status: "unavailable" }).eq("id", jobId);
  if (error) throw new Error(`failed to flip job status: ${error.message}`);

  const outcome = await saveOneRerankResult(adminClient, "checkpoint-2e-test-model", candidate.candidateId, VALID_RESPONSE);
  assert.equal(outcome, "job_no_longer_eligible");
  assert.equal(await matchExists(jobId), null, "no match row must be created for a job that went inactive before saving");
});

test("REAL PATH: a verified additional location removed since discovery makes a Paris-primary job ineligible at save time", async () => {
  const jobId = await createFixtureJob({
    title: "Real-Path Location-Removed Job",
    countryCode: "FR",
    city: "Paris",
    additionalLocation: { countryCode: "LB", city: "Beirut" },
  });
  const candidate = await discoverCandidateFor(jobId);

  // Beirut was the ONLY reason this Paris-primary job was eligible for a
  // Free Lebanon user — a later ingestion run confirms it's no longer a
  // valid additional location and replaces it with Paris-only.
  await replaceJobLocations(jobId, {
    countryCode: "FR",
    city: "Paris",
    workArrangement: "onsite",
    locations: [{ country_code: "FR", city: "Paris", is_primary: true, location_confidence: "high" }],
  });

  const outcome = await saveOneRerankResult(adminClient, "checkpoint-2e-test-model", candidate.candidateId, VALID_RESPONSE);
  assert.equal(outcome, "job_no_longer_eligible");
  assert.equal(await matchExists(jobId), null);
});

test("REAL PATH: a subscription that lapses between discovery and save makes a plan-only-eligible job ineligible at save time", async () => {
  const proUser = await createTestUser("2e-real-path-pro");
  const proJobIds = [];
  try {
    await adminClient
      .from("subscriptions")
      .update({ plan_code: "pro", status: "active", provider: "whish", current_period_end: new Date(Date.now() + 86_400_000).toISOString() })
      .eq("user_id", proUser.id);

    // job_preferences must be set BEFORE the analysis is created/confirmed
    // (preferences_version snapshotting — same ordering requirement
    // documented in tests/db/matching-rerank.test.mjs).
    const { error: prefsError } = await proUser.client.rpc("save_job_preferences", {
      p_work_arrangement: "remote",
      p_job_type: "full-time",
      p_experience_level: "junior",
      p_additional_notes: null,
      p_custom_target_roles: [],
      p_custom_locations: [],
      p_target_role_ids: [],
      p_location_ids: [],
      p_lebanon_location_scope: "selected_only",
      p_international_search_enabled: true,
      p_willing_to_relocate: false,
    });
    if (prefsError) throw new Error(`save_job_preferences failed: ${prefsError.message}`);

    const { data: persistedPrefs } = await adminClient.from("job_preferences").select("job_market_coverage, work_arrangement, international_search_enabled").eq("user_id", proUser.id).single();
    assert.equal(persistedPrefs.job_market_coverage, "remote_worldwide", `sanity: expected remote_worldwide, got ${JSON.stringify(persistedPrefs)}`);

    const cv = await uploadFakeCv(proUser, "checkpoint-2e-pro-lapse.pdf");
    const analysis = await insertFakeAnalysis(proUser, cv.id);
    const { data: confirmed, error: confirmError } = await proUser.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });
    if (confirmError) throw new Error(`confirm_cv_analysis failed: ${confirmError.message}`);
    await adminClient.from("cv_analyses").update({ profile_embedding: EMBEDDING }).eq("id", confirmed.id);

    const { data: jobData, error: jobError } = await adminClient.rpc("upsert_job_with_locations", {
      p_job: {
        title: "Real-Path Pro-Only Remote Job",
        company_name: "Checkpoint 2E Real-Path Fixture Co",
        description: "Pro + remote_worldwide only eligible job.",
        application_method: "external_link",
        application_url: "https://example.test/apply",
        source_type: "admin_manual",
        external_id: `checkpoint-2e-real-path-pro-${randomUUID()}`,
        work_arrangement: "remote",
        remote_scope: "country:US",
        country_code: "US",
        city: null,
      },
      // Country-resolved primary location required — an empty p_locations
      // array with no primary_location_confidence fallback makes the RPC
      // compute status='pending_review' (Checkpoint 2C's own rule), which
      // shortlistJobsForUser's WHERE status='active' filter would then
      // correctly exclude. Not a production bug — a fixture-setup mistake
      // this real-path test caught.
      p_locations: [{ country_code: "US", city: null, is_primary: true, location_confidence: "high" }],
      p_replace_locations: true,
    });
    if (jobError) throw new Error(`job creation failed: ${jobError.message}`);
    const jobId = jobData[0].out_job_id;
    proJobIds.push(jobId);
    await adminClient.from("jobs").update({ embedding: EMBEDDING }).eq("id", jobId);

    const candidates = await findRerankCandidates(adminClient, { userLimit: 50, jobsPerUser: 50, candidatePoolSize: 200 });
    const candidate = candidates.find((c) => c.jobId === jobId && c.cvAnalysisId === confirmed.id);
    assert.ok(candidate, "expected the Pro+remote_worldwide user to discover this job while their subscription is active");

    // The subscription lapses before the (real, still-valid) token is
    // presented for saving — plan_code still says 'pro' (expire_subscription
    // is never called anywhere in src/, confirmed during the audit), only
    // status changes, exactly the real-world scenario deriveEffectivePlanCode
    // now defends against.
    const { error: expireError } = await adminClient.from("subscriptions").update({ status: "expired" }).eq("user_id", proUser.id);
    if (expireError) throw new Error(`failed to expire subscription: ${expireError.message}`);

    const outcome = await saveOneRerankResult(adminClient, "checkpoint-2e-test-model", candidate.candidateId, VALID_RESPONSE);
    assert.equal(outcome, "job_no_longer_eligible");

    const { data: match } = await adminClient.from("matches").select("id").eq("user_id", proUser.id).eq("job_id", jobId).maybeSingle();
    assert.equal(match, null, "no match must be created once the subscription has lapsed");
  } finally {
    if (proJobIds.length > 0) {
      await adminClient.from("matches").delete().in("job_id", proJobIds);
      await adminClient.from("jobs").delete().in("id", proJobIds);
    }
    await deleteTestUsers([proUser]);
  }
});

test("BATCH ISOLATION (real path): a tampered token and a valid token processed in sequence against the real database — the valid one still saves", async () => {
  const jobId = await createFixtureJob({ title: "Real-Path Batch Isolation Job", countryCode: "LB", city: "Beirut" });
  const candidate = await discoverCandidateFor(jobId);

  // Tamper a character well inside the signature's fully-packed base64url
  // region, NOT the final character(s) — a 32-byte HMAC-SHA256 digest
  // base64url-encodes to 43 characters, and the last character carries only
  // 4 significant bits plus 2 decoder-ignored "don't care" bits (256 bits /
  // 6 bits-per-char leaves a partial final group). Flipping only the very
  // last character can therefore decode to byte-identical signature bytes
  // for certain symbol pairs, making the "tamper" a silent no-op roughly
  // 1-in-16 runs (observed empirically: 2026-10-27 MVP-readiness session,
  // `actual: 'saved'` where `invalid_candidate_signature` was expected).
  // Index -4 is always inside a fully-packed group, so the flip always
  // changes real decoded bytes.
  const tamperIndex = candidate.candidateId.length - 4;
  const originalChar = candidate.candidateId[tamperIndex];
  const replacementChar = originalChar === "A" ? "B" : "A";
  const tamperedToken =
    candidate.candidateId.slice(0, tamperIndex) + replacementChar + candidate.candidateId.slice(tamperIndex + 1);
  const tamperedOutcome = await saveOneRerankResult(adminClient, "checkpoint-2e-test-model", tamperedToken, VALID_RESPONSE);
  assert.equal(tamperedOutcome, "invalid_candidate_signature", "the tampered candidate must be rejected");

  const validOutcome = await saveOneRerankResult(adminClient, "checkpoint-2e-test-model", candidate.candidateId, VALID_RESPONSE);
  assert.equal(validOutcome, "saved", "the valid candidate, processed right after the failing one, must still save normally");

  const match = await matchExists(jobId);
  assert.ok(match, "the valid candidate's match must exist despite the preceding tampered candidate");
});
