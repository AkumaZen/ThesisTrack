-- Strength & Volume: saved alert rules (shared by the team) and each person's last-used filter
-- per view level. Rule state between checks lives in valuation.alert_state (key strength:<rule>:<subject>).
CREATE TABLE valuation.strength_rules (
    id serial PRIMARY KEY,
    name text NOT NULL,
    level text NOT NULL CHECK (level IN ('sectors', 'subsectors', 'companies', 'company')),
    parent_key text,
    config jsonb NOT NULL,
    repeat jsonb NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    created_by integer REFERENCES public.users (id) ON DELETE SET NULL,
    created_at bigint NOT NULL
);

CREATE TABLE valuation.strength_filter_prefs (
    user_id integer NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    level text NOT NULL CHECK (level IN ('sectors', 'subsectors', 'companies', 'company')),
    config jsonb NOT NULL,
    PRIMARY KEY (user_id, level)
);
