const FEATURES = [
  {
    title: "CV analysis",
    description:
      "Your CV is parsed into skills, experience, and strengths the moment you upload it.",
    icon: (
      <path
        d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z M14 3v5h5 M9 13h6 M9 17h6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Daily job matching",
    description:
      "New, relevant openings are surfaced every day, so you're never starting from a blank search.",
    icon: (
      <path
        d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Match score explanation",
    description:
      "Every job comes with a clear score and the specific reasons behind it, not just a number.",
    icon: (
      <path
        d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 8v4l3 2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Missing skills detection",
    description:
      "See exactly which skills would strengthen your fit for a role before you apply.",
    icon: (
      <path
        d="M12 9v4m0 4h.01 M10.3 3.86 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.86a2 2 0 0 0-3.4 0Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "AI cover letter generation",
    description:
      "A tailored draft is written for every job you approve, grounded in your real background.",
    icon: (
      <path
        d="M4 4h16v16H4z M8 8h8M8 12h8M8 16h4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Approval before sending",
    description:
      "Nothing goes out on your behalf. You review and approve every match and every letter.",
    icon: (
      <path
        d="m5 13 4 4L19 7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Application tracking",
    description:
      "Keep a clear view of what you've approved, sent, and heard back on, all in one place.",
    icon: (
      <path
        d="M9 17V9m6 8V5M4 21h16M4 21V11m0 10h.01"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

export default function Features() {
  return (
    <section id="features" className="bg-white">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            Features
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Everything you need to apply with confidence
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-slate-200 p-6 transition-colors hover:border-primary/30"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/5 text-primary">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  {feature.icon}
                </svg>
              </div>
              <h3 className="mt-4 font-display text-base font-semibold text-text">
                {feature.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
