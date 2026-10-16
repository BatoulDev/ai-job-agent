// DB-touching persistence layer for LinkedIn data-slayer enrichment — the
// counterpart to ingestSourceBatch.ts for a different kind of operation:
// an UPDATE pass over LinkedIn jobs Bebity has already discovered and
// persisted, never an insert/upsert of newly-discovered ones. Everything
// deterministic/pure (validation, normalization, resolution, the
// bounded-retry rule) lives in linkedinEnrichment.ts; this module only
// adds the database I/O.
//
// Two-pass design, not inline-during-discovery: Bebity discovery and
// persistence (mapLinkedInJob -> runMultiCompanyIngestionBatch ->
// persistValidatedJobs) are completely unchanged by this feature. This
// module runs as an independent follow-up pass, keyed by the same stable
// LinkedIn job id (jobs.external_id, dedup_scope='type:linkedin') that
// discovery already established. Chosen over merging data-slayer's
// response into the initial raw job object before first persistence
// because: (1) it requires zero changes to the existing, already-tested
// discovery/persistence path; (2) the bounded-retry/attempt-tracking
// model in linkedinEnrichment.ts is inherently a two-pass operation
// regardless of which orchestration layer drives it (a future caller
// must still ask "which already-persisted jobs are still eligible"
// before spending on enrichment); (3) it does not require inventing how
// an not-yet-built Bebity n8n branch would need to look.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifyAttemptOutcome,
  isEligibleForEnrichment,
  MAX_ENRICHMENT_ATTEMPTS,
  resolveEmploymentType,
  resolveWorkArrangement,
  validateEnrichmentResponseItem,
  type EnrichmentRejectReason,
  type LinkedInEnrichmentBatchItem,
} from "./linkedinEnrichment.ts";
import type { EmploymentType } from "./rawProviderJob.ts";
import type { WorkArrangement } from "./normalizeLocation.ts";

export type { LinkedInEnrichmentBatchItem };

export interface LinkedInEnrichmentBatchResult {
  jobsRequested: number;
  /** Job id not found under source_type='linkedin' for this batch, or already ineligible when re-checked server-side. */
  jobsSkippedNotEligible: number;
  jobsUpdated: number;
  /** Validation rejected the response (missing/mismatched id, or unidentifiable) — never counted as an attempt, never contaminates the row. */
  jobsValidationFailed: number;
  /** rawItem was null — an actor/network/provider failure for this job, never counted as an attempt. */
  jobsProviderFailure: number;
  identityMismatchCount: number;
  structuredWaPresentCount: number;
  structuredWaEmptyCount: number;
  classifierFallbackUsedCount: number;
  finalWaUnresolvedCount: number;
  employmentTypeFilledCount: number;
  employmentTypeConflictCount: number;
  schemaDriftWarnings: string[];
}

function emptyResult(jobsRequested: number): LinkedInEnrichmentBatchResult {
  return {
    jobsRequested,
    jobsSkippedNotEligible: 0,
    jobsUpdated: 0,
    jobsValidationFailed: 0,
    jobsProviderFailure: 0,
    identityMismatchCount: 0,
    structuredWaPresentCount: 0,
    structuredWaEmptyCount: 0,
    classifierFallbackUsedCount: 0,
    finalWaUnresolvedCount: 0,
    employmentTypeFilledCount: 0,
    employmentTypeConflictCount: 0,
    schemaDriftWarnings: [],
  };
}

interface ExistingJobRow {
  id: string;
  external_id: string;
  title: string | null;
  description: string | null;
  employment_type: string | null;
  work_arrangement: string | null;
  linkedin_enrichment_attempts: number;
}

/**
 * Applies a batch of data-slayer enrichment results to already-persisted
 * LinkedIn jobs. Only ever reads/writes source_type='linkedin' rows,
 * scoped additionally to dedup_scope='type:linkedin' (LinkedIn's real
 * identity scope — see 20260915170000_add_jobs_source_specific_dedup_key.sql).
 * Re-checks eligibility server-side for every item against the row's
 * live state — never trusts the caller's own prior queue selection — so
 * a job already resolved or already at the attempt cap is silently
 * skipped, never re-spent or double-counted.
 *
 * Caller responsibility (e.g. a future internal API route): verify the
 * LinkedIn provider is enabled and request bounds are respected before
 * invoking this — mirrors the ingestSourceBatch.ts split between pure
 * persistValidatedJobs and its gated callers.
 */
export async function applyLinkedInEnrichmentBatch(
  supabase: SupabaseClient,
  items: readonly LinkedInEnrichmentBatchItem[],
  fetchedAt: string = new Date().toISOString()
): Promise<LinkedInEnrichmentBatchResult> {
  const result = emptyResult(items.length);
  if (items.length === 0) return result;

  const externalIds = items.map((item) => item.requestedJobId);
  const { data: rows, error } = await supabase
    .from("jobs")
    .select("id, external_id, title, description, employment_type, work_arrangement, linkedin_enrichment_attempts")
    .eq("source_type", "linkedin")
    .eq("dedup_scope", "type:linkedin")
    .in("external_id", externalIds);
  if (error) {
    throw new Error(`applyLinkedInEnrichmentBatch: failed to read existing jobs: ${error.message}`);
  }

  const byExternalId = new Map<string, ExistingJobRow>((rows ?? []).map((row) => [row.external_id as string, row as ExistingJobRow]));

  for (const item of items) {
    const row = byExternalId.get(item.requestedJobId);
    if (!row) {
      // Not something this batch can act on (job not yet persisted under
      // this identity, or not a LinkedIn row) — not an error for the
      // batch as a whole.
      result.jobsSkippedNotEligible += 1;
      continue;
    }

    const currentWorkArrangement = row.work_arrangement as WorkArrangement | null;
    const currentAttempts = row.linkedin_enrichment_attempts;

    if (!isEligibleForEnrichment(currentWorkArrangement, currentAttempts)) {
      result.jobsSkippedNotEligible += 1;
      continue;
    }

    if (item.rawItem === null) {
      result.jobsProviderFailure += 1;
      continue;
    }

    const validation = validateEnrichmentResponseItem(item.requestedJobId, item.rawItem, fetchedAt);
    if (!validation.ok) {
      result.jobsValidationFailed += 1;
      if ((validation.reason as EnrichmentRejectReason) === "id_mismatch") result.identityMismatchCount += 1;
      continue; // never contaminate this row with a mismatched/malformed response
    }

    if (validation.workplaceTypesMalformed) {
      result.schemaDriftWarnings.push(`job ${item.requestedJobId}: workplace_types was present but not a valid string array`);
    }

    const waResult = resolveWorkArrangement({
      structuredWorkplaceTypes: validation.result.structuredWorkplaceTypes,
      title: row.title,
      description: row.description,
    });
    if (waResult.warning) result.schemaDriftWarnings.push(`job ${item.requestedJobId}: ${waResult.warning}`);
    if (waResult.origin === "data_slayer_structured") result.structuredWaPresentCount += 1;
    else result.structuredWaEmptyCount += 1;
    if (waResult.origin === "classifier") result.classifierFallbackUsedCount += 1;
    if (waResult.workArrangement === null) result.finalWaUnresolvedCount += 1;

    const empResult = resolveEmploymentType(row.employment_type as EmploymentType | null, validation.result.employmentStatusRaw);
    if (row.employment_type === null && empResult.employmentType !== null) result.employmentTypeFilledCount += 1;
    if (empResult.conflict) result.employmentTypeConflictCount += 1;

    const attemptOutcome = classifyAttemptOutcome(validation);
    const update: { work_arrangement: string | null; employment_type: string | null; linkedin_enrichment_attempts?: number; linkedin_enrichment_last_attempt_at?: string } = {
      work_arrangement: waResult.workArrangement,
      employment_type: empResult.employmentType,
    };
    if (attemptOutcome === "counted") {
      update.linkedin_enrichment_attempts = Math.min(currentAttempts + 1, MAX_ENRICHMENT_ATTEMPTS);
      update.linkedin_enrichment_last_attempt_at = fetchedAt;
    }

    const { error: updateError } = await supabase.from("jobs").update(update).eq("id", row.id);
    if (updateError) {
      throw new Error(`applyLinkedInEnrichmentBatch: failed to update job ${item.requestedJobId}: ${updateError.message}`);
    }
    result.jobsUpdated += 1;
  }

  return result;
}
