import EmptyTabState from "./EmptyTabState";
import MatchCard from "./MatchCard";
import type { MatchWithJob } from "@/lib/matches/types";

// Gated by dashboard/page.tsx's isProfileApproved (the full matching-
// eligibility condition — see is_cv_analysis_matching_eligible() in
// supabase/migrations/20260825100010_add_matching_eligibility_gate.sql).
// Data is fetched once in page.tsx (surfaceAndFetchPendingMatches) and
// passed down, matching the existing CvProfileSection/PreferencesSection
// convention rather than each tab self-fetching.
export default function NewMatchesSection({
  matches,
  isLoading,
  error,
  onApprove,
  onReject,
}: {
  matches: MatchWithJob[] | null;
  isLoading: boolean;
  error: string | null;
  onApprove: (matchId: string) => Promise<void>;
  onReject: (matchId: string) => Promise<void>;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted">Loading your matches...</p>;
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
    );
  }

  if (!matches || matches.length === 0) {
    return (
      <EmptyTabState
        title="No matches yet"
        message="Your AI Job Guide hasn't found any job matches yet. Check back soon — new opportunities appear here as they're found."
      />
    );
  }

  return (
    <div className="space-y-6">
      {matches.map((match) => (
        <MatchCard key={match.id} match={match} onApprove={onApprove} onReject={onReject} />
      ))}
    </div>
  );
}
