// Adzuna adapter (Phase 13, Tier C — multi-company feed).
//
// *** NOT LIVE-VERIFIED — BLOCKED_ON_CREDENTIAL ***
// No ADZUNA_APP_ID/ADZUNA_APP_KEY is configured anywhere in this project
// (see docs/OVERNIGHT_CREDENTIALS_REQUIRED.md), so this mapping has never
// been exercised against a real API response. Field names below follow
// Adzuna's publicly documented /search response schema, not a verified
// live call. Before flipping providerConfig.ts's adzuna.enabled to true:
// obtain App ID/key, make one real request, confirm every field name
// below still matches, and confirm which target markets (Lebanon/Saudi/
// Qatar/Kuwait/UAE) Adzuna actually supports as a country code — do not
// trust this file alone as proof the integration works (AGENTS.md §30).
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";

export interface AdzunaRawJob {
  id?: string | number;
  title?: string;
  description?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  redirect_url?: string;
  created?: string;
  contract_type?: string;
}

const CONTRACT_TYPE_MAP: Record<string, string> = {
  full_time: "full-time",
  part_time: "part-time",
  contract: "contract",
};

export function mapAdzunaJob(raw: AdzunaRawJob): RawProviderJob {
  return {
    externalId: raw.id != null ? String(raw.id) : "",
    title: typeof raw.title === "string" ? raw.title : null,
    description: stripHtml(raw.description),
    companyName: typeof raw.company?.display_name === "string" ? raw.company.display_name.trim() : null,
    rawLocation: raw.location?.display_name ?? null,
    providerWorkArrangement: null,
    applicationUrl: typeof raw.redirect_url === "string" ? raw.redirect_url : null,
    applicationEmail: null,
    employmentType: raw.contract_type ? (CONTRACT_TYPE_MAP[raw.contract_type] ?? null) : null,
    seniority: null,
    publishedAt: raw.created ?? null,
    sourceLastModifiedAt: null,
    sourceListingUrl: typeof raw.redirect_url === "string" ? raw.redirect_url : null,
  };
}
