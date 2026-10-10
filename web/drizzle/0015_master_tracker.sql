CREATE TABLE IF NOT EXISTS valuation.master_tracker_companies (
  symbol text PRIMARY KEY, state jsonb NOT NULL, version integer NOT NULL
);
CREATE TABLE IF NOT EXISTS valuation.master_tracker_research (
  key text PRIMARY KEY, symbol text NOT NULL REFERENCES valuation.master_tracker_companies(symbol) ON DELETE CASCADE, data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS valuation.master_tracker_previews (
  id text PRIMARY KEY, symbol text NOT NULL REFERENCES valuation.master_tracker_companies(symbol) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS master_tracker_preview_owner ON valuation.master_tracker_previews(user_id, symbol);
