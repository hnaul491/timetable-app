"""notes, tasks, recurring rules

Revision ID: 0002
Revises: 0001
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

NEW_TABLES = ["recurring_rule", "note", "task"]


def upgrade() -> None:
    op.create_table(
        "recurring_rule",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("semester_id", sa.Integer(), sa.ForeignKey("semester.id"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("weekdays", sa.JSON(), nullable=False),
        sa.Column("start_time", sa.String(5), nullable=False),
        sa.Column("end_time", sa.String(5), nullable=False),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("until_date", sa.Date(), nullable=False),
        sa.Column("location", sa.String(200), nullable=False),
    )
    with op.batch_alter_table("event") as batch:
        batch.add_column(sa.Column("recurring_rule_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_event_recurring_rule", "recurring_rule", ["recurring_rule_id"], ["id"])
    op.create_table(
        "note",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("event.id"), nullable=False),
        sa.Column("tab", sa.String(8), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("important", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("event_id", "tab", name="uq_note_event_tab"),
    )
    op.create_table(
        "task",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("note_id", sa.Integer(), sa.ForeignKey("note.id"), nullable=True),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("event.id"), nullable=True),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.id"), nullable=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("important", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        for table in NEW_TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("task")
    op.drop_table("note")
    with op.batch_alter_table("event") as batch:
        batch.drop_constraint("fk_event_recurring_rule", type_="foreignkey")
        batch.drop_column("recurring_rule_id")
    op.drop_table("recurring_rule")
