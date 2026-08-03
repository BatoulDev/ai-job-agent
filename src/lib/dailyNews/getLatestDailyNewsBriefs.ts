import { createPublicClient } from "@/lib/supabase/publicClient";
import type { DailyNewsBrief } from "./types";

const LATEST_BRIEFS_LIMIT = 5;

interface DailyNewsItemRow {
  id: string;
  headline: string;
  summary: string;
  position: number;
}

interface DailyNewsBriefRow {
  id: string;
  brief_date: string;
  daily_news_items: DailyNewsItemRow[] | null;
}

function isDailyNewsItemRow(value: unknown): value is DailyNewsItemRow {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as DailyNewsItemRow).id === "string" &&
    typeof (value as DailyNewsItemRow).headline === "string" &&
    typeof (value as DailyNewsItemRow).summary === "string"
  );
}

function isDailyNewsBriefRow(value: unknown): value is DailyNewsBriefRow {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as DailyNewsBriefRow).id === "string" &&
    typeof (value as DailyNewsBriefRow).brief_date === "string"
  );
}

export type DailyNewsBriefsResult =
  | { status: "ok"; briefs: DailyNewsBrief[] }
  | { status: "unavailable" };

// Public, read-only, RLS-scoped to published briefs only (see
// daily_news_briefs_select_published_public /
// daily_news_items_select_published_public). Called from a Server
// Component whose route sets `export const revalidate`, so this only runs
// during background ISR regeneration — never once per visitor.
//
// Never throws: a query/network failure (e.g. an unreachable Supabase URL
// during a build, or a transient outage during ISR regeneration) must not
// crash the whole page render — that would fail the build outright, or
// (with no prior cache) leave nothing for ISR to serve. Callers must
// render `status: "unavailable"` distinctly from a genuine zero-briefs
// result, never conflate the two.
export async function getLatestDailyNewsBriefs(): Promise<DailyNewsBriefsResult> {
  const supabase = createPublicClient();

  try {
    const { data, error } = await supabase
      .from("daily_news_briefs")
      .select("id, brief_date, daily_news_items(id, headline, summary, position)")
      .order("brief_date", { ascending: false })
      .order("position", { foreignTable: "daily_news_items", ascending: true })
      .limit(LATEST_BRIEFS_LIMIT);

    if (error) {
      // Log only the message — never the full error object, which can
      // carry request/connection details (host, etc.) via its cause.
      console.error("[dailyNews] Failed to load latest briefs:", error.message);
      return { status: "unavailable" };
    }

    if (!Array.isArray(data)) {
      console.error("[dailyNews] Malformed response loading latest briefs.");
      return { status: "unavailable" };
    }

    const briefs = data.filter(isDailyNewsBriefRow).map((row) => ({
      id: row.id,
      briefDate: row.brief_date,
      items: (row.daily_news_items ?? [])
        .filter(isDailyNewsItemRow)
        .map((item) => ({
          id: item.id,
          headline: item.headline,
          summary: item.summary,
        })),
    }));

    return { status: "ok", briefs };
  } catch (error) {
    console.error(
      "[dailyNews] Unexpected error loading latest briefs:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "unavailable" };
  }
}
