// Pure request-body validation for POST /api/internal/cover-letters/save-generation.
// Same convention as .../matching/save-rerank-results/parseSaveRerankResultsRequest.ts.
// Does NOT validate the *content* of a response — that's parseCoverLetterResponse's
// job, run once per item by the route itself; this module only validates the
// envelope. There is no explicit "failed" item shape: same retry story as
// Phase 06's rerank — a failed generation attempt simply isn't reported here
// at all (the n8n workflow's error branch just logs and moves on), so the
// match is naturally re-offered as a candidate on the next run.

const MAX_ITEMS = 200;
const MAX_MODEL_NAME_LENGTH = 200;

export interface GenerationResultToSave {
  matchId: string;
  response: unknown;
}

export interface SaveGenerationRequestBody {
  modelProvider: string;
  modelVersion: string;
  results: GenerationResultToSave[];
}

export type ParseSaveGenerationRequestResult = { ok: true; value: SaveGenerationRequestBody } | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseSaveGenerationRequestBody(body: unknown): ParseSaveGenerationRequestResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const record = body as Record<string, unknown>;

  if (!isNonEmptyString(record.modelProvider) || record.modelProvider.length > MAX_MODEL_NAME_LENGTH) {
    return { ok: false, error: `modelProvider must be a non-empty string of at most ${MAX_MODEL_NAME_LENGTH} characters` };
  }
  if (!isNonEmptyString(record.modelVersion) || record.modelVersion.length > MAX_MODEL_NAME_LENGTH) {
    return { ok: false, error: `modelVersion must be a non-empty string of at most ${MAX_MODEL_NAME_LENGTH} characters` };
  }
  if (!Array.isArray(record.results)) {
    return { ok: false, error: "results must be an array" };
  }
  if (record.results.length > MAX_ITEMS) {
    return { ok: false, error: `results must have at most ${MAX_ITEMS} items per call` };
  }

  const results: GenerationResultToSave[] = [];
  for (const [index, item] of record.results.entries()) {
    if (typeof item !== "object" || item === null) return { ok: false, error: `results[${index}] must be an object` };
    const row = item as Record<string, unknown>;
    if (!isNonEmptyString(row.matchId)) return { ok: false, error: `results[${index}].matchId is required` };
    if (!("response" in row)) return { ok: false, error: `results[${index}].response is required` };
    results.push({ matchId: row.matchId, response: row.response });
  }

  return { ok: true, value: { modelProvider: record.modelProvider, modelVersion: record.modelVersion, results } };
}
