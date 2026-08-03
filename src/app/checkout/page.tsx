"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import { isPayablePlanCode, type PayablePlanCode } from "@/lib/plans/types";

const PLAN_DISPLAY_NAMES: Record<PayablePlanCode, string> = {
  student: "Student",
  pro: "Pro",
};

interface CheckoutState {
  status: "loading" | "error" | "not_available" | "ready" | "ineligible";
  message?: string;
}

function CheckoutPageContent() {
  const searchParams = useSearchParams();
  const planParam = searchParams.get("plan");
  const isValidPlan = isPayablePlanCode(planParam);
  const [state, setState] = useState<CheckoutState>({ status: "loading" });

  useEffect(() => {
    if (!isPayablePlanCode(planParam)) return;

    let isMounted = true;

    async function start(plan: PayablePlanCode) {
      try {
        const response = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planCode: plan }),
        });

        if (response.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent(
            `/checkout?plan=${plan}`
          )}`;
          return;
        }

        if (response.status === 422) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          if (!isMounted) return;
          if (data?.error === "student_unavailable_outside_lebanon") {
            setState({ status: "ineligible" });
            return;
          }
          setState({ status: "error" });
          return;
        }

        if (!response.ok) {
          if (!isMounted) return;
          setState({ status: "error" });
          return;
        }

        const data = (await response.json()) as { whishConfigured: boolean };
        if (!isMounted) return;

        setState(
          data.whishConfigured
            ? { status: "ready" }
            : { status: "not_available" }
        );
      } catch {
        if (isMounted) setState({ status: "error" });
      }
    }

    start(planParam);
    return () => {
      isMounted = false;
    };
  }, [planParam]);

  const planName = isPayablePlanCode(planParam) ? PLAN_DISPLAY_NAMES[planParam] : null;

  return (
    <div className="min-h-screen bg-bg">
      <header className="mx-auto max-w-5xl px-6 py-6 lg:px-8">
        <BrandMark />
      </header>

      <main className="mx-auto max-w-xl px-6 pb-20 pt-4 lg:px-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10">
          {isValidPlan && state.status === "loading" && (
            <p className="text-sm text-muted">Preparing checkout...</p>
          )}

          {!isValidPlan && (
            <>
              <h1 className="font-display text-xl font-semibold text-text">
                We couldn&apos;t find that plan
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                The plan in this link isn&apos;t recognized. Please choose a
                plan again from pricing.
              </p>
              <Link
                href="/#pricing"
                className="mt-6 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark"
              >
                Back to pricing
              </Link>
            </>
          )}

          {state.status === "ineligible" && (
            <>
              <h1 className="font-display text-xl font-semibold text-text">
                Student plan isn&apos;t available for your account
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                The Student plan is currently limited to users residing in
                Lebanon. You can use the Pro plan instead for remote
                opportunities available to applicants in your country — no
                payment has been requested or taken.
              </p>
              <Link
                href="/#pricing"
                className="mt-6 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark"
              >
                Back to pricing
              </Link>
            </>
          )}

          {state.status === "error" && (
            <>
              <h1 className="font-display text-xl font-semibold text-text">
                Something went wrong
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                We couldn&apos;t start checkout. Please try again in a moment.
              </p>
              <Link
                href="/#pricing"
                className="mt-6 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark"
              >
                Back to pricing
              </Link>
            </>
          )}

          {state.status === "not_available" && (
            <>
              <h1 className="font-display text-xl font-semibold text-text">
                {planName} plan checkout
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Online payment is not available yet. Please try again later.
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                We&apos;ve saved your interest in the {planName} plan — no
                payment has been requested or taken. You can keep using your
                Free plan in the meantime.
              </p>
              <Link
                href="/dashboard"
                className="mt-6 inline-block rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark"
              >
                Go to dashboard
              </Link>
            </>
          )}

          {state.status === "ready" && (
            <p className="text-sm text-muted">Redirecting to checkout...</p>
          )}
        </div>
      </main>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutPageContent />
    </Suspense>
  );
}
