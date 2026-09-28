// Pure link-discovery helper for Tier-B career-page extraction (Phase 16).
//
// Real finding this phase (docs/LEBANON_GULF_SOURCE_RESEARCH.md §4):
// extractCareerPageJobPostings.ts only reads the one URL it's given, but
// real company career pages almost always put schema.org JobPosting
// JSON-LD on each job's own detail page, not the recorded landing page —
// confirmed by two real runs (Phase 13: 0/11, Phase 14: 14/20 succeeded
// with an honest 0 jobs found). This function is the first half of the
// real fix: given a landing page's raw HTML that yielded zero postings,
// find same-domain links that look like individual job-detail pages, so a
// caller can fetch a bounded number of them and re-run the SAME, unchanged
// extractCareerPageJobPostings() against each one.
//
// *** NOT WIRED INTO THE INGESTION WORKFLOW THIS PHASE ***
// This function is pure and tested (HTML string in, candidate URL list
// out — no network). Actually fetching these candidate URLs requires a
// second, bounded HTTP round trip per landing page, which n8n's existing
// single-fetch-per-source Tier-B loop does not yet do — a real workflow
// change (rate limiting, cost guards, retry semantics for N extra fetches
// instead of 1) deliberately left as a scoped follow-up rather than rushed
// in alongside everything else this phase, per docs/LEBANON_GULF_SOURCE_RESEARCH.md's
// own Phase 16 implementation notes.
const ANCHOR_RE = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;

// Matches a path segment that looks like an individual job posting, not a
// generic careers landing/category page: /job/, /jobs/, /career/, /careers/,
// /vacancy/, /vacancies/, /position/, /opening/ followed by something (a
// slug or numeric ID), OR a trailing numeric ID of realistic length.
const JOB_DETAIL_PATH_RE = /\/(job|jobs|career|careers|vacanc(?:y|ies)|position|opening)s?\/[^/?#]{3,}|\/\d{3,}(?:[/?#]|$)/i;

// Generic landing/category/listing pages to exclude even if they'd
// otherwise match — never treat the index itself as a "detail" page.
const EXCLUDE_RE = /\/(jobs|careers|vacancies|positions|openings)\/?(\?.*)?(#.*)?$/i;

export interface FindJobDetailLinksOptions {
  /** Absolute URL of the page whose HTML is being scanned — used to resolve relative hrefs and to enforce same-domain only. */
  pageUrl: string;
  /** Maximum candidate links to return — bounded by design (AGENTS.md §26/§27), never unbounded. */
  maxLinks?: number;
}

const DEFAULT_MAX_LINKS = 5;

export function findCareerPageJobDetailLinks(html: string, options: FindJobDetailLinksOptions): string[] {
  if (!html || typeof html !== "string") return [];

  let base: URL;
  try {
    base = new URL(options.pageUrl);
  } catch {
    return [];
  }
  const maxLinks = options.maxLinks ?? DEFAULT_MAX_LINKS;

  const seen = new Set<string>();
  const results: string[] = [];

  for (const match of html.matchAll(ANCHOR_RE)) {
    if (results.length >= maxLinks) break;
    const href = match[1];
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;

    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }

    // Same-domain only — never follow a link off the company's own site.
    if (resolved.hostname !== base.hostname) continue;
    if (resolved.href === base.href) continue;
    if (EXCLUDE_RE.test(resolved.pathname)) continue;
    if (!JOB_DETAIL_PATH_RE.test(resolved.pathname)) continue;

    const normalized = resolved.href;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(normalized);
  }

  return results;
}
