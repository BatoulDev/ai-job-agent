// DB-touching ingestion orchestration for one company_sources row per call.
// Everything deterministic/pure lives in rawProviderJob.ts; this module only
// adds the database I/O: re-verifying source approval live (never trusting a
// caller-supplied "this source is fine"), bounded idempotent upsert, and
// source-scoped stale-close. Mirrors the proven design in
// docs/job-ingestion-pilot.md (§3 provenance re-check, §5a dedup_scope
// upsert, §6 stale-close safety) as a reusable TypeScript module instead of
// n8n Code-node logic, so it is unit/integration-testable and reusable by
// every Phase 04 provider adapter. See docs/OVERNIGHT_BUILD_PROGRESS.md
// Phase 03.
//
// Scope: one source, one call. Looping over many sources, per-source rate
// limiting, and retry/backoff on transient fetch failures belong to the
// Phase 04 n8n orchestrator (or a future scheduled worker) — this module
// assumes rawJobs was already fetched successfully by the caller.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validateRawProviderJob,
  mapRawProviderJobToJobRow,
  type RawProviderJob,
  type JobSourceType,
  type JobUpsertRow,
} from "./rawProviderJob.ts";

export interface SourceProvenance {
  sourceId: string;
  sourceType: JobSourceType;
  companyName: string;
}

export type SourceProvenanceResult =
  | { ok: true; provenance: SourceProvenance }
  | { ok: false; reason: "source_not_found" | "source_not_approved"; reviewStatus?: string };

/**
 * Re-checks company_sources live, every call — a source approved yesterday
 * may have been flagged needs_manual_review since (docs/job-ingestion-pilot.md
 * §3: "the hardcoded source list ... is never trusted as authorization by
 * itself").
 */
export async function verifySourceForIngestion(
  supabase: SupabaseClient,
  sourceId: string,
  sourceType: JobSourceType
): Promise<SourceProvenanceResult> {
  const { data, error } = await supabase
    .from("company_sources")
    .select("company_name, review_status")
    .eq("id", sourceId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, reason: "source_not_found" };
  }
  if (data.review_status !== "verified") {
    return { ok: false, reason: "source_not_approved", reviewStatus: data.review_status };
  }
  return { ok: true, provenance: { sourceId, sourceType, companyName: data.company_name } };
}

export interface IngestionBatchOptions {
  /** Bounded cap on jobs written per call — mirrors docs/job-ingestion-pilot.md's maxJobsPerSource. */
  maxJobsPerSource: number;
  /** When true, validates and reports but never writes to the database. */
  dryRun: boolean;
}

export type IngestionBatchOutcome = "succeeded" | "source_not_found" | "source_not_approved" | "no_valid_jobs";

export interface IngestionBatchResult {
  outcome: IngestionBatchOutcome;
  jobsFetched: number;
  jobsValid: number;
  jobsRejected: number;
  jobsCreated: number;
  jobsUpdated: number;
  /**
   * Jobs previously active for this source that were absent from this run
   * and are now marked unavailable. Always 0 when truncated is true — a
   * partial page must never close jobs that are simply outside this run's
   * cap (docs/job-ingestion-pilot.md §6).
   */
  jobsClosed: number;
  truncated: boolean;
}

function emptyResult(outcome: IngestionBatchOutcome, jobsFetched: number, jobsRejected = 0): IngestionBatchResult {
  return {
    outcome,
    jobsFetched,
    jobsValid: 0,
    jobsRejected,
    jobsCreated: 0,
    jobsUpdated: 0,
    jobsClosed: 0,
    truncated: false,
  };
}

/**
 * Validates, maps, and idempotently persists one source's already-fetched
 * raw jobs. Throws on an unexpected database error (the caller — a future
 * per-source loop — decides how to classify/retry that; this function never
 * silently reports success on a failed write, per AGENTS.md §18/§30).
 */
export async function runIngestionBatch(
  supabase: SupabaseClient,
  sourceId: string,
  sourceType: JobSourceType,
  rawJobs: readonly RawProviderJob[],
  options: IngestionBatchOptions
): Promise<IngestionBatchResult> {
  const provenance = await verifySourceForIngestion(supabase, sourceId, sourceType);
  if (!provenance.ok) {
    return emptyResult(provenance.reason, rawJobs.length, rawJobs.length);
  }

  const validated: JobUpsertRow[] = [];
  let jobsRejected = 0;
  for (const raw of rawJobs) {
    const result = validateRawProviderJob(raw, sourceType);
    if (!result.valid) {
      jobsRejected += 1;
      continue;
    }
    validated.push(mapRawProviderJobToJobRow(raw, { sourceId, sourceType, companyName: provenance.provenance.companyName }));
  }

  if (validated.length === 0) {
    return emptyResult("no_valid_jobs", rawJobs.length, jobsRejected);
  }

  const truncated = validated.length > options.maxJobsPerSource;
  const bounded = truncated ? validated.slice(0, options.maxJobsPerSource) : validated;

  if (options.dryRun) {
    return {
      outcome: "succeeded",
      jobsFetched: rawJobs.length,
      jobsValid: validated.length,
      jobsRejected,
      jobsCreated: 0,
      jobsUpdated: 0,
      jobsClosed: 0,
      truncated,
    };
  }

  const externalIds = bounded.map((row) => row.external_id);
  const { data: existingRows, error: existingError } = await supabase
    .from("jobs")
    .select("external_id")
    .eq("source_id", sourceId)
    .in("external_id", externalIds);
  if (existingError) {
    throw new Error(`ingestion: failed to read existing jobs for source ${sourceId}: ${existingError.message}`);
  }
  const existingExternalIds = new Set((existingRows ?? []).map((row) => row.external_id));

  const { error: upsertError } = await supabase.from("jobs").upsert(bounded, { onConflict: "dedup_scope,external_id" });
  if (upsertError) {
    throw new Error(`ingestion: upsert failed for source ${sourceId}: ${upsertError.message}`);
  }

  const jobsCreated = bounded.filter((row) => !existingExternalIds.has(row.external_id)).length;
  const jobsUpdated = bounded.length - jobsCreated;

  let jobsClosed = 0;
  if (!truncated) {
    const seenExternalIds = new Set(bounded.map((row) => row.external_id));
    const { data: activeRows, error: activeError } = await supabase
      .from("jobs")
      .select("id, external_id")
      .eq("source_id", sourceId)
      .eq("status", "active");
    if (activeError) {
      throw new Error(`ingestion: failed to read active jobs for stale-close on source ${sourceId}: ${activeError.message}`);
    }
    const staleIds = (activeRows ?? [])
      .filter((row) => row.external_id && !seenExternalIds.has(row.external_id))
      .map((row) => row.id);

    if (staleIds.length > 0) {
      const { error: closeError } = await supabase
        .from("jobs")
        .update({ status: "unavailable", status_reason: "not_found_in_latest_ingestion_run" })
        .in("id", staleIds);
      if (closeError) {
        throw new Error(`ingestion: failed to close stale jobs for source ${sourceId}: ${closeError.message}`);
      }
      jobsClosed = staleIds.length;
    }
  }

  return {
    outcome: "succeeded",
    jobsFetched: rawJobs.length,
    jobsValid: validated.length,
    jobsRejected,
    jobsCreated,
    jobsUpdated,
    jobsClosed,
    truncated,
  };
}
