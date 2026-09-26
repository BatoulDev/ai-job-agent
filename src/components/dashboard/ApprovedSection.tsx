import EmptyTabState from "./EmptyTabState";
import MatchCard from "./MatchCard";
import CoverLetterCard from "./CoverLetterCard";
import TrustNote from "./TrustNote";
import type { MatchWithJob } from "@/lib/matches/types";
import type { CoverLetterRecord } from "@/lib/coverLetters/types";

// Data fetched once in page.tsx and passed down (get_my_matches('user_approved')
// plus each match's cover_letters row, Phase 08).
export default function ApprovedSection({
  matches,
  isLoading,
  error,
  coverLetters,
  onSaveCoverLetterEdit,
  onApproveCoverLetter,
}: {
  matches: MatchWithJob[] | null;
  isLoading: boolean;
  error: string | null;
  coverLetters: Record<string, CoverLetterRecord>;
  onSaveCoverLetterEdit: (coverLetterId: string, content: string) => Promise<void>;
  onApproveCoverLetter: (coverLetterId: string) => Promise<void>;
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
        matches.map((match) => (
          <div key={match.id}>
            <MatchCard match={match} />
            <CoverLetterCard
              matchId={match.id}
              coverLetter={coverLetters[match.id] ?? null}
              onSaveEdit={onSaveCoverLetterEdit}
              onApprove={onApproveCoverLetter}
            />
          </div>
        ))
      )}
      <TrustNote>Nothing is sent without your final approval.</TrustNote>
    </div>
  );
}
