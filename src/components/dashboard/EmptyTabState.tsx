// Honest "nothing here yet" state for dashboard tabs with no real backing
// data source yet — no job-ingestion or matching worker exists (that is
// Automation 2's job). Used instead of the fixed mock cards these tabs
// used to render unconditionally, which implied real matches/applications
// that had never actually happened for any user (Automation-1 audit item 7).
export default function EmptyTabState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-slate-300 bg-card px-6 py-14 text-center shadow-sm">
      <h3 className="font-display text-base font-semibold text-text">{title}</h3>
      <p className="max-w-sm text-sm leading-relaxed text-muted">{message}</p>
    </div>
  );
}
