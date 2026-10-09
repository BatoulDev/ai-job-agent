// DB-touching ingestion orchestration. Everything deterministic/pure lives
// in rawProviderJob.ts; this module only adds the database I/O: re-
// verifying authorization live (never trusting a caller-supplied "this is
// fine"), bounded idempotent upsert, and scoped stale-close. Mirrors the
// proven design in docs/job-ingestion-pilot.md (§3 provenance re-check, §5a
// dedup_scope upsert, §6 stale-close safety) as a reusable TypeScript
// module instead of n8n Code-node logic. See docs/OVERNIGHT_BUILD_PROGRESS.md
// Phase 03.
//
// Two entry points, one shared persistence core (persistValidatedJobs):
//   - runIngestionBatch: one company_sources row per call (Tier A/B —
//     Greenhouse/Lever/Workable/Ashby/career-page extraction). Authorized
//     by re-checking company_sources.review_status live.
//   - runMultiCompanyIngestionBatch (Phase 13): one multi-company feed
//     provider per call (RemoteOK/Jobicy/Arbeitnow/...), where each raw job
//     carries its own company name — there is no single company_sources row
//     to attach the batch to. Authorized by providerConfig.ts's own
//     enabled flag instead, the provider-level equivalent trust gate. See
//     rawProviderJob.ts's JobSourceContext/RawProviderJob.companyName for
//     how one contract supports both shapes without provider-specific
//     matching/persistence logic (AGENTS.md §16/§26).
//
// Scope: one source (or one provider), one call. Looping over many
// sources, per-source rate limiting, and retry/backoff on transient fetch
// failures belong to the n8n orchestrator (or a future scheduled worker) —
// this module assumes rawJobs was already fetched successfully by the
// caller.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validateRawProviderJob,
  mapRawProviderJobToJobRow,
  type RawProviderJob,
  type JobSourceType,
  type JobUpsertRow,
} from "./rawProviderJob.ts";
import { validateMultiCompanyProviderJob } from "./multiCompanyProviderJob.ts";
import { isProviderEnabled, getProviderConfig } from "./providerConfig.ts";

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

/**
 * Server-side authoritative ceiling (the "Layer B" fix for the 2026-10-02
 * false-truncation bug): a caller's requested maxJobsPerSource can only ever
 * be lowered here, never raised. providerConfig.ts's maxJobsPerRun is the
 * single reviewed, git-tracked cost/load ceiling per provider (see that
 * file's header) — trusting a caller-supplied number alone as the real cap
 * would let a misconfigured or compromised orchestrator exceed it
 * (AGENTS.md §26/27). A sourceType with no providerConfig entry (currently
 * only career_page) falls back to the caller's requested value, itself
 * already bounded by the parser's own hard MAX_JOBS_PER_SOURCE_CAP.
 */
function clampToProviderCeiling(sourceType: JobSourceType, requestedMaxJobsPerSource: number): number {
  const providerMax = getProviderConfig(sourceType)?.maxJobsPerRun;
  return providerMax === undefined ? requestedMaxJobsPerSource : Math.min(requestedMaxJobsPerSource, providerMax);
}

export type IngestionBatchOutcome =
  | "succeeded"
  | "source_not_found"
  | "source_not_approved"
  | "no_valid_jobs"
  | "provider_not_enabled";

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
 * Which rows this batch's idempotent-upsert and stale-close queries are
 * scoped to — company-specific sources scope by source_id (unchanged since
 * Phase 03); multi-company feeds (Phase 13) have no source_id, so they
 * scope by source_type instead, with source_id explicitly IS NULL so a
 * RemoteOK batch, say, never touches admin_manual/career_page/linkedin
 * rows that also have a null source_id but a different source_type.
 *
 * refreshScope (Phase 22 fix) is a second, independent scoping dimension
 * for multi-company feeds only: source_type/dedup_scope answers "is this
 * the same provider/job" (identity, unchanged); refreshScope answers "did
 * this call see the complete universe this job belongs to" (stale-close
 * safety). A provider queried through one undivided call per run (RemoteOK,
 * Jobicy, Arbeitnow, Bayt, Indeed today) passes refreshScope: null, which
 * reproduces the exact pre-fix behavior (scope = source_type alone). A
 * provider queried through multiple independently-complete market
 * partitions (GulfTalent: SA, then AE/Dubai) passes a distinct refreshScope
 * per partition, so one partition's complete refresh can never stale-close
 * another partition's jobs that happen to share one source_type — the
 * real bug confirmed in the 2026-10-01 paid pilot (GulfTalent AE's run
 * wrongly closed GulfTalent SA's jobs). See
 * 20261002090000_add_jobs_refresh_scope.sql for why this needed a column
 * rather than reusing an existing one (job-content columns like
 * country_code aren't a reliable, deterministic stand-in for which query
 * fetched a job).
 */
type PersistScope =
  | { sourceId: string; sourceType?: never; refreshScope?: never }
  | { sourceId: null; sourceType: JobSourceType; refreshScope: string | null };

/**
 * Identity scope (source_id | source_type) only — matches dedup_scope
 * exactly, deliberately WITHOUT refresh_scope. Used for the existing-rows
 * lookup (first_seen_at preservation, created-vs-updated accounting): a
 * job's identity is whether it's the same (dedup_scope, external_id), not
 * which refresh partition most recently touched it — a job that moves from
 * one partition to another (e.g. GulfTalent relists the same jobId under a
 * different market search) is still the same row being updated, never a
 * new one. Mirrors ON CONFLICT (dedup_scope, external_id)'s own semantics.
 */
function identityScopeQuery<T extends { eq: (...args: [string, unknown]) => T; is: (...args: [string, unknown]) => T }>(
  query: T,
  scope: PersistScope
): T {
  return scope.sourceId !== null ? query.eq("source_id", scope.sourceId) : query.is("source_id", null).eq("source_type", scope.sourceType);
}

/**
 * Refresh scope (source_id | source_type[+refreshScope]) — identity scope
 * plus an additional refresh_scope filter for multi-company feeds. Used
 * only for the active-rows-for-stale-close query: "did this run see the
 * complete universe this job belongs to" is answered per refresh
 * partition, not per provider-wide identity (see PersistScope's comment).
 */
function refreshScopeQuery<T extends { eq: (...args: [string, unknown]) => T; is: (...args: [string, unknown]) => T }>(
  query: T,
  scope: PersistScope
): T {
  const byIdentity = identityScopeQuery(query, scope);
  if (scope.sourceId !== null) {
    return byIdentity;
  }
  return scope.refreshScope === null ? byIdentity.is("refresh_scope", null) : byIdentity.eq("refresh_scope", scope.refreshScope);
}

/**
 * Shared idempotent-upsert + bounded stale-close logic, used by both
 * runIngestionBatch (company-specific) and runMultiCompanyIngestionBatch
 * (Phase 13, multi-company feeds) — the two differ only in how a batch is
 * authorized and where each job's company_name comes from (see each
 * function's own verification step above its call to this one). Extracted
 * here so dedup/idempotency/stale-close behavior can never drift between
 * the two paths.
 */
async function persistValidatedJobs(
  supabase: SupabaseClient,
  rawJobsCount: number,
  validated: JobUpsertRow[],
  jobsRejected: number,
  options: IngestionBatchOptions,
  scope: PersistScope
): Promise<IngestionBatchResult> {
  if (validated.length === 0) {
    return emptyResult("no_valid_jobs", rawJobsCount, jobsRejected);
  }

  // Defensive: a provider's own raw response can genuinely contain
  // duplicate entries for the same job — confirmed live in Phase 14
  // (Salla's real Workable feed lists one job twice, identical shortcode/
  // title/department). A single upsert() call cannot apply "ON CONFLICT
  // DO UPDATE" twice to the same (dedup_scope, external_id) row in one
  // statement — Postgres rejects the whole batch with "ON CONFLICT DO
  // UPDATE command cannot affect row a second time". De-duplicate by
  // external_id before bounding/upserting (last occurrence wins —
  // arbitrary but deterministic; observed duplicates are identical
  // anyway) so a provider's own data quirk can never take down an entire
  // otherwise-valid batch.
  const deduped = Array.from(new Map(validated.map((row) => [row.external_id, row])).values());

  const truncated = deduped.length > options.maxJobsPerSource;
  const bounded = truncated ? deduped.slice(0, options.maxJobsPerSource) : deduped;

  if (options.dryRun) {
    return {
      outcome: "succeeded",
      jobsFetched: rawJobsCount,
      jobsValid: validated.length,
      jobsRejected,
      jobsCreated: 0,
      jobsUpdated: 0,
      jobsClosed: 0,
      truncated,
    };
  }

  const externalIds = bounded.map((row) => row.external_id);
  const existingQuery = supabase.from("jobs").select("external_id, first_seen_at").in("external_id", externalIds);
  const { data: existingRows, error: existingError } = await identityScopeQuery(existingQuery, scope);
  if (existingError) {
    throw new Error(`ingestion: failed to read existing jobs: ${existingError.message}`);
  }
  const existingExternalIds = new Set((existingRows ?? []).map((row) => row.external_id));
  // Reuse the row's own prior first_seen_at on update, rather than a DB column
  // default — a default would apply to every insert into jobs (admin_manual,
  // test fixtures, ...), not just ingestion, incorrectly widening this fix's
  // scope (confirmed by tests/db/jobs-freshness-and-lifecycle.test.mjs's
  // existing "no freshness timestamps by default" contract for non-ingestion
  // inserts). Falls back to null here only if the existing row's own
  // first_seen_at was itself never set (pre-fix data); never fabricated.
  const existingFirstSeenAt = new Map((existingRows ?? []).map((row) => [row.external_id, row.first_seen_at]));

  // Stamp freshness metadata at upsert time rather than in mapRawProviderJobToJobRow
  // (which stays a pure, clock-free mapping function). last_seen_at/last_checked_at/
  // last_successful_check_at mean "this run confirmed the job still exists" (see
  // 20260914120000_add_jobs_freshness_and_geography.sql's column comments) — true
  // for every row reaching this point, created or updated. status_reason is
  // explicitly cleared so a job that was previously stale-closed and has now
  // reappeared doesn't keep displaying its old close reason once reopened.
  const now = new Date().toISOString();
  const stamped = bounded.map((row) => ({
    ...row,
    first_seen_at: existingFirstSeenAt.get(row.external_id) ?? now,
    last_seen_at: now,
    last_checked_at: now,
    last_successful_check_at: now,
    status_reason: null,
    // Only multi-company rows ever carry a refresh_scope — company-specific
    // sources are already fully scoped by source_id and never set this
    // column, leaving it null exactly as it was before this column existed.
    ...(scope.sourceId === null ? { refresh_scope: scope.refreshScope } : {}),
  }));

  const { error: upsertError } = await supabase.from("jobs").upsert(stamped, { onConflict: "dedup_scope,external_id" });
  if (upsertError) {
    throw new Error(`ingestion: upsert failed: ${upsertError.message}`);
  }

  const jobsCreated = bounded.filter((row) => !existingExternalIds.has(row.external_id)).length;
  const jobsUpdated = bounded.length - jobsCreated;

  let jobsClosed = 0;
  if (!truncated) {
    const seenExternalIds = new Set(bounded.map((row) => row.external_id));
    const activeQuery = supabase.from("jobs").select("id, external_id").eq("status", "active");
    const { data: activeRows, error: activeError } = await refreshScopeQuery(activeQuery, scope);
    if (activeError) {
      throw new Error(`ingestion: failed to read active jobs for stale-close: ${activeError.message}`);
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
        throw new Error(`ingestion: failed to close stale jobs: ${closeError.message}`);
      }
      jobsClosed = staleIds.length;
    }
  }

  return {
    outcome: "succeeded",
    jobsFetched: rawJobsCount,
    jobsValid: validated.length,
    jobsRejected,
    jobsCreated,
    jobsUpdated,
    jobsClosed,
    truncated,
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

  const effectiveOptions = { ...options, maxJobsPerSource: clampToProviderCeiling(sourceType, options.maxJobsPerSource) };
  return persistValidatedJobs(supabase, rawJobs.length, validated, jobsRejected, effectiveOptions, { sourceId });
}

/**
 * Phase 13: the multi-company-feed counterpart to runIngestionBatch above.
 * Each raw job carries its own companyName (validateMultiCompanyProviderJob
 * requires it); there is no company_sources row to verify per job, so
 * authorization is the provider-level `enabled` flag in providerConfig.ts —
 * re-checked live every call, same "never trust a cached approval"
 * discipline runIngestionBatch already applies to company_sources.
 * source_id is always null on every row this writes, so dedup_scope falls
 * back to 'type:'||source_type (see 20260915170000's generated column) —
 * every job from one provider shares one dedup identity, correctly
 * isolated from every other source_type by scopeQuery above.
 *
 * refreshScope (Phase 22 fix, defaults to null): pass this when the caller's
 * rawJobs are only one of several independently-complete query partitions
 * for this source_type (e.g. GulfTalent queried once per market) — see
 * PersistScope's comment above for why this is a separate dimension from
 * dedup identity. Omit it (or pass null) for a provider queried as one
 * undivided call per run, which reproduces the exact pre-fix stale-close
 * behavior.
 */
export async function runMultiCompanyIngestionBatch(
  supabase: SupabaseClient,
  sourceType: JobSourceType,
  rawJobs: readonly RawProviderJob[],
  options: IngestionBatchOptions,
  refreshScope: string | null = null
): Promise<IngestionBatchResult> {
  if (!isProviderEnabled(sourceType)) {
    return emptyResult("provider_not_enabled", rawJobs.length, rawJobs.length);
  }

  const validated: JobUpsertRow[] = [];
  let jobsRejected = 0;
  for (const raw of rawJobs) {
    const result = validateMultiCompanyProviderJob(raw, sourceType);
    if (!result.valid) {
      jobsRejected += 1;
      continue;
    }
    validated.push(mapRawProviderJobToJobRow(raw, { sourceId: null, sourceType }));
  }

  const effectiveOptions = { ...options, maxJobsPerSource: clampToProviderCeiling(sourceType, options.maxJobsPerSource) };
  return persistValidatedJobs(supabase, rawJobs.length, validated, jobsRejected, effectiveOptions, { sourceId: null, sourceType, refreshScope });
}
