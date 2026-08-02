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
    throw new Error(error?.message ?? "Failed to create payment attempt");
  }

  const paymentAttempt = data as PaymentAttemptRow;
  const whishConfigured = getWhishProvider().isConfigured();

  // Real checkout-URL creation is intentionally not attempted here yet —
  // see WhishNotConfiguredError. When official Whish docs/credentials
  // exist, this is where getWhishProvider().createCheckout(...) would be
  // called and its checkout_url persisted onto the payment_attempts row.

  return { paymentAttempt, whishConfigured };
}
