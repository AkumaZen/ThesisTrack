-- Scorecard part B: a one-line lesson captured when a thesis is closed out, shown on the team
-- playbook on /scorecard. Additive, nullable and idempotent: old code ignores it.
ALTER TABLE thesis_scenarios ADD COLUMN IF NOT EXISTS lesson text;
