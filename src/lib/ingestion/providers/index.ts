// One common contract every ATS/provider adapter implements: raw vendor
// JSON in, RawProviderJob out. Extending to a new provider means adding one
// file plus one registry entry here — no calling code changes (AGENTS.md
// §16). admin_manual/linkedin have no adapter because nothing here ever
// fetches those automatically (AGENTS.md §7 — LinkedIn is never scraped or
// auto-applied through).
//
// career_page IS registered, as an identity function: its extraction path
// (extractCareerPageJobPostings.ts, Phase 13) already produces
// RawProviderJob[] directly at POST /extract-career-page-jobs, so by the
// time run-batch (which calls this registry) receives it, there is no
// vendor-specific raw shape left to adapt — just pass it through. Found
// missing during Phase 14's real E2E run: the n8n workflow's "Call Career
// Page Ingestion Batch Endpoint" node has always called run-batch with
// sourceType:'career_page' (career_page is company-specific, one
// company_sources row per candidate, same as Tier A), but this registry
// and run-batch/parseIngestionBatchRequest.ts's allowlist never actually
// accepted it — every real career-page candidate failed with a 400
// ("sourceType must be one of: greenhouse, lever, workable, ashby") that
// no fixture/unit test caught, because none of them called the real route
// end-to-end with sourceType:'career_page'.
import type { JobSourceType, RawProviderJob } from "../rawProviderJob.ts";
import { mapGreenhouseJob, type GreenhouseRawJob } from "./greenhouse.ts";
import { mapLeverJob, type LeverRawJob } from "./lever.ts";
import { mapWorkableJob, type WorkableRawJob } from "./workable.ts";
import { mapAshbyJob, type AshbyRawJob } from "./ashby.ts";
import { mapOracleHcmJob, type OracleHcmRawJob } from "./oracle-hcm.ts";
import { mapWorkdayJob, type WorkdayRawJob } from "./workday.ts";
import { mapRemoteOkJob, type RemoteOkRawJob } from "./remoteok.ts";
import { mapJobicyJob, type JobicyRawJob } from "./jobicy.ts";
import { mapArbeitnowJob, type ArbeitnowRawJob } from "./arbeitnow.ts";
import { mapJSearchJob, type JSearchRawJob } from "./jsearch.ts";
import { mapAdzunaJob, type AdzunaRawJob } from "./adzuna.ts";
import { mapBaytJob, type BaytRawJob } from "./bayt.ts";
import { mapGulfTalentJob, type GulfTalentRawJob } from "./gulftalent.ts";
import { mapIndeedJob, type IndeedRawJob } from "./indeed.ts";

export type ProviderAdapter = (raw: unknown) => RawProviderJob;

export const PROVIDER_ADAPTERS: Partial<Record<JobSourceType, ProviderAdapter>> = {
  greenhouse: (raw) => mapGreenhouseJob(raw as GreenhouseRawJob),
  lever: (raw) => mapLeverJob(raw as LeverRawJob),
  workable: (raw) => mapWorkableJob(raw as WorkableRawJob),
  ashby: (raw) => mapAshbyJob(raw as AshbyRawJob),
  oracle_hcm: (raw) => mapOracleHcmJob(raw as OracleHcmRawJob),
  // workday: registered for testability, same as jsearch/adzuna's
  // BLOCKED_ON_CREDENTIAL pattern — but NOT in run-batch's
  // AUTOMATABLE_SOURCE_TYPES allowlist and NOT wired into the n8n workflow
  // this phase, since the list endpoint carries no description and every
  // real job would be honestly rejected until a per-job detail fetch
  // exists. See providers/workday.ts's own header comment.
  workday: (raw) => mapWorkdayJob(raw as WorkdayRawJob),
  remoteok: (raw) => mapRemoteOkJob(raw as RemoteOkRawJob),
  jobicy: (raw) => mapJobicyJob(raw as JobicyRawJob),
  arbeitnow: (raw) => mapArbeitnowJob(raw as ArbeitnowRawJob),
  // jsearch/adzuna: registered so the adapter contract is complete and
  // testable, even though providerConfig.ts's enabled:false keeps them out
  // of any live run — see each file's own BLOCKED_ON_CREDENTIAL header.
  jsearch: (raw) => mapJSearchJob(raw as JSearchRawJob),
  adzuna: (raw) => mapAdzunaJob(raw as AdzunaRawJob),
  bayt: (raw) => mapBaytJob(raw as BaytRawJob),
  gulftalent: (raw) => mapGulfTalentJob(raw as GulfTalentRawJob),
  indeed: (raw) => mapIndeedJob(raw as IndeedRawJob),
  career_page: (raw) => raw as RawProviderJob,
};

export function getProviderAdapter(sourceType: JobSourceType): ProviderAdapter | null {
  return PROVIDER_ADAPTERS[sourceType] ?? null;
}
