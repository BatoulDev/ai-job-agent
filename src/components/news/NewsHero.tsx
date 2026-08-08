export default function NewsHero() {
  return (
    <section className="relative overflow-hidden border-b border-slate-200/70 bg-white">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_85%_-10%,rgba(6,182,212,0.10),transparent)]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(50%_40%_at_5%_110%,rgba(30,58,138,0.06),transparent)]" />

      <div className="mx-auto max-w-3xl px-6 py-10 text-center sm:py-12 lg:px-8">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-primary/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
          AI &amp; Tech News
        </span>
        <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
          Your Daily AI Brief
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-muted">
          Five important AI and technology updates, summarized so you can
          stay current in just a few minutes.
        </p>
      </div>
    </section>
  );
}
