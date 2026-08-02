import type { ExperienceLevel } from "@/lib/experienceLevel";

// remote_preference/job_type unions match their DB check constraints
// exactly (job_preferences_remote_preference_check / _job_type_check).
// Not consolidated into their own shared modules the way experience_level
// was — this phase only touched experience_level; doing the same for
// these would be an unrelated, unrequested refactor.
export type RemotePreference = "onsite" | "hybrid" | "remote" | "open";
export type JobType = "internship" | "part-time" | "full-time" | "freelance" | "open";

// Full public.job_preferences row shape (see
// supabase/migrations/20260714153055_create_job_preferences.sql and
// supabase/migrations/20260805090000_add_job_preferences_versioning.sql).
// Distinct from src/components/dashboard/PreferencesSection.tsx's
// `PreferencesData`, which is a camelCase display-only projection with no
// id/user_id/version/timestamps — that type is for rendering, this one is
// for anything that needs the real row (e.g. building a preference_snapshot
// or comparing against cv_analyses.preferences_version).
export interface JobPreferences {
  id: string;
  user_id: string;
  target_roles: string | null;
  location: string | null;
  remote_preference: RemotePreference | null;
  job_type: JobType | null;
  experience_level: ExperienceLevel | null;
  additional_notes: string | null;
  // Server-computed only (see bump_job_preferences_version in
  // 20260805090000_add_job_preferences_versioning.sql) — increments on
  // every update that changes real preference data, ignoring any
  // client-supplied value. Never construct or trust a value for this
  // field from user input.
  version: number;
  created_at: string;
  updated_at: string;
}
