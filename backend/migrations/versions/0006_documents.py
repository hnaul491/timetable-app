"""documents per subject stored in Google Drive

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("semester") as batch:
        batch.add_column(sa.Column("drive_folder_id", sa.String(255), nullable=True))
    with op.batch_alter_table("subject") as batch:
        batch.add_column(sa.Column("drive_folder_id", sa.String(255), nullable=True))
    with op.batch_alter_table("google_account") as batch:
        batch.add_column(sa.Column("scopes", sa.Text(), nullable=False, server_default=""))
    op.create_table(
        "document",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.id"), nullable=False),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("event.id"), nullable=True),
        sa.Column("drive_file_id", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("tag", sa.String(16), nullable=False),
        sa.Column("web_view_link", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_document_subject_id", "document", ["subject_id"])
    op.create_index("ix_document_event_id", "document", ["event_id"])
    op.create_table(
        "document_upload",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("session_uri", sa.Text(), nullable=False),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.id"), nullable=False),
        sa.Column("event_id", sa.Integer(), sa.ForeignKey("event.id"), nullable=True),
        sa.Column("tag", sa.String(16), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(255), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("received", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    if op.get_context().dialect.name == "postgresql":
        op.execute("ALTER TABLE document ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE document_upload ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("document_upload")
    op.drop_index("ix_document_event_id", table_name="document")
    op.drop_index("ix_document_subject_id", table_name="document")
    op.drop_table("document")
    with op.batch_alter_table("google_account") as batch:
        batch.drop_column("scopes")
    with op.batch_alter_table("subject") as batch:
        batch.drop_column("drive_folder_id")
    with op.batch_alter_table("semester") as batch:
        batch.drop_column("drive_folder_id")
