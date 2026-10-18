-- Analytics features: segment cache, 5-year highs, saved scans with daily snapshots, market breadth. All idempotent.
CREATE TABLE IF NOT EXISTS valuation.company_segments (
  symbol text PRIMARY KEY,
  data jsonb NOT NULL,
  fetched_at bigint NOT NULL
);
--> statement-breakpoint
-- Highest high of up to five years of daily candles (the stored series is shorter than that), and the first date it covers.
CREATE TABLE IF NOT EXISTS valuation.long_term_highs (
  symbol text PRIMARY KEY,
  high_5y double precision NOT NULL,
  from_date text NOT NULL,
  fetched_at bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS valuation.saved_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  config jsonb NOT NULL,
  notify boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS saved_scans_owner ON valuation.saved_scans (owner_id);
--> statement-breakpoint
-- The symbols a saved scan matched on a given day (one row per scan per day).
CREATE TABLE IF NOT EXISTS valuation.scan_snapshots (
  scan_id uuid NOT NULL REFERENCES valuation.saved_scans(id) ON DELETE CASCADE,
  snap_date date NOT NULL,
  symbols jsonb NOT NULL,
  PRIMARY KEY (scan_id, snap_date)
);
--> statement-breakpoint
-- Market breadth over the scanner universe, one row per trading day (computed from stored daily candles).
CREATE TABLE IF NOT EXISTS valuation.market_breadth (
  as_of date PRIMARY KEY,
  total integer NOT NULL,
  advances integer NOT NULL,
  declines integer NOT NULL,
  unchanged integer NOT NULL,
  with_dma50 integer NOT NULL,
  above_dma50 integer NOT NULL,
  with_dma200 integer NOT NULL,
  above_dma200 integer NOT NULL,
  highs_52w integer NOT NULL,
  lows_52w integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
