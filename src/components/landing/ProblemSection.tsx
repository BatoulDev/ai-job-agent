const PAIN_POINTS = [
  {
    title: "Applying at random",
    description:
      "Without a clear signal on fit, it's easy to spend hours sending applications to roles that were never a real match.",
  },
  {
    title: "No way to know what fits",
    description:
      "Job posts rarely say how your specific background stacks up, so every application feels like a guess.",
  },
  {
    title: "Generic, rushed cover letters",
    description:
      "With limited time, most students send the same template everywhere, which rarely reflects the actual role.",
  },
];

export default function ProblemSection() {
  return (
    <section className="border-y border-slate-200/70 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            The problem
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Job hunting shouldn&apos;t feel like guesswork
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            Students and fresh graduates waste hours applying to roles that
            were never a good fit, with little way to tell which jobs
            actually match their profile.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {PAIN_POINTS.map((point) => (
            <div
              key={point.title}
              className="rounded-2xl border border-slate-200 bg-bg p-6"
            >
              <h3 className="font-display text-lg font-semibold text-text">
                {point.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {point.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
