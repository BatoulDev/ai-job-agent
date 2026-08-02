"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSupabaseUser } from "@/lib/supabase/useSupabaseUser";
import type { PlanCode } from "@/lib/plans/types";

// Routes each pricing card's button based on real session state, the same
// pattern as JoinBetaButton. Free always leads to CV upload (a free
// entitlement is created automatically at signup — no payment step).
// Student/Pro lead to /checkout, which creates a trusted payment attempt
// and is honest about Whish not being configured yet. A query param is
// only ever an intention here — the destination route is what actually
// enforces it server-side (src/proxy.ts protects /checkout and
// /onboarding; the checkout API validates the plan against the database).
export default function PricingCta({
  planCode,
  className,
  children,
}: {
  planCode: PlanCode;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user } = useSupabaseUser();

  const destination =
    planCode === "free"
      ? user
        ? "/onboarding/upload-cv"
        : "/signup?next=/onboarding/upload-cv"
      : user
        ? `/checkout?plan=${planCode}`
        : `/signup?next=${encodeURIComponent(`/checkout?plan=${planCode}`)}`;

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    router.push(destination);
  };

  return (
    <Link href="/signup" onClick={handleClick} className={className}>
      {children}
    </Link>
  );
}
