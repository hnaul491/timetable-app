"""google calendar push

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("event", sa.Column("gcal_event_id", sa.String(255), nullable=True))
    op.add_column("event", sa.Column("gcal_hash", sa.String(64), nullable=True))
    op.create_table(
        "google_account",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("calendar_id", sa.String(255), nullable=True),
        sa.Column("kinds", sa.JSON(), nullable=False),
        sa.Column("needs_reconnect", sa.Boolean(), nullable=False),
        sa.Column("connected_at", sa.DateTime(), nullable=False),
        sa.Column("last_push_at", sa.DateTime(), nullable=True),
        sa.Column("last_push_error", sa.String(500), nullable=True),
        sa.Column("push_lock_until", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "gcal_tombstone",
        sa.Column("gcal_event_id", sa.String(255), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        op.execute("ALTER TABLE google_account ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE gcal_tombstone ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("gcal_tombstone")
    op.drop_table("google_account")
    with op.batch_alter_table("event") as batch:
        batch.drop_column("gcal_hash")
        batch.drop_column("gcal_event_id")
