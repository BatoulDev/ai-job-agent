// Mirrors public.majors (supabase/migrations/20260806090020_create_majors.sql).
export interface Major {
  slug: string;
  name: string;
  category: string;
}

// UI-only sentinel — never a row in public.majors. Selecting it reveals
// the required custom major/field-of-study input and maps to
// profiles.custom_major instead of profiles.major_id.
export const OTHER_MAJOR_VALUE = "other";
