"""position_decisions

Revision ID: c3d8f1a92e56
Revises: 9f2a6c1e4d80
Create Date: 2026-09-04 09:00:00.000000

First of a three-part "track real investing behavior" request (see
harness/memory/decisions.md for the full breakdown): buy/sell decision
logging. The other two parts - price-performance tracking and per-user
parallel thesis "scenarios" - land in later migrations; this one is
deliberately self-contained so it's useful on its own and doesn't need to
anticipate the scenario remodel's exact shape yet.

A decision is a real financial action with real consequences, so it's
append-only (same posture as thesis_versions - BEFORE UPDATE OR DELETE
trigger) rather than freely editable like a custom_table row. It records
`version_id`, the thesis version that was current at the moment of the
decision (nullable only because a company theoretically could have none),
mirroring health_checks.version_id - "what did we believe when we bought"
is exactly the kind of context this platform is built to preserve.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c3d8f1a92e56'
down_revision: Union[str, None] = '9f2a6c1e4d80'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE position_decisions (
            id             BIGSERIAL PRIMARY KEY,
            company_id     VARCHAR(50) NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
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

        CREATE FUNCTION forbid_decision_update() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'position_decisions is append-only; log a new decision instead'; END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER trg_forbid_decision_update
        BEFORE UPDATE OR DELETE ON position_decisions
        FOR EACH ROW EXECUTE FUNCTION forbid_decision_update();
    """)


def downgrade() -> None:
    op.execute("""
        DROP TRIGGER IF EXISTS trg_forbid_decision_update ON position_decisions;
        DROP FUNCTION IF EXISTS forbid_decision_update CASCADE;
        DROP TABLE IF EXISTS position_decisions;
    """)
