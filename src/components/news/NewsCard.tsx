"use client";

import { useState } from "react";
import type { DailyNewsItem } from "@/lib/dailyNews/types";

// Below this length a summary already fits comfortably in 3 clamped lines,
// so there's nothing meaningful an expand control would reveal.
const CLAMP_THRESHOLD = 140;

export default function NewsCard({
  item,
  position,
  featured = false,
}: {
  item: DailyNewsItem;
  position: number;
  featured?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const needsClamp = item.summary.length > CLAMP_THRESHOLD;
  const summaryId = `news-summary-${item.id}`;

  return (
    <article
      className={`group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-primary/30 sm:p-6 ${
        featured ? "lg:col-span-2" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex shrink-0 items-center justify-center rounded-full bg-primary/5 font-display font-semibold text-primary ${
            featured ? "h-10 w-10 text-base" : "h-9 w-9 text-sm"
          }`}
        >
          {String(position).padStart(2, "0")}
        </span>
        <h3
          className={`min-w-0 flex-1 pt-1 font-display font-semibold tracking-tight text-text ${
            featured ? "text-lg sm:text-xl" : "text-base"
          }`}
        >
          {item.headline}
        </h3>
      </div>

      <div className="pl-0 sm:pl-12">
        <p
          id={summaryId}
          className={`text-sm leading-relaxed text-muted ${
            !isExpanded && needsClamp ? "line-clamp-3" : ""
          }`}
        >
          {item.summary}
        </p>

        {needsClamp && (
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={summaryId}
            onClick={() => setIsExpanded((current) => !current)}
            className="mt-2 inline-flex items-center gap-1 rounded-full text-xs font-semibold text-primary outline-none transition-colors hover:text-primary-dark focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
          >
            {isExpanded ? "Show less" : "Read summary"}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
                isExpanded ? "rotate-180" : ""
              }`}
            >
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </article>
  );
}
