import { createClient as createSupabaseClient } from "@supabase/supabase-js";
// Checkpoint 2E audit-remediation: explicit ".ts" extension (same reason
// as the other relative-import fixes in this checkpoint) — this module is
// now a transitive dependency of a guarded local DB test invoking the
// real matching route handlers directly under plain `node --test`, which
// needs the extension even though the bundler-resolved build does not.
// No behavior change.
import { supabaseUrl } from "./env.ts";

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
