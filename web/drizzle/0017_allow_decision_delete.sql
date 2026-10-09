-- position_decisions stays append-only like thesis_versions (0011): UPDATE is always rejected, and
-- DELETE is rejected unless the transaction opted in with set_config('app.allow_thesis_delete',
-- 'on', true). Without this, the admin delete-company endpoint failed for any company with a logged
-- buy/sell decision, because deleting the company cascades into its decisions.
CREATE OR REPLACE FUNCTION forbid_decision_update() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_thesis_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'position_decisions is append-only; log a new decision instead';
END;
$$ LANGUAGE plpgsql;
