import Link from "next/link";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import { getLatestDailyNewsBriefs } from "@/lib/dailyNews/getLatestDailyNewsBriefs";

// Content changes at most once a day (the ai-tech-daily-news GitHub Action),
// so the page is regenerated in the background at most once per hour
// instead of querying Supabase on every visit.
export const revalidate = 3600;

function formatBriefDate(briefDate: string): string {
  const [year, month, day] = briefDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export default async function NewsPage() {
  const result = await getLatestDailyNewsBriefs();

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <section className="border-b border-slate-200/70 bg-white">
          <div className="mx-auto max-w-3xl px-6 py-16 text-center lg:px-8">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-accent">
              Free daily brief
            </span>
            <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight text-text sm:text-5xl">
              AI & Tech News
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-muted">
              A simple daily brief of AI and tech updates, curated
              automatically for students and young builders.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-16 lg:px-8">
          {result.status === "unavailable" ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
              <h2 className="font-display text-xl font-semibold tracking-tight text-text sm:text-2xl">
                Brief temporarily unavailable
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                We couldn&apos;t load today&apos;s AI/tech brief right now.
                Please check back soon.
              </p>
            </div>
          ) : result.briefs.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
              <h2 className="font-display text-xl font-semibold tracking-tight text-text sm:text-2xl">
                No brief yet
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Today&apos;s AI/tech brief hasn&apos;t been published yet.
                Check back soon.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-10">
              {result.briefs.map((brief, briefIndex) => (
                <div
                  key={brief.id}
                  className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
                >
                  <div className="flex flex-col gap-3 border-b border-slate-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h2 className="font-display text-xl font-semibold tracking-tight text-text sm:text-2xl">
                        AI & Tech Daily — {formatBriefDate(brief.briefDate)}
                      </h2>
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        {brief.items.length} quick updates to help you stay
                        current without reading dozens of articles.
                      </p>
                    </div>
                    {briefIndex === 0 && (
                      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-bg px-3 py-1 text-xs font-medium text-muted">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        Latest brief
                      </span>
                    )}
                  </div>

                  <ul className="divide-y divide-slate-100">
                    {brief.items.map((item, itemIndex) => (
                      <li
                        key={item.id}
                        className="flex flex-col gap-3 py-5 sm:flex-row sm:items-start sm:gap-5"
                      >
                        <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-muted sm:w-8 sm:pt-0.5">
                          {String(itemIndex + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-display text-base font-semibold tracking-tight text-text sm:text-lg">
                            {item.headline}
                          </h3>
                          <p className="mt-1.5 text-sm leading-relaxed text-muted">
                            {item.summary}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-20 lg:px-8">
          <div className="flex flex-col items-start gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-base font-semibold tracking-tight text-text">
                Want job matches too?
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Upload your CV when you&apos;re ready, and your AI Job Agent
                will start finding relevant opportunities.
              </p>
            </div>
            <Link
              href="/onboarding/upload-cv"
              className="inline-block shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
            >
              Start job matching
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
