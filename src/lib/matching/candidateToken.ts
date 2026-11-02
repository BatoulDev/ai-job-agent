// Checkpoint 2E: versioned, HMAC-signed candidate tokens — replaces the
// plain "cvAnalysisId:jobId" string that previously let anything holding
// the shared MATCHING_WORKER_SECRET submit an arbitrary (analysis, job)
// pairing to save-rerank-results, whether or not prepare-rerank ever
// offered it. Deliberately a SEPARATE secret (MATCHING_CANDIDATE_TOKEN_SECRET)
// from MATCHING_WORKER_SECRET: the bearer secret travels over the wire to
// n8n and lives in n8n's own credential store; the signing key never does
// — it is used only inside this server process (sign in prepare-rerank,
// verify in save-rerank-results). Reusing the bearer secret as the signing
// key would let n8n (or anything holding that one shared credential) also
// mint arbitrary "valid" tokens, defeating the point.
//
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(that
// exact encoded string, secret)). The signature is verified against the
// RECEIVED encoded bytes directly — the payload is only ever JSON.parse'd
// AFTER the signature passes, never re-serialized-then-compared, which
// would be fragile to any key-order/whitespace difference.
//
// Stateless by design: proves this (cvAnalysisId, jobId, runId) triple was
// genuinely issued by a real prepare-rerank call, recently, and untampered.
// It does NOT prove the pairing is still eligible right now (that's
// revalidateJobEligibility.ts's job) and does NOT prevent replay of a
// still-valid token within its own lifetime (no server-side consumption
// ledger exists) — see this module's own callers for how those are
// handled. Both limitations are accepted, documented, and unchanged by
// this implementation, not solved here.

import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = 1;

// 90 minutes. Calculated, not arbitrary: the real n8n workflow
// (n8n-workflows/ai-job-agent-02-job-matching.ts) processes up to
// userLimit(20)*jobsPerUser(10)=200 candidates strictly sequentially
// (splitInBatches batchSize:1). A candidate that eventually succeeds
// through its own retries can take up to ~190s (OpenAI chat: maxTries 3,
// 60s timeout, 5s between) + ~66s (save: maxTries 2, 30s timeout, 3s
// between) + the fixed 1s rate-limit delay ≈ 257s (~4.3min) worst case for
// ONE candidate. A full 200-candidate run at a realistic ~10-15s/candidate
// average is ~35-50 minutes; a handful of candidates near the end each
// hitting their full retry budget plausibly pushes a real worst-case run
// to ~50-60 minutes. 90 minutes is a safety margin over that measured
// estimate — it is NOT a proof that every theoretically possible 200-
// candidate, every-candidate-maximally-retried run (which could exceed
// several hours) will always complete within it. An unusually long run
// CAN still have its last few tokens expire before being saved — see
// below for how that is surfaced, not silently hidden.
//
// Expiry during an unusually long run surfaces exactly the same way every
// other per-candidate rejection already does today: save-rerank-results
// returns a per-call JSON body with a `candidate_token_expired` count,
// visible in that HTTP node's own execution output in the n8n UI. No new
// alert/notification is added here — this is the existing, already-
// accepted visibility mechanism (the same one invalid_candidate_id/
// not_matching_eligible already relied on before this checkpoint),
// extended to one more outcome, not a new one invented.
export const CANDIDATE_TOKEN_TTL_SECONDS = 90 * 60;

// Tolerance for `iat` appearing slightly in the future — sign and verify
// both happen on this same server process, so clock skew should be ~zero
// in practice; this only guards against sub-second rounding, never used
// to paper over a real distributed-clock problem.
const CLOCK_SKEW_TOLERANCE_SECONDS = 5;

export interface CandidateTokenPayload {
  cvAnalysisId: string;
  jobId: string;
  /** One id shared by every candidate token issued from the same prepare-rerank call — the "issuance context" the token binds to. */
  runId: string;
}

export interface DecodedCandidateToken extends CandidateTokenPayload {
  issuedAt: number;
  expiresAt: number;
}

export type VerifyCandidateTokenResult =
  | { ok: true; value: DecodedCandidateToken }
  | {
      ok: false;
      reason: "missing_secret" | "invalid_format" | "invalid_signature" | "expired" | "future_issued" | "unsupported_version";
    };

interface RawTokenPayload {
  v: number;
  a: string;
  j: string;
  r: string;
  iat: number;
  exp: number;
}

// Checkpoint 2E audit fix: cvAnalysisId/jobId both come from
// gen_random_uuid()-defaulted uuid primary keys (public.cv_analyses.id,
// public.jobs.id — 20260804090010_create_cv_analyses.sql,
// 20260809090030_create_jobs.sql); runId comes from node:crypto's
// randomUUID() (findRerankCandidates, rerankCandidates.ts). All three are
// always real UUIDs in this system — never free-form identifiers — so
// requiring that shape here is a real constraint, not a guess. Accepts
// any RFC 4122 version/variant (not locked to v4 specifically), since the
// requirement is "well-formed UUID", not "exactly how it's generated
// today".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function isRawTokenPayload(value: unknown): value is RawTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.v === "number" &&
    typeof record.a === "string" &&
    isUuid(record.a) &&
    typeof record.j === "string" &&
    isUuid(record.j) &&
    typeof record.r === "string" &&
    isUuid(record.r) &&
    typeof record.iat === "number" &&
    typeof record.exp === "number"
  );
}

// Checkpoint 2E audit fix: a real token is ~250-300 chars (three 36-char
// UUIDs + v/iat/exp numbers as JSON, base64url-encoded, plus a
// base64url-encoded HMAC-SHA256 signature ~43 chars). 1024 is generous
// headroom over that real shape, not an arbitrary round number — checked
// first, before any split/decode/parse/crypto work runs on the input.
export const MAX_CANDIDATE_TOKEN_LENGTH = 1024;

function getSigningSecret(): string | null {
  const secret = process.env.MATCHING_CANDIDATE_TOKEN_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

function hmacFor(payloadSegment: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payloadSegment, "utf8").digest();
}

/** Throws if the signing secret is not configured, or if any identifier is not a well-formed UUID — fail closed, never issue a token for a caller bug. */
export function signCandidateToken(payload: CandidateTokenPayload, now: Date = new Date()): string {
  const secret = getSigningSecret();
  if (!secret) {
    throw new Error("signCandidateToken: MATCHING_CANDIDATE_TOKEN_SECRET is not configured");
  }
  if (!isUuid(payload.cvAnalysisId) || !isUuid(payload.jobId) || !isUuid(payload.runId)) {
    throw new Error("signCandidateToken: cvAnalysisId, jobId, and runId must all be well-formed UUIDs");
  }

  const issuedAt = Math.floor(now.getTime() / 1000);
  const body: RawTokenPayload = {
    v: TOKEN_VERSION,
    a: payload.cvAnalysisId,
    j: payload.jobId,
    r: payload.runId,
    iat: issuedAt,
    exp: issuedAt + CANDIDATE_TOKEN_TTL_SECONDS,
  };
  const payloadSegment = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const signatureSegment = hmacFor(payloadSegment, secret).toString("base64url");
  return `${payloadSegment}.${signatureSegment}`;
}

/** Never throws. Missing secret, oversized/malformed/tampered/expired/future-issued/unsupported-version tokens all fail closed with a distinct reason. */
export function verifyCandidateToken(token: string, now: Date = new Date()): VerifyCandidateTokenResult {
  // Checkpoint 2E audit fix: checked first, before any split/decode/parse/
  // crypto work — an oversized input is rejected on a cheap length check
  // alone, never processed further.
  if (token.length > MAX_CANDIDATE_TOKEN_LENGTH) {
    return { ok: false, reason: "invalid_format" };
  }

  const secret = getSigningSecret();
  if (!secret) return { ok: false, reason: "missing_secret" };

  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "invalid_format" };
  }
  const [payloadSegment, signatureSegment] = parts;

  const expected = hmacFor(payloadSegment, secret);
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureSegment, "base64url");
  } catch {
    return { ok: false, reason: "invalid_format" };
  }
  // Length check before timingSafeEqual: that function throws on mismatched
  // buffer lengths rather than returning false, and checking length first
  // never leaks more than "lengths differ" (not a meaningful timing
  // side-channel for this purpose) — same defensive order internalAuth.ts
  // already uses for the bearer secret.
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: "invalid_signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_format" };
  }
  if (!isRawTokenPayload(parsed)) {
    return { ok: false, reason: "invalid_format" };
  }
  if (parsed.v !== TOKEN_VERSION) {
    return { ok: false, reason: "unsupported_version" };
  }

  // Checkpoint 2E audit fix: signCandidateToken always computes
  // exp = iat + CANDIDATE_TOKEN_TTL_SECONDS itself — exp is never a
  // caller-supplied value. Re-deriving and comparing it here, rather than
  // trusting the payload's own exp field at face value, means even a
  // signature produced by someone holding the real secret cannot mint a
  // token with an artificially stretched lifetime; only a payload that
  // actually went through signCandidateToken's own arithmetic can pass.
  if (parsed.exp !== parsed.iat + CANDIDATE_TOKEN_TTL_SECONDS) {
    return { ok: false, reason: "invalid_format" };
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (parsed.iat > nowSeconds + CLOCK_SKEW_TOLERANCE_SECONDS) {
    return { ok: false, reason: "future_issued" };
  }
  if (parsed.exp < nowSeconds) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    value: { cvAnalysisId: parsed.a, jobId: parsed.j, runId: parsed.r, issuedAt: parsed.iat, expiresAt: parsed.exp },
  };
}
