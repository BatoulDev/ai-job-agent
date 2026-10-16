// LinkedIn exact-ID enrichment via the Apify actor
// `data-slayer/linkedin-job-scraper` — a follow-up pass over LinkedIn jobs
// Bebity has already discovered and persisted (see providers/linkedin.ts
// and applyLinkedInEnrichmentBatch.ts), never a discovery source itself.
// Its real, fetched input schema has exactly two fields —
// `job_ids_or_urls` and `include_hiring_team` — no keyword, location,
// date, company, or job-type filter of any kind, so it structurally
// cannot discover jobs; it can only answer "tell me everything about
// this exact job ID."
//
// Role, confirmed by manual validation across two pilots (25 real Lebanon
// jobs): a non-empty structured `workplace_types` value is high-precision
// (7/7 correct in the most recent batch) — trusted as authoritative when
// present. An empty/unresolved result is NOT reliable evidence that the
// job has no real work arrangement: manual review of the 3 "UNKNOWN"
// results in that same batch found 2 were real false negatives (the
// job's LinkedIn page visibly showed Remote/On-site). This module's
// bounded-retry design (see isEligibleForEnrichment/MAX_ENRICHMENT_ATTEMPTS
// below) exists specifically because of that finding — a single empty
// result must never be treated as permanent ground truth.
//
// `is_remote_allowed` is deliberately never read by this module at all —
// the MCI validation case (workplace_types: [] + is_remote_allowed: false
// on a job that is genuinely Remote) proved it is unsafe as a proxy for
// "onsite" in either direction.
//
// Only the few fields this product actually uses are modeled here
// (AGENTS.md §16/§34 — do not grow the schema/contract beyond a real
// consuming need). Manual validation showed salary (0/10), required_skills
// (0/10), benefits (sparse), and applicant/view counts (weak) are not
// worth persisting or propagating from this actor.

import { classifyWorkArrangementFromText } from "./classifyWorkArrangementFromText.ts";
import type { WorkArrangement } from "./normalizeLocation.ts";
import type { EmploymentType } from "./rawProviderJob.ts";

// ---------------------------------------------------------------------
// Narrow response contract
// ---------------------------------------------------------------------

/** Narrow, validated result of one data-slayer exact-ID enrichment call for one job. */
export interface LinkedInJobEnrichmentResult {
  requestedJobId: string;
  returnedJobId: string;
  /** Already confirmed to be an array of strings (possibly empty) by validateEnrichmentResponseItem. */
  structuredWorkplaceTypes: readonly string[];
  /** Raw employment_status string, or null if absent/not a string. */
  employmentStatusRaw: string | null;
  fetchedAt: string;
}

export type EnrichmentRejectReason = "missing_job_posting_id" | "id_mismatch" | "malformed_response";

export type EnrichmentValidationResult =
  | { ok: true; result: LinkedInJobEnrichmentResult; workplaceTypesMalformed: boolean }
  | { ok: false; reason: EnrichmentRejectReason };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates one raw data-slayer dataset item against the exact job ID we
 * requested. Never trusts the raw shape (AGENTS.md §30 — structured
 * external output must be validated before use). Unknown extra fields on
 * the raw object are silently ignored — only the few fields this module
 * reads are checked. A mismatched or unidentifiable response is rejected
 * outright so it can never be attached to the wrong job.
 */
export function validateEnrichmentResponseItem(requestedJobId: string, raw: unknown, fetchedAt: string): EnrichmentValidationResult {
  if (!isPlainObject(raw)) return { ok: false, reason: "malformed_response" };

  const returnedIdRaw = raw.job_posting_id;
  if (typeof returnedIdRaw !== "string" && typeof returnedIdRaw !== "number") {
    return { ok: false, reason: "missing_job_posting_id" };
  }
  const returnedJobId = String(returnedIdRaw);
  if (returnedJobId !== requestedJobId) {
    return { ok: false, reason: "id_mismatch" };
  }

  const rawWorkplaceTypes = raw.workplace_types;
  let workplaceTypesMalformed = false;
  let structuredWorkplaceTypes: string[];
  if (Array.isArray(rawWorkplaceTypes) && rawWorkplaceTypes.every((v) => typeof v === "string")) {
    structuredWorkplaceTypes = rawWorkplaceTypes;
  } else if (rawWorkplaceTypes === undefined || rawWorkplaceTypes === null) {
    // A response that simply omits the field is not meaningfully
    // different from one that includes it empty.
    structuredWorkplaceTypes = [];
  } else {
    // Present but not a recognizable array of strings — schema drift, not
    // a crash. This is still a real, identified response for this exact
    // job (job_posting_id matched above), so it is not rejected outright.
    structuredWorkplaceTypes = [];
    workplaceTypesMalformed = true;
  }

  const rawEmploymentStatus = raw.employment_status;
  const employmentStatusRaw = typeof rawEmploymentStatus === "string" ? rawEmploymentStatus : null;

  return {
    ok: true,
    workplaceTypesMalformed,
    result: { requestedJobId, returnedJobId, structuredWorkplaceTypes, employmentStatusRaw, fetchedAt },
  };
}

// ---------------------------------------------------------------------
// Structured work-arrangement normalization
// ---------------------------------------------------------------------

export type StructuredWorkArrangementOutcome =
  | { status: "resolved"; value: WorkArrangement }
  | { status: "unresolved" }
  | { status: "unresolved_multiple_values"; warning: string }
  | { status: "unresolved_unknown_value"; warning: string };

const WORKPLACE_TYPE_MAP: Record<string, WorkArrangement> = {
  ONSITE: "onsite",
  HYBRID: "hybrid",
  REMOTE: "remote",
};

/**
 * Exact, defensive normalization of data-slayer's structured
 * workplace_types array. Never fuzzy-maps an unrecognized string, never
 * guesses between multiple values when more than one unexpectedly
 * appears — both log a warning and resolve as unresolved rather than
 * picking a plausible answer (AGENTS.md §30).
 */
export function resolveStructuredWorkArrangement(workplaceTypes: readonly string[]): StructuredWorkArrangementOutcome {
  if (workplaceTypes.length === 0) return { status: "unresolved" };

  if (workplaceTypes.length > 1) {
    return {
      status: "unresolved_multiple_values",
      warning: `data-slayer returned ${workplaceTypes.length} workplace_types values (${workplaceTypes.join(", ")}) — never guessed between them`,
    };
  }

  const only = workplaceTypes[0];
  const mapped = WORKPLACE_TYPE_MAP[only];
  if (!mapped) {
    return { status: "unresolved_unknown_value", warning: `data-slayer returned an unrecognized workplace_types value: "${only}"` };
  }
  return { status: "resolved", value: mapped };
}

// ---------------------------------------------------------------------
// Work-arrangement resolution pipeline: structured -> classifier -> null
// ---------------------------------------------------------------------

export interface ResolveWorkArrangementInput {
  structuredWorkplaceTypes: readonly string[];
  title: string | null | undefined;
  description: string | null | undefined;
}

export type WorkArrangementOrigin = "data_slayer_structured" | "classifier" | "unresolved";

export interface ResolveWorkArrangementResult {
  workArrangement: WorkArrangement | null;
  origin: WorkArrangementOrigin;
  warning: string | null;
}

/**
 * QUALITY-FIRST resolution (deliberate product decision — see
 * docs/LEBANON_LIVE_SOURCE_EXPANSION.md's architecture-decision record):
 * data-slayer's structured value is checked first and wins whenever
 * present; classifyWorkArrangementFromText is consulted only when
 * data-slayer has nothing usable; null is persisted only when neither
 * source can determine an arrangement. Classifier internals are never
 * modified here or anywhere in this module.
 */
export function resolveWorkArrangement(input: ResolveWorkArrangementInput): ResolveWorkArrangementResult {
  const structured = resolveStructuredWorkArrangement(input.structuredWorkplaceTypes);

  if (structured.status === "resolved") {
    return { workArrangement: structured.value, origin: "data_slayer_structured", warning: null };
  }

  const warning = structured.status === "unresolved" ? null : structured.warning;

  const classification = classifyWorkArrangementFromText({ title: input.title, description: input.description });
  if (classification.workArrangement) {
    return { workArrangement: classification.workArrangement, origin: "classifier", warning };
  }

  return { workArrangement: null, origin: "unresolved", warning };
}

// ---------------------------------------------------------------------
// Employment-type resolution: Bebity authoritative, data-slayer gap-fill
// ---------------------------------------------------------------------

const EMPLOYMENT_STATUS_MAP: Record<string, EmploymentType> = {
  "Full-time": "full-time",
  "Part-time": "part-time",
  Contract: "contract",
  Internship: "internship",
};

export interface EmploymentTypeConflict {
  bebity: EmploymentType;
  dataSlayer: EmploymentType;
}

export interface ResolveEmploymentTypeResult {
  employmentType: EmploymentType | null;
  conflict: EmploymentTypeConflict | null;
}

/**
 * Bebity remains authoritative whenever it already mapped a value.
 * data-slayer's employment_status only fills a genuine gap (Bebity
 * null). A real disagreement is surfaced as `conflict` for logging —
 * Bebity's value is still what gets persisted; the job is never
 * quarantined and matching continues normally on the retained value.
 */
export function resolveEmploymentType(bebityEmploymentType: EmploymentType | null, employmentStatusRaw: string | null): ResolveEmploymentTypeResult {
  const dataSlayerMapped = employmentStatusRaw ? EMPLOYMENT_STATUS_MAP[employmentStatusRaw] ?? null : null;

  if (bebityEmploymentType) {
    if (dataSlayerMapped && dataSlayerMapped !== bebityEmploymentType) {
      return { employmentType: bebityEmploymentType, conflict: { bebity: bebityEmploymentType, dataSlayer: dataSlayerMapped } };
    }
    return { employmentType: bebityEmploymentType, conflict: null };
  }

  return { employmentType: dataSlayerMapped, conflict: null };
}

// ---------------------------------------------------------------------
// Bounded retry / idempotency model
// ---------------------------------------------------------------------

/** jobs.linkedin_enrichment_attempts is capped here and by the column's own DB check constraint. */
export const MAX_ENRICHMENT_ATTEMPTS = 2;

/**
 * Server-side queue-eligibility rule, re-checked on every batch (never
 * trusts a caller's own prior selection). A job with any resolved work
 * arrangement is excluded regardless of attempt count; an unresolved job
 * is eligible only while under the attempt cap.
 */
export function isEligibleForEnrichment(workArrangement: WorkArrangement | null, attempts: number): boolean {
  return workArrangement === null && attempts < MAX_ENRICHMENT_ATTEMPTS;
}

export type EnrichmentAttemptOutcome = "counted" | "not_counted";

/**
 * Whether a given validation outcome should increment
 * jobs.linkedin_enrichment_attempts. A structurally-identified response
 * for this exact job counts, even when its work arrangement ended up
 * unresolved or its workplace_types field was malformed — a real,
 * identified (and billed) answer was obtained for this job. An ID
 * mismatch or an unidentifiable/malformed response never counts — we
 * cannot confirm a valid attempt was actually made for this specific job
 * — and neither does any provider/actor/network failure (represented by
 * the caller never invoking this with a real item at all; see
 * applyLinkedInEnrichmentBatch.ts's provider-failure branch).
 */
export function classifyAttemptOutcome(validation: EnrichmentValidationResult): EnrichmentAttemptOutcome {
  return validation.ok ? "counted" : "not_counted";
}

// ---------------------------------------------------------------------
// Cost safety (Phase 11) — ready for a future live orchestrator to call;
// not exercised against a real Apify call anywhere in this codebase yet.
// ---------------------------------------------------------------------

/** Documented, observed real price at time of implementation ($0.004/job, confirmed across two pilots). */
export const DATA_SLAYER_OBSERVED_PRICE_PER_JOB_USD = 0.004;
/** Hard ceiling with a small, explicit margin above the observed price — never a large slack multiplier. */
export const DATA_SLAYER_MAX_ACCEPTABLE_PRICE_PER_JOB_USD = 0.005;

export type PriceCheckResult = { ok: true } | { ok: false; reason: "price_above_threshold"; observedPriceUsd: number; maxAcceptablePriceUsd: number };

/**
 * A future live orchestrator must call this with the actor's real,
 * freshly-fetched per-job price (from a free Apify metadata call) before
 * any paid batch — never assume the price is still what was last
 * observed. Aborts (falls back to classifier-only) rather than silently
 * paying more, matching this project's existing bebity cost-incident
 * lesson (AGENTS.md §35).
 */
export function checkDataSlayerPrice(observedPriceUsd: number, maxAcceptablePriceUsd: number = DATA_SLAYER_MAX_ACCEPTABLE_PRICE_PER_JOB_USD): PriceCheckResult {
  if (observedPriceUsd > maxAcceptablePriceUsd) {
    return { ok: false, reason: "price_above_threshold", observedPriceUsd, maxAcceptablePriceUsd };
  }
  return { ok: true };
}

/** No slack multiplier — the hard financial backstop for one batch run's maxTotalChargeUsd. */
export function computeMaxTotalChargeUsd(batchSize: number, maxAcceptablePriceUsd: number = DATA_SLAYER_MAX_ACCEPTABLE_PRICE_PER_JOB_USD): number {
  return Math.round(batchSize * maxAcceptablePriceUsd * 1_000_000) / 1_000_000;
}

/** Prefer bounded batches over sending hundreds of IDs in one actor run (Phase 12). */
export const ENRICHMENT_BATCH_SIZE = 25;

// ---------------------------------------------------------------------
// Orchestration reconciliation — matches a requested-ID list against the
// actor's raw dataset by VALUE (job_posting_id), never by array position.
// This is what makes "partial response" and "missing item" handling safe
// by construction: an item is only ever applied to the job whose id it
// actually claims, so a differently-ordered or short (partial-yield)
// dataset can never be misaligned onto the wrong row. Pure — no network,
// no DB access. The orchestration layer (an internal API route) is the
// only caller.
// ---------------------------------------------------------------------

export interface LinkedInEnrichmentBatchItem {
  /** The LinkedIn job id (jobs.external_id for dedup_scope='type:linkedin') enrichment was requested for. */
  requestedJobId: string;
  /** The raw data-slayer dataset item matched to this id by job_posting_id, or null when no item in the dataset claims this id (actor failure for this job, or a genuinely partial/short dataset). */
  rawItem: unknown | null;
}

function extractRawJobPostingId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const id = (raw as Record<string, unknown>).job_posting_id;
  if (typeof id === "string") return id;
  if (typeof id === "number") return String(id);
  return null;
}

/**
 * Reconciles a requested batch of LinkedIn job ids against the actor's
 * raw dataset response. An item in the dataset whose job_posting_id does
 * not match any requested id is simply never used (defends against a
 * genuinely unidentifiable or unsolicited row — never force-attached to
 * the wrong job). A requested id with no matching item in the dataset
 * (actor failure for that one job, or a short/partial-yield dataset)
 * gets `rawItem: null`, which applyLinkedInEnrichmentBatch's own Case D
 * handling already treats as "never counts as an attempt, remains
 * retryable" — no separate handling needed here.
 */
export function buildEnrichmentItemsFromDataset(requestedJobIds: readonly string[], rawDatasetItems: readonly unknown[]): LinkedInEnrichmentBatchItem[] {
  const byId = new Map<string, unknown>();
  for (const raw of rawDatasetItems) {
    const id = extractRawJobPostingId(raw);
    if (id === null) continue; // unusable for matching — safely ignored, not a crash
    if (!byId.has(id)) byId.set(id, raw); // first occurrence wins on an unexpected duplicate id
  }

  return requestedJobIds.map((requestedJobId) => ({
    requestedJobId,
    rawItem: byId.get(requestedJobId) ?? null,
  }));
}
