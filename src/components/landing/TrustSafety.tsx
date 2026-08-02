const COMMITMENTS = [
  {
    title: "Nothing is sent without your approval",
    description:
      "Every match, letter, and application waits for your explicit go-ahead.",
  },
  {
    title: "We do not auto-apply on LinkedIn",
    description:
      "For LinkedIn roles, we only show you the job link and your prepared materials.",
  },
  {
    title: "You control your CV and applications",
    description:
      "Your data is yours. Review, edit, or remove it whenever you want.",
  },
  {
    title: "Every cover letter is editable before sending",
    description: "AI drafts the letter. You always have the final word.",
  },
];

export default function TrustSafety() {
  return (
    <section className="bg-primary">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            Trust &amp; safety
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            You stay in control, always
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-white/70">
            The AI does the searching and drafting. You decide what actually
            goes out.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {COMMITMENTS.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-white/10 bg-white/5 p-6"
            >
              <div className="flex items-start gap-3">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#06B6D4"
                  strokeWidth="2"
                  className="mt-0.5 shrink-0"
                >
                  <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div>
                  <h3 className="font-display text-base font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/70">
                    {item.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
