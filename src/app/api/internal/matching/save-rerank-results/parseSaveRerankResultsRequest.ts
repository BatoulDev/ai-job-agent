// Pure request-body validation for POST /api/internal/matching/save-rerank-results.
// Same convention as src/app/api/checkout/parseCheckoutRequest.ts. Does NOT
// validate the *shape* of each result's LLM response — that is
// parseRerankResponse()'s job (src/lib/matching/rerankResponse.ts), run once
// per item by the route itself; this module only validates the envelope.

const MAX_ITEMS = 200;
const MAX_MODEL_NAME_LENGTH = 200;

export interface RerankResultToSave {
  candidateId: string;
  response: unknown;
}

export interface SaveRerankResultsRequestBody {
  matchingModel: string;
  results: RerankResultToSave[];
}

export type ParseSaveRerankResultsRequestResult = { ok: true; value: SaveRerankResultsRequestBody } | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseSaveRerankResultsRequestBody(body: unknown): ParseSaveRerankResultsRequestResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const record = body as Record<string, unknown>;

  if (!isNonEmptyString(record.matchingModel) || record.matchingModel.length > MAX_MODEL_NAME_LENGTH) {
    return { ok: false, error: `matchingModel must be a non-empty string of at most ${MAX_MODEL_NAME_LENGTH} characters` };
  }
  if (!Array.isArray(record.results)) {
    return { ok: false, error: "results must be an array" };
  }
  if (record.results.length > MAX_ITEMS) {
    return { ok: false, error: `results must have at most ${MAX_ITEMS} items per call` };
  }

  const results: RerankResultToSave[] = [];
  for (const [index, item] of record.results.entries()) {
    if (typeof item !== "object" || item === null) return { ok: false, error: `results[${index}] must be an object` };
    const row = item as Record<string, unknown>;
    if (!isNonEmptyString(row.candidateId)) return { ok: false, error: `results[${index}].candidateId is required` };
    if (!("response" in row)) return { ok: false, error: `results[${index}].response is required` };
    results.push({ candidateId: row.candidateId, response: row.response });
  }

  return { ok: true, value: { matchingModel: record.matchingModel, results } };
}
