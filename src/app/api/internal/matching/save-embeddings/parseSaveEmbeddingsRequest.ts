// Pure request-body validation for POST /api/internal/matching/save-embeddings.
// Same convention as src/app/api/checkout/parseCheckoutRequest.ts.

const MAX_ITEMS = 200;
// Generous bounds covering every common embedding model's dimensionality
// (e.g. OpenAI text-embedding-3-small=1536, -large=3072) without hardcoding
// one model — the provider choice is made by whatever calls this endpoint,
// not by this app (Phase 05 architecture decision).
const MIN_DIMENSIONS = 1;
const MAX_DIMENSIONS = 4096;

export interface JobEmbeddingToSave {
  jobId: string;
  embedding: number[];
  contentHash: string;
}

export interface ProfileEmbeddingToSave {
  cvAnalysisId: string;
  embedding: number[];
  contentHash: string;
}

export interface SaveEmbeddingsRequestBody {
  jobs: JobEmbeddingToSave[];
  profiles: ProfileEmbeddingToSave[];
}

export type ParseSaveEmbeddingsRequestResult =
  | { ok: true; value: SaveEmbeddingsRequestBody }
  | { ok: false; error: string };

function isValidEmbedding(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= MIN_DIMENSIONS &&
    value.length <= MAX_DIMENSIONS &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseSaveEmbeddingsRequestBody(body: unknown): ParseSaveEmbeddingsRequestResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const record = body as Record<string, unknown>;

  if (!Array.isArray(record.jobs) || !Array.isArray(record.profiles)) {
    return { ok: false, error: "jobs and profiles must both be arrays" };
  }
  if (record.jobs.length > MAX_ITEMS || record.profiles.length > MAX_ITEMS) {
    return { ok: false, error: `jobs and profiles must each have at most ${MAX_ITEMS} items per call` };
  }

  const jobs: JobEmbeddingToSave[] = [];
  for (const [index, item] of record.jobs.entries()) {
    if (typeof item !== "object" || item === null) return { ok: false, error: `jobs[${index}] must be an object` };
    const row = item as Record<string, unknown>;
    if (!isNonEmptyString(row.jobId)) return { ok: false, error: `jobs[${index}].jobId is required` };
    if (!isValidEmbedding(row.embedding)) return { ok: false, error: `jobs[${index}].embedding must be an array of ${MIN_DIMENSIONS}-${MAX_DIMENSIONS} finite numbers` };
    if (!isNonEmptyString(row.contentHash)) return { ok: false, error: `jobs[${index}].contentHash is required` };
    jobs.push({ jobId: row.jobId, embedding: row.embedding, contentHash: row.contentHash });
  }

  const profiles: ProfileEmbeddingToSave[] = [];
  for (const [index, item] of record.profiles.entries()) {
    if (typeof item !== "object" || item === null) return { ok: false, error: `profiles[${index}] must be an object` };
    const row = item as Record<string, unknown>;
    if (!isNonEmptyString(row.cvAnalysisId)) return { ok: false, error: `profiles[${index}].cvAnalysisId is required` };
    if (!isValidEmbedding(row.embedding)) return { ok: false, error: `profiles[${index}].embedding must be an array of ${MIN_DIMENSIONS}-${MAX_DIMENSIONS} finite numbers` };
    if (!isNonEmptyString(row.contentHash)) return { ok: false, error: `profiles[${index}].contentHash is required` };
    profiles.push({ cvAnalysisId: row.cvAnalysisId, embedding: row.embedding, contentHash: row.contentHash });
  }

  return { ok: true, value: { jobs, profiles } };
}
