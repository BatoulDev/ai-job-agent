export default function StatsGrid({
  stats,
}: {
  stats: { label: string; value: string }[];
}) {
  return (
    <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-2xl border border-slate-200 bg-card p-5 shadow-sm"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            {stat.label}
          </p>
          <p className="mt-2 font-display text-2xl font-semibold text-text">
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}
