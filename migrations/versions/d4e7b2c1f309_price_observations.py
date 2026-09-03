"""price_observations

Revision ID: d4e7b2c1f309
Revises: c3d8f1a92e56
Create Date: 2026-09-04 11:00:00.000000

Part 2 of the "track real investing behavior" request (see ADR-024 and
ADR-025 in harness/memory/decisions.md): does the stock actually perform.

Deliberately a separate table from `observations` rather than reusing it -
observations is quarter-cadence financial fundamentals keyed by
(company_id, period, metric_key); a price checkpoint is a plain
(company_id, date) fact logged at whatever cadence the user checks, and
forcing it through observations' period/metric-registry machinery would
conflate two different concepts. `source` defaults to 'manual' (the only
path built right now) but reserves 'screener' for the auto-pull integration
the user asked to keep open for later - not built yet.

Not append-only (unlike thesis_versions/position_decisions): a price point
is a plain fact, correctable if mis-typed, not a decision or an audit
record. UNIQUE(company_id, observed_on) + the service layer upserting on
conflict means "log today's price again" corrects today's entry rather
than erroring or duplicating.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd4e7b2c1f309'
down_revision: Union[str, None] = 'c3d8f1a92e56'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
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
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS price_observations;
    """)
