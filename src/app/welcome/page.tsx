import Link from "next/link";
import BrandMark from "@/components/BrandMark";

export default function WelcomePage() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="mx-auto max-w-5xl px-6 py-6 lg:px-8">
        <BrandMark />
      </header>

      <main className="mx-auto max-w-4xl px-6 pb-20 pt-4 lg:px-8">
        <div className="text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Welcome to AI Job Agent
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted">
            Choose what you want to do first.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="flex flex-col rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path
                  d="M12 15V4m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-text">
              Start job matching
            </h2>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">
              Upload your CV so your AI Job Agent can analyze your profile,
              find relevant jobs, and prepare application materials.
            </p>
            <Link
              href="/onboarding/upload-cv"
              className="mt-6 inline-block w-full rounded-full bg-primary px-6 py-3 text-center text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-colors hover:bg-primary-dark"
            >
              Upload my CV
            </Link>
          </div>

          <div className="flex flex-col rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path
                  d="M4 5h13a2 2 0 0 1 2 2v11a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5Zm0 0a2 2 0 0 0-2 2v9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M8 9h7M8 13h7M8 17h4" strokeLinecap="round" />
              </svg>
            </span>
            <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-text">
              Explore AI/Tech News
            </h2>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">
              Not ready to upload your CV yet? Explore free AI and tech
              updates made for students and fresh graduates.
            </p>
            <Link
              href="/news"
              className="mt-6 inline-block w-full rounded-full border border-slate-300 px-6 py-3 text-center text-sm font-semibold text-text transition-colors hover:border-primary hover:text-primary"
            >
              Read AI/Tech News
            </Link>
          </div>
        </div>

        <p className="mt-8 text-center text-xs leading-relaxed text-muted">
          You can upload your CV anytime later from the dashboard or
          navigation.
        </p>
      </main>
    </div>
  );
}
