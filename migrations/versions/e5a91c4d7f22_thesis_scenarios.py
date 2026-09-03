"""thesis_scenarios

Revision ID: e5a91c4d7f22
Revises: d4e7b2c1f309
Create Date: 2026-09-04 14:00:00.000000

Part 3 of the "track real investing behavior" request (see ADR-026 in
harness/memory/decisions.md for the full design rationale): per-user
parallel theses on the same company.

`companies` shrinks to pure shared identity (name, industry/niche,
operating_model, currency). Everything that was thesis *opinion* -
status, status_source, outcome, conviction, entry_date, exit_date,
last_reviewed, current_version_id - moves to a new `thesis_scenarios` row
per (company, owner). thesis_versions/health_checks/status_events/
status_proposals/position_decisions all gain a `scenario_id` (kept
alongside their existing company_id, which stays useful for
company-wide/cross-scenario queries without a join - same denormalization
pattern health_checks already used for company_id+version_id).

Every existing company gets exactly one auto-created scenario on
migration (owned by whoever authored its latest thesis version, or
'analyst' if somehow none exists) so nothing already in the database is
orphaned or lost. observations, price_observations, custom_tables, and
guidance_notes are deliberately NOT touched - they're objective company
facts or team coordination, shared across every scenario on a company,
not one user's opinion.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e5a91c4d7f22'
down_revision: Union[str, None] = 'd4e7b2c1f309'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
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
    """)

    # Backfill: one scenario per existing company, owned by its latest version's author.
    op.execute("""
        INSERT INTO thesis_scenarios
            (company_id, owner, label, status, status_source, outcome, conviction,
             entry_date, exit_date, last_reviewed, current_version_id)
        SELECT
            c.company_id,
            COALESCE(
                (SELECT tv.authored_by FROM thesis_versions tv
                 WHERE tv.company_id = c.company_id ORDER BY tv.version_no DESC LIMIT 1),
                'analyst'
            ),
            'Thesis',
            c.status, c.status_source, c.outcome, c.conviction,
            c.entry_date, c.exit_date, c.last_reviewed, c.current_version_id
        FROM companies c;
    """)

    op.execute("""
        ALTER TABLE thesis_versions ADD COLUMN scenario_id BIGINT;
        UPDATE thesis_versions tv SET scenario_id = ts.id
            FROM thesis_scenarios ts WHERE ts.company_id = tv.company_id;
        ALTER TABLE thesis_versions ALTER COLUMN scenario_id SET NOT NULL;
        ALTER TABLE thesis_versions ADD CONSTRAINT fk_thesis_versions_scenario
            FOREIGN KEY (scenario_id) REFERENCES thesis_scenarios(id) ON DELETE CASCADE;
        ALTER TABLE thesis_versions DROP CONSTRAINT thesis_versions_company_id_version_no_key;
        ALTER TABLE thesis_versions ADD CONSTRAINT thesis_versions_scenario_id_version_no_key
            UNIQUE (scenario_id, version_no);
        CREATE INDEX idx_thesis_versions_scenario ON thesis_versions(scenario_id);
    """)

    op.execute("""
        ALTER TABLE thesis_scenarios ADD CONSTRAINT fk_thesis_scenarios_current_version
            FOREIGN KEY (current_version_id) REFERENCES thesis_versions(version_id);
    """)

    for tbl in ("health_checks", "status_events", "status_proposals", "position_decisions"):
        op.execute(f"""
            ALTER TABLE {tbl} ADD COLUMN scenario_id BIGINT;
            UPDATE {tbl} t SET scenario_id = ts.id
                FROM thesis_scenarios ts WHERE ts.company_id = t.company_id;
            ALTER TABLE {tbl} ALTER COLUMN scenario_id SET NOT NULL;
            ALTER TABLE {tbl} ADD CONSTRAINT fk_{tbl}_scenario
                FOREIGN KEY (scenario_id) REFERENCES thesis_scenarios(id) ON DELETE CASCADE;
            CREATE INDEX idx_{tbl}_scenario ON {tbl}(scenario_id);
        """)

    op.execute("""
        ALTER TABLE companies DROP CONSTRAINT IF EXISTS fk_current_version;
        ALTER TABLE companies
            DROP COLUMN status,
            DROP COLUMN status_source,
            DROP COLUMN outcome,
            DROP COLUMN conviction,
            DROP COLUMN entry_date,
            DROP COLUMN exit_date,
            DROP COLUMN last_reviewed,
            DROP COLUMN current_version_id;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE companies
            ADD COLUMN status thesis_status NOT NULL DEFAULT 'on_track',
            ADD COLUMN status_source verdict_source NOT NULL DEFAULT 'manual',
            ADD COLUMN outcome thesis_outcome NOT NULL DEFAULT 'open',
            ADD COLUMN conviction SMALLINT,
            ADD COLUMN entry_date DATE,
            ADD COLUMN exit_date DATE,
            ADD COLUMN last_reviewed DATE,
            ADD COLUMN current_version_id BIGINT;

        UPDATE companies c SET
            status = ts.status, status_source = ts.status_source, outcome = ts.outcome,
            conviction = ts.conviction, entry_date = ts.entry_date, exit_date = ts.exit_date,
            last_reviewed = ts.last_reviewed, current_version_id = ts.current_version_id
        FROM thesis_scenarios ts
        WHERE ts.company_id = c.company_id;

        ALTER TABLE companies ALTER COLUMN last_reviewed SET NOT NULL;
        ALTER TABLE companies ADD CONSTRAINT fk_current_version
            FOREIGN KEY (current_version_id) REFERENCES thesis_versions(version_id);
    """)

    for tbl in ("position_decisions", "status_proposals", "status_events", "health_checks"):
        op.execute(f"""
            ALTER TABLE {tbl} DROP CONSTRAINT fk_{tbl}_scenario;
            DROP INDEX IF EXISTS idx_{tbl}_scenario;
            ALTER TABLE {tbl} DROP COLUMN scenario_id;
        """)

    op.execute("""
        ALTER TABLE thesis_versions DROP CONSTRAINT thesis_versions_scenario_id_version_no_key;
        ALTER TABLE thesis_versions ADD CONSTRAINT thesis_versions_company_id_version_no_key
            UNIQUE (company_id, version_no);
        ALTER TABLE thesis_versions DROP CONSTRAINT fk_thesis_versions_scenario;
        DROP INDEX IF EXISTS idx_thesis_versions_scenario;
        ALTER TABLE thesis_versions DROP COLUMN scenario_id;
    """)

    op.execute("""
        DROP TABLE IF EXISTS thesis_scenarios;
    """)
