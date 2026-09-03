// Mirrors public.locations (supabase/migrations/20260806090040_create_locations.sql,
// extended by 20260902090000_add_relocation_market_catalog.sql). name is
// already a normalized display string (e.g. "Sidon / Saida, Lebanon") —
// never re-derive or re-format it client-side.
export interface JobLocation {
  slug: string;
  name: string;
}

// A relocation-market row (is_relocation_market = true) additionally
// carries its country_code, used to derive the set of countries a user
// can select as "already authorized" (job_preference_authorized_countries)
// — see src/app/onboarding/preferences/page.tsx.
export interface RelocationLocation extends JobLocation {
  country_code: string;
}

// UI-only sentinel — never a row in public.locations. Selecting it
// reveals a custom-location text entry, appended to
// job_preferences.custom_locations (never job_preference_locations).
export const OTHER_LOCATION_VALUE = "other";
