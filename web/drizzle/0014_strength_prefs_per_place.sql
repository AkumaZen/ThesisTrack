-- Strength & Volume filters are remembered for each place they are used (every sector, a sector's
-- subsectors, a subsector's companies, one company), not once per level: changing the filter in
-- one subsector no longer replaces the one kept for another. Existing rows keep scope '' and are
-- the starting point for places that have no filter of their own yet. Idempotent.
ALTER TABLE valuation.strength_filter_prefs ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT '';
ALTER TABLE valuation.strength_filter_prefs DROP CONSTRAINT IF EXISTS strength_filter_prefs_pkey;
ALTER TABLE valuation.strength_filter_prefs ADD CONSTRAINT strength_filter_prefs_pkey PRIMARY KEY (user_id, level, scope);
