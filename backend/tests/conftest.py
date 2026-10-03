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
