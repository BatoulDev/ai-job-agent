// Bounded, safety-first pagination for the Oracle HCM (Oracle Cloud
// Recruiting) Tier-A branch (2026-10-23 pagination-safety phase). Pure,
// deterministic, no network/DB — the n8n workflow's own Set-node
// expressions encode this exact same algorithm inline (n8n expressions
// cannot import a project module at runtime), the same duplication
// pattern this codebase already uses for deriveAtsFeedUrl.ts's regex
// being mirrored inside n8n-workflows/ai-job-agent-01-job-ingestion.ts's
// own `Extract Oracle HCM Jobs`-family nodes. This module exists so the
// algorithm itself is independently, directly testable.
//
// Real, live-confirmed facts this design is built on (see
// docs/LEBANON_LIVE_SOURCE_EXPANSION.md and this phase's own audit
// trail): the request's own `&limit=50` query parameter does NOT govern
// the real job-results page size — only the response's own
// items[0].Offset/items[0].Limit/items[0].TotalJobsCount can be trusted.
// A single bounded live test confirmed `finder=findReqs;siteNumber=X,offset=N`
// is accepted and the echoed-back Offset changes accordingly — but a
// genuine second page of DISTINCT job content was never observed (the
// one real tenant tested has fewer jobs than one page), so this module
// treats every multi-page scenario defensively: any sign of a
// non-advancing offset, an empty page before the real total is reached,
// or malformed metadata fails CLOSED (keeps whatever was already safely
// accumulated, marks the retrieval incomplete, and stops asking for more
// pages) rather than assuming pagination "must be working."
export interface OracleHcmRawJobLike {
  Id?: string | number;
  [key: string]: unknown;
}

export interface OracleHcmPaginationState {
  rawJobs: OracleHcmRawJobLike[];
  /** Offset of the last page actually accepted into rawJobs. */
  pageOffset: number;
  /** The real reported Limit from that same last accepted page — never the requested one — used to compute the next offset. */
  pageLimit: number;
  pagesFetched: number;
  /**
   * True whenever retrieval stopped for any reason other than a confirmed
   * "we have seen every job the source itself reports" signal — malformed
   * metadata, a non-advancing offset, a premature empty page, a page
   * fetch failure, or bounded page-count exhaustion. Threaded to
   * run-batch's own `paginationIncomplete` field (ingestSourceBatch.ts),
   * which forces `truncated: true` and skips stale-close regardless of
   * how few jobs were actually accumulated.
   */
  paginationIncomplete: boolean;
  /** True only when pageOffset + the last page's own item count >= the source's own reported total. */
  isComplete: boolean;
}

interface OracleHcmPageMetadata {
  offset: number;
  limit: number;
  totalJobsCount: number;
  requisitionList: OracleHcmRawJobLike[];
}

/** A reviewed, conservative safety cap — not a measured real limit (Oracle's real per-tenant job count has never been observed above 8). */
export const ORACLE_PAGINATION_MAX_PAGES = 10;

/**
 * Validates the real shape this project has ever actually observed
 * (items[0].{Offset,Limit,TotalJobsCount,requisitionList}) — returns null
 * for anything else, never guesses a default for a missing/non-numeric
 * field (AGENTS.md §30: validate structured output against an explicit
 * schema before using it).
 */
function parsePageMetadata(responseBody: unknown): OracleHcmPageMetadata | null {
  if (typeof responseBody !== "object" || responseBody === null) return null;
  const items = (responseBody as Record<string, unknown>).items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const first = items[0];
  if (typeof first !== "object" || first === null) return null;
  const rec = first as Record<string, unknown>;

  const offset = rec.Offset;
  const limit = rec.Limit;
  const totalJobsCount = rec.TotalJobsCount;
  const requisitionList = rec.requisitionList;

  if (typeof offset !== "number" || !Number.isFinite(offset)) return null;
  if (typeof limit !== "number" || !Number.isFinite(limit)) return null;
  if (typeof totalJobsCount !== "number" || !Number.isFinite(totalJobsCount)) return null;
  if (!Array.isArray(requisitionList)) return null;

  return { offset, limit, totalJobsCount, requisitionList: requisitionList as OracleHcmRawJobLike[] };
}

function hasValidRequisitionId(job: OracleHcmRawJobLike): boolean {
  const id = job.Id;
  return id !== undefined && id !== null && String(id).trim() !== "";
}

/**
 * Last-wins de-dup by Oracle's own raw `Id` field — same philosophy as
 * persistValidatedJobs' own external_id de-dup, applied before mapping.
 * Jobs with a missing/invalid Id are never deduped against each other —
 * keying them all under the same empty-string fallback would silently
 * collapse distinct, unrelated jobs into one (2026-10-24 rawJobs-loss
 * incident finding).
 */
function dedupeById(jobs: readonly OracleHcmRawJobLike[]): OracleHcmRawJobLike[] {
  const map = new Map<string, OracleHcmRawJobLike>();
  let missingIdCounter = 0;
  for (const job of jobs) {
    const key = hasValidRequisitionId(job) ? `id:${String(job.Id)}` : `missing:${missingIdCounter++}`;
    map.set(key, job);
  }
  return Array.from(map.values());
}

function validRequisitionIds(jobs: readonly OracleHcmRawJobLike[]): Set<string> {
  const ids = new Set<string>();
  for (const job of jobs) {
    if (hasValidRequisitionId(job)) ids.add(String(job.Id));
  }
  return ids;
}

/**
 * Fail-closed integrity check, added after the 2026-10-24 incident where an
 * n8n Set-node inline expression's `Array.from(map.values())` (and the
 * `[...map.values()]` spread form) silently returned an empty array despite
 * a correctly-sized Map — losing every accumulated job while every other
 * field in the same return value stayed correct. Verifies every valid Id
 * from EITHER input survived into the merged output. Set-based, so
 * legitimate cross-page duplicates are never mistaken for a lost record.
 */
export function mergeIncludesEveryValidId(
  priorJobs: readonly OracleHcmRawJobLike[],
  newJobs: readonly OracleHcmRawJobLike[],
  merged: readonly OracleHcmRawJobLike[]
): boolean {
  const expected = validRequisitionIds(priorJobs);
  for (const id of validRequisitionIds(newJobs)) expected.add(id);
  const actual = validRequisitionIds(merged);
  for (const id of expected) {
    if (!actual.has(id)) return false;
  }
  // Also catches the exact incident shape: a merge that returns nothing
  // despite non-empty inputs, even when neither input had a valid Id to
  // check by set membership (e.g. every job is Id-less).
  return !(merged.length === 0 && (priorJobs.length > 0 || newJobs.length > 0));
}

function stampCandidateSiteUrl(jobs: readonly OracleHcmRawJobLike[], candidateSiteUrl: string | null): OracleHcmRawJobLike[] {
  return jobs.map((job) => ({ ...job, candidateSiteUrl }));
}

/** The initial state from the very first page (already fetched by the shared `Fetch Source Jobs` node before any pagination decision is made). */
export function classifyOracleHcmFirstPage(responseBody: unknown, candidateSiteUrl: string | null): OracleHcmPaginationState {
  const meta = parsePageMetadata(responseBody);
  if (meta === null) {
    // Fail closed: an unparseable first page means nothing is safely known,
    // so nothing is accumulated — never half-trust a malformed response.
    return { rawJobs: [], pageOffset: 0, pageLimit: 0, pagesFetched: 1, paginationIncomplete: true, isComplete: false };
  }

  const stamped = stampCandidateSiteUrl(meta.requisitionList, candidateSiteUrl);
  const rawJobs = dedupeById(stamped);
  if (!mergeIncludesEveryValidId([], stamped, rawJobs)) {
    // Fail closed: the dedup step itself lost a record it should have kept.
    // Nothing is safely known, so nothing is accumulated — same philosophy
    // as the malformed-metadata branch above.
    return { rawJobs: [], pageOffset: 0, pageLimit: 0, pagesFetched: 1, paginationIncomplete: true, isComplete: false };
  }
  const isComplete = meta.offset + meta.requisitionList.length >= meta.totalJobsCount;
  return { rawJobs, pageOffset: meta.offset, pageLimit: meta.limit, pagesFetched: 1, paginationIncomplete: false, isComplete };
}

/**
 * One subsequent page, given the prior accumulated state. Every failure
 * mode here preserves whatever was already safely accumulated in
 * `priorState.rawJobs` and simply stops (paginationIncomplete: true) —
 * never discards a prior good page because a later one went wrong.
 */
export function classifyOracleHcmNextPage(responseBody: unknown, priorState: OracleHcmPaginationState, candidateSiteUrl: string | null): OracleHcmPaginationState {
  const meta = parsePageMetadata(responseBody);
  if (meta === null) {
    return { ...priorState, paginationIncomplete: true, isComplete: false };
  }

  const isNonAdvancingOffset = meta.offset <= priorState.pageOffset;
  const isPrematureEmptyPage = meta.requisitionList.length === 0 && meta.offset < meta.totalJobsCount;
  if (isNonAdvancingOffset || isPrematureEmptyPage) {
    return { ...priorState, paginationIncomplete: true, isComplete: false };
  }

  const newJobs = stampCandidateSiteUrl(meta.requisitionList, candidateSiteUrl);
  const rawJobs = dedupeById([...priorState.rawJobs, ...newJobs]);
  if (!mergeIncludesEveryValidId(priorState.rawJobs, newJobs, rawJobs)) {
    // Fail closed: preserve whatever was already safely accumulated rather
    // than trust a merge step that just lost a record it should have kept.
    return { ...priorState, paginationIncomplete: true, isComplete: false };
  }
  const isComplete = meta.offset + meta.requisitionList.length >= meta.totalJobsCount;
  return { rawJobs, pageOffset: meta.offset, pageLimit: meta.limit, pagesFetched: priorState.pagesFetched + 1, paginationIncomplete: false, isComplete };
}

/**
 * Called only when the bounded attempt budget (ORACLE_PAGINATION_MAX_PAGES)
 * was exhausted without ever reaching isComplete — by definition an
 * incomplete retrieval, regardless of what paginationIncomplete already said.
 */
export function markPaginationBoundExhausted(state: OracleHcmPaginationState): OracleHcmPaginationState {
  return { ...state, paginationIncomplete: true, isComplete: false };
}

/**
 * Builds the next page's request URL from the ORIGINAL derived feed URL
 * (never from a previously-modified one, so an offset is never
 * double-inserted) by adding `offset=N` as a finder variable, the same
 * comma-separated placement as the existing `siteNumber` variable — the
 * one live-confirmed syntax this phase's bounded test verified is
 * accepted and honored. Generic across any Oracle HCM tenant: keyed only
 * on the `finder=findReqs;siteNumber=...` shape deriveAtsFeedUrl.ts always
 * produces, never a specific company's host/site.
 */
export function buildOracleHcmNextPageUrl(originalFeedUrl: string, nextOffset: number): string | null {
  const pattern = /(finder=findReqs;siteNumber=[A-Za-z0-9_]+)/;
  if (!pattern.test(originalFeedUrl)) return null;
  return originalFeedUrl.replace(pattern, `$1,offset=${nextOffset}`);
}

/** The real reported page size (never the requested one) determines where the next page starts. */
export function nextPageOffset(state: OracleHcmPaginationState): number {
  return state.pageOffset + state.pageLimit;
}
