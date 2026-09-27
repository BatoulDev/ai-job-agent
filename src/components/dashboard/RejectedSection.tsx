import EmptyTabState from "./EmptyTabState";
import MatchCard from "./MatchCard";
import type { MatchWithJob } from "@/lib/matches/types";

// Data fetched once in page.tsx and passed down (get_my_matches('user_rejected')).
export default function RejectedSection({
  matches,
  isLoading,
  error,
}: {
  matches: MatchWithJob[] | null;
  isLoading: boolean;
  error: string | null;
}) {
  if (isLoading) {
    return <p className="text-sm text-muted">Loading your rejected matches...</p>;
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
    );
  }

  if (!matches || matches.length === 0) {
    return (
      <EmptyTabState
        title="No rejected matches yet"
        message="Matches you decide to pass on will appear here."
      />
    );
  }

  return (
    <div className="space-y-6">
      {matches.map((match) => (
        <MatchCard key={match.id} match={match} />
      ))}
    </div>
  );
}
