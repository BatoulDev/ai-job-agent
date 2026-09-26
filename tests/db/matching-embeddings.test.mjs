// DB-dependent integration tests for src/lib/matching/{embedJob,embedProfile,shortlist}.ts
// (Phase 05) against the real local Supabase instance. Uses a deterministic
// fake embedding generator (no real embeddings-provider credential exists
// yet — see docs/OVERNIGHT_CREDENTIALS_REQUIRED.md) so the DB orchestration
// (hash-based refresh skipping, eligibility gating, persistence) is fully
// exercised without any external API call.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { adminClient, assertExpectedLocalProject, createTestUser, deleteTestUsers, uploadFakeCv, insertFakeAnalysis, deleteFakeJobs } from "./helpers.mjs";
import { embedJobIfChanged } from "../../src/lib/matching/embedJob.ts";
import { embedProfileIfEligible } from "../../src/lib/matching/embedProfile.ts";
import { shortlistJobsForUser } from "../../src/lib/matching/shortlist.ts";
import { hashEmbeddingText, buildJobEmbeddingText } from "../../src/lib/matching/embeddingText.ts";

const DIMENSIONS = 8;

// Deterministic, content-derived fake vector — never a real embedding, but
// stable and distinguishable across different input texts, which is all
// these orchestration tests need.
function fakeEmbedding(text) {
  const hash = hashEmbeddingText(text);
  const vector = [];
  for (let i = 0; i < DIMENSIONS; i++) {
    vector.push(parseInt(hash.slice(i * 2, i * 2 + 2), 16) / 255);
  }
  return vector;
}

function countingGenerator() {
  let calls = 0;
  const fn = async (text) => {
    calls++;
    return fakeEmbedding(text);
  };
  return { fn, callCount: () => calls };
}

const jobIdsToClean = [];
let user;

before(async () => {
  await assertExpectedLocalProject();
  user = await createTestUser("matching-embed");
});

after(async () => {
  await deleteFakeJobs(jobIdsToClean);
  await deleteTestUsers([user]);
});

async function insertFixtureJob(overrides = {}) {
  const { data, error } = await adminClient
    .from("jobs")
    .insert({
      title: "Fixture Backend Engineer",
      company_name: "Fixture Co",
      description: "A fake job fixture for automated tests only.",
      application_method: "external_link",
      application_url: "https://example.test/apply",
      source_type: "admin_manual",
      status: "active",
      country_code: "LB",
      city: "Beirut",
      work_arrangement: "onsite",
      ...overrides,
    })
    .select()
    .single();
  if (error) throw new Error(`fixture job insert failed: ${error.message}`);
  jobIdsToClean.push(data.id);
  return data;
}

test("embedJobIfChanged: reports job_not_found for a nonexistent job", async () => {
  const generator = countingGenerator();
  const result = await embedJobIfChanged(adminClient, randomUUID(), generator.fn);
  assert.deepEqual(result, { updated: false, reason: "job_not_found" });
  assert.equal(generator.callCount(), 0);
});

test("embedJobIfChanged: embeds a job with no prior embedding, then skips an unchanged re-run", async () => {
  const job = await insertFixtureJob({ title: "Embed Test Job A" });
  const generator = countingGenerator();

  const first = await embedJobIfChanged(adminClient, job.id, generator.fn);
  assert.deepEqual(first, { updated: true, reason: "embedded" });
  assert.equal(generator.callCount(), 1);

  const { data: row } = await adminClient.from("jobs").select("embedding, embedding_content_hash, embedding_generated_at").eq("id", job.id).single();
  assert.equal(row.embedding.length, DIMENSIONS);
  assert.equal(row.embedding_content_hash, hashEmbeddingText(buildJobEmbeddingText({
    title: job.title,
    description: job.description,
    company_name: job.company_name,
    location: job.location,
    work_arrangement: job.work_arrangement,
    seniority: job.seniority,
    employment_type: job.employment_type,
  })));
  assert.notEqual(row.embedding_generated_at, null);

  const second = await embedJobIfChanged(adminClient, job.id, generator.fn);
  assert.deepEqual(second, { updated: false, reason: "unchanged" });
  assert.equal(generator.callCount(), 1, "an unchanged job must never call the embedding generator again");
});

test("embedJobIfChanged: re-embeds after the job's content actually changes", async () => {
  const job = await insertFixtureJob({ title: "Embed Test Job B" });
  const generator = countingGenerator();

  await embedJobIfChanged(adminClient, job.id, generator.fn);
  const { data: before1 } = await adminClient.from("jobs").select("embedding_content_hash").eq("id", job.id).single();

  await adminClient.from("jobs").update({ description: "A materially different description." }).eq("id", job.id);
  const result = await embedJobIfChanged(adminClient, job.id, generator.fn);
  assert.deepEqual(result, { updated: true, reason: "embedded" });
  assert.equal(generator.callCount(), 2);

  const { data: after1 } = await adminClient.from("jobs").select("embedding_content_hash").eq("id", job.id).single();
  assert.notEqual(after1.embedding_content_hash, before1.embedding_content_hash);
});

test("embedProfileIfEligible: refuses a pending (not-yet-approved) analysis", async () => {
  const cv = await uploadFakeCv(user, "matching-embed-pending.pdf");
  const analysis = await insertFakeAnalysis(user, cv.id);
  const generator = countingGenerator();

  const result = await embedProfileIfEligible(adminClient, analysis.id, generator.fn);
  assert.deepEqual(result, { updated: false, reason: "not_matching_eligible" });
  assert.equal(generator.callCount(), 0);
});

test("embedProfileIfEligible: embeds an approved, current analysis and skips an unchanged re-run", async () => {
  const cv = await uploadFakeCv(user, "matching-embed-approved.pdf");
  const analysis = await insertFakeAnalysis(user, cv.id, {
    professional_summary: "Backend engineer with API design experience.",
    skills: ["TypeScript", "PostgreSQL"],
  });
  const { data: approved, error: confirmError } = await user.client.rpc("confirm_cv_analysis", { p_analysis_id: analysis.id });
  assert.equal(confirmError, null);

  const generator = countingGenerator();
  const first = await embedProfileIfEligible(adminClient, approved.id, generator.fn);
  assert.deepEqual(first, { updated: true, reason: "embedded" });
  assert.equal(generator.callCount(), 1);

  const { data: row } = await adminClient.from("cv_analyses").select("profile_embedding, profile_embedding_content_hash").eq("id", approved.id).single();
  assert.equal(row.profile_embedding.length, DIMENSIONS);

  const second = await embedProfileIfEligible(adminClient, approved.id, generator.fn);
  assert.deepEqual(second, { updated: false, reason: "unchanged" });
  assert.equal(generator.callCount(), 1, "an unchanged profile must never call the embedding generator again");
});

test("shortlistJobsForUser: filters by hard eligibility and ranks the rest by similarity", async () => {
  // Hand-crafted, orthogonal-ish vectors set directly (bypassing the
  // hash-based fakeEmbedding helper, which has no real semantic-distance
  // property and is unsuitable for asserting rank order against whatever
  // other fixture jobs/embeddings already exist in the shared local table
  // from earlier tests in this file).
  const profileEmbedding = [1, 0, 0, 0, 0, 0, 0, 0];
  const closeVector = [1, 0, 0, 0, 0, 0, 0, 0]; // identical to profile: similarity 1, unbeatable
  const farVector = [0, 0, 0, 0, 0, 0, 0, 1]; // orthogonal: similarity 0

  // Eligible (Lebanon, onsite) — one close to the profile, one far.
  const closeJob = await insertFixtureJob({ title: "Backend Engineer, TypeScript and PostgreSQL" });
  const farJob = await insertFixtureJob({ title: "Warehouse Logistics Coordinator, forklift certified" });
  // Ineligible under a free-plan user: onsite outside Lebanon, no relocation.
  const ineligibleJob = await insertFixtureJob({ title: "Backend Engineer, TypeScript", country_code: "SA", city: "Riyadh" });

  await adminClient.from("jobs").update({ embedding: closeVector }).eq("id", closeJob.id);
  await adminClient.from("jobs").update({ embedding: farVector }).eq("id", farJob.id);
  await adminClient.from("jobs").update({ embedding: closeVector }).eq("id", ineligibleJob.id);

  const results = await shortlistJobsForUser(
    adminClient,
    profileEmbedding,
    { planCode: "free", jobMarketCoverage: null, internationalSearchEnabled: false, willingToRelocate: null, relocationMarketCountryCodes: [] },
    { candidatePoolSize: 100, shortlistSize: 10 }
  );

  const resultIds = results.map((r) => r.jobId);
  assert.ok(!resultIds.includes(ineligibleJob.id), "an ineligible job must never appear in the shortlist");
  assert.ok(resultIds.includes(closeJob.id));
  assert.ok(resultIds.includes(farJob.id));
  assert.equal(resultIds.indexOf(closeJob.id), 0, "the semantically closest eligible job must rank first");
});

test("shortlistJobsForUser: respects shortlistSize even when more eligible jobs exist", async () => {
  const generator = countingGenerator();
  const jobs = [];
  for (let i = 0; i < 5; i++) {
    const job = await insertFixtureJob({ title: `Shortlist Size Test Job ${i}` });
    await embedJobIfChanged(adminClient, job.id, generator.fn);
    jobs.push(job);
  }

  const profileEmbedding = fakeEmbedding("Shortlist Size Test Job 0");
  const results = await shortlistJobsForUser(
    adminClient,
    profileEmbedding,
    { planCode: "free", jobMarketCoverage: null, internationalSearchEnabled: false, willingToRelocate: null, relocationMarketCountryCodes: [] },
    { candidatePoolSize: 100, shortlistSize: 2 }
  );
  assert.equal(results.length, 2);
});
