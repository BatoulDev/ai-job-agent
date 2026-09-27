// Pure request-body validation for POST
// /api/internal/ingestion/run-multi-company-batch (Phase 13) — the
// multi-company-feed counterpart to
// run-batch/parseIngestionBatchRequest.ts. Same validation discipline,
// deliberately NOT sharing a body shape with that file: there is no
// sourceId for a multi-company feed (see rawProviderJob.ts's
// JobSourceContext), so this is a distinct, smaller contract rather than
// an optional field bolted onto the existing one.
import { getProviderAdapter } from "../../../../../lib/ingestion/providers/index.ts";
import { getProviderConfig } from "../../../../../lib/ingestion/providerConfig.ts";
import type { JobSourceType } from "../../../../../lib/ingestion/rawProviderJob.ts";

const MULTI_COMPANY_SOURCE_TYPES: readonly JobSourceType[] = ["remoteok", "jobicy", "arbeitnow", "jsearch", "adzuna", "bayt", "gulftalent"];

const MAX_RAW_JOBS = 2000;
const MAX_JOBS_PER_SOURCE_CAP = 500;

export interface MultiCompanyIngestionBatchRequestBody {
  sourceType: JobSourceType;
  rawJobs: unknown[];
  maxJobsPerSource: number;
  dryRun: boolean;
}

export type ParseMultiCompanyIngestionBatchRequestResult =
  | { ok: true; value: MultiCompanyIngestionBatchRequestBody }
  | { ok: false; error: string };

function isMultiCompanySourceType(value: unknown): value is JobSourceType {
  return typeof value === "string" && (MULTI_COMPANY_SOURCE_TYPES as readonly string[]).includes(value);
}

export function parseMultiCompanyIngestionBatchRequestBody(body: unknown): ParseMultiCompanyIngestionBatchRequestResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const record = body as Record<string, unknown>;

  if (!isMultiCompanySourceType(record.sourceType)) {
    return { ok: false, error: "sourceType must be one of: " + MULTI_COMPANY_SOURCE_TYPES.join(", ") };
  }
  if (!getProviderAdapter(record.sourceType)) {
    return { ok: false, error: `No provider adapter registered for sourceType "${record.sourceType}"` };
  }
  // Config-level authorization is checked again live inside
  // runMultiCompanyIngestionBatch itself (never trust a cached decision —
  // same discipline as company_sources re-verification), but rejecting a
  // disabled provider here too means a caller gets an honest 400 instead
  // of a 200 "succeeded" response reporting provider_not_enabled.
  if (!getProviderConfig(record.sourceType)?.enabled) {
    return { ok: false, error: `Provider "${record.sourceType}" is not currently enabled` };
  }

  if (!Array.isArray(record.rawJobs)) {
    return { ok: false, error: "rawJobs must be an array" };
  }
  if (record.rawJobs.length > MAX_RAW_JOBS) {
    return { ok: false, error: `rawJobs exceeds the maximum of ${MAX_RAW_JOBS} per call` };
  }

  if (
    typeof record.maxJobsPerSource !== "number" ||
    !Number.isInteger(record.maxJobsPerSource) ||
    record.maxJobsPerSource < 1 ||
    record.maxJobsPerSource > MAX_JOBS_PER_SOURCE_CAP
  ) {
    return { ok: false, error: `maxJobsPerSource must be an integer between 1 and ${MAX_JOBS_PER_SOURCE_CAP}` };
  }

  if (typeof record.dryRun !== "boolean") {
    return { ok: false, error: "dryRun must be a boolean" };
  }

  return {
    ok: true,
    value: {
      sourceType: record.sourceType,
      rawJobs: record.rawJobs,
      maxJobsPerSource: record.maxJobsPerSource,
      dryRun: record.dryRun,
    },
  };
}
