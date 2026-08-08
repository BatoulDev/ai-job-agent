function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Server-only. Points at a separate, dedicated Supabase project used only
// for public daily-news reads while the rest of the app stays on local
// Supabase (see src/lib/supabase/env.ts for the main app's connection,
// which this intentionally does not share). Anon/publishable key only —
// RLS-scoped to published rows. Never prefix with NEXT_PUBLIC_: read only
// from Server Components, never imported from a "use client" file.
export const newsSupabaseUrl = requireEnv(
  "NEWS_SUPABASE_URL",
  process.env.NEWS_SUPABASE_URL
);

export const newsSupabaseAnonKey = requireEnv(
  "NEWS_SUPABASE_ANON_KEY",
  process.env.NEWS_SUPABASE_ANON_KEY
);
