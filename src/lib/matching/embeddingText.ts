// Pure, deterministic text builders for the matching-embedding pipeline
// (Phase 05). No network, no DB. Producing the exact same text for the same
// input is what makes embedding_content_hash a meaningful "has this
// changed?" signal — see docs/OVERNIGHT_BUILD_PROGRESS.md Phase 05.
import { createHash } from "node:crypto";

export interface JobEmbeddingInput {
  title: string;
  description: string;
  company_name: string;
  location: string | null;
  work_arrangement: string | null;
  seniority: string | null;
  employment_type: string | null;
}

/** Text embedded for a job — title/company weighted first, since they dominate relevance. */
export function buildJobEmbeddingText(job: JobEmbeddingInput): string {
  const lines = [
    `Title: ${job.title}`,
    `Company: ${job.company_name}`,
    job.seniority ? `Seniority: ${job.seniority}` : null,
    job.employment_type ? `Employment type: ${job.employment_type}` : null,
    job.work_arrangement ? `Work arrangement: ${job.work_arrangement}` : null,
    job.location ? `Location: ${job.location}` : null,
    `Description: ${job.description}`,
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

export interface ProfileEmbeddingInput {
  professionalSummary: string | null;
  skills: readonly string[];
  recommendedRoles: readonly string[];
  strongestAreas: readonly string[];
  profileLevel: string | null;
  targetRoles: readonly string[];
  preferredLocations: readonly string[];
  jobType: string | null;
  experienceLevel: string | null;
}

/**
 * Text embedded for a user's approved AI Career Profile + preferences.
 * Only ever built for a row the caller has already confirmed is
 * is_cv_analysis_matching_eligible() — this function does not check that
 * itself (see src/lib/matching/embedProfile.ts, which does).
 */
export function buildProfileEmbeddingText(profile: ProfileEmbeddingInput): string {
  const lines = [
    profile.profileLevel ? `Profile level: ${profile.profileLevel}` : null,
    profile.professionalSummary ? `Summary: ${profile.professionalSummary}` : null,
    profile.skills.length > 0 ? `Skills: ${profile.skills.join(", ")}` : null,
    profile.recommendedRoles.length > 0 ? `Recommended roles: ${profile.recommendedRoles.join(", ")}` : null,
    profile.strongestAreas.length > 0 ? `Strongest areas: ${profile.strongestAreas.join(", ")}` : null,
    profile.targetRoles.length > 0 ? `Target roles: ${profile.targetRoles.join(", ")}` : null,
    profile.preferredLocations.length > 0 ? `Preferred locations: ${profile.preferredLocations.join(", ")}` : null,
    profile.jobType ? `Job type: ${profile.jobType}` : null,
    profile.experienceLevel ? `Experience level: ${profile.experienceLevel}` : null,
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

/** Deterministic content hash — used to detect "has this changed since it was last embedded?" */
export function hashEmbeddingText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
