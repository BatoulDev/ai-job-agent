// Discovery query for the cover-letter generation step (Phase 08): every
// approved match that doesn't yet have a cover_letters row gets a grounded
// prompt built from its own profile, job, and match-explanation data. A
// match_id uniquely identifies the (user, job, analysis) triple already, so
// — unlike Phase 06's rerank candidates — no compound candidate id is
// needed. Same retry story as Phase 06's rerank: a failed generation attempt
// (OpenAI error, invalid response) simply never writes a row, so the match
// is naturally re-offered as a candidate on the next run — no separate
// 'failed' bookkeeping needed.
//
// Quota: plans.cover_letter_limit caps how many AI-generated drafts a
// user's plan is entitled to (free: 1, student: 8, pro: 15 — see
// 20260802090000_create_plans.sql). A cover_letters row is only ever
// created by a successful generation (a real OpenAI cost already spent —
// AGENTS.md §30 "use model and cost limits appropriate to the user's
// active entitlement"), so counting existing rows per user is the
// entitlement-consuming event.
//
// Billing-period scoping (founder decision, 2026-09-30): Student/Pro are
// monthly subscriptions and the allowance is per paid billing period, not
// lifetime. subscriptions.current_period_start/current_period_end (set by
// activate_subscription — see 20260802090010_create_subscriptions.sql and
// the period-preservation rules in 20260903090000_add_price_versioning_and_
// upgrade_locking.sql's mark_payment_verified) are the real, already-
// existing billing-period fields for any activated paid plan — no new
// period concept is introduced here. A user's count only includes
// cover_letters rows created within [current_period_start,
// current_period_end); once a new period starts (renewal), the count
// naturally resets without any cron/reset job, because it is derived from
// the period window, not a mutated counter. The free plan has no period
// (current_period_start/end stay null forever — billing_period =
// 'forever'), so it keeps its original lifetime-total behavior; that is
// unchanged, not a new rule.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCoverLetterPrompt, type CoverLetterJobInput, type CoverLetterMatchInput, type CoverLetterProfileInput } from "./prompt.ts";
import type { PlanCode } from "@/lib/plans/types";

export interface CoverLetterCandidate {
  matchId: string;
  prompt: string;
}

export async function findCoverLetterCandidates(supabase: SupabaseClient, limit: number): Promise<CoverLetterCandidate[]> {
  const { data: matches, error: matchesError } = await supabase
    .from("matches")
    .select("id, user_id, job_id, cv_analysis_id, explanation, score_breakdown")
    .eq("status", "user_approved")
    .order("score", { ascending: false })
    .limit(limit);
  if (matchesError) throw new Error(`findCoverLetterCandidates: matches query failed: ${matchesError.message}`);
  if (!matches || matches.length === 0) return [];

  const matchIds = matches.map((m) => m.id);
  const { data: existingLetters, error: lettersError } = await supabase.from("cover_letters").select("match_id, user_id").in("match_id", matchIds);
  if (lettersError) throw new Error(`findCoverLetterCandidates: cover_letters query failed: ${lettersError.message}`);

  const matchIdsWithLetters = new Set((existingLetters ?? []).map((row) => row.match_id));
  const pending = matches.filter((m) => !matchIdsWithLetters.has(m.id));
  if (pending.length === 0) return [];

  const remainingQuotaByUser = await computeRemainingQuotaByUser(supabase, [...new Set(pending.map((m) => m.user_id))]);

  const candidates: CoverLetterCandidate[] = [];

  for (const match of pending) {
    const remaining = remainingQuotaByUser.get(match.user_id) ?? 0;
    if (remaining <= 0) continue;

    const { data: analysis, error: analysisError } = await supabase
      .from("cv_analyses")
      .select("professional_summary, skills, strongest_areas, profile_level")
      .eq("id", match.cv_analysis_id)
      .maybeSingle();
    if (analysisError) throw new Error(`findCoverLetterCandidates: analysis lookup failed for ${match.cv_analysis_id}: ${analysisError.message}`);
    if (!analysis) continue;

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("title, description, company_name, location, work_arrangement")
      .eq("id", match.job_id)
      .maybeSingle();
    if (jobError) throw new Error(`findCoverLetterCandidates: job lookup failed for ${match.job_id}: ${jobError.message}`);
    if (!job) continue;

    const profileInput: CoverLetterProfileInput = {
      professionalSummary: analysis.professional_summary,
      skills: (analysis.skills as string[] | null) ?? [],
      strongestAreas: (analysis.strongest_areas as string[] | null) ?? [],
      profileLevel: analysis.profile_level,
    };
    const jobInput: CoverLetterJobInput = {
      title: job.title,
      description: job.description,
      companyName: job.company_name,
      location: job.location,
      workArrangement: job.work_arrangement,
    };
    const breakdown = match.score_breakdown as { strengths?: unknown } | null;
    const strengths = Array.isArray(breakdown?.strengths) ? (breakdown.strengths as string[]) : [];
    const matchInput: CoverLetterMatchInput = { explanation: match.explanation, strengths };

    candidates.push({
      matchId: match.id,
      prompt: buildCoverLetterPrompt(profileInput, jobInput, matchInput),
    });
    remainingQuotaByUser.set(match.user_id, remaining - 1);
  }

  return candidates;
}

/**
 * Returns, per user, how many more cover letters their plan still allows in
 * the relevant window — never negative. For a user with a real billing
 * period (current_period_start AND current_period_end both set — any
 * activated Student/Pro subscription), only cover_letters rows created
 * within that period count. For a user with no period (free plan), the
 * count is their real lifetime total, unchanged from before.
 */
async function computeRemainingQuotaByUser(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const { data: subscriptions, error: subsError } = await supabase
    .from("subscriptions")
    .select("user_id, plan_code, current_period_start, current_period_end")
    .in("user_id", userIds);
  if (subsError) throw new Error(`computeRemainingQuotaByUser: subscriptions query failed: ${subsError.message}`);

  const subscriptionByUser = new Map((subscriptions ?? []).map((s) => [s.user_id, s]));
  const planCodes = [...new Set([...subscriptionByUser.values()].map((s) => (s.plan_code as PlanCode) ?? "free").concat(["free" as PlanCode]))];

  const { data: plans, error: plansError } = await supabase.from("plans").select("plan_code, cover_letter_limit").in("plan_code", planCodes);
  if (plansError) throw new Error(`computeRemainingQuotaByUser: plans query failed: ${plansError.message}`);
  const limitByPlanCode = new Map((plans ?? []).map((p) => [p.plan_code, p.cover_letter_limit]));

  const { data: existingLetters, error: lettersError } = await supabase.from("cover_letters").select("user_id, created_at").in("user_id", userIds);
  if (lettersError) throw new Error(`computeRemainingQuotaByUser: cover_letters count query failed: ${lettersError.message}`);
  const alreadyUsedByUser = new Map<string, number>();
  for (const row of existingLetters ?? []) {
    const subscription = subscriptionByUser.get(row.user_id);
    const periodStart = subscription?.current_period_start ? new Date(subscription.current_period_start) : null;
    const periodEnd = subscription?.current_period_end ? new Date(subscription.current_period_end) : null;
    if (periodStart && periodEnd) {
      const createdAt = new Date(row.created_at as string);
      if (createdAt < periodStart || createdAt >= periodEnd) continue; // outside the current billing period — doesn't count
    }
    alreadyUsedByUser.set(row.user_id, (alreadyUsedByUser.get(row.user_id) ?? 0) + 1);
  }

  const result = new Map<string, number>();
  for (const userId of userIds) {
    const subscription = subscriptionByUser.get(userId);
    const planCode = (subscription?.plan_code as PlanCode | undefined) ?? "free";
    const limit = limitByPlanCode.get(planCode) ?? limitByPlanCode.get("free") ?? 0;
    const used = alreadyUsedByUser.get(userId) ?? 0;
    result.set(userId, Math.max(0, limit - used));
  }
  return result;
}
