-- Whole-market "% below 50 DMA" breadth. One row per NSE equity holds its daily closes as two parallel
-- arrays (epoch days, closes), plus the backfill progress; the daily aggregate is stored separately so the
-- page reads one small table. All idempotent.
CREATE TABLE IF NOT EXISTS valuation.breadth_closes (
  symbol text PRIMARY KEY,
  -- done: closes stored; empty: listed but no candles in the window; failed: last fetch errored;
  -- stale: needs a refetch (missed sessions).
  status text NOT NULL,
  error text,
  days integer[] NOT NULL DEFAULT '{}',
  closes double precision[] NOT NULL DEFAULT '{}',
  last_day integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS breadth_closes_status_idx ON valuation.breadth_closes (status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS valuation.market_breadth_dma (
  as_of date PRIMARY KEY,
  eligible50 integer NOT NULL,
  below50 integer NOT NULL,
  eligible200 integer NOT NULL,
  below200 integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
