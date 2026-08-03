// Mirrors public.daily_news_briefs / public.daily_news_items
// (supabase/migrations/20260807090000_create_daily_news_briefs.sql,
// 20260807090010_create_daily_news_items.sql). Limited to the columns the
// public column grant actually exposes and the page actually renders —
// source_url is intentionally never modeled here.
export interface DailyNewsItem {
  id: string;
  headline: string;
  summary: string;
}

export interface DailyNewsBrief {
  id: string;
  briefDate: string;
  items: DailyNewsItem[];
}
