"""week_review is kept per semester: primary key (semester_id, week_start)

Revision ID: 0010
Revises: 0009
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "week_review_new",
        sa.Column("semester_id", sa.Integer(), sa.ForeignKey("semester.id"), primary_key=True),
        sa.Column("week_start", sa.Date(), primary_key=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        op.execute("ALTER TABLE week_review_new ENABLE ROW LEVEL SECURITY")
    # Existing marks go to the active semester, or the first one when none is active (none at all: dropped).
    op.execute(
        "INSERT INTO week_review_new (semester_id, week_start, reviewed_at) "
        "SELECT (SELECT id FROM semester ORDER BY is_active DESC, id LIMIT 1), week_start, reviewed_at "
        "FROM week_review WHERE EXISTS (SELECT 1 FROM semester)"
    )
    op.drop_table("week_review")
    op.rename_table("week_review_new", "week_review")


def downgrade() -> None:
    op.create_table(
        "week_review_old",
        sa.Column("week_start", sa.Date(), primary_key=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        op.execute("ALTER TABLE week_review_old ENABLE ROW LEVEL SECURITY")
    op.execute("INSERT INTO week_review_old (week_start, reviewed_at) "
               "SELECT week_start, MAX(reviewed_at) FROM week_review GROUP BY week_start")
    op.drop_table("week_review")
    op.rename_table("week_review_old", "week_review")
