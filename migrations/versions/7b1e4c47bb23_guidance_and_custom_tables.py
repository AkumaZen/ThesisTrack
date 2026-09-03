"""guidance_and_custom_tables

Revision ID: 7b1e4c47bb23
Revises: 3f656576d076
Create Date: 2026-09-03 15:00:00.000000

Two features beyond BUILD_PLAN.md's frozen v1 scope, built at the user's
explicit request (same pattern as ADR-016's multi-user/RBAC addition - see
ADR-018 in harness/memory/decisions.md for the full rationale):

1. guidance_notes: a simple mutable (not append-only) per-company note
   attached to one of the fixed thesis "block" keys (the_business,
   the_growth_engine, the_big_change, proof_points, what_can_kill_it,
   why_we_believe_it, health_check, references, or "general" for a
   company-wide note), with an open/resolved lifecycle. block_key is
   validated at the Pydantic layer (app/schemas/guidance.py), not a DB
   CHECK constraint, since the block set is defined by the thesis JSON
   contract rather than a DB-owned registry.

2. custom_tables / custom_table_rows: a fully generic, user-defined
   "spreadsheet" per company - custom_tables.columns is a JSONB array of
   {key, label, type} column definitions the user creates on the fly;
   custom_table_rows.row_data is a JSONB object keyed by those column
   keys. No fixed schema, no registry seed - this is the "Excel-like
   table builder" the user asked for, deliberately generic rather than a
   hardcoded table shape (see ADR-018).
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '7b1e4c47bb23'
down_revision: Union[str, None] = '3f656576d076'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
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
            created_by     VARCHAR(80) NOT NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX idx_custom_tables_company ON custom_tables(company_id);

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
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS custom_table_rows;
        DROP TABLE IF EXISTS custom_tables;
        DROP TABLE IF EXISTS guidance_notes;
    """)
