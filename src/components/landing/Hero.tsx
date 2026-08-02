import HeroMatchPreview from "./HeroMatchPreview";
import JoinBetaButton from "./JoinBetaButton";

export default function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_80%_0%,rgba(6,182,212,0.08),transparent)]" />

      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 px-6 py-20 lg:grid-cols-2 lg:gap-12 lg:px-8 lg:py-28">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary">
            Now in beta · Built for Lebanon, expanding to MENA & remote
          </span>

          <h1 className="mt-6 font-display text-4xl font-semibold leading-[1.1] tracking-tight text-text sm:text-5xl lg:text-6xl">
            Your AI Job Agent for{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Smarter Applications
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Upload your CV once. Get matched with relevant jobs every day.
            Review, approve, and apply with confidence.
          </p>

          <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
            <JoinBetaButton className="rounded-full bg-primary px-7 py-3.5 text-center text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark" />
            <a
              href="#how-it-works"
              className="rounded-full px-7 py-3.5 text-center text-sm font-semibold text-text transition-colors hover:text-primary"
            >
              See How It Works →
            </a>
          </div>

          <p className="mt-8 text-sm text-muted">
            No auto-applying on LinkedIn. Nothing sent without your approval.
          </p>
        </div>

        <HeroMatchPreview />
      </div>
    </section>
  );
}
