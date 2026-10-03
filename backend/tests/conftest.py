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
