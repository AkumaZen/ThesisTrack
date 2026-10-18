-- NSE corporate actions (dividend, split, bonus, rights, buyback, ...). Idempotent.
CREATE TABLE IF NOT EXISTS valuation.corporate_actions (
  id serial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  nse_symbol text NOT NULL,
  company_name text NOT NULL,
  isin text,
  kind text NOT NULL,
  subject text NOT NULL,
  amount numeric,
  ratio text,
  face_value numeric,
  ex_date date NOT NULL,
  record_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS corporate_actions_ex_date ON valuation.corporate_actions (ex_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS corporate_actions_symbol_ex ON valuation.corporate_actions (nse_symbol, ex_date DESC);
