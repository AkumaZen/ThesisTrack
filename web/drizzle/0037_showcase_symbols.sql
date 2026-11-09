-- Guest mode: the companies a visitor without an account may see (thesis, saved valuation, team
-- notes). One row per showcased listing symbol, uppercase NSE (or BSE when there is no NSE ticker),
-- the same symbol the valuation tools and thesis price lookups use. Admins toggle it from the company
-- pages ("Show to guests"). Additive and idempotent.
CREATE TABLE IF NOT EXISTS public.showcase_symbols (
  symbol text PRIMARY KEY CHECK (symbol = upper(symbol) AND symbol <> ''),
  added_by integer REFERENCES public.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);
