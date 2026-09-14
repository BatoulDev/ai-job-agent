import PricingCta from "./PricingCta";
import type { PlanCode } from "@/lib/plans/types";
import { createClient } from "@/lib/supabase/server";
import { getPublicPlanCatalog, formatPlanPrice } from "@/lib/plans/getPublicPlanCatalog";

// Confirmed MVP market: this product supports only users currently
// residing in Lebanon (AGENTS.md). There is no selectable residence
// experience — Student is always available, and Pro's only geographic
// difference is the optional (Pro-only) international job search
// configured in onboarding/settings, not a resident-country distinction.
//
// PRESENTATION content only — no price, currency, or billing period lives
// here. The real, current, checkout-authoritative price for every plan
// comes exclusively from public.get_public_plan_catalog() (see
// src/lib/plans/getPublicPlanCatalog.ts) — never a frontend constant, and
// never duplicated here. A future backend price change (via the
// service-role-only publish_price_version RPC, see docs/PRICING.md) shows
// up on this page after a normal refresh with zero edits to this file.
//
// originalPrice/offer below are a static "launch discount" marketing
// framing, not a real historical price row anywhere in the database — kept
// as presentational copy only, per the same reasoning "features"/"cta"
// are presentational: they carry no billing authority and nothing is ever
// charged based on them.
const PLAN_PRESENTATION: Record<
  PlanCode,
  {
    name: string;
    originalPrice?: string;
    description?: string;
    badge?: string;
    offer?: string;
    features: string[];
    cta: string;
    highlighted: boolean;
  }
> = {
  free: {
    name: "Free",
    description: "Try your first AI job match.",
    features: [
      "1 best available job match per month",
      "Match score + basic explanation",
      "1 sample AI cover letter per month",
      "Application tracking dashboard",
      "Manual application link only",
      "No email sending",
    ],
    cta: "Start Free",
    highlighted: false,
  },
  student: {
    name: "Student",
    originalPrice: "$18",
    badge: "Most popular",
    offer: "Launch offer",
    features: [
      "Daily curated job search for Lebanon-focused opportunities",
      "Up to 25 curated matches per month, depending on fit and availability",
      "Match score + missing skills explanation",
      "8 AI-tailored cover letters per month",
      "1 free cover letter revision per cover letter",
      "Application tracking dashboard",
      "Email-apply jobs sent only after final approval",
      "Best for students and fresh graduates targeting Lebanon-based or Lebanon-friendly roles",
    ],
    cta: "Get Student Plan",
    highlighted: true,
  },
  pro: {
    name: "Pro",
    originalPrice: "$29",
    offer: "Launch offer",
    features: [
      "Everything in Student, for Lebanon-based matching",
      "Optional: expand your search outside Lebanon",
      "Verified international remote roles that accept Lebanon-based applicants",
      "Optional relocation to Saudi Arabia, Qatar, Kuwait, or the UAE",
      "Up to 45 curated matches per month",
      "Match score + missing skills explanation",
      "15 AI-tailored cover letters per month",
      "Up to 3 cover letter revisions per cover letter",
      "Application tracking dashboard",
      "Email-apply jobs sent only after final approval",
    ],
    cta: "Go Pro",
    highlighted: false,
  },
};

// Every plan code this page knows how to present. If the server catalog is
// missing any one of these (misconfiguration, or a plan deliberately
// deactivated), the whole section fails closed to the unavailable state
// below rather than rendering a partial/confusing pricing table or
// inventing a price for the missing plan.
const EXPECTED_PLAN_CODES: PlanCode[] = ["free", "student", "pro"];

// Server Component: reads the signed-in user's current subscription only
// to relabel the Pro card as an upgrade for an active Student (never to
// gate availability — Student is always available; MVP supports only
// Lebanon-based users, so there is no residence-based restriction here).
// The displayed upgrade price, if any, is never computed here — the
// server-verified amount comes back from create_payment_attempt at
// checkout time (src/app/checkout/page.tsx), never a client estimate.
export default async function Pricing() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isActiveStudent = false;
  if (user) {
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("plan_code, status")
      .eq("user_id", user.id)
      .maybeSingle();
    isActiveStudent = subscription?.plan_code === "student" && subscription?.status === "active";
  }

  const catalog = await getPublicPlanCatalog();
  const catalogByPlanCode = new Map(catalog?.map((entry) => [entry.planCode, entry]));
  // Fail closed: only render the pricing table (and its checkout buttons)
  // when EVERY plan this page presents actually came back from the server
  // catalog. A partial or empty result never renders a stale/invented
  // price or a checkout button that could start a mispriced attempt.
  const pricingAvailable =
    catalog !== null && EXPECTED_PLAN_CODES.every((code) => catalogByPlanCode.has(code));

  const plans = pricingAvailable
    ? EXPECTED_PLAN_CODES.map((planCode) => {
        const entry = catalogByPlanCode.get(planCode)!;
        const presentation = PLAN_PRESENTATION[planCode];
        return {
          planCode,
          ...presentation,
          price: formatPlanPrice(entry.priceAmount, entry.currency),
          period: entry.billingPeriod === "forever" ? "/ forever" : "/ month",
        };
      })
    : [];

  return (
    <section id="pricing" className="bg-white">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            Pricing
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Simple plans, no surprises
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            Pricing shown for preview. Beta access is free while we launch.
          </p>
        </div>

        {!pricingAvailable && (
          <div className="mx-auto mt-14 max-w-xl rounded-3xl border border-slate-200 bg-bg p-8 text-center">
            <p className="text-sm font-medium text-text">
              Pricing is temporarily unavailable. Please check back shortly.
            </p>
          </div>
        )}

        {pricingAvailable && (
        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {plans.map((plan) => {
            const isUpgradeCard = plan.planCode === "pro" && isActiveStudent;

            return (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-3xl border p-8 ${
                plan.highlighted
                  ? "border-primary bg-primary text-white shadow-xl shadow-primary/20 lg:-translate-y-3"
                  : "border-slate-200 bg-bg text-text"
              }`}
            >
              {plan.badge && (
                <span className="absolute -top-3 left-8 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white">
                  {plan.badge}
                </span>
              )}

              <h3 className="font-display text-lg font-semibold">
                {plan.name}
              </h3>
              {plan.description && (
                <p
                  className={`mt-1 text-sm ${
                    plan.highlighted ? "text-white/70" : "text-muted"
                  }`}
                >
                  {plan.description}
                </p>
              )}

              <div className="mt-5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {plan.originalPrice && (
                    <span className="relative inline-block">
                      <span
                        className={`text-base font-medium ${
                          plan.highlighted ? "text-white" : "text-slate-500"
                        }`}
                      >
                        {plan.originalPrice}
                      </span>
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-[-2px] top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-red-500"
                      />
                    </span>
                  )}
                  <span className="font-display text-3xl font-bold">
                    {plan.price}
                  </span>
                  <span
                    className={
                      plan.highlighted ? "text-white/70" : "text-muted"
                    }
                  >
                    {plan.period}
                  </span>
                </div>
                {plan.offer && (
                  <span
                    className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      plan.highlighted
                        ? "bg-white/15 text-white ring-1 ring-inset ring-white/25"
                        : "bg-red-50 text-red-600 ring-1 ring-inset ring-red-200"
                    }`}
                  >
                    {plan.offer}
                  </span>
                )}
              </div>

              <ul className="mt-6 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={plan.highlighted ? "#06B6D4" : "#10B981"}
                      strokeWidth="2.5"
                      className="mt-0.5 shrink-0"
                    >
                      <path
                        d="m5 13 4 4L19 7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              <PricingCta
                planCode={plan.planCode}
                className={`mt-8 block rounded-full py-2.5 text-center text-sm font-semibold transition-colors ${
                  plan.highlighted
                    ? "bg-white text-primary hover:bg-white/90"
                    : "bg-primary text-white hover:bg-primary-dark"
                }`}
              >
                {isUpgradeCard ? "Upgrade to Pro" : plan.cta}
              </PricingCta>
              {isUpgradeCard && (
                <p className={`mt-2 text-center text-xs leading-relaxed ${plan.highlighted ? "text-white/70" : "text-muted"}`}>
                  As an active Student, you only pay the verified difference — calculated at checkout.
                </p>
              )}
            </div>
            );
          })}
        </div>
        )}

        <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-muted">
          Match limits are monthly maximums, not guarantees. We prioritize
          relevant opportunities over volume, so some users may receive fewer
          matches if there are not enough strong-fit jobs available.
        </p>

        <p className="mx-auto mt-4 max-w-3xl text-center text-sm leading-relaxed text-muted">
          All plans are approval-first. We never auto-apply on LinkedIn, and
          we never send anything without your confirmation. Free users get
          manual application links only. Student and Pro users can send
          email-apply jobs after final approval; ATS, company forms, and
          LinkedIn jobs are prepared for manual application.
        </p>
      </div>
    </section>
  );
}
