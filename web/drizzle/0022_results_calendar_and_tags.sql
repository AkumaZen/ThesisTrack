-- Results calendar, announcement tags and per-person notification settings. All idempotent.
-- Per-source refresh log: lets the one-minute poller piggyback slow jobs (board meetings every 6 hours,
-- deals every 3, shareholding daily) without Vercel crons, and lets overlapping runs claim symbols safely.
CREATE TABLE IF NOT EXISTS valuation.symbol_refresh (
  kind text NOT NULL,
  symbol text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL DEFAULT true,
  PRIMARY KEY (kind, symbol)
);
--> statement-breakpoint
-- Upcoming board meetings. One row per company, day and kind (results or other), so the exchange's
-- several rows for one meeting and our own parse of the announcement text collapse into one.
CREATE TABLE IF NOT EXISTS valuation.board_meetings (
  id serial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  nse_symbol text NOT NULL,
  company_name text NOT NULL,
  meeting_date date NOT NULL,
  purpose text NOT NULL,
  is_results boolean NOT NULL DEFAULT false,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS board_meetings_date ON valuation.board_meetings (meeting_date);
--> statement-breakpoint
-- Keyword tag of each announcement (filled when stored; older rows are tagged by the poller).
ALTER TABLE valuation.announcements ADD COLUMN IF NOT EXISTS tag text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS announcements_untagged ON valuation.announcements (id) WHERE tag IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS valuation.user_notification_settings (
  user_id integer PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  only_important boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
