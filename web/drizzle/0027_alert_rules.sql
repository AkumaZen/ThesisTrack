-- Personal price-level alerts and shareholding-change alert settings. Idempotent.
CREATE TABLE IF NOT EXISTS valuation.price_alert_rules (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  nse_symbol text NOT NULL,
  company_name text NOT NULL,
  kind text NOT NULL,
  threshold numeric NOT NULL,
  base_price numeric,
  active boolean NOT NULL DEFAULT true,
  triggered_at timestamptz,
  triggered_price numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_alert_rules_active ON valuation.price_alert_rules (active, nse_symbol);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_alert_rules_user ON valuation.price_alert_rules (user_id);
--> statement-breakpoint
-- Percentage points of change in a holder group's share (quarter on quarter) that is worth an alert.
-- A null threshold turns that group off. Applies to the person's tracked companies.
CREATE TABLE IF NOT EXISTS valuation.holding_alert_settings (
  user_id integer PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  promoter_pp numeric,
  fii_pp numeric,
  dii_pp numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS valuation.holding_alert_deliveries (
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  nse_symbol text NOT NULL,
  period text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, nse_symbol, period)
);
