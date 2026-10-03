# Plan 1 — Foundation + School Timetable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed, Google-login-protected web app that imports my SE S1 timetable from the Zeus ICS link every day, filters it to my sections, and shows it in a clean week/day view on laptop and phone.

**Architecture:** FastAPI backend (Python 3.12, SQLAlchemy 2, Alembic) running as a Vercel Python serverless function under `/api`, Supabase Postgres for data, Supabase Auth (Google) for login with a server-side email allowlist. React + Vite + TypeScript SPA served by Vercel. A GitHub Actions cron calls `POST /api/sync` daily; sync fetches the whole-semester ICS, normalizes titles into subject + section, and diffs by `UID`.

**Tech Stack:** Python 3.12, uv, FastAPI, SQLAlchemy 2, Alembic, psycopg 3, icalendar, httpx, PyJWT, cryptography, pytest · Node 22, React 19, Vite, TypeScript, Tailwind CSS v4, TanStack Query v5, React Router v7, supabase-js v2, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-03-timetable-app-design.md` · UI canvas: https://claude.ai/artifact/FrMfhBtKZezMzRmjT41AnR

**This is plan 1 of 4.** Plan 2: custom/recurring events, notes, tasks, board, subjects, weekend review, semester switcher, subject alias editing + hide subject in Settings, PWA manifest (installable). Plan 3: Google Calendar push. Plan 4: AI (suggest tasks + assistant). Tables/columns those plans need are added by their own migrations, not here.

## Global Constraints

- Budget **$0**: only free tiers (Vercel Hobby, Supabase Free, GitHub Actions, Google Cloud OAuth).
- Python `>=3.12` (managed by uv). Node `>=22`.
- All timestamps stored in the DB as **naive UTC** `datetime`; API returns ISO-8601 strings ending in `Z`; UI displays in **`Europe/Paris`** using `Intl` with an explicit `timeZone` (never the browser's local zone).
- Single user: every `/api` route except `/api/health` and cron-authenticated `POST /api/sync` requires a Supabase JWT whose `email` is in `ALLOWED_EMAILS`.
- Secrets (`ZEUS_ICS_KEY`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, DB URL) never appear in git, API responses, logs, or error messages. **The Zeus ICS URL contains the key, so it must never be put in an error message.**
- Every Supabase table has Row Level Security enabled (the backend connects as the `postgres` role, which bypasses RLS; the public Data API is then closed).
- Section titles follow `^(G\d+|GR\d+) - (.+)$`; holidays are `Vacances` and `Bank Holiday`; a title ending in ` Exam` is kind `exam`.
- UI tokens from the canvas: fonts Plus Jakarta Sans + JetBrains Mono; accent `#2E55E6`; ink `#15171C`; muted `#5B6170`; line `#E4E7EC`; canvas `#F4F5F7`.
- All shell commands run in Git Bash from the repo root `C:\Users\huynh\timetable-app` unless a step says `cd backend` / `cd frontend`.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Zeus returns HTTP 200 with an empty or non-calendar body** (maintenance page, empty VCALENDAR) → sync must fail with status `failed` and must **not** cancel any events. Tests: Task 4 (`test_html_body_is_invalid_feed`) and Task 7 (`test_empty_feed_changes_nothing`).
2. **The week of 19–25 Oct 2026 crosses the CEST→CET switch (25 Oct)** → week range must end at `2026-10-25T23:00:00Z`, and an event at `12:00Z` on 26 Oct must show `13:00`. Tests: Task 11 (`rangeUtc` and `formatTime` DST tests).
3. **Overlapping events in one day column** (e.g. sessions before a section is chosen, or two classes moved into the same slot) → shown side by side, never hidden under each other. Tests: Task 11 (`layoutDay` overlap/chain tests) and Task 12 (`renders overlapping events side by side`).
4. **Network errors leaking the ICS key** (httpx exception text includes the URL) → error message contains no key. Test: Task 6 (`test_network_error_message_does_not_contain_key`).
5. **User pastes the whole Zeus link (with `?startDate=…`) instead of the bare key** → key is extracted and stored; the GET endpoint never returns it. Tests: Task 6 (`extract_key` tests) and Task 9 (`test_put_zeus_key_accepts_full_link_and_never_returns_it`).

---

## File Structure

```
timetable-app/
├─ api/index.py                         # Vercel entry; imports backend app
├─ requirements.txt                     # Vercel Python deps (mirror of backend deps)
├─ vercel.json                          # build, function config, rewrites
├─ .github/workflows/ci.yml             # tests on push
├─ .github/workflows/sync.yml           # daily cron → POST /api/sync
├─ docs/SETUP.md                        # one-time Supabase / Google / Vercel setup
├─ backend/
│  ├─ pyproject.toml  .python-version  alembic.ini  .env.example
│  ├─ migrations/env.py  migrations/script.py.mako  migrations/versions/0001_initial.py
│  ├─ app/
│  │  ├─ main.py            # create_app(), router wiring
│  │  ├─ config.py          # Settings (env)
│  │  ├─ db.py              # Base, engine, get_session
│  │  ├─ models.py          # Semester, Subject, MySection, Event, SyncRun, AppSecret
│  │  ├─ timeutil.py        # to_naive_utc, iso_utc
│  │  ├─ auth.py            # TokenVerifier, require_user, require_cron_or_user
│  │  ├─ secret_store.py    # Fernet-encrypted secrets, get_zeus_key
│  │  ├─ deps.py            # get_now, get_fetcher
│  │  ├─ schemas.py         # Pydantic response/request models
│  │  ├─ seed.py            # semesters + S1 aliases (CLI)
│  │  ├─ subjects/parser.py   subjects/resolver.py
│  │  ├─ zeus/ics_parser.py   zeus/ics_client.py   zeus/sync.py
│  │  ├─ services/events_query.py
│  │  └─ routers/health.py  routers/events.py  routers/settings.py  routers/sync.py
│  └─ tests/ (conftest.py + one test file per module)
└─ frontend/
   ├─ package.json  vite.config.ts  tsconfig.json  index.html  .env.example
   └─ src/
      ├─ main.tsx  App.tsx  index.css  types.ts  vite-env.d.ts
      ├─ lib/supabase.ts  lib/api.ts  lib/time.ts  lib/layout.ts  lib/useMediaQuery.ts
      ├─ auth/AuthGate.tsx  auth/LoginPage.tsx
      ├─ components/Layout.tsx  components/WeekGrid.tsx  components/Banners.tsx
      ├─ pages/CalendarPage.tsx  pages/SettingsPage.tsx
      └─ test/setup.ts  (+ *.test.ts(x) next to the code)
```

---

### Task 1: Backend scaffold, toolchain, health endpoint

**Files:**
- Create: `backend/pyproject.toml`, `backend/.python-version`, `backend/app/__init__.py`, `backend/app/main.py`, `backend/app/routers/__init__.py`, `backend/app/routers/health.py`, `backend/tests/__init__.py`, `backend/tests/test_health.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `app.main.create_app() -> FastAPI`; module-level `app.main.app`. Route `GET /api/health → {"status": "ok"}`.

- [ ] **Step 1: Install uv and Python 3.12** (Python is not installed on this machine)

Run in PowerShell:
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```
Open a new terminal, then:
```bash
uv --version
uv python install 3.12
```
Expected: `uv 0.x.y` and Python 3.12 installed.

- [ ] **Step 2: Create project files**

`backend/.python-version`:
```
3.12
```

`backend/pyproject.toml`:
```toml
[project]
name = "timetable-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "sqlalchemy>=2.0",
  "psycopg[binary]>=3.2",
  "alembic>=1.13",
  "pydantic-settings>=2.4",
  "pyjwt[crypto]>=2.9",
  "httpx>=0.27",
  "icalendar>=6.0",
  "cryptography>=43",
]

[dependency-groups]
dev = ["pytest>=8", "uvicorn>=0.30"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

`backend/app/__init__.py`, `backend/app/routers/__init__.py` and `backend/tests/__init__.py`: empty files (the last one lets tests do `from tests.conftest import AUTH`).

Append to `.gitignore`:
```
backend/dev.db
backend/.env
frontend/.env
frontend/dist/
.vercel/
```

- [ ] **Step 3: Write the failing test** — `backend/tests/test_health.py`

```python
from fastapi.testclient import TestClient

from app.main import create_app


def test_health_returns_ok():
    client = TestClient(create_app())
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && uv sync && uv run pytest tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 5: Implement** — `backend/app/routers/health.py`

```python
from fastapi import APIRouter

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

`backend/app/main.py`:
```python
from fastapi import FastAPI

from app.routers import health


def create_app() -> FastAPI:
    app = FastAPI(title="Timetable API")
    app.include_router(health.router)
    return app


app = create_app()
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && uv run pytest -v`
Expected: 1 passed

- [ ] **Step 7: Commit**

```bash
git add .gitignore backend/pyproject.toml backend/uv.lock backend/.python-version backend/app backend/tests
git commit -m "feat(backend): scaffold FastAPI app with health endpoint"
```

---

### Task 2: Config, database, models, initial migration (with RLS)

**Files:**
- Create: `backend/app/config.py`, `backend/app/db.py`, `backend/app/models.py`, `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/script.py.mako`, `backend/migrations/versions/0001_initial.py`, `backend/.env.example`, `backend/tests/conftest.py`, `backend/tests/test_models.py`, `backend/tests/test_migrations.py`

**Interfaces:**
- Produces:
  - `app.config.Settings` fields: `database_url: str`, `allowed_emails: str`, `supabase_url: str`, `cron_secret: str`, `token_encryption_key: str`, `zeus_ics_key: str`, `zeus_base_url: str`; property `allowed_email_set -> set[str]`; `get_settings() -> Settings` (cached).
  - `app.db.Base`, `app.db.make_engine(url) -> Engine`, `app.db.get_engine() -> Engine`, `app.db.get_session() -> Iterator[Session]`.
  - Models `Semester`, `Subject`, `MySection`, `Event`, `SyncRun`, `AppSecret` (fields below).
  - Test fixtures `engine`, `session`, `semester` (active S1, group 802).

- [ ] **Step 1: Write the failing tests**

`backend/tests/conftest.py`:
```python
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (register tables)
from app.db import Base
from app.models import Semester


@pytest.fixture
def engine():
    eng = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s


@pytest.fixture
def semester(session) -> Semester:
    sem = Semester(
        code="S1",
        name="SE S1 (Fundamental)",
        zeus_group_id=802,
        start_date=date(2026, 10, 12),
        end_date=date(2027, 1, 30),
        is_active=True,
    )
    session.add(sem)
    session.commit()
    return sem
```

`backend/tests/test_models.py`:
```python
from datetime import datetime

from sqlalchemy import select

from app.models import Event, MySection, Subject


def test_subject_aliases_round_trip(session, semester):
    session.add(
        Subject(semester_id=semester.id, display_name="French for Fall 26 T1",
                aliases=["French for Spring F26 T1"])
    )
    session.commit()
    subject = session.scalar(select(Subject))
    assert subject.aliases == ["French for Spring F26 T1"]
    assert subject.hidden is False
    assert subject.color == "#2E55E6"


def test_event_defaults(session, semester):
    subject = Subject(semester_id=semester.id, display_name="Harmonization", aliases=[])
    session.add(subject)
    session.flush()
    session.add(MySection(subject_id=subject.id, section="G1"))
    session.add(
        Event(source="zeus", zeus_uid="u1", semester_id=semester.id, subject_id=subject.id,
              title_raw="Harmonization", start_at=datetime(2026, 10, 20, 7, 0),
              end_at=datetime(2026, 10, 20, 10, 0), kind="class")
    )
    session.commit()
    event = session.scalar(select(Event))
    assert event.status == "normal"
    assert event.room == ""
    assert event.changed_at is None
```

`backend/tests/test_migrations.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_models.py tests/test_migrations.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models'`

- [ ] **Step 3: Implement config, db, models**

`backend/app/config.py`:
```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./dev.db"
    allowed_emails: str = ""
    supabase_url: str = ""
    cron_secret: str = ""
    token_encryption_key: str = ""
    zeus_ics_key: str = ""
    zeus_base_url: str = "https://zeus.ionis-it.com"

    @property
    def allowed_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

`backend/app/db.py`:
```python
from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session
from sqlalchemy.pool import NullPool

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def make_engine(url: str) -> Engine:
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False})
    # Supabase transaction pooler (port 6543) does not support prepared statements.
    return create_engine(url, poolclass=NullPool, connect_args={"prepare_threshold": None})


@lru_cache
def get_engine() -> Engine:
    return make_engine(get_settings().database_url)


def get_session() -> Iterator[Session]:
    with Session(get_engine()) as session:
        yield session
```

`backend/app/models.py`:
```python
from datetime import date, datetime

from sqlalchemy import (JSON, Boolean, Date, DateTime, ForeignKey, Index, Integer, String,
                        Text, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Semester(Base):
    __tablename__ = "semester"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(8), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    zeus_group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)


class Subject(Base):
    __tablename__ = "subject"
    __table_args__ = (UniqueConstraint("semester_id", "display_name", name="uq_subject_semester_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    semester_id: Mapped[int] = mapped_column(ForeignKey("semester.id"))
    display_name: Mapped[str] = mapped_column(String(200))
    color: Mapped[str] = mapped_column(String(7), default="#2E55E6")
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)


class MySection(Base):
    __tablename__ = "my_section"

    subject_id: Mapped[int] = mapped_column(ForeignKey("subject.id"), primary_key=True)
    section: Mapped[str] = mapped_column(String(16))


class Event(Base):
    __tablename__ = "event"
    __table_args__ = (Index("ix_event_semester_start", "semester_id", "start_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(16))
    zeus_uid: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    semester_id: Mapped[int] = mapped_column(ForeignKey("semester.id"))
    subject_id: Mapped[int | None] = mapped_column(ForeignKey("subject.id"), nullable=True)
    section: Mapped[str | None] = mapped_column(String(16), nullable=True)
    title_raw: Mapped[str] = mapped_column(String(300))
    start_at: Mapped[datetime] = mapped_column(DateTime)
    end_at: Mapped[datetime] = mapped_column(DateTime)
    room: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="normal")
    changed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SyncRun(Base):
    __tablename__ = "sync_run"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16))
    fetched: Mapped[int] = mapped_column(Integer, default=0)
    inserted: Mapped[int] = mapped_column(Integer, default=0)
    updated: Mapped[int] = mapped_column(Integer, default=0)
    cancelled: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class AppSecret(Base):
    __tablename__ = "app_secret"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_encrypted: Mapped[str] = mapped_column(Text)
```

- [ ] **Step 4: Implement Alembic**

`backend/alembic.ini`:
```ini
[alembic]
script_location = migrations
sqlalchemy.url =
```

`backend/migrations/script.py.mako`:
```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = None
depends_on = None


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

`backend/migrations/env.py`:
```python
from alembic import context
from sqlalchemy import engine_from_config, pool

import app.models  # noqa: F401
from app.config import get_settings
from app.db import Base

config = context.config
url = config.get_main_option("sqlalchemy.url") or get_settings().database_url
target_metadata = Base.metadata


def run_offline() -> None:
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_online() -> None:
    connectable = engine_from_config(
        {"sqlalchemy.url": url}, prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata,
                          render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_offline()
else:
    run_online()
```

`backend/migrations/versions/0001_initial.py`:
```python
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
    if op.get_bind().dialect.name == "postgresql":
        # Close the Supabase Data API: no policies = anon/authenticated roles see nothing.
        for table in TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
```

`backend/.env.example`:
```
# Local dev uses SQLite by default. For Supabase use the transaction pooler URL:
# DATABASE_URL=postgresql+psycopg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
DATABASE_URL=sqlite:///./dev.db
ALLOWED_EMAILS=you@gmail.com
SUPABASE_URL=https://<ref>.supabase.co
CRON_SECRET=change-me
TOKEN_ENCRYPTION_KEY=
ZEUS_ICS_KEY=
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && uv run pytest -v`
Expected: all pass (health, 2 model tests, migration test). If `test_migrations_match_models` reports a diff, fix the migration (not the test) until it is empty.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): add settings, models and initial migration with RLS"
```

---

### Task 3: Title parser (subject + section + kind)

**Files:**
- Create: `backend/app/subjects/__init__.py` (empty), `backend/app/subjects/parser.py`, `backend/tests/test_title_parser.py`

**Interfaces:**
- Produces: `ParsedTitle(base_name: str | None, section: str | None, kind: str)` (frozen dataclass; `kind` ∈ `"class" | "exam" | "holiday"`); `parse_title(raw: str) -> ParsedTitle`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_title_parser.py`

```python
import pytest

from app.subjects.parser import ParsedTitle, parse_title


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("GR5 - French for Fall 26 T1", ParsedTitle("French for Fall 26 T1", "GR5", "class")),
        ("GR12 - French for Fall 26 T1", ParsedTitle("French for Fall 26 T1", "GR12", "class")),
        ("G1 - Adapting to a New Culture", ParsedTitle("Adapting to a New Culture", "G1", "class")),
        ("GR2 - French for Spring F26 T1", ParsedTitle("French for Spring F26 T1", "GR2", "class")),
        ("Relational Databases", ParsedTitle("Relational Databases", None, "class")),
        ("Relational Databases Exam", ParsedTitle("Relational Databases", None, "exam")),
        ("Interpersonnal Communication ", ParsedTitle("Interpersonnal Communication", None, "class")),
        ("Engineering Tools (Terminal · Git · CI · Docker)",
         ParsedTitle("Engineering Tools (Terminal · Git · CI · Docker)", None, "class")),
        ("Tutorat & French for Fall 26 T1", ParsedTitle("Tutorat & French for Fall 26 T1", None, "class")),
        ("Vacances", ParsedTitle(None, None, "holiday")),
        ("Bank Holiday", ParsedTitle(None, None, "holiday")),
    ],
)
def test_parse_title(raw, expected):
    assert parse_title(raw) == expected


def test_collapses_inner_whitespace():
    assert parse_title("GR5  -   French  for Fall 26 T1").base_name == "French for Fall 26 T1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_title_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.subjects'`

- [ ] **Step 3: Implement** — `backend/app/subjects/parser.py`

```python
import re
from dataclasses import dataclass

SECTION_RE = re.compile(r"^(G\d+|GR\d+)\s*-\s*(.+)$")
EXAM_RE = re.compile(r"\s+exam$", re.IGNORECASE)
HOLIDAY_TITLES = {"vacances", "bank holiday"}


@dataclass(frozen=True)
class ParsedTitle:
    base_name: str | None
    section: str | None
    kind: str


def parse_title(raw: str) -> ParsedTitle:
    title = " ".join(raw.split())
    if title.casefold() in HOLIDAY_TITLES:
        return ParsedTitle(None, None, "holiday")
    section = None
    match = SECTION_RE.match(title)
    if match:
        section, title = match.group(1), match.group(2).strip()
    kind = "class"
    if EXAM_RE.search(title):
        kind = "exam"
        title = EXAM_RE.sub("", title)
    return ParsedTitle(title, section, kind)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_title_parser.py -v`
Expected: 12 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/subjects backend/tests/test_title_parser.py
git commit -m "feat(backend): parse Zeus titles into subject, section and kind"
```

---

### Task 4: ICS parser + time helpers

**Files:**
- Create: `backend/app/timeutil.py`, `backend/app/zeus/__init__.py` (empty), `backend/app/zeus/ics_parser.py`, `backend/tests/test_timeutil.py`, `backend/tests/test_ics_parser.py`

**Interfaces:**
- Produces:
  - `app.timeutil.to_naive_utc(value: datetime | date) -> datetime`, `app.timeutil.iso_utc(dt: datetime) -> str` (e.g. `"2026-10-20T12:30:00Z"`).
  - `app.zeus.ics_parser.FeedEvent(uid, title, start, end, room, description)` (frozen; `start`/`end` naive UTC), `ParsedFeed(events: list[FeedEvent], skipped: int)`, `InvalidFeedError(Exception)`, `parse_ics(text: str) -> ParsedFeed`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_timeutil.py`:
```python
from datetime import date, datetime, timedelta, timezone

from app.timeutil import iso_utc, to_naive_utc


def test_aware_datetime_converted_to_naive_utc():
    paris_summer = timezone(timedelta(hours=2))
    assert to_naive_utc(datetime(2026, 10, 20, 14, 30, tzinfo=paris_summer)) == datetime(2026, 10, 20, 12, 30)


def test_naive_datetime_is_kept():
    assert to_naive_utc(datetime(2026, 10, 20, 12, 30)) == datetime(2026, 10, 20, 12, 30)


def test_date_becomes_midnight():
    assert to_naive_utc(date(2026, 12, 21)) == datetime(2026, 12, 21, 0, 0)


def test_iso_utc_has_z_suffix():
    assert iso_utc(datetime(2026, 10, 20, 12, 30)) == "2026-10-20T12:30:00Z"
```

`backend/tests/test_ics_parser.py`:
```python
from datetime import datetime

import pytest

from app.zeus.ics_parser import InvalidFeedError, parse_ics


def ics(*events: str) -> str:
    return "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", *events,
                        "END:VCALENDAR"]) + "\r\n"


def vevent(uid, summary, start, end="20261020T143000Z", location="", description=""):
    lines = ["BEGIN:VEVENT", f"UID:{uid}", f"SUMMARY:{summary}", f"DTSTART:{start}"]
    if end is not None:
        lines.append(f"DTEND:{end}")
    lines += [f"LOCATION:{location}", f"DESCRIPTION:{description}", "END:VEVENT"]
    return "\r\n".join(lines)


def test_parses_basic_event():
    feed = parse_ics(ics(vevent("u1", "GR5 - French for Fall 26 T1", "20261020T123000Z",
                                location="KB605")))
    assert feed.skipped == 0
    [event] = feed.events
    assert event.uid == "u1"
    assert event.title == "GR5 - French for Fall 26 T1"
    assert event.start == datetime(2026, 10, 20, 12, 30)
    assert event.end == datetime(2026, 10, 20, 14, 30)
    assert event.room == "KB605"


def test_unescapes_commas_in_location():
    feed = parse_ics(ics(vevent("u1", "Tutorat & French for Fall 26 T1", "20261020T123000Z",
                                location="KB404\\, KB604 B")))
    assert feed.events[0].room == "KB404, KB604 B"


def test_unfolds_long_lines():
    folded = vevent("u1", "GR12 - French for Fall 26 T1", "20261020T123000Z",
                    description="SORTIE CULTURELLE : Bourgeois gentilhomme le samedi\r\n  24 octobre")
    assert "samedi 24 octobre" in parse_ics(ics(folded)).events[0].description


def test_skips_missing_end_and_duplicate_uid():
    feed = parse_ics(ics(
        vevent("u1", "Harmonization", "20261020T070000Z", end="20261020T100000Z"),
        vevent("u2", "Harmonization", "20261021T070000Z", end=None),
        vevent("u1", "Harmonization", "20261022T070000Z", end="20261022T100000Z"),
    ))
    assert [e.uid for e in feed.events] == ["u1"]
    assert feed.skipped == 2


def test_skips_event_ending_before_it_starts():
    feed = parse_ics(ics(vevent("u1", "X", "20261020T123000Z", end="20261020T120000Z")))
    assert feed.events == []
    assert feed.skipped == 1


def test_empty_calendar_returns_no_events():
    assert parse_ics(ics()).events == []


def test_html_body_is_invalid_feed():
    with pytest.raises(InvalidFeedError):
        parse_ics("<html><body>Maintenance</body></html>")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_timeutil.py tests/test_ics_parser.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement**

`backend/app/timeutil.py`:
```python
from datetime import date, datetime, timezone


def to_naive_utc(value: datetime | date) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return datetime(value.year, value.month, value.day)


def iso_utc(dt: datetime) -> str:
    return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
```

`backend/app/zeus/ics_parser.py`:
```python
from dataclasses import dataclass
from datetime import datetime

from icalendar import Calendar

from app.timeutil import to_naive_utc


class InvalidFeedError(Exception):
    pass


@dataclass(frozen=True)
class FeedEvent:
    uid: str
    title: str
    start: datetime
    end: datetime
    room: str
    description: str


@dataclass
class ParsedFeed:
    events: list[FeedEvent]
    skipped: int


def parse_ics(text: str) -> ParsedFeed:
    if "BEGIN:VCALENDAR" not in text:
        raise InvalidFeedError("response is not an iCalendar document")
    try:
        calendar = Calendar.from_ical(text)
    except ValueError as exc:
        raise InvalidFeedError(f"could not parse calendar: {exc}") from None

    events: list[FeedEvent] = []
    seen: set[str] = set()
    skipped = 0
    for component in calendar.walk("VEVENT"):
        uid = str(component.get("UID", "")).strip()
        dtstart = component.get("DTSTART")
        dtend = component.get("DTEND")
        if not uid or uid in seen or dtstart is None or dtend is None:
            skipped += 1
            continue
        start = to_naive_utc(dtstart.dt)
        end = to_naive_utc(dtend.dt)
        if end <= start:
            skipped += 1
            continue
        seen.add(uid)
        events.append(FeedEvent(
            uid=uid,
            title=str(component.get("SUMMARY", "")).strip(),
            start=start,
            end=end,
            room=str(component.get("LOCATION", "")).strip(),
            description=str(component.get("DESCRIPTION", "")).strip(),
        ))
    return ParsedFeed(events=events, skipped=skipped)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_timeutil.py tests/test_ics_parser.py -v`
Expected: 11 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/timeutil.py backend/app/zeus backend/tests/test_timeutil.py backend/tests/test_ics_parser.py
git commit -m "feat(backend): parse Zeus ICS feed into UTC feed events"
```

---

### Task 5: Subject resolver + seed data

**Files:**
- Create: `backend/app/subjects/resolver.py`, `backend/app/seed.py`, `backend/tests/test_resolver.py`, `backend/tests/test_seed.py`

**Interfaces:**
- Consumes: `Subject`, `Semester` (Task 2).
- Produces: `PALETTE: list[str]`; `SubjectResolver(session, semester_id)` with `.resolve(base_name: str) -> Subject` (case-insensitive match on `display_name` or any alias; creates the subject if missing, flushes it); `seed(session) -> None` (idempotent; caller commits); CLI `uv run python -m app.seed`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_resolver.py`:
```python
from sqlalchemy import func, select

from app.models import Subject
from app.subjects.resolver import PALETTE, SubjectResolver


def test_matches_display_name_case_insensitively(session, semester):
    session.add(Subject(semester_id=semester.id, display_name="Data Privacy by Design", aliases=[]))
    session.flush()
    resolver = SubjectResolver(session, semester.id)
    assert resolver.resolve("Data Privacy By Design").display_name == "Data Privacy by Design"


def test_matches_alias(session, semester):
    session.add(Subject(semester_id=semester.id, display_name="French for Fall 26 T1",
                        aliases=["French for Spring F26 T1"]))
    session.flush()
    resolver = SubjectResolver(session, semester.id)
    assert resolver.resolve("French for Spring F26 T1").display_name == "French for Fall 26 T1"


def test_creates_missing_subject_once_with_palette_color(session, semester):
    resolver = SubjectResolver(session, semester.id)
    first = resolver.resolve("GenAI 101")
    second = resolver.resolve("genai 101")
    assert first.id == second.id
    assert first.color == PALETTE[0]
    assert session.scalar(select(func.count()).select_from(Subject)) == 1


def test_new_subjects_get_different_colors(session, semester):
    resolver = SubjectResolver(session, semester.id)
    assert resolver.resolve("A").color != resolver.resolve("B").color
```

`backend/tests/test_seed.py`:
```python
from sqlalchemy import select

from app.models import Semester, Subject
from app.seed import seed


def test_seed_is_idempotent_and_sets_s1_active(session):
    seed(session)
    seed(session)
    session.commit()
    semesters = session.scalars(select(Semester).order_by(Semester.code)).all()
    assert [s.code for s in semesters] == ["S1", "S2", "S3"]
    s1 = semesters[0]
    assert s1.is_active and s1.zeus_group_id == 802
    assert not semesters[1].is_active and semesters[1].zeus_group_id is None


def test_seed_creates_s1_aliases(session):
    seed(session)
    session.commit()
    french = session.scalar(select(Subject).where(Subject.display_name == "French for Fall 26 T1"))
    assert set(french.aliases) == {"French for Spring F26 T1", "Tutorat & French for Fall 26 T1"}
    ic = session.scalar(select(Subject).where(Subject.display_name == "Interpersonal Communication"))
    assert ic.aliases == ["Interpersonnal Communication"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_resolver.py tests/test_seed.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement**

`backend/app/subjects/resolver.py`:
```python
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Subject

PALETTE = [
    "#2E55E6", "#6A45D8", "#0E7F72", "#B25E00", "#2F7D32", "#C0306A",
    "#8A6D00", "#0F6E9E", "#9C3D9C", "#5E5A00", "#4F6B2A", "#3B4252",
]


class SubjectResolver:
    def __init__(self, session: Session, semester_id: int) -> None:
        self._session = session
        self._semester_id = semester_id
        self._subjects = list(session.scalars(
            select(Subject).where(Subject.semester_id == semester_id).order_by(Subject.id)
        ))

    def resolve(self, base_name: str) -> Subject:
        key = base_name.casefold()
        for subject in self._subjects:
            if subject.display_name.casefold() == key or any(a.casefold() == key for a in subject.aliases):
                return subject
        subject = Subject(
            semester_id=self._semester_id,
            display_name=base_name,
            color=PALETTE[len(self._subjects) % len(PALETTE)],
            aliases=[],
            hidden=False,
        )
        self._session.add(subject)
        self._session.flush()
        self._subjects.append(subject)
        return subject
```

`backend/app/seed.py`:
```python
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Semester, Subject
from app.subjects.resolver import PALETTE

SEMESTERS = [
    # code, name, zeus_group_id, start, end, active
    ("S1", "SE S1 (Fundamental)", 802, date(2026, 10, 12), date(2027, 1, 30), True),
    ("S2", "SE S2 (Common Core)", None, None, None, False),
    ("S3", "SE S3 (Specialization)", None, None, None, False),
]

S1_ALIASES = {
    "French for Fall 26 T1": ["French for Spring F26 T1", "Tutorat & French for Fall 26 T1"],
    "Interpersonal Communication": ["Interpersonnal Communication"],
}


def seed(session: Session) -> None:
    for code, name, group_id, start, end, active in SEMESTERS:
        if session.scalar(select(Semester).where(Semester.code == code)) is None:
            session.add(Semester(code=code, name=name, zeus_group_id=group_id,
                                 start_date=start, end_date=end, is_active=active))
    session.flush()
    s1 = session.scalar(select(Semester).where(Semester.code == "S1"))
    for index, (display_name, aliases) in enumerate(S1_ALIASES.items()):
        existing = session.scalar(select(Subject).where(
            Subject.semester_id == s1.id, Subject.display_name == display_name))
        if existing is None:
            session.add(Subject(semester_id=s1.id, display_name=display_name, aliases=aliases,
                                color=PALETTE[(index + 2) % len(PALETTE)], hidden=False))
    session.flush()


if __name__ == "__main__":
    from app.db import get_engine

    with Session(get_engine()) as db:
        seed(db)
        db.commit()
    print("Seed complete.")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_resolver.py tests/test_seed.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/subjects/resolver.py backend/app/seed.py backend/tests/test_resolver.py backend/tests/test_seed.py
git commit -m "feat(backend): resolve subjects with aliases and seed semesters"
```

---

### Task 6: Zeus ICS client + encrypted secret store

**Files:**
- Create: `backend/app/zeus/ics_client.py`, `backend/app/secret_store.py`, `backend/tests/test_ics_client.py`, `backend/tests/test_secret_store.py`

**Interfaces:**
- Consumes: `AppSecret` (Task 2), `Settings` (Task 2).
- Produces:
  - `ZeusFetchError(message, *, auth: bool = False)`; `extract_key(value: str) -> str` (raises `ValueError`); `build_ics_url(base_url: str, group_id: int, key: str) -> str`; `fetch_ics(url: str, client: httpx.Client | None = None) -> str`.
  - `SecretStore(session, encryption_key: str)` with `.set(name, value) -> None` and `.get(name) -> str | None`; constant `ZEUS_KEY_NAME = "zeus_ics_key"`; `get_zeus_key(session, settings) -> str | None` (DB value first, then `settings.zeus_ics_key`).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_ics_client.py`:
```python
import httpx
import pytest

from app.zeus.ics_client import ZeusFetchError, build_ics_url, extract_key, fetch_ics

KEY = "AbC123xyZ9"
URL = f"https://zeus.ionis-it.com/api/group/802/ics/{KEY}"


def client_returning(status: int, text: str = "") -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(status, text=text)))


def test_build_ics_url():
    assert build_ics_url("https://zeus.ionis-it.com/", 802, KEY) == URL


def test_fetch_returns_body_on_200():
    assert fetch_ics(URL, client_returning(200, "BEGIN:VCALENDAR")) == "BEGIN:VCALENDAR"


@pytest.mark.parametrize("status", [401, 403])
def test_fetch_flags_auth_errors(status):
    with pytest.raises(ZeusFetchError) as info:
        fetch_ics(URL, client_returning(status))
    assert info.value.auth is True


def test_fetch_raises_on_server_error():
    with pytest.raises(ZeusFetchError) as info:
        fetch_ics(URL, client_returning(500))
    assert info.value.auth is False
    assert "500" in str(info.value)


def test_network_error_message_does_not_contain_key():
    def boom(request):
        raise httpx.ConnectError(f"cannot connect to {request.url}")

    with pytest.raises(ZeusFetchError) as info:
        fetch_ics(URL, httpx.Client(transport=httpx.MockTransport(boom)))
    assert KEY not in str(info.value)
    assert info.value.__cause__ is None


@pytest.mark.parametrize(
    "value",
    [KEY, f"  {KEY}  ", URL, f"{URL}?startDate=2026-10-10", f"{URL}/"],
)
def test_extract_key(value):
    assert extract_key(value) == KEY


@pytest.mark.parametrize("value", ["", "hello world", "https://zeus.ionis-it.com/", "a/b"])
def test_extract_key_rejects_garbage(value):
    with pytest.raises(ValueError):
        extract_key(value)
```

`backend/tests/test_secret_store.py`:
```python
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.config import Settings
from app.models import AppSecret
from app.secret_store import ZEUS_KEY_NAME, SecretStore, get_zeus_key

KEY = Fernet.generate_key().decode()


def test_round_trip_and_ciphertext_differs(session):
    store = SecretStore(session, KEY)
    store.set("x", "secret-value")
    store.set("x", "secret-value-2")
    session.commit()
    row = session.scalar(select(AppSecret))
    assert "secret-value" not in row.value_encrypted
    assert store.get("x") == "secret-value-2"


def test_wrong_key_returns_none(session):
    SecretStore(session, KEY).set("x", "v")
    session.commit()
    assert SecretStore(session, Fernet.generate_key().decode()).get("x") is None


def test_get_zeus_key_prefers_db_then_env(session):
    settings = Settings(token_encryption_key=KEY, zeus_ics_key="fromenv")
    assert get_zeus_key(session, settings) == "fromenv"
    SecretStore(session, KEY).set(ZEUS_KEY_NAME, "fromdb")
    assert get_zeus_key(session, settings) == "fromdb"


def test_get_zeus_key_none_when_unset(session):
    assert get_zeus_key(session, Settings(token_encryption_key=KEY, zeus_ics_key="")) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_ics_client.py tests/test_secret_store.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement**

`backend/app/zeus/ics_client.py`:
```python
import re

import httpx

KEY_RE = re.compile(r"[A-Za-z0-9_-]{4,128}")
LINK_RE = re.compile(r"/ics/([^/?#\s]+)")


class ZeusFetchError(Exception):
    def __init__(self, message: str, *, auth: bool = False) -> None:
        super().__init__(message)
        self.auth = auth


def extract_key(value: str) -> str:
    value = value.strip()
    match = LINK_RE.search(value)
    key = match.group(1) if match else value
    if not KEY_RE.fullmatch(key):
        raise ValueError("not a valid Zeus ICS link or key")
    return key


def build_ics_url(base_url: str, group_id: int, key: str) -> str:
    return f"{base_url.rstrip('/')}/api/group/{group_id}/ics/{key}"


def fetch_ics(url: str, client: httpx.Client | None = None) -> str:
    owns_client = client is None
    http = client or httpx.Client(timeout=8.0)
    try:
        response = http.get(url, headers={"Accept": "text/calendar"})
    except httpx.HTTPError as exc:
        # Never include the exception text: it contains the URL, which contains the key.
        raise ZeusFetchError(f"network error ({type(exc).__name__})") from None
    finally:
        if owns_client:
            http.close()
    if response.status_code in (401, 403):
        raise ZeusFetchError("Zeus rejected the ICS link", auth=True)
    if response.status_code != 200:
        raise ZeusFetchError(f"Zeus returned HTTP {response.status_code}")
    return response.text
```

`backend/app/secret_store.py`:
```python
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AppSecret

ZEUS_KEY_NAME = "zeus_ics_key"


class SecretStore:
    def __init__(self, session: Session, encryption_key: str) -> None:
        if not encryption_key:
            raise ValueError("TOKEN_ENCRYPTION_KEY is not set")
        self._session = session
        self._fernet = Fernet(encryption_key.encode())

    def set(self, name: str, value: str) -> None:
        token = self._fernet.encrypt(value.encode()).decode()
        row = self._session.get(AppSecret, name)
        if row is None:
            self._session.add(AppSecret(name=name, value_encrypted=token))
        else:
            row.value_encrypted = token
        self._session.flush()

    def get(self, name: str) -> str | None:
        row = self._session.get(AppSecret, name)
        if row is None:
            return None
        try:
            return self._fernet.decrypt(row.value_encrypted.encode()).decode()
        except InvalidToken:
            return None


def get_zeus_key(session: Session, settings: Settings) -> str | None:
    if settings.token_encryption_key:
        stored = SecretStore(session, settings.token_encryption_key).get(ZEUS_KEY_NAME)
        if stored:
            return stored
    return settings.zeus_ics_key or None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_ics_client.py tests/test_secret_store.py -v`
Expected: 19 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/zeus/ics_client.py backend/app/secret_store.py backend/tests/test_ics_client.py backend/tests/test_secret_store.py
git commit -m "feat(backend): fetch Zeus ICS safely and store secrets encrypted"
```

---

### Task 7: Sync engine (diff by UID)

**Files:**
- Create: `backend/app/zeus/sync.py`, `backend/tests/test_sync.py`

**Interfaces:**
- Consumes: `parse_title` (Task 3), `FeedEvent`, `ParsedFeed`, `InvalidFeedError`, `parse_ics` (Task 4), `SubjectResolver` (Task 5), `ZeusFetchError` (Task 6), models (Task 2).
- Produces:
  - `SyncResult(fetched, inserted, updated, cancelled, skipped)` (dataclass, ints, default 0).
  - `apply_feed(session, semester: Semester, feed: ParsedFeed, now: datetime) -> SyncResult` — raises `InvalidFeedError` **before any write** if the feed has no events.
  - `Fetcher = Callable[[Semester], str]`.
  - `run_sync(session, fetch: Fetcher, now: datetime) -> SyncRun` — always commits and returns the `SyncRun`; `status` ∈ `"ok" | "failed" | "auth_failed"`.

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_sync.py`

```python
from dataclasses import replace
from datetime import datetime

import pytest
from sqlalchemy import select

from app.models import Event, Subject, SyncRun
from app.zeus.ics_client import ZeusFetchError
from app.zeus.ics_parser import FeedEvent, InvalidFeedError, ParsedFeed
from app.zeus.sync import apply_feed, run_sync

NOW = datetime(2026, 10, 15, 12, 0)
LATER = datetime(2026, 10, 16, 12, 0)

FRENCH = FeedEvent("u-fr", "GR5 - French for Fall 26 T1", datetime(2026, 10, 20, 12, 30),
                   datetime(2026, 10, 20, 14, 30), "KB605", "")
RELDB = FeedEvent("u-db", "Relational Databases", datetime(2026, 10, 19, 11, 0),
                  datetime(2026, 10, 19, 13, 0), "KB602", "")
PAST = FeedEvent("u-past", "Harmonization", datetime(2026, 10, 13, 7, 0),
                 datetime(2026, 10, 13, 10, 0), "SM Cisco - KB105", "")


def feed(*events: FeedEvent, skipped: int = 0) -> ParsedFeed:
    return ParsedFeed(events=list(events), skipped=skipped)


def event_by_uid(session, uid: str) -> Event:
    return session.scalar(select(Event).where(Event.zeus_uid == uid))


def test_inserts_new_events_with_subject_section_and_kind(session, semester):
    result = apply_feed(session, semester, feed(FRENCH, RELDB, skipped=1), NOW)
    assert (result.fetched, result.inserted, result.skipped) == (2, 2, 1)
    french = event_by_uid(session, "u-fr")
    assert french.section == "GR5"
    assert french.kind == "class"
    assert session.get(Subject, french.subject_id).display_name == "French for Fall 26 T1"


def test_same_feed_twice_changes_nothing(session, semester):
    apply_feed(session, semester, feed(FRENCH, RELDB), NOW)
    result = apply_feed(session, semester, feed(FRENCH, RELDB), LATER)
    assert (result.inserted, result.updated, result.cancelled) == (0, 0, 0)
    assert event_by_uid(session, "u-fr").status == "normal"


def test_time_change_marks_future_event_changed(session, semester):
    apply_feed(session, semester, feed(FRENCH), NOW)
    moved = replace(FRENCH, start=datetime(2026, 10, 20, 13, 0), end=datetime(2026, 10, 20, 15, 0))
    result = apply_feed(session, semester, feed(moved), LATER)
    event = event_by_uid(session, "u-fr")
    assert result.updated == 1
    assert (event.status, event.changed_at, event.start_at) == ("changed", LATER, datetime(2026, 10, 20, 13, 0))


def test_room_change_marks_changed(session, semester):
    apply_feed(session, semester, feed(FRENCH), NOW)
    apply_feed(session, semester, feed(replace(FRENCH, room="KB204-B FLE")), LATER)
    event = event_by_uid(session, "u-fr")
    assert (event.status, event.room) == ("changed", "KB204-B FLE")


def test_past_events_are_never_modified(session, semester):
    apply_feed(session, semester, feed(PAST, FRENCH), NOW)
    result = apply_feed(session, semester, feed(replace(PAST, room="Elsewhere"), FRENCH), LATER)
    event = event_by_uid(session, "u-past")
    assert result.updated == 0
    assert (event.room, event.status) == ("SM Cisco - KB105", "normal")


def test_missing_future_event_cancelled_but_missing_past_kept(session, semester):
    apply_feed(session, semester, feed(PAST, FRENCH, RELDB), NOW)
    result = apply_feed(session, semester, feed(RELDB), LATER)
    assert result.cancelled == 1
    assert event_by_uid(session, "u-fr").status == "cancelled"
    assert event_by_uid(session, "u-past").status == "normal"


def test_cancelled_event_that_reappears_is_marked_changed(session, semester):
    apply_feed(session, semester, feed(FRENCH, RELDB), NOW)
    apply_feed(session, semester, feed(RELDB), NOW)
    apply_feed(session, semester, feed(FRENCH, RELDB), LATER)
    assert event_by_uid(session, "u-fr").status == "changed"


def test_holiday_and_exam_kinds(session, semester):
    holiday = FeedEvent("u-hol", "Vacances", datetime(2026, 12, 21, 7, 0), datetime(2026, 12, 21, 19, 0), "", "")
    exam = FeedEvent("u-ex", "Relational Databases Exam", datetime(2027, 1, 26, 8, 0),
                     datetime(2027, 1, 26, 10, 0), "KB003 (amphi 3)", "")
    apply_feed(session, semester, feed(holiday, exam, RELDB), NOW)
    hol, ex, db = (event_by_uid(session, u) for u in ("u-hol", "u-ex", "u-db"))
    assert (hol.kind, hol.subject_id) == ("holiday", None)
    assert ex.kind == "exam"
    assert ex.subject_id == db.subject_id


def test_empty_feed_changes_nothing(session, semester):
    apply_feed(session, semester, feed(FRENCH, RELDB), NOW)
    session.commit()
    with pytest.raises(InvalidFeedError):
        apply_feed(session, semester, feed(), LATER)
    assert event_by_uid(session, "u-fr").status == "normal"

    run = run_sync(session, lambda sem: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", LATER)
    assert run.status == "failed"
    assert event_by_uid(session, "u-db").status == "normal"


def test_run_sync_success_records_counts(session, semester):
    text = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN",
        "BEGIN:VEVENT", "UID:u1", "SUMMARY:Relational Databases",
        "DTSTART:20261019T110000Z", "DTEND:20261019T130000Z", "LOCATION:KB602", "END:VEVENT",
        "END:VCALENDAR", "",
    ])
    run = run_sync(session, lambda sem: text, NOW)
    assert (run.status, run.fetched, run.inserted, run.error) == ("ok", 1, 1, None)
    assert run.finished_at == NOW
    assert session.scalar(select(SyncRun)).id == run.id


def test_run_sync_auth_failure(session, semester):
    def fetch(sem):
        raise ZeusFetchError("Zeus rejected the ICS link", auth=True)

    run = run_sync(session, fetch, NOW)
    assert (run.status, run.error) == ("auth_failed", "Zeus rejected the ICS link")


def test_run_sync_without_active_semester(session):
    run = run_sync(session, lambda sem: "", NOW)
    assert run.status == "failed"
    assert run.error == "no active semester"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_sync.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.zeus.sync'`

- [ ] **Step 3: Implement** — `backend/app/zeus/sync.py`

```python
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, Semester, SyncRun
from app.subjects.parser import parse_title
from app.subjects.resolver import SubjectResolver
from app.zeus.ics_client import ZeusFetchError
from app.zeus.ics_parser import InvalidFeedError, ParsedFeed, parse_ics

Fetcher = Callable[[Semester], str]


@dataclass
class SyncResult:
    fetched: int = 0
    inserted: int = 0
    updated: int = 0
    cancelled: int = 0
    skipped: int = 0


def apply_feed(session: Session, semester: Semester, feed: ParsedFeed, now: datetime) -> SyncResult:
    if not feed.events:
        # An empty feed almost always means Zeus had a problem; never mass-cancel on it.
        raise InvalidFeedError("feed contains no events")

    resolver = SubjectResolver(session, semester.id)
    existing = {
        e.zeus_uid: e
        for e in session.scalars(
            select(Event).where(Event.semester_id == semester.id, Event.source == "zeus")
        )
    }
    result = SyncResult(fetched=len(feed.events), skipped=feed.skipped)

    for item in feed.events:
        parsed = parse_title(item.title)
        subject_id = resolver.resolve(parsed.base_name).id if parsed.base_name else None
        event = existing.pop(item.uid, None)
        if event is None:
            session.add(Event(
                source="zeus", zeus_uid=item.uid, semester_id=semester.id, subject_id=subject_id,
                section=parsed.section, title_raw=item.title, start_at=item.start, end_at=item.end,
                room=item.room, description=item.description, kind=parsed.kind, status="normal",
            ))
            result.inserted += 1
            continue
        if event.start_at < now:
            continue
        differs = (event.start_at, event.end_at, event.room, event.title_raw) != (
            item.start, item.end, item.room, item.title)
        if differs or event.status == "cancelled":
            event.start_at, event.end_at = item.start, item.end
            event.room, event.title_raw, event.description = item.room, item.title, item.description
            event.subject_id, event.section, event.kind = subject_id, parsed.section, parsed.kind
            event.status, event.changed_at = "changed", now
            result.updated += 1
        elif event.description != item.description:
            event.description = item.description

    for event in existing.values():
        if event.start_at >= now and event.status != "cancelled":
            event.status, event.changed_at = "cancelled", now
            result.cancelled += 1

    session.flush()
    return result


def run_sync(session: Session, fetch: Fetcher, now: datetime) -> SyncRun:
    run = SyncRun(started_at=now, status="running", fetched=0, inserted=0, updated=0,
                  cancelled=0, skipped=0)
    session.add(run)
    try:
        semester = session.scalar(select(Semester).where(Semester.is_active.is_(True)))
        if semester is None:
            raise ZeusFetchError("no active semester")
        result = apply_feed(session, semester, parse_ics(fetch(semester)), now)
    except ZeusFetchError as exc:
        run.status = "auth_failed" if exc.auth else "failed"
        run.error = str(exc)
    except InvalidFeedError as exc:
        run.status = "failed"
        run.error = f"invalid feed: {exc}"
    else:
        run.status = "ok"
        run.fetched, run.inserted, run.updated = result.fetched, result.inserted, result.updated
        run.cancelled, run.skipped = result.cancelled, result.skipped
    run.finished_at = now
    session.commit()
    return run
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_sync.py -v`
Expected: 12 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/zeus/sync.py backend/tests/test_sync.py
git commit -m "feat(backend): diff Zeus feed into events by UID with safe cancellation"
```

---

### Task 8: Authentication (Supabase JWT + email allowlist)

**Files:**
- Create: `backend/app/auth.py`, `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: `Settings`, `get_settings` (Task 2).
- Produces: `CurrentUser(email: str)`; `AuthError(message, *, forbidden=False)`; `TokenVerifier(jwks_client, allowed_emails: set[str], audience="authenticated")` with `.verify(token) -> CurrentUser`; FastAPI deps `get_verifier(settings) -> TokenVerifier`, `require_user(authorization, verifier) -> CurrentUser` (401 bad/missing token, 403 email not allowed), `require_cron_or_user(x_cron_secret, authorization, settings, verifier) -> str` (returns `"cron"` or the email).

- [ ] **Step 1: Write the failing test** — `backend/tests/test_auth.py`

```python
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth import AuthError, CurrentUser, TokenVerifier

PRIVATE = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_PRIVATE = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class FakeJWKS:
    def __init__(self, key):
        self.key = key

    def get_signing_key_from_jwt(self, token):
        return self


def token(email="me@example.com", aud="authenticated", key=PRIVATE, expires_in=3600):
    claims = {"sub": "user-1", "email": email, "aud": aud, "exp": int(time.time()) + expires_in}
    return jwt.encode(claims, key, algorithm="RS256")


@pytest.fixture
def verifier():
    return TokenVerifier(FakeJWKS(PRIVATE.public_key()), {"me@example.com"})


def test_valid_token_for_allowed_email(verifier):
    assert verifier.verify(token(email="Me@Example.com")) == CurrentUser(email="me@example.com")


def test_other_email_is_forbidden(verifier):
    with pytest.raises(AuthError) as info:
        verifier.verify(token(email="stranger@example.com"))
    assert info.value.forbidden is True


@pytest.mark.parametrize(
    "bad",
    [
        lambda: token(expires_in=-10),
        lambda: token(aud="anon"),
        lambda: token(key=OTHER_PRIVATE),
        lambda: "not-a-jwt",
    ],
)
def test_invalid_tokens_are_rejected(verifier, bad):
    with pytest.raises(AuthError) as info:
        verifier.verify(bad())
    assert info.value.forbidden is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_auth.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.auth'`

- [ ] **Step 3: Implement** — `backend/app/auth.py`

```python
import hmac
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import jwt
from fastapi import Depends, Header, HTTPException

from app.config import Settings, get_settings


@dataclass(frozen=True)
class CurrentUser:
    email: str


class AuthError(Exception):
    def __init__(self, message: str, *, forbidden: bool = False) -> None:
        super().__init__(message)
        self.forbidden = forbidden


class TokenVerifier:
    def __init__(self, jwks_client: Any, allowed_emails: set[str], audience: str = "authenticated") -> None:
        self._jwks = jwks_client
        self._allowed = {e.lower() for e in allowed_emails}
        self._audience = audience

    def verify(self, token: str) -> CurrentUser:
        try:
            signing_key = self._jwks.get_signing_key_from_jwt(token)
            claims = jwt.decode(token, signing_key.key, algorithms=["RS256", "ES256"],
                                audience=self._audience)
        except jwt.PyJWTError:
            raise AuthError("invalid token") from None
        email = str(claims.get("email", "")).lower()
        if not email or email not in self._allowed:
            raise AuthError("this account is not allowed", forbidden=True)
        return CurrentUser(email=email)


@lru_cache
def _verifier_for(supabase_url: str, allowed: frozenset[str]) -> TokenVerifier:
    jwks = jwt.PyJWKClient(f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json")
    return TokenVerifier(jwks, set(allowed))


def get_verifier(settings: Settings = Depends(get_settings)) -> TokenVerifier:
    return _verifier_for(settings.supabase_url, frozenset(settings.allowed_email_set))


def require_user(
    authorization: str | None = Header(default=None),
    verifier: TokenVerifier = Depends(get_verifier),
) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    try:
        return verifier.verify(authorization[7:].strip())
    except AuthError as exc:
        raise HTTPException(status_code=403 if exc.forbidden else 401, detail=str(exc)) from None


def require_cron_or_user(
    x_cron_secret: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
    verifier: TokenVerifier = Depends(get_verifier),
) -> str:
    if x_cron_secret and settings.cron_secret and hmac.compare_digest(x_cron_secret, settings.cron_secret):
        return "cron"
    return require_user(authorization, verifier).email
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_auth.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth.py backend/tests/test_auth.py
git commit -m "feat(backend): verify Supabase JWTs against an email allowlist"
```

---

### Task 9: API — events, settings, sync

**Files:**
- Create: `backend/app/deps.py`, `backend/app/schemas.py`, `backend/app/services/__init__.py` (empty), `backend/app/services/events_query.py`, `backend/app/routers/events.py`, `backend/app/routers/settings.py`, `backend/app/routers/sync.py`, `backend/tests/test_api_events.py`, `backend/tests/test_api_settings.py`, `backend/tests/test_api_sync.py`
- Modify: `backend/app/main.py`, `backend/tests/conftest.py`

**Interfaces:**
- Consumes: everything from Tasks 2–8.
- Produces (HTTP, all JSON; timestamps ISO with `Z`):
  - `GET /api/events?start=<iso>&end=<iso>` → `{"events": EventOut[], "missing_sections": string[]}`; `EventOut = {id, title, subject_id, subject_name, color, section, start, end, room, kind, status, source}`; 400 if range ≤ 0 or > 42 days.
  - `GET /api/semesters` → `SemesterOut[]` `{id, code, name, zeus_group_id, start_date, end_date, is_active}`.
  - `GET /api/settings/sections` → `{subject_id, subject_name, sections: string[], chosen: string | null}[]` (sections naturally sorted).
  - `PUT /api/settings/sections` body `{subject_id, section}` → one choice; 422 if unknown.
  - `GET /api/settings/zeus-key` → `{"configured": bool}`; `PUT /api/settings/zeus-key` body `{"value": str}` → `{"configured": true}`; 422 if not a link/key.
  - `POST /api/sync` (cron secret header **or** user) → `SyncRunOut {status, started_at, finished_at, fetched, inserted, updated, cancelled, skipped, error}`.
  - `GET /api/sync/status` → `{"last_run": SyncRunOut | null, "last_success_at": string | null}`.
  - Python: `app.deps.get_now() -> datetime`, `app.deps.get_fetcher(...) -> Fetcher`; `app.services.events_query.list_visible_events(session, semester_id, start, end) -> tuple[list[VisibleEvent], list[str]]`, `section_choices(session, semester_id) -> list[SectionChoice]`, `active_semester(session) -> Semester | None`.

- [ ] **Step 1: Extend test fixtures** — append to `backend/tests/conftest.py`

```python
from datetime import datetime

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.auth import AuthError, CurrentUser, get_verifier
from app.config import Settings, get_settings
from app.db import get_session
from app.deps import get_now
from app.main import create_app

NOW = datetime(2026, 10, 15, 12, 0)
AUTH = {"Authorization": "Bearer good"}


class FakeVerifier:
    def verify(self, token: str) -> CurrentUser:
        if token == "good":
            return CurrentUser(email="me@example.com")
        if token == "other":
            raise AuthError("this account is not allowed", forbidden=True)
        raise AuthError("invalid token")


@pytest.fixture
def settings() -> Settings:
    return Settings(database_url="sqlite://", allowed_emails="me@example.com",
                    supabase_url="https://example.supabase.co", cron_secret="cron-secret",
                    token_encryption_key=Fernet.generate_key().decode(), zeus_ics_key="")


@pytest.fixture
def client(engine, settings):
    app = create_app()

    def session_override():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = session_override
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_verifier] = lambda: FakeVerifier()
    app.dependency_overrides[get_now] = lambda: NOW
    return TestClient(app)
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_api_events.py`:
```python
from datetime import datetime

from app.models import Event, MySection, Subject
from tests.conftest import AUTH

WEEK = "start=2026-10-18T22:00:00Z&end=2026-10-25T23:00:00Z"


def add_event(session, semester, subject, uid, section, start, end, status="normal", kind="class"):
    session.add(Event(source="zeus", zeus_uid=uid, semester_id=semester.id,
                      subject_id=subject.id if subject else None, section=section,
                      title_raw=uid, start_at=start, end_at=end, room="KB605", kind=kind, status=status))


def seed_french(session, semester, choose=None):
    french = Subject(semester_id=semester.id, display_name="French for Fall 26 T1", aliases=[], color="#0E7F72")
    session.add(french)
    session.flush()
    t0, t1 = datetime(2026, 10, 20, 12, 30), datetime(2026, 10, 20, 14, 30)
    add_event(session, semester, french, "gr5", "GR5", t0, t1)
    add_event(session, semester, french, "gr1", "GR1", t0, t1)
    add_event(session, semester, french, "combined", None, datetime(2026, 10, 22, 12, 30), datetime(2026, 10, 22, 15, 30))
    if choose:
        session.add(MySection(subject_id=french.id, section=choose))
    session.commit()
    return french


def test_requires_login(client):
    assert client.get(f"/api/events?{WEEK}").status_code == 401
    assert client.get(f"/api/events?{WEEK}", headers={"Authorization": "Bearer other"}).status_code == 403


def test_returns_only_my_section_and_unsectioned(client, session, semester):
    seed_french(session, semester, choose="GR5")
    body = client.get(f"/api/events?{WEEK}", headers=AUTH).json()
    sections = sorted(str(e["section"]) for e in body["events"])
    assert sections == ["GR5", "None"]
    assert body["missing_sections"] == []
    first = body["events"][0]
    assert first["title"] == "French for Fall 26 T1"
    assert first["start"] == "2026-10-20T12:30:00Z"
    assert first["color"] == "#0E7F72"


def test_unchosen_section_hidden_and_reported(client, session, semester):
    seed_french(session, semester)
    body = client.get(f"/api/events?{WEEK}", headers=AUTH).json()
    assert [e["section"] for e in body["events"]] == [None]
    assert body["missing_sections"] == ["French for Fall 26 T1"]


def test_hidden_subject_excluded_and_cancelled_included(client, session, semester):
    hidden = Subject(semester_id=semester.id, display_name="Hidden", aliases=[], hidden=True)
    shown = Subject(semester_id=semester.id, display_name="Shown", aliases=[])
    session.add_all([hidden, shown])
    session.flush()
    add_event(session, semester, hidden, "h", None, datetime(2026, 10, 19, 8), datetime(2026, 10, 19, 9))
    add_event(session, semester, shown, "s", None, datetime(2026, 10, 19, 8), datetime(2026, 10, 19, 9), status="cancelled")
    session.commit()
    events = client.get(f"/api/events?{WEEK}", headers=AUTH).json()["events"]
    assert [(e["title"], e["status"]) for e in events] == [("Shown", "cancelled")]


def test_holiday_uses_raw_title(client, session, semester):
    add_event(session, semester, None, "Vacances", None, datetime(2026, 10, 19, 7), datetime(2026, 10, 19, 19), kind="holiday")
    session.commit()
    [event] = client.get(f"/api/events?{WEEK}", headers=AUTH).json()["events"]
    assert (event["title"], event["kind"], event["subject_id"]) == ("Vacances", "holiday", None)


def test_rejects_bad_ranges(client, semester):
    assert client.get("/api/events?start=2026-10-20T00:00:00Z&end=2026-10-19T00:00:00Z", headers=AUTH).status_code == 400
    assert client.get("/api/events?start=2026-10-01T00:00:00Z&end=2026-12-01T00:00:00Z", headers=AUTH).status_code == 400
```

`backend/tests/test_api_settings.py`:
```python
from datetime import datetime

from sqlalchemy import select

from app.models import Event, MySection, Subject
from app.secret_store import ZEUS_KEY_NAME, SecretStore
from tests.conftest import AUTH


def seed_sections(session, semester, sections):
    french = Subject(semester_id=semester.id, display_name="French for Fall 26 T1", aliases=[])
    session.add(french)
    session.flush()
    for i, section in enumerate(sections):
        session.add(Event(source="zeus", zeus_uid=f"u{i}", semester_id=semester.id, subject_id=french.id,
                          section=section, title_raw="x", start_at=datetime(2026, 10, 20, 12),
                          end_at=datetime(2026, 10, 20, 14), kind="class"))
    session.commit()
    return french


def test_semesters_list(client, semester):
    [s1] = client.get("/api/semesters", headers=AUTH).json()
    assert (s1["code"], s1["is_active"], s1["zeus_group_id"]) == ("S1", True, 802)


def test_sections_are_naturally_sorted(client, session, semester):
    seed_sections(session, semester, ["GR10", "GR2", "GR1", "GR2"])
    [choice] = client.get("/api/settings/sections", headers=AUTH).json()
    assert choice["sections"] == ["GR1", "GR2", "GR10"]
    assert choice["chosen"] is None


def test_choose_section_then_change_it(client, session, semester):
    french = seed_sections(session, semester, ["GR1", "GR5"])
    resp = client.put("/api/settings/sections", json={"subject_id": french.id, "section": "GR5"}, headers=AUTH)
    assert resp.status_code == 200 and resp.json()["chosen"] == "GR5"
    client.put("/api/settings/sections", json={"subject_id": french.id, "section": "GR1"}, headers=AUTH)
    assert session.scalar(select(MySection.section)) == "GR1"


def test_choose_unknown_section_is_422(client, session, semester):
    french = seed_sections(session, semester, ["GR1"])
    resp = client.put("/api/settings/sections", json={"subject_id": french.id, "section": "GR9"}, headers=AUTH)
    assert resp.status_code == 422


def test_put_zeus_key_accepts_full_link_and_never_returns_it(client, session, settings, semester):
    assert client.get("/api/settings/zeus-key", headers=AUTH).json() == {"configured": False}
    link = "https://zeus.ionis-it.com/api/group/802/ics/AbC123xyZ9?startDate=2026-10-10"
    resp = client.put("/api/settings/zeus-key", json={"value": link}, headers=AUTH)
    assert resp.json() == {"configured": True}
    assert client.get("/api/settings/zeus-key", headers=AUTH).json() == {"configured": True}
    assert SecretStore(session, settings.token_encryption_key).get(ZEUS_KEY_NAME) == "AbC123xyZ9"


def test_put_zeus_key_rejects_garbage(client, semester):
    resp = client.put("/api/settings/zeus-key", json={"value": "hello world"}, headers=AUTH)
    assert resp.status_code == 422
```

`backend/tests/test_api_sync.py`:
```python
from app.deps import get_fetcher
from app.models import MySection, Subject
from app.zeus.ics_client import ZeusFetchError
from tests.conftest import AUTH

ICS = "\r\n".join([
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN",
    "BEGIN:VEVENT", "UID:a", "SUMMARY:GR5 - French for Fall 26 T1",
    "DTSTART:20261020T123000Z", "DTEND:20261020T143000Z", "LOCATION:KB605", "END:VEVENT",
    "BEGIN:VEVENT", "UID:b", "SUMMARY:GR1 - French for Fall 26 T1",
    "DTSTART:20261020T123000Z", "DTEND:20261020T143000Z", "LOCATION:KB601", "END:VEVENT",
    "END:VCALENDAR", "",
])


def use_feed(client, text=ICS, error=None):
    def fetch(semester):
        if error:
            raise error
        return text

    client.app.dependency_overrides[get_fetcher] = lambda: fetch


def test_cron_secret_triggers_sync(client, semester):
    use_feed(client)
    resp = client.post("/api/sync", headers={"X-Cron-Secret": "cron-secret"})
    assert resp.status_code == 200
    assert (resp.json()["status"], resp.json()["inserted"]) == ("ok", 2)


def test_wrong_secret_without_login_is_401(client, semester):
    use_feed(client)
    assert client.post("/api/sync", headers={"X-Cron-Secret": "nope"}).status_code == 401


def test_logged_in_user_can_sync(client, semester):
    use_feed(client)
    assert client.post("/api/sync", headers=AUTH).json()["status"] == "ok"


def test_auth_failure_is_reported_in_body(client, semester):
    use_feed(client, error=ZeusFetchError("Zeus rejected the ICS link", auth=True))
    body = client.post("/api/sync", headers=AUTH).json()
    assert (body["status"], body["error"]) == ("auth_failed", "Zeus rejected the ICS link")


def test_status_reports_last_run_and_last_success(client, semester):
    assert client.get("/api/sync/status", headers=AUTH).json() == {"last_run": None, "last_success_at": None}
    use_feed(client)
    client.post("/api/sync", headers=AUTH)
    use_feed(client, error=ZeusFetchError("Zeus returned HTTP 500"))
    client.post("/api/sync", headers=AUTH)
    body = client.get("/api/sync/status", headers=AUTH).json()
    assert body["last_run"]["status"] == "failed"
    assert body["last_success_at"] == "2026-10-15T12:00:00Z"


def test_sync_then_pick_section_then_see_week(client, session, semester):
    use_feed(client)
    client.post("/api/sync", headers=AUTH)
    french = session.query(Subject).filter_by(display_name="French for Fall 26 T1").one()
    client.put("/api/settings/sections", json={"subject_id": french.id, "section": "GR5"}, headers=AUTH)
    events = client.get("/api/events?start=2026-10-18T22:00:00Z&end=2026-10-25T23:00:00Z", headers=AUTH).json()["events"]
    assert [(e["section"], e["room"]) for e in events] == [("GR5", "KB605")]
    assert session.query(MySection).count() == 1
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_api_events.py tests/test_api_settings.py tests/test_api_sync.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.deps'`

- [ ] **Step 4: Implement deps, schemas, query service**

`backend/app/deps.py`:
```python
from datetime import datetime, timezone

from fastapi import Depends
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_session
from app.models import Semester
from app.secret_store import get_zeus_key
from app.zeus.ics_client import ZeusFetchError, build_ics_url, fetch_ics
from app.zeus.sync import Fetcher


def get_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_fetcher(
    session: Session = Depends(get_session), settings: Settings = Depends(get_settings)
) -> Fetcher:
    def fetch(semester: Semester) -> str:
        key = get_zeus_key(session, settings)
        if not key:
            raise ZeusFetchError("no Zeus ICS link configured")
        if semester.zeus_group_id is None:
            raise ZeusFetchError("active semester has no Zeus group id")
        return fetch_ics(build_ics_url(settings.zeus_base_url, semester.zeus_group_id, key))

    return fetch
```

`backend/app/schemas.py`:
```python
from datetime import date

from pydantic import BaseModel


class EventOut(BaseModel):
    id: int
    title: str
    subject_id: int | None
    subject_name: str | None
    color: str | None
    section: str | None
    start: str
    end: str
    room: str
    kind: str
    status: str
    source: str


class EventsResponse(BaseModel):
    events: list[EventOut]
    missing_sections: list[str]


class SemesterOut(BaseModel):
    id: int
    code: str
    name: str
    zeus_group_id: int | None
    start_date: date | None
    end_date: date | None
    is_active: bool


class SectionChoiceOut(BaseModel):
    subject_id: int
    subject_name: str
    sections: list[str]
    chosen: str | None


class SectionUpdate(BaseModel):
    subject_id: int
    section: str


class ZeusKeyUpdate(BaseModel):
    value: str


class ZeusKeyStatus(BaseModel):
    configured: bool


class SyncRunOut(BaseModel):
    status: str
    started_at: str
    finished_at: str | None
    fetched: int
    inserted: int
    updated: int
    cancelled: int
    skipped: int
    error: str | None


class SyncStatusOut(BaseModel):
    last_run: SyncRunOut | None
    last_success_at: str | None
```

`backend/app/services/events_query.py`:
```python
import re
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, MySection, Semester, Subject


@dataclass(frozen=True)
class VisibleEvent:
    id: int
    title: str
    subject_id: int | None
    subject_name: str | None
    color: str | None
    section: str | None
    start_at: datetime
    end_at: datetime
    room: str
    kind: str
    status: str
    source: str


@dataclass(frozen=True)
class SectionChoice:
    subject_id: int
    subject_name: str
    sections: list[str]
    chosen: str | None


def natural_key(value: str) -> list[int | str]:
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", value)]


def active_semester(session: Session) -> Semester | None:
    return session.scalar(select(Semester).where(Semester.is_active.is_(True)))


def _subjects(session: Session, semester_id: int) -> dict[int, Subject]:
    return {s.id: s for s in session.scalars(select(Subject).where(Subject.semester_id == semester_id))}


def _chosen(session: Session, subject_ids: list[int]) -> dict[int, str]:
    rows = session.scalars(select(MySection).where(MySection.subject_id.in_(subject_ids)))
    return {row.subject_id: row.section for row in rows}


def list_visible_events(
    session: Session, semester_id: int, start: datetime, end: datetime
) -> tuple[list[VisibleEvent], list[str]]:
    subjects = _subjects(session, semester_id)
    chosen = _chosen(session, list(subjects))
    rows = session.scalars(
        select(Event)
        .where(Event.semester_id == semester_id, Event.start_at < end, Event.end_at > start)
        .order_by(Event.start_at, Event.id)
    )
    visible: list[VisibleEvent] = []
    missing: set[str] = set()
    for event in rows:
        subject = subjects.get(event.subject_id) if event.subject_id is not None else None
        if subject is not None and subject.hidden:
            continue
        if event.section is not None:
            pick = chosen.get(event.subject_id) if event.subject_id is not None else None
            if pick is None:
                missing.add(subject.display_name if subject else event.title_raw)
                continue
            if pick != event.section:
                continue
        visible.append(VisibleEvent(
            id=event.id,
            title=subject.display_name if subject else event.title_raw,
            subject_id=event.subject_id,
            subject_name=subject.display_name if subject else None,
            color=subject.color if subject else None,
            section=event.section,
            start_at=event.start_at,
            end_at=event.end_at,
            room=event.room,
            kind=event.kind,
            status=event.status,
            source=event.source,
        ))
    return visible, sorted(missing)


def section_choices(session: Session, semester_id: int) -> list[SectionChoice]:
    subjects = _subjects(session, semester_id)
    chosen = _chosen(session, list(subjects))
    pairs = session.execute(
        select(Event.subject_id, Event.section)
        .where(Event.semester_id == semester_id, Event.section.is_not(None), Event.subject_id.is_not(None))
        .distinct()
    ).all()
    by_subject: dict[int, set[str]] = {}
    for subject_id, section in pairs:
        by_subject.setdefault(subject_id, set()).add(section)
    return sorted(
        (
            SectionChoice(subject_id=sid, subject_name=subjects[sid].display_name,
                          sections=sorted(sections, key=natural_key), chosen=chosen.get(sid))
            for sid, sections in by_subject.items()
        ),
        key=lambda c: c.subject_name,
    )
```

- [ ] **Step 5: Implement routers and wire them**

`backend/app/routers/events.py`:
```python
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import require_user
from app.db import get_session
from app.schemas import EventOut, EventsResponse
from app.services.events_query import active_semester, list_visible_events
from app.timeutil import iso_utc, to_naive_utc

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])
MAX_RANGE = timedelta(days=42)


@router.get("/events", response_model=EventsResponse)
def get_events(start: datetime, end: datetime, session: Session = Depends(get_session)) -> EventsResponse:
    start_utc, end_utc = to_naive_utc(start), to_naive_utc(end)
    if end_utc <= start_utc or end_utc - start_utc > MAX_RANGE:
        raise HTTPException(status_code=400, detail="range must be longer than 0 and at most 42 days")
    semester = active_semester(session)
    if semester is None:
        return EventsResponse(events=[], missing_sections=[])
    events, missing = list_visible_events(session, semester.id, start_utc, end_utc)
    return EventsResponse(
        events=[
            EventOut(id=e.id, title=e.title, subject_id=e.subject_id, subject_name=e.subject_name,
                     color=e.color, section=e.section, start=iso_utc(e.start_at), end=iso_utc(e.end_at),
                     room=e.room, kind=e.kind, status=e.status, source=e.source)
            for e in events
        ],
        missing_sections=missing,
    )
```

`backend/app/routers/settings.py`:
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_user
from app.config import Settings, get_settings
from app.db import get_session
from app.models import MySection, Semester
from app.schemas import SectionChoiceOut, SectionUpdate, SemesterOut, ZeusKeyStatus, ZeusKeyUpdate
from app.secret_store import ZEUS_KEY_NAME, SecretStore, get_zeus_key
from app.services.events_query import active_semester, section_choices
from app.zeus.ics_client import extract_key

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


@router.get("/semesters", response_model=list[SemesterOut])
def list_semesters(session: Session = Depends(get_session)) -> list[SemesterOut]:
    rows = session.scalars(select(Semester).order_by(Semester.code))
    return [SemesterOut.model_validate(row, from_attributes=True) for row in rows]


@router.get("/settings/sections", response_model=list[SectionChoiceOut])
def get_sections(session: Session = Depends(get_session)) -> list[SectionChoiceOut]:
    semester = active_semester(session)
    if semester is None:
        return []
    return [SectionChoiceOut(**vars(c)) for c in section_choices(session, semester.id)]


@router.put("/settings/sections", response_model=SectionChoiceOut)
def put_section(body: SectionUpdate, session: Session = Depends(get_session)) -> SectionChoiceOut:
    semester = active_semester(session)
    choices = {c.subject_id: c for c in section_choices(session, semester.id)} if semester else {}
    choice = choices.get(body.subject_id)
    if choice is None or body.section not in choice.sections:
        raise HTTPException(status_code=422, detail="unknown subject or section")
    row = session.get(MySection, body.subject_id)
    if row is None:
        session.add(MySection(subject_id=body.subject_id, section=body.section))
    else:
        row.section = body.section
    session.commit()
    return SectionChoiceOut(subject_id=choice.subject_id, subject_name=choice.subject_name,
                            sections=choice.sections, chosen=body.section)


@router.get("/settings/zeus-key", response_model=ZeusKeyStatus)
def get_zeus_key_status(session: Session = Depends(get_session),
                        settings: Settings = Depends(get_settings)) -> ZeusKeyStatus:
    return ZeusKeyStatus(configured=get_zeus_key(session, settings) is not None)


@router.put("/settings/zeus-key", response_model=ZeusKeyStatus)
def put_zeus_key(body: ZeusKeyUpdate, session: Session = Depends(get_session),
                 settings: Settings = Depends(get_settings)) -> ZeusKeyStatus:
    try:
        key = extract_key(body.value)
    except ValueError:
        raise HTTPException(status_code=422, detail="Paste the Zeus ICS link (or its key)") from None
    if not settings.token_encryption_key:
        raise HTTPException(status_code=500, detail="server is missing TOKEN_ENCRYPTION_KEY")
    SecretStore(session, settings.token_encryption_key).set(ZEUS_KEY_NAME, key)
    session.commit()
    return ZeusKeyStatus(configured=True)
```

`backend/app/routers/sync.py`:
```python
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_cron_or_user, require_user
from app.db import get_session
from app.deps import get_fetcher, get_now
from app.models import SyncRun
from app.schemas import SyncRunOut, SyncStatusOut
from app.timeutil import iso_utc
from app.zeus.sync import Fetcher, run_sync

router = APIRouter(prefix="/api")


def to_out(run: SyncRun) -> SyncRunOut:
    return SyncRunOut(
        status=run.status, started_at=iso_utc(run.started_at),
        finished_at=iso_utc(run.finished_at) if run.finished_at else None,
        fetched=run.fetched, inserted=run.inserted, updated=run.updated,
        cancelled=run.cancelled, skipped=run.skipped, error=run.error,
    )


@router.post("/sync", response_model=SyncRunOut)
def trigger_sync(
    _caller: str = Depends(require_cron_or_user),
    session: Session = Depends(get_session),
    fetch: Fetcher = Depends(get_fetcher),
    now: datetime = Depends(get_now),
) -> SyncRunOut:
    return to_out(run_sync(session, fetch, now))


@router.get("/sync/status", response_model=SyncStatusOut, dependencies=[Depends(require_user)])
def sync_status(session: Session = Depends(get_session)) -> SyncStatusOut:
    last = session.scalar(select(SyncRun).order_by(SyncRun.id.desc()).limit(1))
    last_ok = session.scalar(
        select(SyncRun).where(SyncRun.status == "ok").order_by(SyncRun.id.desc()).limit(1)
    )
    return SyncStatusOut(
        last_run=to_out(last) if last else None,
        last_success_at=iso_utc(last_ok.finished_at) if last_ok and last_ok.finished_at else None,
    )
```

Replace `backend/app/main.py`:
```python
from fastapi import FastAPI

from app.routers import events, health, settings, sync


def create_app() -> FastAPI:
    app = FastAPI(title="Timetable API")
    for module in (health, events, settings, sync):
        app.include_router(module.router)
    return app


app = create_app()
```

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend && uv run pytest -v`
Expected: all tests pass (≈ 90).

- [ ] **Step 7: Smoke-test locally against SQLite**

```bash
cd backend
cp .env.example .env            # keep DATABASE_URL=sqlite:///./dev.db
uv run alembic upgrade head
uv run python -m app.seed
uv run uvicorn app.main:app --port 8000 &
curl -s localhost:8000/api/health        # {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}\n" "localhost:8000/api/events?start=2026-10-18T22:00:00Z&end=2026-10-25T23:00:00Z"   # 401
kill %1
```

- [ ] **Step 8: Commit**

```bash
git add backend
git commit -m "feat(backend): events, settings and sync API"
```

---

### Task 10: Frontend scaffold, Supabase login, API client

**Files:**
- Create: `frontend/package.json` (via npm), `frontend/index.html`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/.env.example`, `frontend/src/vite-env.d.ts`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/src/lib/supabase.ts`, `frontend/src/lib/api.ts`, `frontend/src/auth/AuthGate.tsx`, `frontend/src/auth/LoginPage.tsx`, `frontend/src/test/setup.ts`, `frontend/src/lib/api.test.ts`

**Interfaces:**
- Produces: `supabase` client; `ApiError(status: number, message: string)`; `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` (adds `Authorization: Bearer <access_token>`, JSON content type when body present, throws `ApiError` with FastAPI `detail`); `<AuthGate>` (renders `<LoginPage>` when signed out).

- [ ] **Step 1: Create the package and install dependencies**

```bash
mkdir frontend && cd frontend
npm init -y
npm pkg set type=module scripts.dev=vite "scripts.build=tsc --noEmit && vite build" scripts.test=vitest scripts.preview="vite preview"
npm install react react-dom react-router @tanstack/react-query @supabase/supabase-js
npm install -D vite @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Write config and entry files**

`frontend/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#2E55E6" />
    <title>Timetable</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    env: { VITE_SUPABASE_URL: "http://localhost:54321", VITE_SUPABASE_KEY: "test-key" },
  },
});
```

`frontend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`frontend/.env.example`:
```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_KEY=<publishable or anon key>
```

`frontend/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_KEY: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`frontend/src/index.css`:
```css
@import "tailwindcss";

@theme {
  --font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --color-accent: #2e55e6;
  --color-accent-strong: #2445c4;
  --color-accent-soft: #e8edfd;
  --color-ink: #15171c;
  --color-muted: #5b6170;
  --color-line: #e4e7ec;
  --color-canvas: #f4f5f7;
}

body {
  margin: 0;
  background: var(--color-canvas);
  color: var(--color-ink);
  font-family: var(--font-sans);
}
```

`frontend/src/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

`frontend/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: Write the failing test** — `frontend/src/lib/api.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "tok" } } })) } },
}));

import { ApiError, apiFetch } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("apiFetch", () => {
  it("sends the bearer token and parses JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiFetch<{ ok: number }>("/api/x")).resolves.toEqual({ ok: 1 });
    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("sets JSON content type when sending a body", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/x", { method: "PUT", body: JSON.stringify({ a: 1 }) });
    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("throws ApiError with the FastAPI detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "this account is not allowed" }), { status: 403 })));
    const error = await apiFetch("/api/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: "this account is not allowed" });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/api.test.ts`
Expected: FAIL — cannot resolve `./api`

- [ ] **Step 5: Implement client, auth gate, placeholder App**

`frontend/src/lib/supabase.ts`:
```ts
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY);
```

`frontend/src/lib/api.ts`:
```ts
import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText || `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // error body was not JSON; keep the status text
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}
```

`frontend/src/auth/LoginPage.tsx`:
```tsx
import { supabase } from "../lib/supabase";

export function LoginPage() {
  const signIn = () =>
    supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-white p-8">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-accent font-bold text-white">T</div>
          <h1 className="text-xl font-bold">Timetable</h1>
        </div>
        <p className="text-sm text-muted">Sign in with your Google account to see your timetable.</p>
        <button type="button" onClick={signIn} className="h-11 rounded-xl bg-accent font-semibold text-white hover:bg-accent-strong">
          Continue with Google
        </button>
      </div>
    </main>
  );
}
```

`frontend/src/auth/AuthGate.tsx`:
```tsx
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { LoginPage } from "./LoginPage";

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <p className="p-8 text-muted">Loading…</p>;
  if (session === null) return <LoginPage />;
  return <>{children}</>;
}
```

`frontend/src/App.tsx` (placeholder until Task 12):
```tsx
import { AuthGate } from "./auth/AuthGate";

export default function App() {
  return (
    <AuthGate>
      <p className="p-8">Signed in.</p>
    </AuthGate>
  );
}
```

- [ ] **Step 6: Run tests and build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: 3 tests pass; build writes `dist/`.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(frontend): scaffold React app with Supabase login and API client"
```

---

### Task 11: Paris time helpers + day layout

**Files:**
- Create: `frontend/src/lib/time.ts`, `frontend/src/lib/time.test.ts`, `frontend/src/lib/layout.ts`, `frontend/src/lib/layout.test.ts`

**Interfaces:**
- Produces:
  - `TZ = "Europe/Paris"`; `parisParts(iso) -> { date: "YYYY-MM-DD"; minutes: number }`; `formatTime(iso) -> "HH:MM"`; `parisMidnightUtc(date) -> ISO string`; `addDays(date, n) -> date`; `startOfWeek(date) -> Monday date`; `todayParis(now?: Date) -> date`; `rangeUtc(firstDate, days) -> { start; end }`; `dayLabel(date) -> { weekday: "Mon"; day: "19" }`; `formatLongDate(date) -> "19 October 2026"`.
  - `Span { startMin; endMin }`; `Placed<T> { item; column; columns }`; `layoutDay<T extends Span>(items: T[]) -> Placed<T>[]`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/time.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { addDays, dayLabel, formatLongDate, formatTime, parisMidnightUtc, parisParts, rangeUtc, startOfWeek, todayParis } from "./time";

describe("Paris time", () => {
  it("converts summer time (CEST, UTC+2)", () => {
    expect(parisParts("2026-10-20T12:30:00Z")).toEqual({ date: "2026-10-20", minutes: 870 });
    expect(formatTime("2026-10-20T12:30:00Z")).toBe("14:30");
  });

  it("converts winter time after the 25 Oct switch (CET, UTC+1)", () => {
    expect(formatTime("2026-10-26T12:00:00Z")).toBe("13:00");
  });

  it("week range across the DST switch ends at 23:00Z", () => {
    expect(rangeUtc("2026-10-19", 7)).toEqual({ start: "2026-10-18T22:00:00.000Z", end: "2026-10-25T23:00:00.000Z" });
  });

  it("midnight on spring-forward day", () => {
    expect(parisMidnightUtc("2026-03-29")).toBe("2026-03-28T23:00:00.000Z");
  });

  it("startOfWeek returns Monday", () => {
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-26")).toBe("2026-10-26");
    expect(startOfWeek("2026-11-01")).toBe("2026-10-26");
  });

  it("today is computed in Paris, not UTC", () => {
    expect(todayParis(new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-25");
    expect(todayParis(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-26");
  });

  it("date arithmetic and labels", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayLabel("2026-10-19")).toEqual({ weekday: "Mon", day: "19" });
    expect(formatLongDate("2026-10-25")).toBe("25 October 2026");
  });
});
```

`frontend/src/lib/layout.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { layoutDay } from "./layout";

const ev = (id: string, startMin: number, endMin: number) => ({ id, startMin, endMin });
const byId = (placed: ReturnType<typeof layoutDay<ReturnType<typeof ev>>>) =>
  Object.fromEntries(placed.map((p) => [p.item.id, [p.column, p.columns]]));

describe("layoutDay", () => {
  it("separate events each get the full width", () => {
    expect(byId(layoutDay([ev("a", 540, 600), ev("b", 660, 720)]))).toEqual({ a: [0, 1], b: [0, 1] });
  });

  it("touching events do not overlap", () => {
    expect(byId(layoutDay([ev("tutorat", 810, 870), ev("french", 870, 990)]))).toEqual({ tutorat: [0, 1], french: [0, 1] });
  });

  it("two overlapping events share the width", () => {
    expect(byId(layoutDay([ev("a", 870, 990), ev("b", 870, 990)]))).toEqual({ a: [0, 2], b: [1, 2] });
  });

  it("a chain reuses free columns", () => {
    expect(byId(layoutDay([ev("a", 540, 660), ev("b", 600, 720), ev("c", 660, 780)]))).toEqual({
      a: [0, 2],
      b: [1, 2],
      c: [0, 2],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/time.test.ts src/lib/layout.test.ts`
Expected: FAIL — cannot resolve `./time` / `./layout`

- [ ] **Step 3: Implement**

`frontend/src/lib/time.ts`:
```ts
export const TZ = "Europe/Paris";

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const offsetFormat = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" });

export interface ParisParts {
  date: string;
  minutes: number;
}

export function parisParts(iso: string): ParisParts {
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function formatTime(iso: string): string {
  const { minutes } = parisParts(iso);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function offsetMinutes(utcMs: number): number {
  const name = offsetFormat.formatToParts(new Date(utcMs)).find((x) => x.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return 0;
  const total = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -total : total;
}

function utcNoon(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function parisMidnightUtc(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d);
  const firstGuess = naive - offsetMinutes(naive) * 60_000;
  return new Date(naive - offsetMinutes(firstGuess) * 60_000).toISOString();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function startOfWeek(date: string): string {
  const mondayIndex = (utcNoon(date).getUTCDay() + 6) % 7;
  return addDays(date, -mondayIndex);
}

export function todayParis(now: Date = new Date()): string {
  return parisParts(now.toISOString()).date;
}

export function rangeUtc(firstDate: string, days: number): { start: string; end: string } {
  return { start: parisMidnightUtc(firstDate), end: parisMidnightUtc(addDays(firstDate, days)) };
}

export function dayLabel(date: string): { weekday: string; day: string } {
  const dt = utcNoon(date);
  return { weekday: dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }), day: String(dt.getUTCDate()) };
}

export function formatLongDate(date: string): string {
  return utcNoon(date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
```

`frontend/src/lib/layout.ts`:
```ts
export interface Span {
  startMin: number;
  endMin: number;
}

export interface Placed<T> {
  item: T;
  column: number;
  columns: number;
}

export function layoutDay<T extends Span>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const placed of cluster) placed.columns = columnEnds.length;
    out.push(...cluster);
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= item.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.endMin);
    } else {
      columnEnds[column] = item.endMin;
    }
    cluster.push({ item, column, columns: 0 });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length > 0) flush();
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib`
Expected: all pass (time 7, layout 4, api 3).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib
git commit -m "feat(frontend): Paris time helpers and overlap-aware day layout"
```

---

### Task 12: Calendar (week/day) and Settings screens

**Files:**
- Create: `frontend/src/types.ts`, `frontend/src/lib/useMediaQuery.ts`, `frontend/src/components/WeekGrid.tsx`, `frontend/src/components/WeekGrid.test.tsx`, `frontend/src/components/Banners.tsx`, `frontend/src/components/Banners.test.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/pages/CalendarPage.tsx`, `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError` (Task 10); time + layout helpers (Task 11); HTTP API (Task 9).
- Produces: `ApiEvent`, `EventsResponse`, `SectionChoice`, `SyncRun`, `SyncStatus` types; `<WeekGrid days events />`; `<SyncBanner status />`, `<MissingSectionsBanner names />`, `<ErrorPanel error />`; routes `/` (calendar) and `/settings`.

- [ ] **Step 1: Types and media-query hook**

`frontend/src/types.ts`:
```ts
export interface ApiEvent {
  id: number;
  title: string;
  subject_id: number | null;
  subject_name: string | null;
  color: string | null;
  section: string | null;
  start: string;
  end: string;
  room: string;
  kind: "class" | "exam" | "holiday" | "work" | "french_ext" | "other";
  status: "normal" | "changed" | "cancelled";
  source: "zeus" | "custom";
}

export interface EventsResponse {
  events: ApiEvent[];
  missing_sections: string[];
}

export interface SectionChoice {
  subject_id: number;
  subject_name: string;
  sections: string[];
  chosen: string | null;
}

export interface SyncRun {
  status: "running" | "ok" | "failed" | "auth_failed";
  started_at: string;
  finished_at: string | null;
  fetched: number;
  inserted: number;
  updated: number;
  cancelled: number;
  skipped: number;
  error: string | null;
}

export interface SyncStatus {
  last_run: SyncRun | null;
  last_success_at: string | null;
}
```

`frontend/src/lib/useMediaQuery.ts`:
```ts
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const get = () => typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
```

- [ ] **Step 2: Write the failing component tests**

`frontend/src/components/WeekGrid.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ApiEvent } from "../types";
import { WeekGrid } from "./WeekGrid";

const WEEK = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];

const event = (over: Partial<ApiEvent>): ApiEvent => ({
  id: 1, title: "French for Fall 26 T1", subject_id: 1, subject_name: "French for Fall 26 T1", color: "#0E7F72",
  section: "GR5", start: "2026-10-20T12:30:00Z", end: "2026-10-20T14:30:00Z", room: "KB605",
  kind: "class", status: "normal", source: "zeus", ...over,
});

describe("WeekGrid", () => {
  it("places an event in Paris time with an accessible label", () => {
    render(<WeekGrid days={WEEK} events={[event({})]} />);
    const block = screen.getByRole("group", { name: "French for Fall 26 T1 GR5, 14:30 to 16:30, KB605" });
    expect(block.style.top).toBe("340px");
    expect(block.style.height).toBe("100px");
  });

  it("renders overlapping events side by side", () => {
    render(<WeekGrid days={WEEK} events={[event({ id: 1 }), event({ id: 2, title: "Other", section: null })]} />);
    const blocks = screen.getAllByRole("group");
    expect(blocks.map((b) => [b.dataset.column, b.dataset.columns])).toEqual([["0", "2"], ["1", "2"]]);
  });

  it("strikes through cancelled events and badges changed ones", () => {
    render(<WeekGrid days={WEEK} events={[event({ id: 1, status: "cancelled" }), event({ id: 2, start: "2026-10-21T07:00:00Z", end: "2026-10-21T09:00:00Z", status: "changed" })]} />);
    expect(screen.getAllByRole("group")[0]).toHaveClass("line-through");
    expect(screen.getByText("Changed")).toBeInTheDocument();
  });

  it("shows holidays as a header chip, not a block", () => {
    render(<WeekGrid days={WEEK} events={[event({ title: "Vacances", kind: "holiday", subject_id: null, section: null, start: "2026-10-19T06:00:00Z", end: "2026-10-19T18:00:00Z" })]} />);
    expect(screen.getByText("Vacances")).toBeInTheDocument();
    expect(screen.queryAllByRole("group")).toHaveLength(0);
  });

  it("extends the grid for early classes", () => {
    render(<WeekGrid days={WEEK} events={[event({ start: "2026-10-26T07:00:00Z", end: "2026-10-26T09:00:00Z" })]} />);
    expect(screen.queryByText("07:00")).not.toBeInTheDocument();
    render(<WeekGrid days={["2026-10-26"]} events={[event({ start: "2026-10-26T06:00:00Z", end: "2026-10-26T08:00:00Z" })]} />);
    expect(screen.getByText("07:00")).toBeInTheDocument();
  });
});
```

`frontend/src/components/Banners.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { MissingSectionsBanner, SyncBanner } from "./Banners";

const run = (status: "ok" | "failed" | "auth_failed") => ({
  status, started_at: "2026-10-15T04:00:00Z", finished_at: "2026-10-15T04:00:02Z",
  fetched: 0, inserted: 0, updated: 0, cancelled: 0, skipped: 0, error: status === "ok" ? null : "x",
});

const wrap = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("banners", () => {
  it("asks for the Zeus link when never synced", () => {
    wrap(<SyncBanner status={{ last_run: null, last_success_at: null }} />);
    expect(screen.getByText(/paste your Zeus link/i)).toBeInTheDocument();
  });

  it("explains an expired Zeus link", () => {
    wrap(<SyncBanner status={{ last_run: run("auth_failed"), last_success_at: "2026-10-14T04:00:02Z" }} />);
    expect(screen.getByText(/generate a new link in Zeus/i)).toBeInTheDocument();
  });

  it("shows nothing when the last sync was ok", () => {
    const { container } = wrap(<SyncBanner status={{ last_run: run("ok"), last_success_at: "2026-10-15T04:00:02Z" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists subjects that need a section", () => {
    wrap(<MissingSectionsBanner names={["French for Fall 26 T1", "Tutorat Fall 26 T1"]} />);
    expect(screen.getByText(/French for Fall 26 T1, Tutorat Fall 26 T1/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /choose your groups/i })).toHaveAttribute("href", "/settings");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components`
Expected: FAIL — cannot resolve `./WeekGrid` / `./Banners`

- [ ] **Step 4: Implement components**

`frontend/src/components/WeekGrid.tsx`:
```tsx
import { useMemo, type CSSProperties } from "react";
import { layoutDay, type Span } from "../lib/layout";
import { dayLabel, formatTime, parisParts, todayParis } from "../lib/time";
import type { ApiEvent } from "../types";

interface Props {
  days: string[];
  events: ApiEvent[];
  hourHeight?: number;
}

type Timed = ApiEvent & Span;

const DAY_MIN = 24 * 60;

function bounds(timed: Timed[]): [number, number] {
  let first = 8;
  let last = 21;
  for (const t of timed) {
    first = Math.min(first, Math.floor(t.startMin / 60));
    last = Math.max(last, Math.ceil(t.endMin / 60));
  }
  return [first, last];
}

export function WeekGrid({ days, events, hourHeight = 52 }: Props) {
  const today = todayParis();
  const { byDay, holidays, firstHour, lastHour } = useMemo(() => {
    const byDay = new Map<string, Timed[]>(days.map((d) => [d, []]));
    const holidays = new Map<string, string[]>();
    for (const ev of events) {
      const start = parisParts(ev.start);
      if (ev.kind === "holiday") {
        holidays.set(start.date, [...(holidays.get(start.date) ?? []), ev.title]);
        continue;
      }
      const end = parisParts(ev.end);
      byDay.get(start.date)?.push({ ...ev, startMin: start.minutes, endMin: end.date === start.date ? end.minutes : DAY_MIN });
    }
    const [firstHour, lastHour] = bounds([...byDay.values()].flat());
    return { byDay, holidays, firstHour, lastHour };
  }, [days, events]);

  const height = (lastHour - firstHour) * hourHeight;
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const columns = `56px repeat(${days.length}, minmax(${days.length > 1 ? 110 : 0}px, 1fr))`;

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white">
      <div className="grid" style={{ gridTemplateColumns: columns }}>
        <div className="border-b border-line" />
        {days.map((date) => {
          const label = dayLabel(date);
          const isToday = date === today;
          return (
            <div key={date} className="flex flex-wrap items-center gap-2 border-b border-l border-line px-2 py-2.5">
              <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label.weekday}</span>
              <span className={`flex size-[30px] items-center justify-center rounded-full text-[15px] font-bold ${isToday ? "bg-accent text-white" : ""}`}>
                {label.day}
              </span>
              {(holidays.get(date) ?? []).map((name) => (
                <span key={name} className="rounded-full bg-[#F0F1F4] px-2 py-0.5 text-[11px] font-semibold text-[#3A3F4B]">
                  {name}
                </span>
              ))}
            </div>
          );
        })}
        <div className="relative" style={{ height }}>
          {hours.map((h) => (
            <div key={h} className="absolute right-2 font-mono text-[11px] text-muted" style={{ top: (h - firstHour) * hourHeight + 2 }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {days.map((date) => (
          <div
            key={date}
            className="relative border-l border-[#EEF0F3]"
            style={{
              height,
              backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${hourHeight - 1}px, #EEF0F3 ${hourHeight - 1}px, #EEF0F3 ${hourHeight}px)`,
            }}
          >
            {layoutDay(byDay.get(date) ?? []).map(({ item, column, columns: count }) => (
              <EventBlock
                key={item.id}
                ev={item}
                column={column}
                columns={count}
                style={{
                  top: ((item.startMin - firstHour * 60) / 60) * hourHeight + 2,
                  height: ((item.endMin - item.startMin) / 60) * hourHeight - 4,
                  left: `calc(${(column / count) * 100}% + 3px)`,
                  width: `calc(${100 / count}% - 6px)`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function EventBlock({ ev, style, column, columns }: { ev: ApiEvent; style: CSSProperties; column: number; columns: number }) {
  const color = ev.color ?? "#3B4252";
  const title = ev.section ? `${ev.title} ${ev.section}` : ev.title;
  const label = `${title}, ${formatTime(ev.start)} to ${formatTime(ev.end)}${ev.room ? `, ${ev.room}` : ""}`;
  return (
    <div
      role="group"
      aria-label={label}
      data-column={column}
      data-columns={columns}
      className={`absolute flex flex-col gap-0.5 overflow-hidden rounded-lg px-2 py-1.5 text-xs ${ev.status === "cancelled" ? "line-through opacity-60" : ""}`}
      style={{ ...style, background: `${color}1F` }}
    >
      <span className="flex items-center gap-1.5 leading-tight font-bold">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
        {ev.title}
        {ev.section ? ` · ${ev.section}` : ""}
      </span>
      <span className="font-mono text-[10.5px] text-[#3A3F4B]">
        {formatTime(ev.start)}–{formatTime(ev.end)}
      </span>
      {ev.room && <span className="text-[11px] text-[#3A3F4B]">{ev.room}</span>}
      <span className="flex flex-wrap gap-1">
        {ev.kind === "exam" && <span className="rounded-full bg-[#8B1A1A] px-1.5 text-[10.5px] font-bold text-white">Exam</span>}
        {ev.status === "changed" && <span className="rounded-full bg-[#9A3412] px-1.5 text-[10.5px] font-bold text-white">Changed</span>}
      </span>
    </div>
  );
}
```

`frontend/src/components/Banners.tsx`:
```tsx
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "../lib/api";
import { supabase } from "../lib/supabase";
import { formatTime, parisParts } from "../lib/time";
import type { SyncStatus } from "../types";

function Banner({ tone, children }: { tone: "warn" | "error"; children: ReactNode }) {
  const styles = tone === "warn" ? "border-[#F5D9B8] bg-[#FFF7ED] text-[#7C2D12]" : "border-[#F3C4C4] bg-[#FDECEC] text-[#8B1A1A]";
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

function since(iso: string | null): string {
  if (!iso) return "never";
  const { date } = parisParts(iso);
  return `${date} ${formatTime(iso)}`;
}

export function SyncBanner({ status }: { status: SyncStatus | undefined }) {
  if (!status) return null;
  const run = status.last_run;
  if (run === null) {
    return (
      <Banner tone="warn">
        No school data yet. <Link to="/settings" className="font-semibold underline">Paste your Zeus link in Settings</Link>, then press Sync now.
      </Banner>
    );
  }
  if (run.status === "auth_failed") {
    return (
      <Banner tone="error">
        Zeus rejected the link. Generate a new link in Zeus and <Link to="/settings" className="font-semibold underline">paste it in Settings</Link>. Showing data from {since(status.last_success_at)}.
      </Banner>
    );
  }
  if (run.status === "failed") {
    return <Banner tone="warn">School sync failed. Showing data from {since(status.last_success_at)}.</Banner>;
  }
  return null;
}

export function MissingSectionsBanner({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <Banner tone="warn">
      Some classes are hidden until you pick your group: {names.join(", ")}.{" "}
      <Link to="/settings" className="font-semibold underline">Choose your groups</Link>
    </Banner>
  );
}

export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) {
    return (
      <Banner tone="error">
        This Google account is not allowed to use this app.{" "}
        <button type="button" className="font-semibold underline" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </Banner>
    );
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return (
    <Banner tone="error">
      Could not load data: {message}.{" "}
      {onRetry && (
        <button type="button" className="font-semibold underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </Banner>
  );
}
```

- [ ] **Step 5: Run component tests**

Run: `cd frontend && npx vitest run src/components`
Expected: 9 passed

- [ ] **Step 6: Implement layout and pages**

`frontend/src/components/Layout.tsx`:
```tsx
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router";
import { apiFetch } from "../lib/api";

interface Semester {
  code: string;
  name: string;
  is_active: boolean;
}

const links = [
  { to: "/", label: "Calendar" },
  { to: "/settings", label: "Settings" },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex h-11 items-center rounded-lg px-3 text-sm ${isActive ? "bg-accent-soft font-semibold text-accent-strong" : "font-medium text-[#3A3F4B] hover:bg-[#F0F1F4]"}`;

export function Layout() {
  const semesters = useQuery({ queryKey: ["semesters"], queryFn: () => apiFetch<Semester[]>("/api/semesters") });
  const active = semesters.data?.find((s) => s.is_active);
  return (
    <div className="min-h-screen md:flex">
      <nav aria-label="Main" className="hidden w-60 shrink-0 flex-col gap-5 border-r border-line bg-white px-4 py-5 md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">T</div>
          <span className="text-[17px] font-bold">Timetable</span>
        </div>
        {active && (
          <div className="rounded-xl border border-line bg-[#F8F9FB] px-3 py-2.5 text-sm font-semibold">{active.name}</div>
        )}
        <div className="flex flex-col gap-0.5">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end className={navClass}>
              {l.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="min-w-0 flex-1 px-4 pt-5 pb-24 md:px-7 md:pb-8">
        <Outlet />
      </main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 grid grid-cols-2 border-t border-line bg-white px-2 pt-1.5 pb-3 md:hidden">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end className={({ isActive }) => `flex h-12 items-center justify-center text-sm ${isActive ? "font-semibold text-accent-strong" : "text-[#3A3F4B]"}`}>
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
```

`frontend/src/pages/CalendarPage.tsx`:
```tsx
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorPanel, MissingSectionsBanner, SyncBanner } from "../components/Banners";
import { WeekGrid } from "../components/WeekGrid";
import { apiFetch } from "../lib/api";
import { addDays, dayLabel, formatLongDate, rangeUtc, startOfWeek, todayParis } from "../lib/time";
import { useMediaQuery } from "../lib/useMediaQuery";
import type { EventsResponse, SyncStatus } from "../types";

type View = "week" | "day";

const buttonClass = "h-10 rounded-xl border border-line bg-white px-3.5 text-sm font-semibold hover:bg-[#F8F9FB]";

export function CalendarPage() {
  const isPhone = useMediaQuery("(max-width: 767px)");
  const [view, setView] = useState<View>(isPhone ? "day" : "week");
  const [anchor, setAnchor] = useState(todayParis());

  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)) : [anchor];
  const range = rangeUtc(days[0], days.length);
  const step = view === "week" ? 7 : 1;

  const events = useQuery({
    queryKey: ["events", range.start, range.end],
    queryFn: () => apiFetch<EventsResponse>(`/api/events?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`),
  });
  const sync = useQuery({ queryKey: ["sync-status"], queryFn: () => apiFetch<SyncStatus>("/api/sync/status") });

  const title =
    view === "week"
      ? `${dayLabel(days[0]).day} – ${formatLongDate(days[6])}`
      : `${dayLabel(anchor).weekday} ${formatLongDate(anchor)}`;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold tracking-tight">{title}</h1>
        <div className="flex gap-1.5">
          <button type="button" aria-label={`Previous ${view}`} className={buttonClass} onClick={() => setAnchor(addDays(anchor, -step))}>
            ‹
          </button>
          <button type="button" className={buttonClass} onClick={() => setAnchor(todayParis())}>
            Today
          </button>
          <button type="button" aria-label={`Next ${view}`} className={buttonClass} onClick={() => setAnchor(addDays(anchor, step))}>
            ›
          </button>
        </div>
        <div role="group" aria-label="View" className="flex rounded-xl bg-[#E9EBEF] p-[3px]">
          {(["week", "day"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`h-[34px] rounded-lg px-4 text-sm capitalize ${view === v ? "bg-white font-semibold shadow-sm" : "font-medium text-[#3A3F4B]"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </header>
      <SyncBanner status={sync.data} />
      <MissingSectionsBanner names={events.data?.missing_sections ?? []} />
      {events.error ? <ErrorPanel error={events.error} onRetry={() => events.refetch()} /> : <WeekGrid days={days} events={events.data?.events ?? []} />}
    </div>
  );
}
```

`frontend/src/pages/SettingsPage.tsx`:
```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ErrorPanel } from "../components/Banners";
import { apiFetch } from "../lib/api";
import { formatTime, parisParts } from "../lib/time";
import type { SectionChoice, SyncRun, SyncStatus } from "../types";

const card = "flex flex-col gap-3 rounded-2xl border border-line bg-white p-5";
const primary = "h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-60";

function when(iso: string | null | undefined): string {
  return iso ? `${parisParts(iso).date} ${formatTime(iso)}` : "never";
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const keyStatus = useQuery({ queryKey: ["zeus-key"], queryFn: () => apiFetch<{ configured: boolean }>("/api/settings/zeus-key") });
  const sync = useQuery({ queryKey: ["sync-status"], queryFn: () => apiFetch<SyncStatus>("/api/sync/status") });
  const sections = useQuery({ queryKey: ["sections"], queryFn: () => apiFetch<SectionChoice[]>("/api/settings/sections") });
  const [link, setLink] = useState("");

  const saveKey = useMutation({
    mutationFn: (value: string) => apiFetch("/api/settings/zeus-key", { method: "PUT", body: JSON.stringify({ value }) }),
    onSuccess: () => {
      setLink("");
      queryClient.invalidateQueries({ queryKey: ["zeus-key"] });
    },
  });
  const syncNow = useMutation({
    mutationFn: () => apiFetch<SyncRun>("/api/sync", { method: "POST" }),
    onSettled: () => queryClient.invalidateQueries(),
  });
  const pick = useMutation({
    mutationFn: (body: { subject_id: number; section: string }) =>
      apiFetch("/api/settings/sections", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (link.trim()) saveKey.mutate(link.trim());
  };

  const lastRun = sync.data?.last_run;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      {keyStatus.error && <ErrorPanel error={keyStatus.error} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="text-base font-bold">School timetable (Zeus)</h2>
          <form onSubmit={submit} className="flex flex-col gap-2">
            <label htmlFor="zeus-link" className="text-sm font-semibold text-[#3A3F4B]">
              Zeus ICS subscription link
            </label>
            <div className="flex gap-2">
              <input
                id="zeus-link"
                type="password"
                autoComplete="off"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder={keyStatus.data?.configured ? "Saved. Paste a new link to replace it." : "https://zeus.ionis-it.com/api/group/…/ics/…"}
                className="h-10 min-w-0 flex-1 rounded-xl border border-[#D5D9E0] px-3 text-sm"
              />
              <button type="submit" className={primary} disabled={saveKey.isPending}>
                Save
              </button>
            </div>
            <p className="text-xs text-muted">
              In Zeus, generate the calendar link for your group and paste it here. It is stored on the server only and never shown again.
            </p>
            {saveKey.error && <p className="text-sm text-[#8B1A1A]">{(saveKey.error as Error).message}</p>}
            <p className="text-sm">{keyStatus.data?.configured ? "Link saved." : "No link saved yet."}</p>
          </form>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#F8F9FB] px-3 py-2.5 text-sm">
            <span>
              Last sync: {lastRun ? `${lastRun.status} · ${when(lastRun.finished_at)}` : "never"}
              {lastRun?.status === "ok" && ` · ${lastRun.fetched} events, ${lastRun.inserted} new, ${lastRun.updated} changed, ${lastRun.cancelled} cancelled`}
              {lastRun?.error && ` · ${lastRun.error}`}
            </span>
            <button type="button" className={primary} onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
              {syncNow.isPending ? "Syncing…" : "Sync now"}
            </button>
          </div>
        </section>
        <section className={card}>
          <h2 className="text-base font-bold">My groups</h2>
          <p className="text-sm text-muted">Zeus sends every parallel group. Pick yours; classes without a group are always shown.</p>
          {sections.data?.length === 0 && <p className="text-sm">No grouped classes yet. Sync first.</p>}
          {sections.data?.map((choice) => (
            <label key={choice.subject_id} className="flex flex-wrap items-center justify-between gap-3 text-sm font-medium">
              {choice.subject_name}
              <select
                value={choice.chosen ?? ""}
                onChange={(e) => pick.mutate({ subject_id: choice.subject_id, section: e.target.value })}
                className="h-10 min-w-[120px] rounded-xl border border-[#D5D9E0] bg-white px-2.5 font-semibold"
              >
                {choice.chosen === null && <option value="">Choose…</option>}
                {choice.sections.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </section>
      </div>
    </div>
  );
}
```

Replace `frontend/src/App.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { AuthGate } from "./auth/AuthGate";
import { Layout } from "./components/Layout";
import { ApiError } from "./lib/api";
import { CalendarPage } from "./pages/CalendarPage";
import { SettingsPage } from "./pages/SettingsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      staleTime: 60_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<CalendarPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthGate>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 7: Run all frontend tests and the build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all tests pass; build succeeds with no type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): week/day calendar, sync banners and settings page"
```

---

### Task 13: Deploy (Vercel + Supabase), CI and daily sync cron

**Files:**
- Create: `api/index.py`, `requirements.txt`, `vercel.json`, `.github/workflows/ci.yml`, `.github/workflows/sync.yml`, `docs/SETUP.md`

**Interfaces:**
- Consumes: `app.main.app` (Task 9), frontend build (Task 12).
- Produces: production URL `https://<project>.vercel.app` serving the SPA and `/api/*`; daily `POST /api/sync`.

- [ ] **Step 1: Vercel entry and config**

`api/index.py`:
```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app  # noqa: E402,F401
```

`requirements.txt` (must match `backend/pyproject.toml` dependencies):
```
fastapi>=0.115
sqlalchemy>=2.0
psycopg[binary]>=3.2
alembic>=1.13
pydantic-settings>=2.4
pyjwt[crypto]>=2.9
httpx>=0.27
icalendar>=6.0
cryptography>=43
```

`vercel.json`:
```json
{
  "buildCommand": "cd frontend && npm ci && npm run build",
  "outputDirectory": "frontend/dist",
  "functions": {
    "api/index.py": { "includeFiles": "backend/app/**", "maxDuration": 60 }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.py" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

- [ ] **Step 2: CI and cron workflows**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  backend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uv sync
      - run: uv run pytest -q
  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npx vitest run
      - run: npm run build
```

`.github/workflows/sync.yml`:
```yaml
name: Daily Zeus sync
on:
  schedule:
    - cron: "0 4 * * *"   # 06:00 Paris in summer, 05:00 in winter
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger sync
        env:
          APP_URL: ${{ secrets.APP_URL }}
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          curl -fsS -X POST "$APP_URL/api/sync" -H "X-Cron-Secret: $CRON_SECRET" -o result.json
          cat result.json
          grep -q '"status":"ok"' result.json
```

- [ ] **Step 3: Write `docs/SETUP.md`**

````markdown
# One-time setup

All services below are free. Do the steps in order.

## 1. Supabase (database + login)
1. Create a project at https://supabase.com (region: closest to Paris, e.g. `eu-west`). Save the database password.
2. **Project Settings → Database → Connection string**:
   - *Transaction pooler* (port 6543) → `DATABASE_URL` for Vercel. Change the scheme to `postgresql+psycopg://`.
   - *Session pooler* (port 5432) → use for migrations from your laptop.
3. **Project Settings → API**: copy the Project URL (`SUPABASE_URL` / `VITE_SUPABASE_URL`) and the publishable (or anon) key (`VITE_SUPABASE_KEY`).
4. Make sure **JWT signing keys** are asymmetric (default for new projects): Project Settings → JWT Keys shows an ECC/RSA current key.

## 2. Google login
1. https://console.cloud.google.com → new project → **APIs & Services → OAuth consent screen**: External, add your Gmail as a test user.
2. **Credentials → Create OAuth client ID → Web application**. Authorized redirect URI: `https://<ref>.supabase.co/auth/v1/callback`.
3. Supabase → **Authentication → Providers → Google**: enable, paste client ID + secret.
4. Supabase → **Authentication → URL Configuration**: Site URL = `https://<project>.vercel.app`; add `http://localhost:5173` to redirect URLs.

## 3. Database schema
```bash
cd backend
DATABASE_URL="postgresql+psycopg://<session-pooler-url>" uv run alembic upgrade head
DATABASE_URL="postgresql+psycopg://<session-pooler-url>" uv run python -m app.seed
```
Then in Supabase **Table Editor** confirm every table shows "RLS enabled".

## 4. Secrets
```bash
cd backend
uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"   # TOKEN_ENCRYPTION_KEY
uv run python -c "import secrets; print(secrets.token_urlsafe(32))"                                 # CRON_SECRET
```

## 5. Vercel
1. https://vercel.com → Add New Project → import `hnaul491/timetable-app` (Hobby plan). Framework preset: Other.
2. Environment variables (Production + Preview):
   `DATABASE_URL`, `SUPABASE_URL`, `ALLOWED_EMAILS` (your Google email), `CRON_SECRET`, `TOKEN_ENCRYPTION_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`.
3. Deploy. If the deploy rejects `maxDuration: 60`, lower it to the value the error message allows and note it in the spec's open items.

## 6. GitHub Actions secrets
Repo → Settings → Secrets and variables → Actions: `APP_URL` = `https://<project>.vercel.app`, `CRON_SECRET` = same value as Vercel.

## 7. First run
1. Open the app, sign in with Google.
2. Settings → paste the Zeus ICS link → Save → **Sync now**.
3. Settings → My groups → choose your G / GR groups.
4. GitHub → Actions → "Daily Zeus sync" → Run workflow → it must finish green.

## Local development
```bash
cd backend && cp .env.example .env    # fill SUPABASE_URL, ALLOWED_EMAILS, TOKEN_ENCRYPTION_KEY
uv run alembic upgrade head && uv run python -m app.seed
uv run uvicorn app.main:app --reload --port 8000
cd ../frontend && cp .env.example .env  # fill VITE_ values
npm run dev                              # http://localhost:5173
```
````

- [ ] **Step 4: Verify locally, then commit and push**

Run: `cd backend && uv run pytest -q && cd ../frontend && npx vitest run && npm run build`
Expected: all green.

```bash
git add api requirements.txt vercel.json .github docs/SETUP.md
git commit -m "chore: Vercel deployment, CI and daily sync workflow"
git push
```
Expected: GitHub Actions **CI** run is green.

- [ ] **Step 5: Do the one-time setup and verify production**

Follow `docs/SETUP.md` sections 1–7 (manual, in the browser). Then:

```bash
curl -s https://<project>.vercel.app/api/health
# {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}\n" "https://<project>.vercel.app/api/events?start=2026-10-18T22:00:00Z&end=2026-10-25T23:00:00Z"
# 401
```
In the browser: sign in → Settings → paste link → Sync now shows `ok` with ~346 events → pick groups → Calendar shows the week of 19–25 Oct with only your groups, times in Paris time. On a phone the calendar opens in Day view.

- [ ] **Step 6: Resolve spec open items 1 and 3**

- Record whether the ICS link still works after 2026-10-04 (open item 1) and the accepted `maxDuration` (open item 3) in the spec's section 14, then:

```bash
git add docs/superpowers/specs/2026-10-03-timetable-app-design.md
git commit -m "docs: record ICS key lifetime and Vercel duration findings"
git push
```
