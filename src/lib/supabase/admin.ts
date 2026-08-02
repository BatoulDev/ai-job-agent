import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

function requireServerEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Service-role client — bypasses Row Level Security entirely. Only ever
// import this from server-only code paths (Route Handlers, Server
// Actions) that perform trusted subscription/payment/analysis-task writes
// with no client-facing insert/update RLS policy by design (see the
// subscriptions/payment_attempts/analysis_tasks migrations). SUPABASE_SECRET_KEY
// has no NEXT_PUBLIC_ prefix, so Next.js never inlines it into a browser
// bundle — but never import this module from a "use client" file regardless.
export function createAdminClient() {
  const supabaseSecretKey = requireServerEnv(
    "SUPABASE_SECRET_KEY",
    process.env.SUPABASE_SECRET_KEY
  );

  return createSupabaseClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
