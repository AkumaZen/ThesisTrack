-- Scorecard part A: every thesis records the price it was entered at, so a return can be shown.
-- thesis_scenarios.entry_date already exists (unused until now) and becomes the buy date.
--   entry_price         the buy price (nullable: existing theses are filled in by the backfill script)
--   entry_price_source  'manual' | 'auto' | 'backfill_buy' | 'backfill_history' | 'no_data'
--   needs_price         true while a listed company's thesis still has no entry price
-- Additive and idempotent: old code ignores the new columns and keeps working.
ALTER TABLE thesis_scenarios ADD COLUMN IF NOT EXISTS entry_price numeric;
--> statement-breakpoint
ALTER TABLE thesis_scenarios ADD COLUMN IF NOT EXISTS entry_price_source text;
--> statement-breakpoint
ALTER TABLE thesis_scenarios ADD COLUMN IF NOT EXISTS needs_price boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE thesis_scenarios DROP CONSTRAINT IF EXISTS entry_price_positive;
--> statement-breakpoint
ALTER TABLE thesis_scenarios ADD CONSTRAINT entry_price_positive CHECK (entry_price IS NULL OR entry_price > 0);
--> statement-breakpoint
ALTER TABLE thesis_scenarios DROP CONSTRAINT IF EXISTS entry_price_source_values;
--> statement-breakpoint
ALTER TABLE thesis_scenarios ADD CONSTRAINT entry_price_source_values CHECK (entry_price_source IS NULL OR entry_price_source IN ('manual','auto','backfill_buy','backfill_history','no_data'));
