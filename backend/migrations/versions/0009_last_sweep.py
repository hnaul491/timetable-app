"""google_account.last_sweep_at: when the orphan sweep of the app calendar last completed

Revision ID: 0009
Revises: 0008
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("google_account", sa.Column("last_sweep_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("google_account", "last_sweep_at")
