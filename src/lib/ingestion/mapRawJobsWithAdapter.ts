// Isolates one raw item's adapter failure from the rest of the batch.
//
// Found during the 2026-10-23 GulfTalent reliability audit: run-multi-company-batch/route.ts
// used to do `rawJobs.map((raw) => adapter(raw))` directly — a single malformed item
// (e.g. `null`, or any shape whose property access throws inside the
// adapter) propagates out of .map() and is caught only by the route's outer
// try/catch, turning the ENTIRE batch into a 500. Every otherwise-valid job
// in that cycle's dataset is lost, not just the one bad record.
//
// A record the adapter could not even read has no determinable company name
// (or any other field) — rather than inventing a silent-drop side channel,
// it is replaced with an all-empty RawProviderJob shape and left to the
// SAME required-field validators every other invalid record already goes
// through (validateMultiCompanyProviderJob rejects it as missing_company_name;
// validateRawProviderJob rejects it as missing_external_id for the
// company-specific run-batch path). This keeps jobsFetched/jobsRejected
// accurate with zero change to ingestSourceBatch.ts or either route's HTTP
// response contract.
//
// Relocated here (from run-multi-company-batch/) 2026-10-23 so run-batch/route.ts
// (the company-specific, Tier-A counterpart) can share the exact same fix
// instead of duplicating it — that route had the identical unguarded
// `rawJobs.map((raw) => adapter(raw))` defect.
import type { ProviderAdapter } from "./providers/index.ts";
import type { JobSourceType, RawProviderJob } from "./rawProviderJob.ts";

/**
 * An adapter exception never carries the raw item, the error object, its
 * message, or even its own constructor name — only one of a fixed, strict
 * allowlist of known JS built-in error names, or the single fixed fallback
 * "adapter_exception" for everything else (including a custom/subclassed
 * Error). A provider's own feed can contain PII, and nothing guarantees a
 * future adapter's thrown value stays free of it — not just in its
 * message, but in principle in a crafted constructor/class name too.
 * Deriving the logged string ONLY from this closed allowlist, never from
 * the thrown value itself, makes leaking attacker- or provider-influenced
 * content into logs impossible by construction.
 */
export type AdapterExceptionHandler = (index: number, sourceType: JobSourceType, errorKind: string) => void;

const KNOWN_BUILTIN_ERROR_NAMES = new Set([
  "Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError",
]);

function classifyException(error: unknown): string {
  const name = error instanceof Error ? error.constructor?.name : undefined;
  return typeof name === "string" && KNOWN_BUILTIN_ERROR_NAMES.has(name) ? name : "adapter_exception";
}

export interface MapRawJobsWithAdapterResult {
  mapped: RawProviderJob[];
  /** Count of items the adapter itself threw on — distinct from ordinary validation rejections, which are counted later by the caller's own validator. */
  adapterExceptions: number;
}

const UNREADABLE_RAW_JOB: RawProviderJob = { externalId: "", title: null, description: null, companyName: null };

export function mapRawJobsWithAdapter(
  rawJobs: readonly unknown[],
  adapter: ProviderAdapter,
  sourceType: JobSourceType,
  onAdapterException?: AdapterExceptionHandler
): MapRawJobsWithAdapterResult {
  const mapped: RawProviderJob[] = [];
  let adapterExceptions = 0;

  for (let i = 0; i < rawJobs.length; i++) {
    try {
      mapped.push(adapter(rawJobs[i]));
    } catch (error) {
      adapterExceptions += 1;
      onAdapterException?.(i, sourceType, classifyException(error));
      mapped.push(UNREADABLE_RAW_JOB);
    }
  }

  return { mapped, adapterExceptions };
}
