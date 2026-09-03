import { createClient } from "@/lib/supabase/server";
import type { PayablePlanCode } from "@/lib/plans/types";
import { getWhishProvider } from "@/lib/payments/whish/provider";

export interface PaymentAttemptRow {
  id: string;
  plan_code: string;
  amount: number;
  currency: string;
  status: string;
  checkout_url: string | null;
  // Set only by create_payment_attempt itself when a verified, in-period
  // active Student subscription made this a discounted upgrade — never a
  // client-supplied value. amount already reflects the discount when true.
  is_upgrade: boolean;
}

export interface StartCheckoutResult {
  paymentAttempt: PaymentAttemptRow;
  whishConfigured: boolean;
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

// create_payment_attempt's own quota (PT429, see
// supabase/migrations/20260822160000_add_payment_attempt_create_rate_limit.sql)
// — never raised for a reused in-flight attempt, only for a genuinely new
// one past the rolling-window limit. message is the hand-authored, safe
// string from the RPC itself, never raw Postgres internals.
export class CheckoutRateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutRateLimitedError";
  }
}

// Creates (or reuses, if one is already in flight) a payment attempt for
// the signed-in user and returns whether Whish is actually configured.
// Never activates a subscription and never fabricates a checkout URL —
// see src/lib/payments/whish/provider.ts for why. All trust (auth
// identity, plan validity, price) comes from the database via the
// create_payment_attempt RPC (public.create_payment_attempt), not from
// this function's caller.
export async function startCheckout(
  planCode: PayablePlanCode
): Promise<StartCheckoutResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new NotAuthenticatedError();
  }

  const { data, error } = await supabase.rpc("create_payment_attempt", {
    p_plan_code: planCode,
  });

  if (error || !data) {
    if (error?.code === "PT429") {
      throw new CheckoutRateLimitedError(error.message);
    }
    // student_unavailable_outside_lebanon (raised by the residence-guard
    // trigger on public.payment_attempts, see
    // supabase/migrations/20260806090120_add_student_plan_residence_guard.sql)
    // is a known, stable, hand-authored exception — the route handler
    // matches this exact string to return a distinct 422. Every other
    // message is treated as unknown/internal and never surfaced.
    if (error?.message === "student_unavailable_outside_lebanon") {
      throw new Error("student_unavailable_outside_lebanon");
    }
    // Preserve the real cause server-side (code/message only — this RPC
    // never includes CV content or other sensitive data in its exceptions)
    // before throwing a generic error the route can safely surface.
    console.error("create_payment_attempt RPC error:", error?.code, error?.message);
    throw new Error("Failed to create payment attempt");
  }

  const paymentAttempt = data as PaymentAttemptRow;
  const whishConfigured = getWhishProvider().isConfigured();

  // Real checkout-URL creation is intentionally not attempted here yet —
  // see WhishNotConfiguredError. When official Whish docs/credentials
  // exist, this is where getWhishProvider().createCheckout(...) would be
  // called and its checkout_url persisted onto the payment_attempts row.

  return { paymentAttempt, whishConfigured };
}
