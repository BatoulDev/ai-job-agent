import Link from "next/link";
import Navbar from "@/components/landing/Navbar";
import Footer from "@/components/landing/Footer";

type NewsCategory = "AI" | "Tech" | "Tools" | "Product" | "Research";

const CATEGORY_STYLES: Record<NewsCategory, string> = {
  AI: "bg-primary/10 text-primary",
  Tech: "bg-accent/10 text-accent",
  Tools: "bg-slate-200 text-slate-600",
  Product: "bg-success/10 text-success",
  Research: "bg-amber-100 text-amber-700",
};

// TODO: Replace this hardcoded array with the automated daily AI/tech news feed later.
const dailyNewsItems: {
  id: number;
  category: NewsCategory;
  headline: string;
  summary: string;
  readTime: string;
}[] = [
  {
    id: 1,
    category: "AI",
    headline: "OpenAI releases new developer tools",
    summary:
      "New AI tools are making it easier for builders to create assistants, workflows, and product features.",
    readTime: "2 min read",
  },
  {
    id: 2,
    category: "AI",
    headline: "AI agents are becoming easier to build",
    summary:
      "New frameworks are helping developers create agents that can search, summarize, and automate tasks.",
    readTime: "3 min read",
  },
  {
    id: 3,
    category: "Tech",
    headline: "Cloud platforms simplify web app deployment",
    summary:
      "Modern hosting tools are reducing the setup needed to launch student and startup projects.",
    readTime: "2 min read",
  },
  {
    id: 4,
    category: "Tools",
    headline: "New AI note-taking tools improve summaries",
    summary:
      "AI tools are getting better at turning meetings, PDFs, and long notes into short useful summaries.",
    readTime: "2 min read",
  },
  {
    id: 5,
    category: "Product",
    headline: "More apps are adding AI copilots",
    summary:
      "Products are adding built-in AI helpers for writing, search, planning, and decision support.",
    readTime: "3 min read",
  },
  {
    id: 6,
    category: "AI",
    headline: "Multimodal AI tools continue improving",
    summary:
      "AI systems are getting better at understanding text, images, documents, and structured data together.",
    readTime: "3 min read",
  },
  {
    id: 7,
    category: "Tech",
    headline: "Low-code tools help builders test ideas faster",
    summary:
      "New platforms let users prototype workflows and internal tools without building everything from scratch.",
    readTime: "2 min read",
  },
  {
    id: 8,
    category: "Research",
    headline: "Smaller AI models are becoming more useful",
    summary:
      "Lightweight models are improving in speed and cost, making AI features more accessible for small products.",
    readTime: "3 min read",
  },
  {
    id: 9,
    category: "Tools",
    headline: "Browser-based AI assistants are expanding",
    summary:
      "More tools are helping users summarize pages, compare information, and work faster inside the browser.",
    readTime: "2 min read",
  },
  {
    id: 10,
    category: "Product",
    headline: "AI search experiences are becoming more conversational",
    summary:
      "Search products are moving toward answer-focused interfaces with summaries, follow-up questions, and source links.",
    readTime: "3 min read",
  },
];

export default function NewsPage() {
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
            <p className="mx-auto mt-5 max-w-xl rounded-full bg-bg px-4 py-2 text-xs leading-relaxed text-muted">
              Demo content for now. Later, this page will be updated
              automatically by our AI/tech news automation.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-16 lg:px-8">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-xl font-semibold tracking-tight text-text sm:text-2xl">
                  Today&apos;s AI/Tech Brief
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  10 quick updates to help you stay current without reading
                  dozens of articles.
                </p>
              </div>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-bg px-3 py-1 text-xs font-medium text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Updated today
              </span>
            </div>

            <ul className="divide-y divide-slate-100">
              {dailyNewsItems.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 py-5 sm:flex-row sm:items-start sm:gap-5"
                >
                  <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-muted sm:w-8 sm:pt-0.5">
                    {String(item.id).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        CATEGORY_STYLES[item.category]
                      }`}
                    >
                      {item.category}
                    </span>
                    <h3 className="mt-2 font-display text-base font-semibold tracking-tight text-text sm:text-lg">
                      {item.headline}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">
                      {item.summary}
                    </p>
                    <div className="mt-2 flex items-center gap-3 text-xs">
                      <span className="text-muted">{item.readTime}</span>
                      <span className="font-semibold text-primary">
                        Read more &rarr;
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
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
