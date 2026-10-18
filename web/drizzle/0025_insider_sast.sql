-- NSE insider trading (SEBI PIT) and substantial acquisition (SAST Reg 29) disclosures. Idempotent.
CREATE TABLE IF NOT EXISTS valuation.insider_trades (
  id serial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  nse_symbol text NOT NULL,
  company_name text NOT NULL,
  person_name text NOT NULL,
  person_category text NOT NULL,
  security_type text NOT NULL DEFAULT '',
  txn_type text NOT NULL,
  mode text NOT NULL DEFAULT '',
  quantity bigint NOT NULL DEFAULT 0,
  value numeric NOT NULL DEFAULT 0,
  before_shares bigint,
  before_pct numeric,
  after_shares bigint,
  after_pct numeric,
  from_date date,
  to_date date,
  broadcast_at timestamptz NOT NULL,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS insider_trades_time ON valuation.insider_trades (broadcast_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS insider_trades_symbol_time ON valuation.insider_trades (nse_symbol, broadcast_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS valuation.sast_disclosures (
  id serial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  nse_symbol text NOT NULL,
  company_name text NOT NULL,
  acquirer_name text NOT NULL,
  action text NOT NULL,
  security_type text NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT '',
  regulation text NOT NULL DEFAULT '',
  is_promoter boolean NOT NULL DEFAULT false,
  shares_acquired bigint,
  shares_sold bigint,
  shares_after bigint,
  pct_acquired numeric,
  pct_sold numeric,
  pct_after numeric,
  period_text text NOT NULL DEFAULT '',
  disclosed_at timestamptz NOT NULL,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sast_time ON valuation.sast_disclosures (disclosed_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sast_symbol_time ON valuation.sast_disclosures (nse_symbol, disclosed_at DESC);
