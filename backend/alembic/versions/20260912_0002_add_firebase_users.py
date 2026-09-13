"""Add Firebase users and project ownership.

Revision ID: 20260912_0002
Revises: 20260910_0001
Create Date: 2026-09-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260912_0002"
down_revision: str | None = "20260910_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("firebase_uid", sa.String(length=128), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("email_verified", sa.Boolean(), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=True),
        sa.Column("photo_url", sa.String(length=2048), nullable=True),
        sa.Column("auth_provider", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_firebase_uid", "users", ["firebase_uid"], unique=True)
    op.add_column("projects", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.create_index("ix_projects_owner_id", "projects", ["owner_id"], unique=False)
    op.create_foreign_key(
        "fk_projects_owner_id_users",
        "projects",
        "users",
        ["owner_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("fk_projects_owner_id_users", "projects", type_="foreignkey")
    op.drop_index("ix_projects_owner_id", table_name="projects")
    op.drop_column("projects", "owner_id")
    op.drop_index("ix_users_firebase_uid", table_name="users")
    op.drop_table("users")
