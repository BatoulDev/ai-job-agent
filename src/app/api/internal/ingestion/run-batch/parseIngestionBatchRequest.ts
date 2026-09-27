// Pure request-body validation for POST /api/internal/ingestion/run-batch —
// same convention as src/app/api/checkout/parseCheckoutRequest.ts: no
// Next.js request context, so it is directly unit-testable. This endpoint
// is called only by a trusted n8n orchestrator (never a browser), but its
// body is still untrusted input at a real network boundary (AGENTS.md §2)
// and is validated exactly as strictly as a client-facing one.
//
// Relative, extensioned imports (not the "@/" alias) — same reasoning as
// every src/lib/ingestion/*.ts module: this file is imported directly by
// `node --test` (no Next.js bundler in that path) to unit-test it, and
// plain Node's ESM resolver does not understand the "@/" tsconfig alias.
import { getProviderAdapter } from "../../../../../lib/ingestion/providers/index.ts";
import type { JobSourceType } from "../../../../../lib/ingestion/rawProviderJob.ts";

// Only the company-specific ATS types this endpoint accepts a sourceId for
// — never admin_manual/career_page/linkedin, which have no automated fetch
// path here (AGENTS.md §7: LinkedIn is never scraped or auto-applied
// through; career_page goes through extractCareerPageJobPostings.ts, not a
// PROVIDER_ADAPTERS entry). Multi-company feeds (remoteok/jobicy/
// arbeitnow/jsearch/adzuna/bayt/gulftalent) are never accepted here either
// — they have no company_sources row to key a sourceId off; see
// run-multi-company-batch/route.ts (Phase 13).
const AUTOMATABLE_SOURCE_TYPES: readonly JobSourceType[] = ["greenhouse", "lever", "workable", "ashby"];

// Defense in depth against a misconfigured or compromised caller sending an
// unbounded payload (AGENTS.md §27) — well above any real ATS board size
// seen during the pilot (67-227 jobs/source).
const MAX_RAW_JOBS = 2000;
const MAX_JOBS_PER_SOURCE_CAP = 500;

export interface IngestionBatchRequestBody {
  sourceId: string;
  sourceType: JobSourceType;
  rawJobs: unknown[];
  maxJobsPerSource: number;
  dryRun: boolean;
}

export type ParseIngestionBatchRequestResult =
  | { ok: true; value: IngestionBatchRequestBody }
  | { ok: false; error: string };

function isSourceType(value: unknown): value is JobSourceType {
  return typeof value === "string" && (AUTOMATABLE_SOURCE_TYPES as readonly string[]).includes(value);
}

export function parseIngestionBatchRequestBody(body: unknown): ParseIngestionBatchRequestResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const record = body as Record<string, unknown>;

  if (typeof record.sourceId !== "string" || !record.sourceId.trim()) {
    return { ok: false, error: "sourceId is required" };
  }

  if (!isSourceType(record.sourceType)) {
    return { ok: false, error: "sourceType must be one of: " + AUTOMATABLE_SOURCE_TYPES.join(", ") };
  }
  if (!getProviderAdapter(record.sourceType)) {
    return { ok: false, error: `No provider adapter registered for sourceType "${record.sourceType}"` };
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
      sourceId: record.sourceId,
      sourceType: record.sourceType,
      rawJobs: record.rawJobs,
      maxJobsPerSource: record.maxJobsPerSource,
      dryRun: record.dryRun,
    },
  };
}
