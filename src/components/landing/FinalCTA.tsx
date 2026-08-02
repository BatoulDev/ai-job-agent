import JoinBetaButton from "./JoinBetaButton";

export default function FinalCTA() {
  return (
    <section id="join-beta" className="bg-white">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary-dark px-8 py-16 text-center sm:px-16">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_50%_0%,rgba(6,182,212,0.25),transparent)]" />

          <h2 className="relative font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Start applying smarter, not harder.
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-lg text-white/70">
            Join the beta and let your AI Job Agent find the matches worth
            your time.
          </p>
          <div className="relative mt-9">
            <JoinBetaButton className="inline-block rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-primary shadow-lg transition-colors hover:bg-white/90" />
          </div>
        </div>
      </div>
    </section>
  );
}
