// Validation wrapper for multi-company feed adapters (Phase 13: RemoteOK,
// Jobicy, Arbeitnow, and future JSearch/Adzuna/Bayt/GulfTalent). Reuses
// rawProviderJob.ts's validateRawProviderJob unchanged — every existing
// Tier-A rule (required fields, URL/email format, LinkedIn email ban)
// still applies — and adds exactly one extra rule these feeds need:
// raw.companyName must be present, since there is no company_sources row
// to fall back on (see JobSourceContext.companyName in rawProviderJob.ts).
//
// Kept as a separate wrapper rather than folding into
// validateRawProviderJob itself so every existing Tier-A call site and
// test is untouched — this is purely additive.
import { validateRawProviderJob, type RawProviderJob, type JobSourceType, type RawProviderJobRejectReason } from "./rawProviderJob.ts";

export interface MultiCompanyRawProviderJob extends RawProviderJob {
  companyName: string;
}

export type MultiCompanyValidationResult = { valid: true } | { valid: false; reason: RawProviderJobRejectReason };

export function validateMultiCompanyProviderJob(raw: RawProviderJob, sourceType: JobSourceType): MultiCompanyValidationResult {
  if (!raw.companyName || !raw.companyName.trim()) {
    return { valid: false, reason: "missing_company_name" };
  }
  return validateRawProviderJob(raw, sourceType);
}
