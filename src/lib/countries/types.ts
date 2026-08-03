// Mirrors public.countries (supabase/migrations/20260806090000_create_countries.sql).
// code is the stable ISO 3166-1 alpha-2 value — the only thing ever
// stored on profiles.country_of_residence; name is display-only.
export interface Country {
  code: string;
  name: string;
}

// The pivot value the whole plan-eligibility / job-market-coverage /
// work-arrangement feature branches on. Never hardcode the string "LB"
// elsewhere — import this instead.
export const LEBANON_COUNTRY_CODE = "LB";
