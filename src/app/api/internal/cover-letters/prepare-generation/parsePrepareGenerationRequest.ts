// Pure request-body validation for POST /api/internal/cover-letters/prepare-generation.
// Same convention as src/app/api/internal/matching/prepare-rerank/parsePrepareRerankRequest.ts.

const MAX_LIMIT = 200;

export interface PrepareGenerationRequestBody {
  limit: number;
}

export type ParsePrepareGenerationRequestResult = { ok: true; value: PrepareGenerationRequestBody } | { ok: false; error: string };

export function parsePrepareGenerationRequestBody(body: unknown): ParsePrepareGenerationRequestResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const record = body as Record<string, unknown>;

  if (typeof record.limit !== "number" || !Number.isInteger(record.limit) || record.limit < 1 || record.limit > MAX_LIMIT) {
    return { ok: false, error: `limit must be an integer between 1 and ${MAX_LIMIT}` };
  }

  return { ok: true, value: { limit: record.limit } };
}
