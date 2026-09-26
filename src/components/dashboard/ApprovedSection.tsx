import EmptyTabState from "./EmptyTabState";
import MatchCard from "./MatchCard";
import TrustNote from "./TrustNote";
import type { MatchWithJob } from "@/lib/matches/types";

// Data fetched once in page.tsx and passed down (get_my_matches('user_approved')).
export default function ApprovedSection({
  matches,
  isLoading,
  error,
}: {
  matches: MatchWithJob[] | null;
  isLoading: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-6">
      {isLoading ? (
        <p className="text-sm text-muted">Loading your approved matches...</p>
      ) : error ? (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
      ) : !matches || matches.length === 0 ? (
        <EmptyTabState
          title="No approved matches yet"
          message="Matches you approve will appear here, ready to review before anything is sent."
        />
      ) : (
        matches.map((match) => <MatchCard key={match.id} match={match} />)
      )}
      <TrustNote>Nothing is sent without your final approval.</TrustNote>
    </div>
  );
}
