"use client";

import { useState } from "react";
import type { DailyNewsBrief } from "@/lib/dailyNews/types";
import { formatBriefDate, formatBriefDateShort } from "@/lib/dailyNews/formatBriefDate";
import { estimateReadingTimeMinutes } from "@/lib/dailyNews/estimateReadingTime";
import NewsCard from "./NewsCard";

// Briefs are already loaded server-side (latest 5 published, newest first —
// see getLatestDailyNewsBriefs.ts). Switching days here is pure client-side
// state over that same array; it never triggers another database request.
export default function DailyBriefBoard({ briefs }: { briefs: DailyNewsBrief[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedBrief = briefs[selectedIndex];

  if (!selectedBrief) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Recent daily briefs" className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-2 sm:w-full sm:flex-wrap">
          {briefs.map((brief, index) => {
            const isSelected = index === selectedIndex;
            return (
              <li key={brief.id}>
                <button
                  type="button"
                  aria-current={isSelected ? "date" : undefined}
                  onClick={() => setSelectedIndex(index)}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 ${
                    isSelected
                      ? "bg-primary text-white"
                      : "border border-slate-200 bg-white text-muted hover:border-primary/30 hover:text-text"
                  }`}
                >
                  {isSelected && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className="shrink-0"
                    >
                      <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {formatBriefDateShort(brief.briefDate)}
                  {index === 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        isSelected ? "bg-white/20 text-white" : "bg-success/10 text-success"
                      }`}
                    >
                      Latest
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-col gap-3 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-text sm:text-2xl">
            {formatBriefDate(selectedBrief.briefDate)}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{selectedBrief.items.length} updates</span>
            <span aria-hidden="true">·</span>
            <span>{estimateReadingTimeMinutes(selectedBrief.items)} min read</span>
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-bg px-3 py-1 text-xs font-medium text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Published brief
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {selectedBrief.items.map((item, index) => (
          <NewsCard key={item.id} item={item} position={index + 1} featured={index === 0} />
        ))}
      </div>
    </div>
  );
}
