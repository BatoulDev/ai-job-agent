import Link from "next/link";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";
import NewsHero from "@/components/news/NewsHero";
import NewsStatusCard from "@/components/news/NewsStatusCard";
import DailyBriefBoard from "@/components/news/DailyBriefBoard";
import { getLatestDailyNewsBriefs } from "@/lib/dailyNews/getLatestDailyNewsBriefs";

// Content changes at most once a day (the ai-tech-daily-news GitHub Action),
// so the page is regenerated in the background at most once per hour
// instead of querying Supabase on every visit.
export const revalidate = 3600;

export default async function NewsPage() {
  const result = await getLatestDailyNewsBriefs();

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <NewsHero />

        <section className="mx-auto max-w-5xl px-6 py-10 lg:px-8 lg:py-12">
          {result.status === "unavailable" ? (
            <NewsStatusCard variant="unavailable" />
          ) : result.briefs.length === 0 ? (
            <NewsStatusCard variant="empty" />
          ) : (
            <DailyBriefBoard briefs={result.briefs} />
          )}
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-20 lg:px-8">
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
