-- Personal sections of companies, each company optionally flagged with a colour and label. Idempotent.
CREATE TABLE IF NOT EXISTS valuation.watchlist_sections (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS watchlist_sections_user_name ON valuation.watchlist_sections (user_id, lower(name));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS valuation.watchlist_section_items (
  section_id integer NOT NULL REFERENCES valuation.watchlist_sections(id) ON DELETE CASCADE,
  nse_symbol text NOT NULL,
  company_name text NOT NULL,
  flag_color text,
  flag_label text,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (section_id, nse_symbol)
);
