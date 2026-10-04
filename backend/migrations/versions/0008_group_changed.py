"""semester.group_changed_at: marks a deliberate Zeus group change until the next sync

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("semester", sa.Column("group_changed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("semester", "group_changed_at")
