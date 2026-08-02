// Single source of truth for the experience-level vocabulary shared by
// two schema locations: job_preferences.experience_level (the user's
// self-reported target level) and cv_analyses.profile_level (the AI's
// assessed level) — see
// supabase/migrations/20260804090000_extend_job_preferences_experience_level.sql
// and 20260804090010_create_cv_analyses.sql. Both check constraints and
// this list must be kept in sync; if you add a value here, add a
// migration extending both check constraints the same way.
export const EXPERIENCE_LEVEL_OPTIONS = [
  { label: "Internship", value: "internship" },
  { label: "Entry-level", value: "entry-level" },
  { label: "Junior", value: "junior" },
  { label: "Mid-level", value: "mid-level" },
  { label: "Senior", value: "senior" },
  { label: "Open to all", value: "open-to-all" },
] as const;

export type ExperienceLevel = (typeof EXPERIENCE_LEVEL_OPTIONS)[number]["value"];

export function isExperienceLevel(value: string | null | undefined): value is ExperienceLevel {
  return !!value && EXPERIENCE_LEVEL_OPTIONS.some((option) => option.value === value);
}
