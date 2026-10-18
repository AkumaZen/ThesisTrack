-- Bulk/block deals, shareholding snapshots and Telegram delivery. All idempotent.
CREATE TABLE IF NOT EXISTS valuation.market_deals (
  id serial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  nse_symbol text NOT NULL,
  company_name text NOT NULL,
  deal_date date NOT NULL,
  client_name text NOT NULL,
  side text NOT NULL,
  quantity bigint NOT NULL,
  price numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS market_deals_symbol_date ON valuation.market_deals (nse_symbol, deal_date DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS valuation.deal_deliveries (
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  deal_id integer NOT NULL REFERENCES valuation.market_deals(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, deal_id)
);
--> statement-breakpoint
-- Latest and previous quarter holding (percent of shares); pledge is percent of the promoters' holding.
CREATE TABLE IF NOT EXISTS valuation.shareholding_snapshots (
  nse_symbol text PRIMARY KEY,
  period text NOT NULL,
  promoters numeric,
  fiis numeric,
  diis numeric,
  public numeric,
  pledged_pct numeric,
  prev_period text,
  prev_promoters numeric,
  prev_fiis numeric,
  prev_diis numeric,
  prev_public numeric,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS valuation.telegram_links (
  user_id integer PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  chat_id text NOT NULL UNIQUE,
  linked_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- One-time link tokens; only the hash is stored.
CREATE TABLE IF NOT EXISTS valuation.telegram_link_tokens (
  token_hash text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
