const STEPS = [
  "Create account",
  "Upload CV",
  "Set preferences",
  "Review AI Profile",
  "Get matches",
];

export default function OnboardingProgress({
  currentStep,
}: {
  currentStep: number;
}) {
  return (
    <ol className="flex items-start justify-between">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const isComplete = step < currentStep;
        const isActive = step === currentStep;

        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-2">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isComplete
                    ? "bg-success text-white"
                    : isActive
                      ? "bg-primary text-white"
                      : "bg-slate-200 text-muted"
                }`}
              >
                {isComplete ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <path
                      d="m5 13 4 4L19 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  step
                )}
              </span>
              <span
                className={`max-w-[5.5rem] text-center text-[11px] font-medium leading-tight sm:text-xs ${
                  isActive
                    ? "text-primary"
                    : isComplete
                      ? "text-text"
                      : "text-muted"
                }`}
              >
                {label}
              </span>
            </div>

            {step !== STEPS.length && (
              <div
                className={`mx-2 mt-4 h-px flex-1 ${
                  isComplete ? "bg-success" : "bg-slate-200"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
