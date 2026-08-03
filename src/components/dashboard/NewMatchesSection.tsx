import MatchCard from "./MatchCard";
import { NEW_MATCHES } from "@/lib/dashboardData";

// This component is only ever reached once LockedMatchesNotice's gate
// (dashboard/page.tsx's isProfileApproved) is satisfied — no job-matching
// automation exists yet, so that gate is never actually open for a real
// user today. The content below is still the pre-existing mock data, not
// wired to anything real.
//
// Future UX contract (not implemented — no matching backend exists yet):
// immediately after approval, before real matches exist, this component
// should show a processing state here — not a full-screen loader —
// reading exactly:
//   "We're finding high-quality matches for you. Your first matches will
//   appear here soon."
// That requires a real backend signal (e.g. a matching-run status) this
// phase does not add. See the CV Analysis / job-matching backend phases.
export default function NewMatchesSection() {
  return (
    <div className="space-y-6">
      {NEW_MATCHES.map((match) => (
        <MatchCard key={match.id} match={match} />
      ))}
    </div>
  );
}
