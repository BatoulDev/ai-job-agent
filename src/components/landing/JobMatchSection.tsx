import JobMatchCard from "./JobMatchCard";

export default function JobMatchSection() {
  return (
    <section className="bg-bg">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            Sample match
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            This is what lands in your feed
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            Every match comes with a score, the reasons behind it, and full
            control over what happens next.
          </p>
        </div>

        <div className="mt-12">
          <JobMatchCard />
        </div>
      </div>
    </section>
  );
}
