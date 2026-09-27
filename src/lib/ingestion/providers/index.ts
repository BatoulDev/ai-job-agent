// One common contract every ATS adapter implements: raw vendor JSON in,
// RawProviderJob out. Extending to a new ATS means adding one file plus one
// registry entry here — no calling code changes (AGENTS.md §16). Only the
// three ATS types the job-ingestion pilot already proved out are wired up;
// admin_manual/career_page/ashby/linkedin have no adapter because nothing
// here ever fetches those automatically (AGENTS.md §7 — LinkedIn is never
// scraped or auto-applied through).
import type { JobSourceType, RawProviderJob } from "../rawProviderJob.ts";
import { mapGreenhouseJob, type GreenhouseRawJob } from "./greenhouse.ts";
import { mapLeverJob, type LeverRawJob } from "./lever.ts";
import { mapWorkableJob, type WorkableRawJob } from "./workable.ts";

export type ProviderAdapter = (raw: unknown) => RawProviderJob;

export const PROVIDER_ADAPTERS: Partial<Record<JobSourceType, ProviderAdapter>> = {
  greenhouse: (raw) => mapGreenhouseJob(raw as GreenhouseRawJob),
  lever: (raw) => mapLeverJob(raw as LeverRawJob),
  workable: (raw) => mapWorkableJob(raw as WorkableRawJob),
};

export function getProviderAdapter(sourceType: JobSourceType): ProviderAdapter | null {
  return PROVIDER_ADAPTERS[sourceType] ?? null;
}
