"""custom_table_section

Revision ID: 9f2a6c1e4d80
Revises: 7b1e4c47bb23
Create Date: 2026-09-03 20:00:00.000000

Tier 2 of the "more customization" request: a custom_table can optionally
tag itself to one of the 7 thesis pillars (app/pillars.py's PILLAR_KEYS) so
it renders inside that section instead of only in the generic flat list.
NULL means unattached (the pre-existing behavior). Validated at the
Pydantic layer, not a DB CHECK constraint - same rationale as
guidance_notes.block_key in the prior migration: the valid set is owned by
the thesis JSON contract, not the DB.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '9f2a6c1e4d80'
down_revision: Union[str, None] = '7b1e4c47bb23'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE custom_tables ADD COLUMN section VARCHAR(50);
        CREATE INDEX idx_custom_tables_section ON custom_tables(section);
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX IF EXISTS idx_custom_tables_section;
        ALTER TABLE custom_tables DROP COLUMN IF EXISTS section;
    """)
