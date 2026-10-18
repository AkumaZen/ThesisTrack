-- Market-wide announcement feed: indexes for browsing by time/tag, and per-person saved keywords. Idempotent.
CREATE INDEX IF NOT EXISTS announcements_time ON valuation.announcements (announced_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS announcements_tag_time ON valuation.announcements (tag, announced_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS valuation.announcement_keywords (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS announcement_keywords_user_keyword ON valuation.announcement_keywords (user_id, lower(keyword));
