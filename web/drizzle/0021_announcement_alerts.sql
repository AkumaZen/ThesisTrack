-- Announcement alerts: each person tracks NSE companies, new exchange announcements are stored once,
-- summarised by an LLM, and pushed to that person's devices (Web Push). All idempotent.
CREATE TABLE IF NOT EXISTS valuation.tracked_companies (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  nse_symbol text NOT NULL,
  company_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tracked_companies_user_symbol_uq UNIQUE (user_id, nse_symbol)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tracked_companies_symbol ON valuation.tracked_companies (nse_symbol);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS valuation.announcements (
  id serial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  nse_symbol text NOT NULL,
  company_name text NOT NULL,
  subject text NOT NULL,
  details text NOT NULL DEFAULT '',
  announced_at timestamptz NOT NULL,
  pdf_url text,
  summary text,
  summarised_at timestamptz,
  summary_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS announcements_symbol_time ON valuation.announcements (nse_symbol, announced_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS valuation.announcement_deliveries (
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  announcement_id integer NOT NULL REFERENCES valuation.announcements(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, announcement_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS valuation.push_subscriptions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_failure_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON valuation.push_subscriptions (user_id);
