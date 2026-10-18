-- Concall analysis and forensic checks for tracked companies. All idempotent.
-- Per-company scan: stored Screener tables, rule-based result quality and red flags, and the
-- transcripts found in the Master Tracker's research. Refreshed by an explicit action, no LLM.
CREATE TABLE IF NOT EXISTS valuation.concall_company_scan (
  symbol text PRIMARY KEY REFERENCES valuation.master_tracker_companies(symbol) ON DELETE CASCADE,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  fin_source text NOT NULL,
  financials jsonb,
  financials_at timestamptz,
  quality jsonb NOT NULL DEFAULT '[]'::jsonb,
  flags jsonb,
  transcripts jsonb NOT NULL DEFAULT '[]'::jsonb
);
--> statement-breakpoint
-- One LLM analysis per transcript text and prompt version: the cache that keeps the model to one run per transcript.
CREATE TABLE IF NOT EXISTS valuation.concall_analyses (
  id serial PRIMARY KEY,
  transcript_hash text NOT NULL,
  prompt_version integer NOT NULL,
  symbol text NOT NULL REFERENCES valuation.master_tracker_companies(symbol) ON DELETE CASCADE,
  quarter date NOT NULL,
  source_title text NOT NULL,
  model text NOT NULL,
  result jsonb NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transcript_hash, prompt_version)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS concall_analyses_symbol ON valuation.concall_analyses (symbol, quarter DESC);
--> statement-breakpoint
-- Guidance statements of an analysis, with the rule-based verdict against later actuals.
CREATE TABLE IF NOT EXISTS valuation.concall_guidance (
  id serial PRIMARY KEY,
  analysis_id integer NOT NULL REFERENCES valuation.concall_analyses(id) ON DELETE CASCADE,
  symbol text NOT NULL REFERENCES valuation.master_tracker_companies(symbol) ON DELETE CASCADE,
  quarter date NOT NULL,
  metric text NOT NULL,
  label text NOT NULL,
  basis text NOT NULL,
  comparator text NOT NULL,
  target numeric,
  target_high numeric,
  period text NOT NULL,
  quote text NOT NULL,
  page integer,
  status text NOT NULL DEFAULT 'pending',
  actual numeric,
  actual_text text NOT NULL DEFAULT '',
  status_reason text NOT NULL DEFAULT '',
  evaluated_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS concall_guidance_symbol ON valuation.concall_guidance (symbol, quarter DESC);
