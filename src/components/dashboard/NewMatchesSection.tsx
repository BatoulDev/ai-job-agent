import EmptyTabState from "./EmptyTabState";

// Gated by dashboard/page.tsx's isProfileApproved (the full matching-
// eligibility condition — see is_cv_analysis_matching_eligible() in
// supabase/migrations/20260825100010_add_matching_eligibility_gate.sql).
// No job-ingestion or matching worker exists yet, so real matches are
// never available — this renders an honest empty state, not a placeholder
// for fake results (Automation-1 audit item 7).
export default function NewMatchesSection() {
  return (
    <EmptyTabState
      title="No matches yet"
      message="Your AI Job Agent hasn't found any job matches yet. Once job matching is live, new opportunities will appear here for your review."
    />
  );
}
