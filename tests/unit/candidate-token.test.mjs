// Checkpoint 2E — pure, offline tests for src/lib/matching/candidateToken.ts.
// No DB, no network. Controls process.env.MATCHING_CANDIDATE_TOKEN_SECRET
// directly (restored in an after() hook) rather than relying on whatever
// .env.local happens to have, so every case here is deterministic
// regardless of local environment setup.
//
// Run: node --test tests/unit/candidate-token.test.mjs

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import {
  signCandidateToken,
  verifyCandidateToken,
  CANDIDATE_TOKEN_TTL_SECONDS,
  MAX_CANDIDATE_TOKEN_LENGTH,
} from "../../src/lib/matching/candidateToken.ts";

const ORIGINAL_SECRET = process.env.MATCHING_CANDIDATE_TOKEN_SECRET;
const TEST_SECRET = "test-only-candidate-token-secret-do-not-use-in-production";

before(() => {
  process.env.MATCHING_CANDIDATE_TOKEN_SECRET = TEST_SECRET;
});

after(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.MATCHING_CANDIDATE_TOKEN_SECRET;
  } else {
    process.env.MATCHING_CANDIDATE_TOKEN_SECRET = ORIGINAL_SECRET;
  }
});

// Real-shaped UUIDs, matching what cv_analyses.id/jobs.id/randomUUID()
// actually produce in this system — not placeholder strings.
const CV_ANALYSIS_ID = randomUUID();
const JOB_ID = randomUUID();
const RUN_ID = randomUUID();
const PAYLOAD = { cvAnalysisId: CV_ANALYSIS_ID, jobId: JOB_ID, runId: RUN_ID };

function reSign(payloadSegment) {
  return createHmac("sha256", TEST_SECRET).update(payloadSegment, "utf8").digest().toString("base64url");
}

describe("signCandidateToken / verifyCandidateToken", () => {
  test("a freshly-signed token verifies and round-trips every field", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const token = signCandidateToken(PAYLOAD, now);
    const result = verifyCandidateToken(token, now);
    assert.equal(result.ok, true);
    assert.equal(result.value.cvAnalysisId, CV_ANALYSIS_ID);
    assert.equal(result.value.jobId, JOB_ID);
    assert.equal(result.value.runId, RUN_ID);
    assert.equal(result.value.expiresAt - result.value.issuedAt, CANDIDATE_TOKEN_TTL_SECONDS);
  });

  test("tampering with the payload segment invalidates the signature", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const token = signCandidateToken(PAYLOAD, now);
    const [payloadSegment, signatureSegment] = token.split(".");
    // Flip the job id inside the payload without re-signing — simulates
    // an attacker trying to redirect a valid token at a different job.
    const decoded = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
    const tamperedPayload = Buffer.from(JSON.stringify({ ...decoded, j: randomUUID() }), "utf8").toString("base64url");
    const tamperedToken = `${tamperedPayload}.${signatureSegment}`;

    const result = verifyCandidateToken(tamperedToken, now);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_signature");
  });

  test("tampering with the signature segment alone invalidates it", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const token = signCandidateToken(PAYLOAD, now);
    const [payloadSegment, signatureSegment] = token.split(".");
    const flippedChar = signatureSegment[0] === "A" ? "B" : "A";
    const tamperedToken = `${payloadSegment}.${flippedChar}${signatureSegment.slice(1)}`;

    const result = verifyCandidateToken(tamperedToken, now);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_signature");
  });

  test("malformed token (no separator) is rejected as invalid_format", () => {
    const result = verifyCandidateToken("not-a-real-token-at-all");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_format");
  });

  test("legacy unsigned candidateId format ('analysisId:jobId') is rejected, never accepted as a compatibility fallback", () => {
    const result = verifyCandidateToken(`${CV_ANALYSIS_ID}:${JOB_ID}`);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_format");
  });

  test("an expired token is rejected", () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const token = signCandidateToken(PAYLOAD, issuedAt);
    const checkAt = new Date(issuedAt.getTime() + (CANDIDATE_TOKEN_TTL_SECONDS + 1) * 1000);

    const result = verifyCandidateToken(token, checkAt);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "expired");
  });

  test("a token issued noticeably in the future is rejected", () => {
    const issuedAt = new Date("2026-01-01T01:00:00.000Z");
    const token = signCandidateToken(PAYLOAD, issuedAt);
    const checkAt = new Date(issuedAt.getTime() - 60_000); // verifying 1 minute "before" it was issued

    const result = verifyCandidateToken(token, checkAt);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "future_issued");
  });

  test("valid sequential-run duration: a token checked just before its 90-minute TTL expires still verifies", () => {
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");
    const token = signCandidateToken(PAYLOAD, issuedAt);
    // 85 of the 90 minutes elapsed — representative of a candidate near
    // the end of a real, long-but-not-pathological sequential n8n run.
    const checkAt = new Date(issuedAt.getTime() + 85 * 60 * 1000);

    const result = verifyCandidateToken(token, checkAt);
    assert.equal(result.ok, true);
  });

  test("an unsupported token version is rejected", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const token = signCandidateToken(PAYLOAD, now);
    const [payloadSegment] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
    const futureVersionPayload = Buffer.from(JSON.stringify({ ...decoded, v: 99 }), "utf8").toString("base64url");
    // Re-sign over the tampered payload so this specifically isolates the
    // version check, not the signature check.
    const sig = reSign(futureVersionPayload);

    const result = verifyCandidateToken(`${futureVersionPayload}.${sig}`, now);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "unsupported_version");
  });

  test("missing signing secret fails closed for both sign and verify", () => {
    const savedSecret = process.env.MATCHING_CANDIDATE_TOKEN_SECRET;
    delete process.env.MATCHING_CANDIDATE_TOKEN_SECRET;
    try {
      assert.throws(() => signCandidateToken(PAYLOAD));
      const result = verifyCandidateToken("anything.at-all");
      assert.equal(result.ok, false);
      assert.equal(result.reason, "missing_secret");
    } finally {
      process.env.MATCHING_CANDIDATE_TOKEN_SECRET = savedSecret;
    }
  });

  test("two tokens for the same payload signed at different times never produce the same string (iat differs)", () => {
    const tokenA = signCandidateToken(PAYLOAD, new Date("2026-01-01T00:00:00.000Z"));
    const tokenB = signCandidateToken(PAYLOAD, new Date("2026-01-01T00:00:01.000Z"));
    assert.notEqual(tokenA, tokenB);
  });
});

// Checkpoint 2E audit-remediation: new cases for the specific findings fixed.
describe("candidateToken — audit-remediation fixes", () => {
  test("signCandidateToken rejects a non-UUID cvAnalysisId/jobId/runId", () => {
    assert.throws(() => signCandidateToken({ cvAnalysisId: "not-a-uuid", jobId: JOB_ID, runId: RUN_ID }));
    assert.throws(() => signCandidateToken({ cvAnalysisId: CV_ANALYSIS_ID, jobId: "not-a-uuid", runId: RUN_ID }));
    assert.throws(() => signCandidateToken({ cvAnalysisId: CV_ANALYSIS_ID, jobId: JOB_ID, runId: "not-a-uuid" }));
  });

  test("verifyCandidateToken rejects a validly-signed payload whose identifiers are not UUID-shaped", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const issuedAt = Math.floor(now.getTime() / 1000);
    const body = { v: 1, a: "not-a-uuid", j: JOB_ID, r: RUN_ID, iat: issuedAt, exp: issuedAt + CANDIDATE_TOKEN_TTL_SECONDS };
    const payloadSegment = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
    const token = `${payloadSegment}.${reSign(payloadSegment)}`;

    const result = verifyCandidateToken(token, now);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_format");
  });

  test("a token longer than MAX_CANDIDATE_TOKEN_LENGTH is rejected before any decoding", () => {
    const oversized = "a".repeat(MAX_CANDIDATE_TOKEN_LENGTH + 1) + ".sig";
    const result = verifyCandidateToken(oversized);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_format");
  });

  test("a real, validly-signed token is always well under the maximum length", () => {
    const token = signCandidateToken(PAYLOAD);
    assert.ok(token.length <= MAX_CANDIDATE_TOKEN_LENGTH, `expected a real token (${token.length} chars) to fit within the max (${MAX_CANDIDATE_TOKEN_LENGTH})`);
  });

  test("expiry-invariant violation: a validly-signed payload with exp stretched beyond iat+TTL is rejected, even though the signature itself verifies", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const issuedAt = Math.floor(now.getTime() / 1000);
    // A payload that could only exist if someone with the secret hand-
    // crafted it — signCandidateToken itself never produces this shape.
    const body = { v: 1, a: CV_ANALYSIS_ID, j: JOB_ID, r: RUN_ID, iat: issuedAt, exp: issuedAt + CANDIDATE_TOKEN_TTL_SECONDS * 100 };
    const payloadSegment = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
    const token = `${payloadSegment}.${reSign(payloadSegment)}`;

    const result = verifyCandidateToken(token, now);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_format");
  });

  test("a genuinely-issued token's own exp always equals iat + CANDIDATE_TOKEN_TTL_SECONDS (the invariant holds for real tokens)", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const token = signCandidateToken(PAYLOAD, now);
    const result = verifyCandidateToken(token, now);
    assert.equal(result.ok, true);
    assert.equal(result.value.expiresAt, result.value.issuedAt + CANDIDATE_TOKEN_TTL_SECONDS);
  });
});
