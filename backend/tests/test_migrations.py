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
                  "recurring_rule", "note", "task", "week_review", "google_account", "gcal_tombstone", "app_setting", "document", "document_upload", "pending_action", "chat_message",
                  "alembic_version"]:
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in sql


def _cfg(tmp_path):
    url = f"sqlite:///{tmp_path / 'r.db'}"
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg, url


def test_0010_assigns_existing_review_marks_to_the_active_semester(tmp_path):
    cfg, url = _cfg(tmp_path)
    command.upgrade(cfg, "0009")
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.exec_driver_sql("INSERT INTO semester (id, code, name, is_active) VALUES (1, 'S1', 'One', 0), (2, 'S2', 'Two', 1)")
        conn.exec_driver_sql("INSERT INTO week_review (week_start, reviewed_at) VALUES ('2026-10-19', '2026-10-20 10:00:00')")
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        rows = conn.exec_driver_sql("SELECT semester_id, week_start FROM week_review").all()
    engine.dispose()
    assert rows == [(2, "2026-10-19")]


def test_0010_falls_back_to_the_first_semester_and_survives_none(tmp_path):
    cfg, url = _cfg(tmp_path)
    command.upgrade(cfg, "0009")
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.exec_driver_sql("INSERT INTO semester (id, code, name, is_active) VALUES (3, 'S3', 'Three', 0), (4, 'S4', 'Four', 0)")
        conn.exec_driver_sql("INSERT INTO week_review (week_start, reviewed_at) VALUES ('2026-10-19', '2026-10-20 10:00:00')")
    command.upgrade(cfg, "head")
    with engine.connect() as conn:
        assert conn.exec_driver_sql("SELECT semester_id FROM week_review").all() == [(3,)]
    engine.dispose()
    (tmp_path / "n").mkdir()
    cfg2, url2 = _cfg(tmp_path / "n")
    command.upgrade(cfg2, "0009")
    e2 = create_engine(url2)
    with e2.begin() as conn:
        conn.exec_driver_sql("INSERT INTO week_review (week_start, reviewed_at) VALUES ('2026-10-19', '2026-10-20 10:00:00')")
    command.upgrade(cfg2, "head")
    with e2.connect() as conn:
        assert conn.exec_driver_sql("SELECT COUNT(*) FROM week_review").scalar() == 0
    e2.dispose()
