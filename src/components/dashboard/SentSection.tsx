import EmptyTabState from "./EmptyTabState";

// No matching/application worker exists yet, so no application has ever
// actually been sent for any user — this is an honest empty state, not a
// placeholder for a fake "Sent Today" event (Automation-1 audit item 7).
export default function SentSection() {
  return (
    <EmptyTabState
      title="Nothing sent yet"
      message="Applications you've approved and sent will appear here."
    />
  );
}
