// Mirrors public.locations (supabase/migrations/20260806090040_create_locations.sql).
// name is already a normalized display string (e.g. "Sidon / Saida,
// Lebanon") — never re-derive or re-format it client-side.
export interface JobLocation {
  slug: string;
  name: string;
}

// UI-only sentinel — never a row in public.locations. Selecting it
// reveals a custom-location text entry, appended to
// job_preferences.custom_locations (never job_preference_locations).
export const OTHER_LOCATION_VALUE = "other";
