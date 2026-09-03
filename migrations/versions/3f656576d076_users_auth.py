"""users_auth

Revision ID: 3f656576d076
Revises: 8bc7749f431e
Create Date: 2026-09-03 06:52:41.913439

Multi-user login with RBAC - not in BUILD_PLAN.md's original schema (§0
scopes v1 to a single-analyst static API key). Built at the user's explicit
request, beyond the frozen spec, per ADR-016 in harness/memory/decisions.md.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '3f656576d076'
down_revision: Union[str, None] = '8bc7749f431e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TYPE user_role AS ENUM ('read_write', 'read_only');

        CREATE TABLE users (
            id             SERIAL PRIMARY KEY,
            email          VARCHAR(255) UNIQUE NOT NULL,
            password_hash  VARCHAR(255) NOT NULL,
            role           user_role NOT NULL DEFAULT 'read_write',
            is_active      BOOLEAN NOT NULL DEFAULT TRUE,
            created_at     TIMESTAMPTZ DEFAULT NOW(),
            last_login_at  TIMESTAMPTZ
        );
    """)


def downgrade() -> None:
    op.execute("""
        DROP TABLE IF EXISTS users;
        DROP TYPE IF EXISTS user_role;
    """)
