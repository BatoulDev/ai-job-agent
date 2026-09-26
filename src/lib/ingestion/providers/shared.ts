// Shared, pure helpers for ATS provider adapters. Ported verbatim from the
// already-proven, live-verified logic in
// n8n-workflows/job-ingestion-pilot-orchestrator.ts (see
// docs/job-ingestion-pilot.md §5) so behavior does not silently drift
// between the retired pilot and this reusable TypeScript version.

export function stripHtml(html: string | null | undefined): string {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export const EMPLOYMENT_MAP: Record<string, string> = {
  "full-time": "full-time",
  "part-time": "part-time",
  contract: "contract",
  contractual: "contract",
  internship: "internship",
};

export const WORKPLACE_MAP: Record<string, string> = {
  remote: "remote",
  "on-site": "onsite",
  onsite: "onsite",
  hybrid: "hybrid",
};
