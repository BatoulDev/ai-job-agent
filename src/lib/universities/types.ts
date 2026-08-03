// Mirrors public.universities (supabase/migrations/20260806090010_create_universities.sql).
export interface University {
  slug: string;
  name: string;
  abbreviation: string | null;
}

// UI-only sentinel — never a row in public.universities. Selecting it
// reveals the required "Enter your university name" input and maps to
// profiles.custom_university instead of profiles.university_id.
export const OTHER_UNIVERSITY_VALUE = "other";
