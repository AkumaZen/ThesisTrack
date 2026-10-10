-- Persistent private document cache shared by internal Python functions.
CREATE TABLE IF NOT EXISTS valuation.master_tracker_documents (
  bse_code text NOT NULL,
  sha256 text NOT NULL,
  record jsonb NOT NULL,
  pdf bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bse_code, sha256)
);
