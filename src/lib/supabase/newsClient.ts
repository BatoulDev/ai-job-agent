import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { newsSupabaseAnonKey, newsSupabaseUrl } from "./newsEnv";

// Cookie-free client for public, unauthenticated reads of the online
// daily-news project only (see newsEnv.ts). Never import this from a
// "use client" file. Distinct from src/lib/supabase/publicClient.ts, which
// connects to the main (local) Supabase project.
export function createNewsClient() {
  return createSupabaseClient(newsSupabaseUrl, newsSupabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
