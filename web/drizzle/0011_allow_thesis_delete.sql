-- thesis_versions stays append-only: UPDATE is always rejected, and DELETE is rejected unless the
-- transaction opted in with set_config('app.allow_thesis_delete', 'on', true). Only the admin
-- delete-company endpoint sets it, so a company (and its history) can be removed deliberately.
CREATE OR REPLACE FUNCTION forbid_version_update() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('app.allow_thesis_delete', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'thesis_versions is append-only; write a new version';
END;
$$ LANGUAGE plpgsql;
