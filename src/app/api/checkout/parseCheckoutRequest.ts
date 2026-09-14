// Type-only import: erased at compile time (and by Node's native TS
// stripping under `node --test`, which imports this module directly from
// tests/unit/checkout-request-tampering.test.mjs) — never needs runtime
// resolution of the "@/" path alias, which only Next.js's own bundler
// understands. This file is otherwise fully self-contained, matching the
// convention already used by src/lib/cvAnalysis/confirm.client.ts.
import type { PayablePlanCode } from "@/lib/plans/types";

export type ParseCheckoutRequestResult =
  | { ok: true; planCode: PayablePlanCode }
  | { ok: false; error: string };

// Deliberately small, local, runtime-only duplicate of
// PAYABLE_PLAN_CODES (src/lib/plans/types.ts) — see the import comment
// above for why this file cannot import that runtime value directly. This
// is an authorization allowlist (which plan codes are purchasable), never
// a price/money value — the actual amount is always resolved server-side
// by public.create_payment_attempt, never derived from this list. Keep in
// sync if a plan is ever added to or removed from PAYABLE_PLAN_CODES.
function isPayablePlanCode(value: unknown): value is PayablePlanCode {
  return value === "student" || value === "pro";
}

// Strict allowlist: the ONLY field POST /api/checkout ever accepts from the
// client is planCode — a stable plan code, never a price, currency,
// discount, upgrade credit, price-version id, billing-period date,
// entitlement, or payment status. Any other key is rejected outright, not
// silently ignored, so a client can never even attempt to influence what
// gets charged — every money value is derived server-side from
// public.create_payment_attempt (see src/lib/payments/checkout.ts).
// Pure and side-effect-free so it can be unit-tested without a Next.js
// request context. See docs/PRICING.md.
export function parseCheckoutRequestBody(body: unknown): ParseCheckoutRequestResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body" };
  }

  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "planCode") {
    return { ok: false, error: "Unexpected field in checkout request" };
  }

  const planCode = (body as Record<string, unknown>).planCode;
  if (typeof planCode !== "string" || !isPayablePlanCode(planCode)) {
    return { ok: false, error: "Unknown or invalid plan" };
  }

  return { ok: true, planCode };
}
