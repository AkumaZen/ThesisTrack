-- Squashed initial schema: the final state of all 8 Alembic migrations
-- (6964238e12f2 p0_schema .. e5a91c4d7f22 thesis_scenarios), DDL ported
-- near-verbatim. This targets a fresh database, so the scenario-remodel
-- migration's backfill UPDATEs (which needed a temporary trigger disable to
-- touch pre-existing append-only rows) are omitted - there's no existing
-- data to migrate here, just the end-state shape.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE TYPE operating_model  AS ENUM ('factory','subscription','money_lending','retail_stores','services');
CREATE TYPE thesis_status    AS ENUM ('on_track','watch_closely','broken');
CREATE TYPE verdict_source   AS ENUM ('manual','rule_engine','ai_proposed');
CREATE TYPE thesis_outcome   AS ENUM ('open','played_out','invalidated','exited_early','superseded');
CREATE TYPE metric_unit      AS ENUM ('pct','days','ratio','currency','count','currency_per_unit');
CREATE TYPE trigger_severity AS ENUM ('warn','kill');
CREATE TYPE proposal_state   AS ENUM ('pending','accepted','rejected','superseded');
CREATE TYPE user_role        AS ENUM ('read_write','read_only');

CREATE TABLE broad_industries (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) UNIQUE NOT NULL,
    is_active    BOOLEAN DEFAULT TRUE
);

CREATE TABLE specific_niches (
    id                 SERIAL PRIMARY KEY,
    broad_industry_id  INT NOT NULL REFERENCES broad_industries(id),
    name               VARCHAR(120) NOT NULL,
    is_active          BOOLEAN DEFAULT TRUE,
    UNIQUE (broad_industry_id, name)
);

CREATE TABLE metric_definitions (
    metric_key       VARCHAR(60) PRIMARY KEY,
    label            VARCHAR(120) NOT NULL,
    operating_model  operating_model,
    unit             metric_unit NOT NULL,
    higher_is_better BOOLEAN,
    decimals         SMALLINT DEFAULT 1,
    is_core          BOOLEAN DEFAULT FALSE,
    help_text        TEXT,
    sort_order       SMALLINT DEFAULT 100
);

-- Pure shared identity - per-user thesis opinion (status, outcome, current
-- version, etc.) lives in thesis_scenarios (ADR-026 per-user parallel theses).
CREATE TABLE companies (
    company_id          VARCHAR(50) PRIMARY KEY,
    name                VARCHAR(255) NOT NULL,
    broad_industry_id   INT NOT NULL REFERENCES broad_industries(id),
    specific_niche_id   INT NOT NULL REFERENCES specific_niches(id),
    operating_model     operating_model NOT NULL,
    currency            CHAR(3) NOT NULL DEFAULT 'INR',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE thesis_scenarios (
    id                  BIGSERIAL PRIMARY KEY,
    company_id          VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    owner               VARCHAR(80) NOT NULL,
    label               VARCHAR(120) NOT NULL DEFAULT 'Thesis',
    status              thesis_status NOT NULL DEFAULT 'on_track',
    status_source       verdict_source NOT NULL DEFAULT 'manual',
    outcome             thesis_outcome NOT NULL DEFAULT 'open',
    conviction          SMALLINT,
    entry_date          DATE,
    exit_date           DATE,
    last_reviewed       DATE NOT NULL,
    current_version_id  BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, owner),
    CHECK (conviction IS NULL OR conviction BETWEEN 1 AND 5)
);
CREATE INDEX idx_thesis_scenarios_company ON thesis_scenarios(company_id);

CREATE TABLE thesis_versions (
    version_id    BIGSERIAL PRIMARY KEY,
    company_id    VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    scenario_id   BIGINT NOT NULL REFERENCES thesis_scenarios(id) ON DELETE CASCADE,
    version_no    INT NOT NULL,
    thesis_data   JSONB NOT NULL,
    change_note   TEXT,
    authored_by   VARCHAR(80) NOT NULL,
    authored_at   TIMESTAMPTZ DEFAULT NOW(),
    search_tsv    tsvector GENERATED ALWAYS AS (
                     to_tsvector('english', jsonb_path_query_array(thesis_data, '$.**?(@.type() == "string")')::text)
                  ) STORED,
    UNIQUE (scenario_id, version_no)
);
CREATE INDEX idx_thesis_versions_scenario ON thesis_versions(scenario_id);

ALTER TABLE thesis_scenarios
    ADD CONSTRAINT fk_thesis_scenarios_current_version
    FOREIGN KEY (current_version_id) REFERENCES thesis_versions(version_id);

CREATE FUNCTION forbid_version_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'thesis_versions is append-only; write a new version'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_forbid_version_update
BEFORE UPDATE OR DELETE ON thesis_versions
FOR EACH ROW EXECUTE FUNCTION forbid_version_update();

CREATE TABLE observations (
    id             BIGSERIAL PRIMARY KEY,
    company_id     VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    period         VARCHAR(10) NOT NULL,
    period_end     DATE NOT NULL,
    metric_key     VARCHAR(60) NOT NULL REFERENCES metric_definitions(metric_key),
    numeric_value  NUMERIC(20,4),
    text_value     TEXT,
    source_type    VARCHAR(40),
    source_url     TEXT,
    note           TEXT,
    ingested_by    VARCHAR(80) NOT NULL,
    ingested_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id, period, metric_key)
);
CREATE INDEX idx_obs_company_period ON observations(company_id, period_end DESC);

CREATE TABLE kill_triggers (
    id             BIGSERIAL PRIMARY KEY,
    version_id     BIGINT NOT NULL REFERENCES thesis_versions(version_id) ON DELETE CASCADE,
    label          TEXT NOT NULL,
    metric_key     VARCHAR(60) REFERENCES metric_definitions(metric_key),
    operator       VARCHAR(4) CHECK (operator IN ('<','<=','>','>=','==','!=')),
    threshold      NUMERIC(20,4),
    severity       trigger_severity NOT NULL DEFAULT 'kill',
    action         TEXT NOT NULL,
    grace_periods  SMALLINT NOT NULL DEFAULT 1,
    manual_check   BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (manual_check OR (metric_key IS NOT NULL AND operator IS NOT NULL AND threshold IS NOT NULL))
);

CREATE TABLE trigger_evaluations (
    id             BIGSERIAL PRIMARY KEY,
    trigger_id     BIGINT NOT NULL REFERENCES kill_triggers(id) ON DELETE CASCADE,
    period         VARCHAR(10) NOT NULL,
    observed_value NUMERIC(20,4),
    breached       BOOLEAN NOT NULL,
    fired          BOOLEAN NOT NULL,
    evaluated_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (trigger_id, period)
);

CREATE TABLE health_checks (
    id                BIGSERIAL PRIMARY KEY,
    company_id        VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    scenario_id       BIGINT NOT NULL REFERENCES thesis_scenarios(id) ON DELETE CASCADE,
    version_id        BIGINT NOT NULL REFERENCES thesis_versions(version_id),
    period            VARCHAR(10) NOT NULL,
    verdict           thesis_status NOT NULL,
    source            verdict_source NOT NULL,
    note              TEXT NOT NULL,
    reasoning_chain   JSONB,
    evidence          JSONB,
    human_confirmed   BOOLEAN NOT NULL DEFAULT FALSE,
    model_name        VARCHAR(80),
    author            VARCHAR(80),
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id, period)
);
CREATE INDEX idx_health_checks_scenario ON health_checks(scenario_id);

CREATE TABLE status_proposals (
    id               BIGSERIAL PRIMARY KEY,
    company_id       VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    scenario_id      BIGINT NOT NULL REFERENCES thesis_scenarios(id) ON DELETE CASCADE,
    period           VARCHAR(10),
    proposed_status  thesis_status NOT NULL,
    source           verdict_source NOT NULL,
    rationale        TEXT NOT NULL,
    evidence         JSONB,
    state            proposal_state NOT NULL DEFAULT 'pending',
    model_name       VARCHAR(80),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    resolved_by      VARCHAR(80),
    resolved_at      TIMESTAMPTZ,
    resolution_note  TEXT
);
CREATE INDEX idx_status_proposals_scenario ON status_proposals(scenario_id);
CREATE INDEX idx_proposals_pending ON status_proposals(company_id) WHERE state = 'pending';

CREATE TABLE status_events (
    id           BIGSERIAL PRIMARY KEY,
    company_id   VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    scenario_id  BIGINT NOT NULL REFERENCES thesis_scenarios(id) ON DELETE CASCADE,
    from_status  thesis_status,
    to_status    thesis_status NOT NULL,
    source       verdict_source NOT NULL,
    proposal_id  BIGINT REFERENCES status_proposals(id),
    rationale    TEXT NOT NULL,
    override     BOOLEAN NOT NULL DEFAULT FALSE,
    actor        VARCHAR(80) NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_status_events_scenario ON status_events(scenario_id);

CREATE TABLE position_decisions (
    id             BIGSERIAL PRIMARY KEY,
    company_id     VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    scenario_id    BIGINT NOT NULL REFERENCES thesis_scenarios(id) ON DELETE CASCADE,
    version_id     BIGINT REFERENCES thesis_versions(version_id),
    action         VARCHAR(4) NOT NULL CHECK (action IN ('buy', 'sell')),
    price          NUMERIC NOT NULL CHECK (price > 0),
    quantity       NUMERIC CHECK (quantity IS NULL OR quantity > 0),
    decided_on     DATE NOT NULL,
    rationale      TEXT NOT NULL,
    actor          VARCHAR(80) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_position_decisions_company ON position_decisions(company_id);
CREATE INDEX idx_position_decisions_decided_on ON position_decisions(decided_on);
CREATE INDEX idx_position_decisions_scenario ON position_decisions(scenario_id);

CREATE FUNCTION forbid_decision_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'position_decisions is append-only; log a new decision instead'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_forbid_decision_update
BEFORE UPDATE OR DELETE ON position_decisions
FOR EACH ROW EXECUTE FUNCTION forbid_decision_update();

CREATE TABLE price_observations (
    id             BIGSERIAL PRIMARY KEY,
    company_id     VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    observed_on    DATE NOT NULL,
    price          NUMERIC NOT NULL CHECK (price > 0),
    source         VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'screener')),
    actor          VARCHAR(80) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, observed_on)
);
CREATE INDEX idx_price_observations_company ON price_observations(company_id, observed_on DESC);

CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    email          VARCHAR(255) UNIQUE NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    role           user_role NOT NULL DEFAULT 'read_write',
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    last_login_at  TIMESTAMPTZ
);

CREATE TABLE training_splits (
    company_id   VARCHAR(50) PRIMARY KEY REFERENCES companies(company_id) ON DELETE CASCADE,
    split        VARCHAR(10) NOT NULL CHECK (split IN ('train','eval')),
    assigned_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE guidance_notes (
    id             BIGSERIAL PRIMARY KEY,
    company_id     VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    block_key      VARCHAR(40) NOT NULL,
    note           TEXT NOT NULL,
    status         VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_by     VARCHAR(80) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_by    VARCHAR(80),
    resolved_at    TIMESTAMPTZ
);
CREATE INDEX idx_guidance_notes_company ON guidance_notes(company_id);
CREATE INDEX idx_guidance_notes_status ON guidance_notes(status);

CREATE TABLE custom_tables (
    id             BIGSERIAL PRIMARY KEY,
    company_id     VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    name           VARCHAR(120) NOT NULL,
    columns        JSONB NOT NULL DEFAULT '[]',
    section        VARCHAR(50),
    created_by     VARCHAR(80) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_custom_tables_company ON custom_tables(company_id);
CREATE INDEX idx_custom_tables_section ON custom_tables(section);

CREATE TABLE custom_table_rows (
    id             BIGSERIAL PRIMARY KEY,
    table_id       BIGINT NOT NULL REFERENCES custom_tables(id) ON DELETE CASCADE,
    row_data       JSONB NOT NULL DEFAULT '{}',
    row_order      INTEGER NOT NULL DEFAULT 0,
    created_by     VARCHAR(80) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_custom_table_rows_table ON custom_table_rows(table_id);

CREATE INDEX idx_companies_industry  ON companies(broad_industry_id);
CREATE INDEX idx_companies_niche     ON companies(specific_niche_id);
CREATE INDEX idx_companies_model     ON companies(operating_model);
CREATE INDEX idx_companies_name_trgm ON companies USING GIN (name gin_trgm_ops);
CREATE INDEX idx_versions_gin        ON thesis_versions USING GIN (thesis_data jsonb_path_ops);
CREATE INDEX idx_versions_fts        ON thesis_versions USING GIN (search_tsv);

-- Metric registry seed (BUILD_PLAN.md §3).
INSERT INTO metric_definitions (metric_key, label, operating_model, unit, higher_is_better, is_core) VALUES
('revenue_growth_yoy_pct',  'Revenue Growth YoY',       NULL,             'pct',                true,  true),
('debt_to_equity',          'Debt to Equity',           NULL,             'ratio',              false, false),
('capacity_utilization_pct','Capacity Utilization',     'factory',        'pct',                true,  true),
('capex_remaining',         'Capex Outlay Remaining',   'factory',        'currency',           false, false),
('operating_margin_pct',    'Operating Margin',         'factory',        'pct',                true,  true),
('working_capital_days',    'Working Capital Days',     'factory',        'days',               false, true),
('arr',                     'Annual Recurring Revenue', 'subscription',   'currency',           true,  true),
('nrr_pct',                 'Net Revenue Retention',    'subscription',   'pct',                true,  true),
('cac',                     'Customer Acquisition Cost','subscription',   'currency',           false, false),
('monthly_churn_pct',       'Monthly Churn',            'subscription',   'pct',                false, true),
('nim_pct',                 'Net Interest Margin',      'money_lending',  'pct',                true,  true),
('gross_npa_pct',           'Gross NPA',                'money_lending',  'pct',                false, true),
('loan_book_growth_pct',    'Loan Book Growth',         'money_lending',  'pct',                true,  true),
('cost_of_funds_pct',       'Cost of Funds',            'money_lending',  'pct',                false, false),
('sssg_pct',                'Same-Store Sales Growth',  'retail_stores',  'pct',                true,  true),
('store_count',             'Store Footprint',          'retail_stores',  'count',              true,  true),
('inventory_turns',         'Inventory Turnover',       'retail_stores',  'ratio',              true,  false),
('revenue_per_sqft',        'Revenue per Sq Ft',        'retail_stores',  'currency_per_unit',  true,  true),
('billable_headcount',      'Billable Headcount',       'services',       'count',              true,  true),
('blended_billing_rate',    'Blended Billing Rate',     'services',       'currency_per_unit',  true,  true),
('utilization_rate_pct',    'Utilization Rate',         'services',       'pct',                true,  true),
('attrition_pct',           'Voluntary Attrition',      'services',       'pct',                false, true);
