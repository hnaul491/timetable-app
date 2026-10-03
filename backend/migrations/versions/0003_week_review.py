"""week review marks

Revision ID: 0003
Revises: 0002
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "week_review",
        sa.Column("week_start", sa.Date(), primary_key=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        op.execute("ALTER TABLE week_review ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("week_review")
