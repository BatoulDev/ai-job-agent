import EmptyTabState from "./EmptyTabState";

// No matching worker exists yet, so no match has ever actually been
// rejected by any user — this is an honest empty state, not a placeholder
// for fake results (Automation-1 audit item 7).
export default function RejectedSection() {
  return (
    <EmptyTabState
      title="No rejected matches yet"
      message="Matches you decide to pass on will appear here."
    />
  );
}
