// Stable plan codes, matching the public.plans.plan_code check constraint
// exactly (supabase/migrations/20260802090000_create_plans.sql). This list
// is only used for shape-level validation of things like URL query params
// — never as a source of price or limit truth. Trusted numbers always come
// from the public.plans table via a server-side query.
export const PLAN_CODES = ["free", "student", "pro"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const PAYABLE_PLAN_CODES = ["student", "pro"] as const;
export type PayablePlanCode = (typeof PAYABLE_PLAN_CODES)[number];

export function isPlanCode(value: string | null | undefined): value is PlanCode {
  return !!value && (PLAN_CODES as readonly string[]).includes(value);
}

export function isPayablePlanCode(
  value: string | null | undefined
): value is PayablePlanCode {
  return !!value && (PAYABLE_PLAN_CODES as readonly string[]).includes(value);
}

export interface Plan {
  planCode: PlanCode;
  displayName: string;
  priceAmount: number;
  currency: string;
  billingPeriod: "forever" | "monthly";
  isActive: boolean;
  jobMatchLimit: number;
  coverLetterLimit: number;
}
