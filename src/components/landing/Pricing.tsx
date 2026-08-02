import PricingCta from "./PricingCta";
import type { PlanCode } from "@/lib/plans/types";

// Marketing copy below (price, limits) must match the canonical values in
// public.plans exactly (supabase/migrations/20260802090000_create_plans.sql).
// That table — not this file — is what server-side entitlement and
// payment-amount checks read; if pricing ever changes, update the
// migration first, then this copy to match.
const PLANS: {
  planCode: PlanCode;
  name: string;
  price: string;
  originalPrice?: string;
  period: string;
  description?: string;
  badge?: string;
  offer?: string;
  features: string[];
  cta: string;
  highlighted: boolean;
}[] = [
  {
    planCode: "free",
    name: "Free",
    price: "$0",
    period: "/ forever",
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
  {
    planCode: "student",
    name: "Student",
    price: "$9",
    originalPrice: "$18",
    period: "/ month",
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
  {
    planCode: "pro",
    name: "Pro",
    price: "$18",
    originalPrice: "$29",
    period: "/ month",
    offer: "Launch offer",
    features: [
      "Expanded MENA + region-friendly job coverage",
      "Local, hybrid, remote, and timezone-friendly opportunities",
      "Up to 45 curated matches per month",
      "Match score + missing skills explanation",
      "15 AI-tailored cover letters per month",
      "Up to 3 cover letter revisions per cover letter",
      "Application tracking dashboard",
      "Email-apply jobs sent only after final approval",
      "Best for users targeting wider local, remote, MENA, and region-friendly opportunities",
    ],
    cta: "Go Pro",
    highlighted: false,
  },
];

export default function Pricing() {
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

        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => (
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
                {plan.cta}
              </PricingCta>
            </div>
          ))}
        </div>

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
