// LinkedIn adapter, via the Apify actor `bebity/linkedin-jobs-scraper`
// (Tier C — multi-company feed, same pattern as bayt.ts/gulftalent.ts/
// indeed.ts). Public LinkedIn job-search results only — see AGENTS.md
// §35 for the full guardrail set this adapter must respect: no login, no
// cookies, no private-profile access, bounded cost per run, disabled
// until a pilot proves quality.
//
// LIVE-VERIFIED (Lebanon pilot, see docs/LEBANON_LIVE_SOURCE_EXPANSION.md):
// a real, bounded 10-item Lebanon run ($0.0001, run options
// `maxItems=10&maxTotalChargeUsd=0.05` — NOT the actor's own input, which
// has no `maxItems` field at all; its real bounding field is `rows`, the
// root cause of the earlier $1.47 cost incident) confirmed the real
// schema below. `workType` was an empty string on all 10/10 real
// samples, exactly as the earlier free research sample found — this is
// why classifyWorkArrangementFromText.ts exists and is wired in below as
// a fallback, never a primary source. `applyType` was EASY_APPLY on 7/10
// and EXTERNAL on 3/10 — a real, non-trivial external-link share, unlike
// the earlier 15-item sample's 100% Easy-Apply finding. 2/10 EXTERNAL
// rows had an empty `applyUrl` despite `applyType: "EXTERNAL"` — the
// canonical `jobUrl` (always a real lb.linkedin.com/jobs/view/... link in
// every sample) is therefore the application-target fallback for every
// row, per AGENTS.md §35 rule 7: the public LinkedIn URL alone is a valid
// destination. 1/10 rows had an empty `companyName` — correctly rejected
// by validateMultiCompanyProviderJob's missing_company_name rule, same
// as the Execution Trader finding.
import type { RawProviderJob } from "../rawProviderJob.ts";
import { stripHtml } from "./shared.ts";
import { classifyWorkArrangementFromText } from "../classifyWorkArrangementFromText.ts";

export interface LinkedInRawJob {
  id?: string | number;
  title?: string;
  companyName?: string;
  location?: string;
  description?: string;
  contractType?: string;
  // Real observed values (Lebanon pilot): always "" — no structured
  // signal has ever been seen, despite the actor's input schema
  // advertising a workTypes filter. Kept as a real field (not removed)
  // so a future run that DOES observe a value is handled correctly
  // without a second schema-drift incident.
  workType?: string;
  applyType?: "EASY_APPLY" | "EXTERNAL" | string;
  applyUrl?: string;
  // Canonical public LinkedIn job-listing URL — always present in every
  // real sample, including rows where applyUrl was empty.
  jobUrl?: string;
  publishedAt?: string;
  // Real observed values (Lebanon pilot): "Mid-Senior level", "Not
  // Applicable", "Entry level". Only the unambiguous values are mapped
  // below — "Mid-Senior level"/"Not Applicable"/"Associate"/"Director"
  // stay unmapped rather than guessed (AGENTS.md §30).
  experienceLevel?: string;
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  "Full-time": "full-time",
  "Part-time": "part-time",
  Contract: "contract",
  Internship: "internship",
  // "Temporary" and "Volunteer" (real enum values from the actor's own
  // contractTypes filter) have no match in this project's employmentType
  // enum — deliberately left unmapped rather than guessed (AGENTS.md §30).
};

// Structured workType values, in case a future run ever observes one —
// never observed yet (see module header), so this is defensive, not
// confirmed live.
const WORK_TYPE_MAP: Record<string, string> = {
  "On-site": "onsite",
  Remote: "remote",
  Hybrid: "hybrid",
};

const EXPERIENCE_LEVEL_TO_SENIORITY: Record<string, string> = {
  "Entry level": "entry-level",
  Internship: "internship",
};

function resolveProviderWorkArrangement(raw: LinkedInRawJob): string | null {
  const structured = raw.workType?.trim();
  if (structured && WORK_TYPE_MAP[structured]) return WORK_TYPE_MAP[structured];

  // Fallback only (AGENTS.md §35 / task Phase 5): classify from title +
  // description when no usable structured signal exists. Never both.
  const classification = classifyWorkArrangementFromText({ title: raw.title, description: raw.description });
  return classification.workArrangement;
}

export function mapLinkedInJob(raw: LinkedInRawJob): RawProviderJob {
  const applyUrl = typeof raw.applyUrl === "string" ? raw.applyUrl.trim() : "";
  const jobUrl = typeof raw.jobUrl === "string" ? raw.jobUrl.trim() : "";

  return {
    externalId: raw.id != null ? String(raw.id) : "",
    title: typeof raw.title === "string" ? stripHtml(raw.title) : null,
    description: stripHtml(raw.description),
    companyName: typeof raw.companyName === "string" && raw.companyName.trim() ? raw.companyName.trim() : null,
    rawLocation: typeof raw.location === "string" && raw.location.trim() ? raw.location.trim() : null,
    providerWorkArrangement: resolveProviderWorkArrangement(raw),
    // AGENTS.md §35 rule 7: the canonical public LinkedIn URL alone is a
    // valid application target — prefer a real external/Easy-Apply
    // applyUrl when present, but never reject a job for lacking one.
    applicationUrl: applyUrl || jobUrl || null,
    applicationEmail: null,
    employmentType: raw.contractType ? (EMPLOYMENT_TYPE_MAP[raw.contractType] ?? null) : null,
    seniority: raw.experienceLevel ? (EXPERIENCE_LEVEL_TO_SENIORITY[raw.experienceLevel] ?? null) : null,
    publishedAt: raw.publishedAt ?? null,
    sourceLastModifiedAt: null,
    sourceListingUrl: jobUrl || null,
  };
}
