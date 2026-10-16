// Pure request-body validation for POST
// /api/internal/ingestion/run-linkedin-enrichment-batch.
//
// Contract: the caller (an orchestrator that already fetched data-slayer's
// raw dataset response for a bounded batch of requested LinkedIn job ids)
// sends BOTH the id list it requested and the actor's raw dataset
// verbatim — reconciliation (matching each requested id against the
// dataset by job_posting_id, handling a partial/short/reordered dataset
// safely) happens entirely server-side via
// linkedinEnrichment.ts's buildEnrichmentItemsFromDataset, never
// duplicated in the orchestrator itself. This keeps 100% of the matching
// logic in one tested place.
import { ENRICHMENT_BATCH_SIZE } from "../../../../../lib/ingestion/linkedinEnrichment.ts";

const MAX_ITEMS = ENRICHMENT_BATCH_SIZE;

export interface LinkedInEnrichmentBatchRequestBody {
  requestedJobIds: string[];
  rawDatasetItems: unknown[];
}

export type ParseLinkedInEnrichmentBatchRequestResult = { ok: true; value: LinkedInEnrichmentBatchRequestBody } | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseLinkedInEnrichmentBatchRequestBody(body: unknown): ParseLinkedInEnrichmentBatchRequestResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }
  const record = body as Record<string, unknown>;

  if (!Array.isArray(record.requestedJobIds)) {
    return { ok: false, error: "requestedJobIds must be an array" };
  }
  if (record.requestedJobIds.length === 0) {
    return { ok: false, error: "requestedJobIds must not be empty" };
  }
  // Bounded batch size (Phase 12) — never send/process hundreds of ids in
  // one call; a caller needing more enriched issues multiple calls.
  if (record.requestedJobIds.length > MAX_ITEMS) {
    return { ok: false, error: `requestedJobIds exceeds the maximum batch size of ${MAX_ITEMS}` };
  }
  if (!record.requestedJobIds.every(isNonEmptyString)) {
    return { ok: false, error: "every requestedJobIds entry must be a non-empty string" };
  }

  if (!Array.isArray(record.rawDatasetItems)) {
    return { ok: false, error: "rawDatasetItems must be an array" };
  }
  // The actor's dataset is expected to contain at most one item per
  // requested id — generously bounded above that to tolerate a
  // misbehaving actor without accepting an unbounded payload.
  if (record.rawDatasetItems.length > MAX_ITEMS * 2) {
    return { ok: false, error: `rawDatasetItems is implausibly larger than the requested batch (max ${MAX_ITEMS * 2})` };
  }

  return {
    ok: true,
    value: { requestedJobIds: record.requestedJobIds as string[], rawDatasetItems: record.rawDatasetItems },
  };
}
