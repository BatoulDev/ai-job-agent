import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getNewsSupabaseConfig } from "./newsEnv";

// Cookie-free client for public, unauthenticated reads of the online
// daily-news project only (see newsEnv.ts). Never import this from a
// "use client" file. Distinct from src/lib/supabase/publicClient.ts, which
// connects to the main (local) Supabase project.
//
// Throws if NEWS_SUPABASE_URL/NEWS_SUPABASE_ANON_KEY are missing — callers
// must invoke this from inside a try/catch (see
// getLatestDailyNewsBriefs.ts) so a missing-configuration environment
// (e.g. CI, which never sets these) degrades to the "unavailable" state
// instead of crashing the build or the page render.
export function createNewsClient() {
  const { url, anonKey } = getNewsSupabaseConfig();
  return createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
