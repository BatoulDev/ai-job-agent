import EmptyTabState from "./EmptyTabState";
import TrustNote from "./TrustNote";

// No matching worker exists yet, so no real match has ever been approved
// by any user — this is an honest empty state, not a placeholder for fake
// results (Automation-1 audit item 7).
export default function ApprovedSection() {
  return (
    <div className="space-y-6">
      <EmptyTabState
        title="No approved matches yet"
        message="Matches you approve will appear here, ready to review before anything is sent."
      />
      <TrustNote>Nothing is sent without your final approval.</TrustNote>
    </div>
  );
}
