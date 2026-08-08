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
//
// Read lazily inside a function rather than as top-level consts: this
// module is imported transitively by the statically-prerendered /news
// route, so validating at module-import time would fail `next build`
// itself whenever these variables are absent (e.g. in CI, which
// intentionally never configures the external news project). Callers
// are expected to call this from inside a try/catch and fall back to
// the existing "unavailable" state.
export function getNewsSupabaseConfig(): { url: string; anonKey: string } {
  return {
    url: requireEnv("NEWS_SUPABASE_URL", process.env.NEWS_SUPABASE_URL),
    anonKey: requireEnv(
      "NEWS_SUPABASE_ANON_KEY",
      process.env.NEWS_SUPABASE_ANON_KEY
    ),
  };
}
