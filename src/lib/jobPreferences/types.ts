import type { ExperienceLevel } from "@/lib/experienceLevel";

// job_type unions match its DB check constraint exactly
// (job_preferences_job_type_check). Not consolidated into its own shared
// module the way experience_level was — this phase only touched
// work_arrangement/experience_level; doing the same for job_type would be
// an unrelated, unrequested refactor.
export type JobType = "internship" | "part-time" | "full-time" | "freelance" | "open";

// Matches job_preferences_work_arrangement_check exactly (see
// supabase/migrations/20260806090060_restructure_job_preferences_work_arrangement.sql).
// Renamed from remote_preference; the old "open" value was remapped to
// "flexible" — they meant the same thing (open to remote/hybrid/on-site).
export type WorkArrangement = "remote" | "onsite" | "hybrid" | "flexible";

// Matches job_preferences_job_market_coverage_check exactly. Only ever
// non-null for a Lebanon-resident Pro user with work_arrangement in
// (remote, flexible) — enforced server-side by
// enforce_job_preferences_eligibility_trigger, never trust a client value
// for this field beyond what that trigger allows.
export type JobMarketCoverage =
  | "lebanon_only"
  | "remote_lebanon_applicants"
  | "remote_mena"
  | "remote_worldwide";

// Full public.job_preferences row shape (see
// supabase/migrations/20260714153055_create_job_preferences.sql,
// supabase/migrations/20260805090000_add_job_preferences_versioning.sql, and
// supabase/migrations/20260806090060_restructure_job_preferences_work_arrangement.sql).
// Distinct from src/components/dashboard/PreferencesSection.tsx's
// `PreferencesData`, which is a camelCase display-only projection with no
// id/user_id/version/timestamps — that type is for rendering, this one is
// for anything that needs the real row (e.g. building a preference_snapshot
// or comparing against cv_analyses.preferences_version).
export interface JobPreferences {
  id: string;
  user_id: string;
  // Frozen, scalar free-text columns from before the reference-data
  // overhaul. No longer written by new code — preserved only for
  // historical reads. Use job_preference_target_roles / custom_target_roles
  // and job_preference_locations / custom_locations instead.
  target_roles: string | null;
  location: string | null;
  work_arrangement: WorkArrangement | null;
  job_market_coverage: JobMarketCoverage | null;
  job_type: JobType | null;
  experience_level: ExperienceLevel | null;
  additional_notes: string | null;
  custom_target_roles: string[] | null;
  custom_locations: string[] | null;
  // Server-computed only (see bump_job_preferences_version in
  // 20260805090000_add_job_preferences_versioning.sql) — increments on
  // every update that changes real preference data, ignoring any
  // client-supplied value. Never construct or trust a value for this
  // field from user input.
  version: number;
  created_at: string;
  updated_at: string;
}
