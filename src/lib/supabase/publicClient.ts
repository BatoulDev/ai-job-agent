import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabasePublishableKey, supabaseUrl } from "./env";

// Cookie-free client for public, unauthenticated reads of RLS-scoped public
// data (e.g. published daily news briefs). Unlike src/lib/supabase/server.ts,
// this never calls next/headers cookies() — reading cookies forces a route
// to opt out of static rendering/ISR, which would defeat `export const
// revalidate` on a page that doesn't need the visitor's session at all.
// Uses the same browser-safe publishable key as src/lib/supabase/client.ts;
// RLS is enforced exactly as it would be for the anon role.
export function createPublicClient() {
  return createSupabaseClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
