-- The breakout scanner's wider universe: companies with a six-month average market cap of Rs 500 Cr
-- to Rs 20,000 Cr (AMFI list, refreshed twice a year by scripts/import-mcap-universe.mjs). One row per
-- ISIN. `symbol` is the app ticker used everywhere else (NSE symbol when priced on NSE, else the BSE
-- ticker; null when Angel One has no price source). Numbered 0020 because 0018/0019 exist on branch scorecard.
CREATE TABLE IF NOT EXISTS valuation.mcap_universe (
  isin text PRIMARY KEY,
  company_name text NOT NULL,
  nse_symbol text,
  bse_code text,
  market_cap_cr numeric(14, 2) NOT NULL,
  mcap_as_of date NOT NULL,
  listed_on text,
  angel_nse_token text,
  angel_nse_symbol text,
  angel_bse_token text,
  angel_bse_symbol text,
  bse_scrip_code text,
  price_exchange text,
  price_source_status text NOT NULL,
  match_method text,
  symbol text,
  active boolean NOT NULL DEFAULT true,
  imported_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DROP INDEX IF EXISTS valuation.mcap_universe_symbol_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX mcap_universe_symbol_uq ON valuation.mcap_universe (symbol) WHERE symbol IS NOT NULL AND active;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mcap_universe_active ON valuation.mcap_universe (active);
