import { createClient } from "@/lib/supabase/server";
import { isPlanCode, type PlanCode } from "./types";

export interface PublicPlanCatalogEntry {
  planCode: PlanCode;
  displayName: string;
  priceAmount: number;
  currency: string;
  billingPeriod: "forever" | "monthly";
  jobMatchLimit: number;
  coverLetterLimit: number;
}

// The one safe, server-side read path for "what can be purchased right
// now, for how much" — backed entirely by the public.get_public_plan_catalog()
// RPC (supabase/migrations/20260914100000_add_public_plan_catalog_and_price_publishing.sql),
// never a frontend price constant. Works for both signed-out and signed-in
// visitors (the RPC grants EXECUTE to both anon and authenticated).
//
// Returns null on any failure (network error, RPC error, or an
// unexpected/empty result) — callers MUST treat null as "pricing
// unavailable" and render a safe unavailable state, never fall back to an
// invented or previously-hard-coded price. See src/components/landing/Pricing.tsx.
//
// Caching: this always runs as part of a Server Component render that also
// calls supabase.auth.getUser() (cookie access), which already forces
// Next.js to render the page dynamically per request — there is no
// separate cache/revalidate configuration to add or reason about here, and
// none should be added: a cached catalog response could show a stale price
// at the exact moment checkout is about to charge the real, current one.
export async function getPublicPlanCatalog(): Promise<PublicPlanCatalogEntry[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_plan_catalog");

  if (error || !data) {
    console.error("get_public_plan_catalog RPC error:", error?.code, error?.message);
    return null;
  }

  const entries: PublicPlanCatalogEntry[] = [];
  for (const row of data) {
    if (!isPlanCode(row.plan_code)) {
      // Defensive only — the RPC sources plan_code from public.plans, a
      // trusted server table, so this should never happen. Fail closed on
      // the single unrecognized entry rather than surfacing it to a user.
      console.error("get_public_plan_catalog returned an unrecognized plan_code:", row.plan_code);
      continue;
    }
    if (row.billing_period !== "forever" && row.billing_period !== "monthly") {
      console.error("get_public_plan_catalog returned an unrecognized billing_period:", row.billing_period);
      continue;
    }
    entries.push({
      planCode: row.plan_code,
      displayName: row.display_name,
      priceAmount: Number(row.price_amount),
      currency: row.currency,
      billingPeriod: row.billing_period,
      jobMatchLimit: row.job_match_limit,
      coverLetterLimit: row.cover_letter_limit,
    });
  }

  return entries;
}

// Formats a server-resolved amount/currency pair for display — only ever
// called AFTER a real value has come back from getPublicPlanCatalog(),
// never used to invent a price. Whole-dollar amounts render without
// decimals (matching the product's existing "$9"/"$18" visual style);
// a fractional amount still renders with exactly 2 decimal places.
export function formatPlanPrice(priceAmount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(priceAmount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(priceAmount);
}
