import { NextResponse } from "next/server";
import { isPayablePlanCode } from "@/lib/plans/types";
import { startCheckout, NotAuthenticatedError } from "@/lib/payments/checkout";

// Starts (or resumes) a paid-plan checkout attempt for the signed-in user.
// Never activates a subscription and never returns a fabricated checkout
// URL — see src/lib/payments/whish/provider.ts. Idempotent: calling this
// again while an attempt is still in flight returns the same attempt
// (enforced in the create_payment_attempt database function), so a page
// refresh can never create a duplicate.
export async function POST(request: Request) {
  let planCode: string | undefined;

  try {
    const body = (await request.json()) as { planCode?: unknown };
    if (typeof body.planCode === "string") {
      planCode = body.planCode;
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!isPayablePlanCode(planCode)) {
    return NextResponse.json({ error: "Unknown or invalid plan" }, { status: 400 });
  }

  try {
    const { paymentAttempt, whishConfigured } = await startCheckout(planCode);
    return NextResponse.json({ paymentAttempt, whishConfigured });
  } catch (error) {
    if (error instanceof NotAuthenticatedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // A known, expected validation outcome (Student is only available to
    // Lebanon-based users — see create_payment_attempt in
    // supabase/migrations/20260806090120_add_student_plan_residence_guard.sql),
    // not an internal error — surface it distinctly (AGENTS.md §19:
    // distinguish validation errors from unexpected errors).
    if (error instanceof Error && error.message === "student_unavailable_outside_lebanon") {
      return NextResponse.json({ error: "student_unavailable_outside_lebanon" }, { status: 422 });
    }

    // Do not expose internal error details to the client (AGENTS.md §6/§19).
    console.error("Checkout attempt failed:", error);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 500 }
    );
  }
}
