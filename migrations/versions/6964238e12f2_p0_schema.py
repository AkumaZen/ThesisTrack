"""p0_schema

Revision ID: 6964238e12f2
Revises:
Create Date: 2026-09-02 22:59:49.394551

Raw-SQL migration (not op.create_table): the generated search_tsv column
and the append-only trigger on thesis_versions aren't well served by
Alembic's op.* DSL, and pasting the exact DDL from BUILD_PLAN.md §2 is
lower-risk than re-deriving it through the ORM layer.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '6964238e12f2'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    op.execute('CREATE EXTENSION IF NOT EXISTS btree_gin')

    op.execute("""
        CREATE TYPE operating_model  AS ENUM ('factory','subscription','money_lending','retail_stores','services');
        CREATE TYPE thesis_status    AS ENUM ('on_track','watch_closely','broken');
        CREATE TYPE verdict_source   AS ENUM ('manual','rule_engine','ai_proposed');
        CREATE TYPE thesis_outcome   AS ENUM ('open','played_out','invalidated','exited_early','superseded');
        CREATE TYPE metric_unit      AS ENUM ('pct','days','ratio','currency','count','currency_per_unit');
        CREATE TYPE trigger_severity AS ENUM ('warn','kill');
        CREATE TYPE proposal_state   AS ENUM ('pending','accepted','rejected','superseded');
    """)

    op.execute("""
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
    """)

    op.execute("""
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
    """)

    op.execute("""
        CREATE TABLE companies (
            company_id          VARCHAR(50) PRIMARY KEY,
            name                VARCHAR(255) NOT NULL,
            broad_industry_id   INT NOT NULL REFERENCES broad_industries(id),
            specific_niche_id   INT NOT NULL REFERENCES specific_niches(id),
            operating_model     operating_model NOT NULL,
            currency            CHAR(3) NOT NULL DEFAULT 'INR',
            status              thesis_status NOT NULL DEFAULT 'on_track',
            status_source       verdict_source NOT NULL DEFAULT 'manual',
            outcome             thesis_outcome NOT NULL DEFAULT 'open',
            conviction          SMALLINT CHECK (conviction BETWEEN 1 AND 5),
            entry_date          DATE,
            exit_date           DATE,
            last_reviewed       DATE NOT NULL,
            current_version_id  BIGINT,
            created_at          TIMESTAMPTZ DEFAULT NOW(),
            updated_at          TIMESTAMPTZ DEFAULT NOW()
        );
    """)

    op.execute("""
        CREATE TABLE thesis_versions (
            version_id    BIGSERIAL PRIMARY KEY,
            company_id    VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            version_no    INT NOT NULL,
            thesis_data   JSONB NOT NULL,
            change_note   TEXT,
            authored_by   VARCHAR(80) NOT NULL,
            authored_at   TIMESTAMPTZ DEFAULT NOW(),
            search_tsv    tsvector GENERATED ALWAYS AS (
                             to_tsvector('english', jsonb_path_query_array(thesis_data, '$.**?(@.type() == "string")')::text)
                          ) STORED,
            UNIQUE (company_id, version_no)
        );
    """)

    op.execute("""
        ALTER TABLE companies
          ADD CONSTRAINT fk_current_version
          FOREIGN KEY (current_version_id) REFERENCES thesis_versions(version_id);
    """)

    op.execute("""
        CREATE FUNCTION forbid_version_update() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'thesis_versions is append-only; write a new version'; END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER trg_forbid_version_update
        BEFORE UPDATE OR DELETE ON thesis_versions
        FOR EACH ROW EXECUTE FUNCTION forbid_version_update();
    """)

    op.execute("""
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
    """)

    op.execute("""
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
    """)

    op.execute("""
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
    """)

    op.execute("""
        CREATE TABLE health_checks (
            id                BIGSERIAL PRIMARY KEY,
            company_id        VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
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
    """)

    op.execute("""
        CREATE TABLE status_proposals (
            id               BIGSERIAL PRIMARY KEY,
            company_id       VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
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
    """)

    op.execute("""
        CREATE TABLE status_events (
            id           BIGSERIAL PRIMARY KEY,
            company_id   VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            from_status  thesis_status,
            to_status    thesis_status NOT NULL,
            source       verdict_source NOT NULL,
            proposal_id  BIGINT REFERENCES status_proposals(id),
            rationale    TEXT NOT NULL,
            override     BOOLEAN NOT NULL DEFAULT FALSE,
            actor        VARCHAR(80) NOT NULL,
            created_at   TIMESTAMPTZ DEFAULT NOW()
        );
    """)

    op.execute("""
        CREATE INDEX idx_companies_industry  ON companies(broad_industry_id);
        CREATE INDEX idx_companies_niche     ON companies(specific_niche_id);
        CREATE INDEX idx_companies_model     ON companies(operating_model);
        CREATE INDEX idx_companies_status    ON companies(status);
        CREATE INDEX idx_companies_reviewed  ON companies(last_reviewed);
        CREATE INDEX idx_companies_name_trgm ON companies USING GIN (name gin_trgm_ops);
        CREATE INDEX idx_versions_gin        ON thesis_versions USING GIN (thesis_data jsonb_path_ops);
        CREATE INDEX idx_versions_fts        ON thesis_versions USING GIN (search_tsv);
        CREATE INDEX idx_proposals_pending   ON status_proposals(company_id) WHERE state = 'pending';
    """)

    # Metric registry seed (BUILD_PLAN.md §3) — "seeded in the P0 migration".
    op.execute("""
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
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS status_events;
        DROP TABLE IF EXISTS status_proposals;
        DROP TABLE IF EXISTS health_checks;
        DROP TABLE IF EXISTS trigger_evaluations;
        DROP TABLE IF EXISTS kill_triggers;
        DROP TABLE IF EXISTS observations;
        ALTER TABLE IF EXISTS companies DROP CONSTRAINT IF EXISTS fk_current_version;
        DROP TABLE IF EXISTS thesis_versions;
        DROP FUNCTION IF EXISTS forbid_version_update CASCADE;
        DROP TABLE IF EXISTS companies;
        DROP TABLE IF EXISTS metric_definitions;
        DROP TABLE IF EXISTS specific_niches;
        DROP TABLE IF EXISTS broad_industries;
        DROP TYPE IF EXISTS proposal_state;
        DROP TYPE IF EXISTS trigger_severity;
        DROP TYPE IF EXISTS metric_unit;
        DROP TYPE IF EXISTS thesis_outcome;
        DROP TYPE IF EXISTS verdict_source;
        DROP TYPE IF EXISTS thesis_status;
        DROP TYPE IF EXISTS operating_model;
    """)
