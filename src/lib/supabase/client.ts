import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";

// Cookie storage is handled internally by @supabase/ssr in the browser; do not pass a custom `cookies` option.
export function createClient() {
  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
