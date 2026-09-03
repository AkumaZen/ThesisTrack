"""p6_training_splits

Revision ID: 8bc7749f431e
Revises: 6964238e12f2
Create Date: 2026-09-03 06:38:49.028245

BUILD_PLAN.md §7.4: split assignment must be stable across export runs, so
it's a real table, not recomputed on every export.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '8bc7749f431e'
down_revision: Union[str, None] = '6964238e12f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE training_splits (
            company_id   VARCHAR(50) PRIMARY KEY REFERENCES companies(company_id) ON DELETE CASCADE,
            split        VARCHAR(10) NOT NULL CHECK (split IN ('train','eval')),
            assigned_at  TIMESTAMPTZ DEFAULT NOW()
        );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS training_splits;")
