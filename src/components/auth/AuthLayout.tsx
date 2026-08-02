import BrandMark from "@/components/BrandMark";

const VALUE_BULLETS = [
  "Upload your CV once",
  "Get curated job matches",
  "Review match scores and missing skills",
  "Approve before anything is sent",
];

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-bg">
      <header className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <BrandMark />
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 items-start gap-12 px-4 pb-16 pt-4 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:pb-24">
        <div className="mx-auto w-full max-w-[480px]">{children}</div>

        <div className="relative hidden overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary-dark p-10 text-white lg:sticky lg:top-10 lg:block">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_80%_0%,rgba(6,182,212,0.25),transparent)]" />

          <div className="relative">
            <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight">
              Apply smarter with your AI Job Agent
            </h2>

            <ul className="mt-8 space-y-4">
              {VALUE_BULLETS.map((bullet) => (
                <li
                  key={bullet}
                  className="flex items-start gap-3 text-sm text-white/85"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#06B6D4"
                    strokeWidth="2.5"
                    className="mt-0.5 shrink-0"
                  >
                    <path
                      d="m5 13 4 4L19 7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {bullet}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
