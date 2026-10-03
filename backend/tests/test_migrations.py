import io
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

import app.models  # noqa: F401
from app.db import Base

BACKEND = Path(__file__).resolve().parents[1]


def test_migrations_match_models(tmp_path):
    url = f"sqlite:///{tmp_path / 'm.db'}"
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")
    engine = create_engine(url)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    engine.dispose()
    assert diff == []


def test_postgres_migration_enables_rls_on_every_table():
    buf = io.StringIO()
    cfg = Config(str(BACKEND / "alembic.ini"), output_buffer=buf)
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    cfg.set_main_option("sqlalchemy.url", "postgresql+psycopg://u:p@localhost/db")
    command.upgrade(cfg, "head", sql=True)
    sql = buf.getvalue()
    for table in ["semester", "subject", "my_section", "event", "sync_run", "app_secret",
                  "recurring_rule", "note", "task", "week_review", "alembic_version"]:
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in sql
