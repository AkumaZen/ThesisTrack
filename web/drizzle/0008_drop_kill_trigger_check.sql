-- Drops a DB-level CHECK constraint that duplicated (and outlived) the app's
-- own kill-trigger validation: it required manual_check=true OR all of
-- metric_key/operator/threshold to be set together, which blocks saving a
-- kill trigger the analyst hasn't finished configuring yet. The Zod schema
-- no longer enforces this either (see web/src/lib/server/schemas/thesis.ts) -
-- a half-filled trigger is a normal mid-draft state and the rule engine
-- already skips evaluating any trigger that isn't fully specified.
ALTER TABLE "kill_triggers" DROP CONSTRAINT IF EXISTS "kill_triggers_check";
