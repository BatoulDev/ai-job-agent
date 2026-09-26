// Pure request-body validation for POST /api/internal/matching/prepare-rerank.
// Same convention as src/app/api/checkout/parseCheckoutRequest.ts.

const MAX_LIMIT = 200;

export interface PrepareRerankRequestBody {
  userLimit: number;
  jobsPerUser: number;
  candidatePoolSize: number;
}

export type ParsePrepareRerankRequestResult = { ok: true; value: PrepareRerankRequestBody } | { ok: false; error: string };

function isBoundedPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT;
}

export function parsePrepareRerankRequestBody(body: unknown): ParsePrepareRerankRequestResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const record = body as Record<string, unknown>;

  if (!isBoundedPositiveInt(record.userLimit)) {
    return { ok: false, error: `userLimit must be an integer between 1 and ${MAX_LIMIT}` };
  }
  if (!isBoundedPositiveInt(record.jobsPerUser)) {
    return { ok: false, error: `jobsPerUser must be an integer between 1 and ${MAX_LIMIT}` };
  }
  if (!isBoundedPositiveInt(record.candidatePoolSize)) {
    return { ok: false, error: `candidatePoolSize must be an integer between 1 and ${MAX_LIMIT}` };
  }

  return { ok: true, value: { userLimit: record.userLimit, jobsPerUser: record.jobsPerUser, candidatePoolSize: record.candidatePoolSize } };
}
