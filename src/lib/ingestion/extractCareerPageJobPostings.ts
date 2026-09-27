// Tier-B career-page extraction (Phase 13 §4) — reusable across any
// company career page, not a per-company hack. Reads schema.org
// JobPosting structured data (https://schema.org/JobPosting) embedded in
// a career page's own HTML as a `<script type="application/ld+json">`
// block. This is the SEO markup Google for Jobs consumes; a large share of
// company career sites (including many built on ATSs this project has no
// adapter for — Workday/SAP/Oracle/custom sites) already emit it, so one
// extractor covers many companies with zero per-company code, exactly the
// "reusable adapter/extractor layer" the phase asked for.
//
// Deliberately NOT a general-purpose HTML scraper: only a page's own
// declared structured data is read, never inferred from arbitrary DOM
// layout/CSS selectors — "direct HTML/structured extraction where
// reliable," per the phase's instructions, not scraping when no clean
// structured signal exists. A page with no JobPosting JSON-LD yields zero
// jobs, honestly, rather than a best-effort guess. No headless browser, no
// Apify, no JS execution — a plain HTML string in, RawProviderJob[] out.
//
// Company-specific, same as Greenhouse/Lever/Workable/Ashby: the caller
// supplies companyName from the live company_sources row (never per-job,
// unlike the multi-company feeds in providers/remoteok.ts etc.) — see
// extract-career-page-jobs/route.ts.
import type { RawProviderJob } from "./rawProviderJob.ts";
import { stripHtml } from "./providers/shared.ts";

const JSON_LD_SCRIPT_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

interface SchemaOrgPostalAddress {
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string | { name?: string };
}

interface SchemaOrgJobPosting {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  employmentType?: string | string[];
  identifier?: { value?: string | number } | string;
  url?: string;
  jobLocation?: { address?: SchemaOrgPostalAddress } | { address?: SchemaOrgPostalAddress }[];
  jobLocationType?: string;
  applicantLocationRequirements?: unknown;
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  FULL_TIME: "full-time",
  PART_TIME: "part-time",
  CONTRACTOR: "contract",
  TEMPORARY: "contract",
  INTERN: "internship",
  INTERNSHIP: "internship",
};

function isJobPostingType(type: SchemaOrgJobPosting["@type"]): boolean {
  if (typeof type === "string") return type === "JobPosting";
  if (Array.isArray(type)) return type.includes("JobPosting");
  return false;
}

/** Flattens the handful of real-world JSON-LD container shapes sites use (a single object, an array, or an @graph wrapper) down to a flat list of JobPosting-typed objects — never guesses at a shape that isn't there. */
function flattenJobPostings(parsed: unknown): SchemaOrgJobPosting[] {
  if (parsed == null || typeof parsed !== "object") return [];
  const asRecord = parsed as Record<string, unknown>;

  if (isJobPostingType(asRecord["@type"] as SchemaOrgJobPosting["@type"] | undefined)) {
    return [asRecord as SchemaOrgJobPosting];
  }
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => flattenJobPostings(item));
  }
  if (Array.isArray(asRecord["@graph"])) {
    return (asRecord["@graph"] as unknown[]).flatMap((item) => flattenJobPostings(item));
  }
  return [];
}

function extractLocationText(posting: SchemaOrgJobPosting): string | null {
  const raw = posting.jobLocation;
  const first = Array.isArray(raw) ? raw[0] : raw;
  const address = first?.address;
  if (!address) return null;
  const country = typeof address.addressCountry === "string" ? address.addressCountry : address.addressCountry?.name;
  const parts = [address.addressLocality, address.addressRegion, country].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

function extractExternalId(posting: SchemaOrgJobPosting): string {
  if (posting.identifier && typeof posting.identifier === "object" && posting.identifier.value != null) {
    return String(posting.identifier.value);
  }
  if (typeof posting.identifier === "string" && posting.identifier.trim()) {
    return posting.identifier.trim();
  }
  // A JobPosting's own canonical url is stable and unique per real-world
  // posting on a given site — a legitimate identifier here, not an
  // invented one, when no explicit identifier block is present.
  return typeof posting.url === "string" ? posting.url.trim() : "";
}

function mapJobPosting(posting: SchemaOrgJobPosting): RawProviderJob {
  const employmentTypeRaw = Array.isArray(posting.employmentType) ? posting.employmentType[0] : posting.employmentType;
  return {
    externalId: extractExternalId(posting),
    title: typeof posting.title === "string" ? posting.title : null,
    description: stripHtml(posting.description),
    rawLocation: extractLocationText(posting),
    providerWorkArrangement: posting.jobLocationType === "TELECOMMUTE" ? "remote" : null,
    applicationUrl: typeof posting.url === "string" ? posting.url : null,
    applicationEmail: null,
    employmentType: employmentTypeRaw ? (EMPLOYMENT_TYPE_MAP[employmentTypeRaw] ?? null) : null,
    seniority: null,
    publishedAt: posting.datePosted ?? null,
    sourceLastModifiedAt: null,
    sourceListingUrl: typeof posting.url === "string" ? posting.url : null,
  };
}

/**
 * Extracts every schema.org JobPosting found in a career page's raw HTML.
 * Pure — no network, no DOM, no JS execution. A page with no JobPosting
 * JSON-LD (or only malformed JSON-LD) returns an empty array, honestly,
 * rather than falling back to a guess. Malformed individual blocks are
 * skipped, not fatal — one broken script tag must never hide every other
 * valid posting on the same page.
 */
export function extractCareerPageJobPostings(html: string): RawProviderJob[] {
  if (!html || typeof html !== "string") return [];

  const postings: SchemaOrgJobPosting[] = [];
  for (const match of html.matchAll(JSON_LD_SCRIPT_RE)) {
    const blockText = match[1];
    if (!blockText || !blockText.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(blockText);
    } catch {
      continue;
    }
    postings.push(...flattenJobPostings(parsed));
  }

  return postings.map(mapJobPosting);
}
