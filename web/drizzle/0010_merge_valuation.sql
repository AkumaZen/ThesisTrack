-- Merge the Valuation Dashboard into ThesisTrack (one app, one database).
--
-- 1. Shared people: public.users gains a display name (how authors are
--    recorded by the valuation tools, e.g. "Rohit.Negi"), a forced-password-
--    change flag and the admin role; browser sessions move to an httpOnly
--    cookie backed by public.sessions.
-- 2. Every valuation table lives in its own `valuation` schema, created
--    exactly as the dashboard's migrations 0001-0005 did, except that the
--    dashboard's own users/sessions tables are gone - user_id columns point at
--    public.users instead.
--
-- Existing valuation data is copied separately by scripts/merge-valuation-data.mjs.

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin';

ALTER TABLE public.users ADD COLUMN display_name varchar(80);
-- rohit.negi@rdc.in -> Rohit.Negi (matches the names the dashboard already recorded)
UPDATE public.users SET display_name = (
    SELECT string_agg(initcap(part), '.' ORDER BY ord)
    FROM unnest(string_to_array(split_part(email, '@', 1), '.')) WITH ORDINALITY AS t(part, ord)
);
ALTER TABLE public.users ALTER COLUMN display_name SET NOT NULL;
CREATE UNIQUE INDEX users_display_name_lower_idx ON public.users (lower(display_name));
ALTER TABLE public.users ADD COLUMN must_change_password boolean DEFAULT false NOT NULL;

CREATE TABLE public.sessions (
    token_hash text PRIMARY KEY,
    user_id integer NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL
);
CREATE INDEX sessions_user_idx ON public.sessions (user_id);

CREATE SCHEMA valuation;

-- ---- from valuation dashboard 0001_baseline.sql ----
CREATE TABLE valuation.alert_reads (
    user_id integer NOT NULL,
    alert_id integer NOT NULL
);

CREATE TABLE valuation.alert_settings (
    key text NOT NULL,
    value jsonb NOT NULL
);

CREATE TABLE valuation.alert_state (
    key text NOT NULL,
    value text NOT NULL,
    updated_at bigint NOT NULL
);

CREATE TABLE valuation.alert_user_prefs (
    user_id integer NOT NULL,
    enabled jsonb DEFAULT '{}'::jsonb NOT NULL,
    muted jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE valuation.alerts (
    id integer NOT NULL,
    type text NOT NULL,
    subject_key text NOT NULL,
    subject_label text NOT NULL,
    message text NOT NULL,
    href text,
    created_at bigint NOT NULL
);

CREATE SEQUENCE valuation.alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE valuation.alerts_id_seq OWNED BY valuation.alerts.id;

CREATE TABLE valuation.app_meta (
    key text NOT NULL,
    value text NOT NULL
);

CREATE TABLE valuation.benchmark_series_cache (
    id text NOT NULL,
    candles jsonb NOT NULL,
    fetched_at bigint NOT NULL
);

CREATE TABLE valuation.company_cache (
    symbol text NOT NULL,
    basis text NOT NULL,
    data jsonb NOT NULL,
    fetched_at bigint NOT NULL
);

CREATE TABLE valuation.company_growth_series_cache (
    symbol text NOT NULL,
    candles jsonb NOT NULL,
    fetched_at bigint NOT NULL
);

CREATE TABLE valuation.nifty500_series_cache (
    id text NOT NULL,
    candles jsonb NOT NULL,
    fetched_at bigint NOT NULL
);

CREATE TABLE valuation.saved_valuations (
    symbol text NOT NULL,
    name text NOT NULL,
    last_updated bigint NOT NULL,
    assumptions jsonb NOT NULL,
    shares double precision NOT NULL,
    active_method text,
    active_scenario text,
    version integer DEFAULT 1 NOT NULL,
    updated_by text
);

CREATE TABLE valuation.sector_baskets (
    key text NOT NULL,
    label text NOT NULL,
    symbols jsonb NOT NULL
);

CREATE TABLE valuation.sector_majors (
    key text NOT NULL,
    label text NOT NULL,
    "position" bigint NOT NULL,
    subsector_keys jsonb NOT NULL
);

CREATE TABLE valuation.sparkline_cache (
    symbol text NOT NULL,
    closes jsonb NOT NULL,
    fetched_at bigint NOT NULL
);

CREATE TABLE valuation.stage_scan_cache (
    symbol text NOT NULL,
    structural jsonb NOT NULL,
    structural_source_date text NOT NULL,
    structural_computed_at bigint NOT NULL,
    live jsonb,
    live_fetched_at bigint,
    stage text NOT NULL,
    updated_at bigint NOT NULL
);

CREATE TABLE valuation.symbol_name_cache (
    symbol text NOT NULL,
    name text NOT NULL
);

CREATE TABLE valuation.user_sectors (
    key text NOT NULL,
    label text NOT NULL,
    subsectors jsonb NOT NULL,
    created_at bigint NOT NULL
);

ALTER TABLE ONLY valuation.alerts ALTER COLUMN id SET DEFAULT nextval('valuation.alerts_id_seq'::regclass);

ALTER TABLE ONLY valuation.alert_reads
    ADD CONSTRAINT alert_reads_pkey PRIMARY KEY (user_id, alert_id);

ALTER TABLE ONLY valuation.alert_settings
    ADD CONSTRAINT alert_settings_pkey PRIMARY KEY (key);

ALTER TABLE ONLY valuation.alert_state
    ADD CONSTRAINT alert_state_pkey PRIMARY KEY (key);

ALTER TABLE ONLY valuation.alert_user_prefs
    ADD CONSTRAINT alert_user_prefs_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY valuation.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY valuation.app_meta
    ADD CONSTRAINT app_meta_pkey PRIMARY KEY (key);

ALTER TABLE ONLY valuation.benchmark_series_cache
    ADD CONSTRAINT benchmark_series_cache_pkey PRIMARY KEY (id);

ALTER TABLE ONLY valuation.company_cache
    ADD CONSTRAINT company_cache_pkey PRIMARY KEY (symbol);

ALTER TABLE ONLY valuation.company_growth_series_cache
    ADD CONSTRAINT company_growth_series_cache_pkey PRIMARY KEY (symbol);

ALTER TABLE ONLY valuation.nifty500_series_cache
    ADD CONSTRAINT nifty500_series_cache_pkey PRIMARY KEY (id);

ALTER TABLE ONLY valuation.saved_valuations
    ADD CONSTRAINT saved_valuations_pkey PRIMARY KEY (symbol);

ALTER TABLE ONLY valuation.sector_baskets
    ADD CONSTRAINT sector_baskets_pkey PRIMARY KEY (key);

ALTER TABLE ONLY valuation.sector_majors
    ADD CONSTRAINT sector_majors_pkey PRIMARY KEY (key);

ALTER TABLE ONLY valuation.sparkline_cache
    ADD CONSTRAINT sparkline_cache_pkey PRIMARY KEY (symbol);

ALTER TABLE ONLY valuation.stage_scan_cache
    ADD CONSTRAINT stage_scan_cache_pkey PRIMARY KEY (symbol);

ALTER TABLE ONLY valuation.symbol_name_cache
    ADD CONSTRAINT symbol_name_cache_pkey PRIMARY KEY (symbol);

ALTER TABLE ONLY valuation.user_sectors
    ADD CONSTRAINT user_sectors_pkey PRIMARY KEY (key);

CREATE INDEX alerts_created_idx ON valuation.alerts USING btree (created_at DESC);

ALTER TABLE ONLY valuation.alert_reads
    ADD CONSTRAINT alert_reads_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES valuation.alerts(id) ON DELETE CASCADE;

ALTER TABLE ONLY valuation.alert_reads
    ADD CONSTRAINT alert_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY valuation.alert_user_prefs
    ADD CONSTRAINT alert_user_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- ---- from valuation dashboard 0002_valuation_history.sql ----
-- Version history for saved valuations, and the team activity feed.

-- One row per meaningful version of a company's valuation. Autosaves by the same person within a
-- short window update their latest row instead of adding one per keystroke (started_at..saved_at
-- is that editing session). 'delete' rows keep the last content so a removal can be undone.
CREATE TABLE valuation.valuation_versions (
    id serial PRIMARY KEY,
    symbol text NOT NULL,
    version integer NOT NULL,
    action text NOT NULL CHECK (action IN ('save', 'delete', 'restore')),
    snapshot jsonb NOT NULL,
    saved_by text NOT NULL,
    started_at bigint NOT NULL,
    saved_at bigint NOT NULL
);
CREATE INDEX valuation_versions_symbol_idx ON valuation.valuation_versions (symbol, id DESC);

-- What teammates did, newest first. ref_id lets a repeated autosave update its own entry.
CREATE TABLE valuation.activity_log (
    id serial PRIMARY KEY,
    at bigint NOT NULL,
    actor text NOT NULL,
    kind text NOT NULL,
    symbol text,
    summary text NOT NULL,
    ref_id integer
);
CREATE INDEX activity_log_at_idx ON valuation.activity_log (at DESC);

-- ---- from valuation dashboard 0003_collaboration.sql ----
-- Team collaboration: theses, notes and discussion per company; review status; coverage.

-- kind: 'thesis' (the latest one is the current thesis, older ones are its history),
-- 'note' (research notes) or 'comment' (discussion about the valuation). Soft-deleted.
CREATE TABLE valuation.company_notes (
    id serial PRIMARY KEY,
    symbol text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('thesis', 'note', 'comment')),
    body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
    author text NOT NULL,
    created_at bigint NOT NULL,
    edited_at bigint,
    deleted_at bigint
);
CREATE INDEX company_notes_symbol_idx ON valuation.company_notes (symbol, created_at DESC);
CREATE INDEX company_notes_search_idx ON valuation.company_notes USING gin (to_tsvector('english', body));

-- Review status of a company's valuation. at_version is the valuation version it was set on, so
-- the page can say "approved, but changed since".
CREATE TABLE valuation.valuation_status (
    symbol text PRIMARY KEY,
    status text NOT NULL CHECK (status IN ('draft', 'review_needed', 'approved')),
    at_version integer,
    set_by text NOT NULL,
    set_at bigint NOT NULL
);

-- The analyst who covers a company (one per company).
CREATE TABLE valuation.coverage (
    symbol text PRIMARY KEY,
    user_id integer NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    assigned_by text NOT NULL,
    assigned_at bigint NOT NULL
);

-- ---- from valuation dashboard 0004_watchlists_and_prefs.sql ----
-- Named watchlists (shared by the team) and per-user preferences.

-- A named list such as "Q4 ideas" or "Defence". The main watchlist (every saved valuation) stays
-- as it is; a named list is a subset of it that anyone on the team can curate.
CREATE TABLE valuation.watchlists (
    id serial PRIMARY KEY,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    created_by text NOT NULL,
    created_at bigint NOT NULL
);
CREATE UNIQUE INDEX watchlists_name_idx ON valuation.watchlists (lower(btrim(name)));

CREATE TABLE valuation.watchlist_members (
    watchlist_id integer NOT NULL REFERENCES valuation.watchlists (id) ON DELETE CASCADE,
    symbol text NOT NULL,
    added_by text NOT NULL,
    added_at bigint NOT NULL,
    PRIMARY KEY (watchlist_id, symbol)
);

-- One JSON document per user: watchlist columns and sort, last visit, alert delivery, etc.
CREATE TABLE valuation.user_prefs (
    user_id integer PRIMARY KEY REFERENCES public.users (id) ON DELETE CASCADE,
    prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at bigint NOT NULL
);

-- ---- from valuation dashboard 0005_valuation_templates.sql ----
-- Named valuation templates ("Bank P/B model", "High-growth") shared by the team, and which
-- template a new valuation starts from: a person's own default or a sector basket's default.

CREATE TABLE valuation.valuation_templates (
    id serial PRIMARY KEY,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    -- Same shape as saved_valuations.assumptions: every method x scenario x 3 years.
    assumptions jsonb NOT NULL,
    active_method text NOT NULL CHECK (active_method IN ('pe', 'pb', 'ev_ebitda', 'mcap_sales')),
    created_by text NOT NULL,
    created_at bigint NOT NULL,
    updated_by text NOT NULL,
    updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX valuation_templates_name_idx ON valuation.valuation_templates (lower(btrim(name)));

-- scope is 'user:<user id>' or 'basket:<basket key>'. Deleting a template clears its defaults.
CREATE TABLE valuation.valuation_template_defaults (
    scope text PRIMARY KEY CHECK (scope ~ '^(user:[0-9]+|basket:.+)$'),
    template_id integer NOT NULL REFERENCES valuation.valuation_templates (id) ON DELETE CASCADE,
    set_by text NOT NULL,
    set_at bigint NOT NULL
);
