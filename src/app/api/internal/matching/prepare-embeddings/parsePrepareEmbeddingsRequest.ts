// Pure request-body validation for POST /api/internal/matching/prepare-embeddings.
// Same convention as src/app/api/checkout/parseCheckoutRequest.ts — no
// Next.js request context, directly unit-testable.

const MAX_LIMIT = 200;

export interface PrepareEmbeddingsRequestBody {
  jobLimit: number;
  profileLimit: number;
}

export type ParsePrepareEmbeddingsRequestResult =
  | { ok: true; value: PrepareEmbeddingsRequestBody }
  | { ok: false; error: string };

function isBoundedPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT;
}

export function parsePrepareEmbeddingsRequestBody(body: unknown): ParsePrepareEmbeddingsRequestResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const record = body as Record<string, unknown>;

  if (!isBoundedPositiveInt(record.jobLimit)) {
    return { ok: false, error: `jobLimit must be an integer between 1 and ${MAX_LIMIT}` };
  }
  if (!isBoundedPositiveInt(record.profileLimit)) {
    return { ok: false, error: `profileLimit must be an integer between 1 and ${MAX_LIMIT}` };
  }

  return { ok: true, value: { jobLimit: record.jobLimit, profileLimit: record.profileLimit } };
}
