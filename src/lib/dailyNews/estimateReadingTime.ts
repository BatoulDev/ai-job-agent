import type { DailyNewsItem } from "./types";

const WORDS_PER_MINUTE = 200;

// Derived entirely from summary text already loaded for the page — never
// stored. A brief's word count divided by an average adult reading speed,
// rounded up so a partial minute still reads as "1 min", not "0 min".
export function estimateReadingTimeMinutes(items: DailyNewsItem[]): number {
  const wordCount = items.reduce((total, item) => {
    return total + item.headline.split(/\s+/).filter(Boolean).length + item.summary.split(/\s+/).filter(Boolean).length;
  }, 0);

  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}
