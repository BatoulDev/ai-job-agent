const COPY = {
  empty: {
    title: "Today's brief is on its way",
    description:
      "We haven't published today's AI & tech brief yet. Check back a little later — new updates land here once they're ready.",
  },
  unavailable: {
    title: "Brief temporarily unavailable",
    description:
      "We couldn't load the daily brief right now. Please check back soon — everything else on the site is working as usual.",
  },
} as const;

export default function NewsStatusCard({
  variant,
}: {
  variant: "empty" | "unavailable";
}) {
  const { title, description } = COPY[variant];

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path
            d="M4 5h16M4 5v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V5M4 5l1.5-2h13L20 5M9 10h6M9 14h6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="font-display text-lg font-semibold tracking-tight text-text sm:text-xl">
        {title}
      </h2>
      <p className="text-sm leading-relaxed text-muted">{description}</p>
    </div>
  );
}
