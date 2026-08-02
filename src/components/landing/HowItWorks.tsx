const STEPS = [
  {
    number: "01",
    title: "Upload your CV",
    description: "One upload is all it takes to get started.",
  },
  {
    number: "02",
    title: "AI analyzes your profile",
    description: "We read your skills, experience, and strengths.",
  },
  {
    number: "03",
    title: "Get daily job matches",
    description: "Relevant openings land in your feed every day.",
  },
  {
    number: "04",
    title: "Review and approve",
    description: "See your match score and decide what's worth pursuing.",
  },
  {
    number: "05",
    title: "Apply with a tailored letter",
    description: "A customized cover letter, ready after your approval.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-bg">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            How it works
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Five steps from CV to offer
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-5 lg:gap-6">
          {STEPS.map((step, index) => (
            <div key={step.number} className="relative">
              {index < STEPS.length - 1 && (
                <div className="absolute left-0 right-0 top-6 hidden h-px bg-slate-200 lg:block lg:left-[calc(50%+28px)] lg:right-[calc(-50%+28px)]" />
              )}
              <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary font-display text-sm font-semibold text-white">
                {step.number}
              </div>
              <h3 className="mt-4 font-display text-base font-semibold text-text">
                {step.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
