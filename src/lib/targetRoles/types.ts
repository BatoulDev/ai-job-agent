// Mirrors public.target_roles (supabase/migrations/20260806090030_create_target_roles.sql).
export interface TargetRole {
  slug: string;
  name: string;
  category: string;
}

// UI-only sentinel — never a row in public.target_roles. Selecting it
// reveals a custom-role text entry, appended to
// job_preferences.custom_target_roles (never job_preference_target_roles).
export const OTHER_TARGET_ROLE_VALUE = "other";

// Selection budget shared between reference-table picks and custom
// entries — enforced again, authoritatively, inside save_job_preferences.
export const MAX_TARGET_ROLES = 5;
