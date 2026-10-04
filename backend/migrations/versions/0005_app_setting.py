"""app settings (language preference)

Revision ID: 0005
Revises: 0004
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_setting",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        op.execute("ALTER TABLE app_setting ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("app_setting")
