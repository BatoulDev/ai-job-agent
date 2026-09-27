// One common contract every ATS/provider adapter implements: raw vendor
// JSON in, RawProviderJob out. Extending to a new provider means adding one
// file plus one registry entry here — no calling code changes (AGENTS.md
// §16). admin_manual/linkedin have no adapter because nothing here ever
// fetches those automatically (AGENTS.md §7 — LinkedIn is never scraped or
// auto-applied through); career_page has no single adapter because its
// extraction path (extractCareerPageJobPostings.ts, Phase 13) already
// produces RawProviderJob directly, with no vendor-specific raw shape to
// adapt.
import type { JobSourceType, RawProviderJob } from "../rawProviderJob.ts";
import { mapGreenhouseJob, type GreenhouseRawJob } from "./greenhouse.ts";
import { mapLeverJob, type LeverRawJob } from "./lever.ts";
import { mapWorkableJob, type WorkableRawJob } from "./workable.ts";
import { mapAshbyJob, type AshbyRawJob } from "./ashby.ts";
import { mapRemoteOkJob, type RemoteOkRawJob } from "./remoteok.ts";
import { mapJobicyJob, type JobicyRawJob } from "./jobicy.ts";
import { mapArbeitnowJob, type ArbeitnowRawJob } from "./arbeitnow.ts";
import { mapJSearchJob, type JSearchRawJob } from "./jsearch.ts";
import { mapAdzunaJob, type AdzunaRawJob } from "./adzuna.ts";

export type ProviderAdapter = (raw: unknown) => RawProviderJob;

export const PROVIDER_ADAPTERS: Partial<Record<JobSourceType, ProviderAdapter>> = {
  greenhouse: (raw) => mapGreenhouseJob(raw as GreenhouseRawJob),
  lever: (raw) => mapLeverJob(raw as LeverRawJob),
  workable: (raw) => mapWorkableJob(raw as WorkableRawJob),
  ashby: (raw) => mapAshbyJob(raw as AshbyRawJob),
  remoteok: (raw) => mapRemoteOkJob(raw as RemoteOkRawJob),
  jobicy: (raw) => mapJobicyJob(raw as JobicyRawJob),
  arbeitnow: (raw) => mapArbeitnowJob(raw as ArbeitnowRawJob),
  // jsearch/adzuna: registered so the adapter contract is complete and
  // testable, even though providerConfig.ts's enabled:false keeps them out
  // of any live run — see each file's own BLOCKED_ON_CREDENTIAL header.
  jsearch: (raw) => mapJSearchJob(raw as JSearchRawJob),
  adzuna: (raw) => mapAdzunaJob(raw as AdzunaRawJob),
};

export function getProviderAdapter(sourceType: JobSourceType): ProviderAdapter | null {
  return PROVIDER_ADAPTERS[sourceType] ?? null;
}
