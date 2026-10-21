-- Copies the old team-shared named lists (valuation.watchlists, migration 0010) into personal
-- watchlist sections (migration 0028), so the app has one list system. Copy only: the old tables
-- stay as a backup. Idempotent: valuation.watchlist_list_copies remembers which old list became
-- which section, so a re-run adds nothing, and a section the person later deletes is not recreated.
--
-- Owner of each list: the user whose email, then display name, matches created_by (case-insensitive);
-- else the earliest-created active admin. A name clash with one of the owner's sections gets " (team)"
-- appended, then a number. The 20-section and 200-item app limits are not enforced here.
CREATE TABLE IF NOT EXISTS valuation.watchlist_list_copies (
  watchlist_id integer PRIMARY KEY REFERENCES valuation.watchlists(id) ON DELETE CASCADE,
  section_id integer REFERENCES valuation.watchlist_sections(id) ON DELETE SET NULL,
  copied_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
DECLARE
  w record;
  owner_id integer;
  base_name text;
  new_name text;
  n integer;
  sec_id integer;
BEGIN
  FOR w IN
    SELECT * FROM valuation.watchlists
    WHERE id NOT IN (SELECT watchlist_id FROM valuation.watchlist_list_copies)
    ORDER BY id
  LOOP
    SELECT id INTO owner_id FROM public.users
      WHERE lower(btrim(email)) = lower(btrim(w.created_by)) ORDER BY id LIMIT 1;
    IF owner_id IS NULL THEN
      SELECT id INTO owner_id FROM public.users
        WHERE lower(btrim(display_name)) = lower(btrim(w.created_by)) ORDER BY id LIMIT 1;
    END IF;
    IF owner_id IS NULL THEN
      SELECT id INTO owner_id FROM public.users
        WHERE role = 'admin' AND is_active ORDER BY created_at, id LIMIT 1;
    END IF;
    IF owner_id IS NULL THEN
      RAISE NOTICE 'No owner for list % (%), skipped', w.id, w.name;
      CONTINUE;
    END IF;

    base_name := btrim(w.name);
    new_name := base_name;
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM valuation.watchlist_sections
      WHERE user_id = owner_id AND lower(btrim(name)) = lower(new_name)
    ) LOOP
      n := n + 1;
      new_name := base_name || CASE WHEN n = 2 THEN ' (team)' ELSE ' (team ' || (n - 1) || ')' END;
    END LOOP;

    INSERT INTO valuation.watchlist_sections (user_id, name, position)
    VALUES (
      owner_id, new_name,
      (SELECT coalesce(max(position), 0) + 1 FROM valuation.watchlist_sections WHERE user_id = owner_id)
    )
    RETURNING id INTO sec_id;

    INSERT INTO valuation.watchlist_section_items (section_id, nse_symbol, company_name, added_at)
    SELECT sec_id, m.symbol,
           coalesce(
             (SELECT sv.name FROM valuation.saved_valuations sv WHERE sv.symbol = m.symbol),
             (SELECT c.name FROM valuation.symbol_name_cache c WHERE c.symbol = m.symbol),
             m.symbol),
           to_timestamp(m.added_at / 1000.0)
    FROM valuation.watchlist_members m
    WHERE m.watchlist_id = w.id
    ON CONFLICT DO NOTHING;

    INSERT INTO valuation.watchlist_list_copies (watchlist_id, section_id) VALUES (w.id, sec_id);
  END LOOP;
END $$;
