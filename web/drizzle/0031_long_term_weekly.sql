-- Weekly closes of about three years ([{date, close}, ...]) next to the 5-year high, for the returns
-- benchmark's 3Y chart. Null until the long-range loader has run for that symbol.
ALTER TABLE valuation.long_term_highs ADD COLUMN IF NOT EXISTS weekly_3y jsonb;
