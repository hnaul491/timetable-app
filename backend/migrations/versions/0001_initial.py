"""initial schema

Revision ID: 0001
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

TABLES = ["semester", "subject", "my_section", "event", "sync_run", "app_secret"]


def upgrade() -> None:
    op.create_table(
        "semester",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(8), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("zeus_group_id", sa.Integer(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "subject",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("semester_id", sa.Integer(), sa.ForeignKey("semester.id"), nullable=False),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
        sa.Column("aliases", sa.JSON(), nullable=False),
        sa.Column("hidden", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("semester_id", "display_name", name="uq_subject_semester_name"),
    )
    op.create_table(
        "my_section",
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.id"), primary_key=True),
        sa.Column("section", sa.String(16), nullable=False),
    )
    op.create_table(
        "event",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("zeus_uid", sa.String(255), nullable=True, unique=True),
        sa.Column("semester_id", sa.Integer(), sa.ForeignKey("semester.id"), nullable=False),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.id"), nullable=True),
        sa.Column("section", sa.String(16), nullable=True),
        sa.Column("title_raw", sa.String(300), nullable=False),
        sa.Column("start_at", sa.DateTime(), nullable=False),
        sa.Column("end_at", sa.DateTime(), nullable=False),
        sa.Column("room", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("changed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_event_semester_start", "event", ["semester_id", "start_at"])
    op.create_table(
        "sync_run",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("fetched", sa.Integer(), nullable=False),
        sa.Column("inserted", sa.Integer(), nullable=False),
        sa.Column("updated", sa.Integer(), nullable=False),
        sa.Column("cancelled", sa.Integer(), nullable=False),
        sa.Column("skipped", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
    )
    op.create_table(
        "app_secret",
        sa.Column("name", sa.String(64), primary_key=True),
        sa.Column("value_encrypted", sa.Text(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        # Close the Supabase Data API: no policies = anon/authenticated roles see nothing.
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        # Alembic's own version table is also exposed by the Data API.
        op.execute("ALTER TABLE alembic_version ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
