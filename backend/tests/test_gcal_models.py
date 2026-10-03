from datetime import datetime

from sqlalchemy import select

from app.config import Settings
from app.models import Event, GcalTombstone, GoogleAccount
from app.services.recurrence import delete_event_cascade


def test_deleting_a_pushed_event_leaves_a_tombstone(session, semester):
    pushed = Event(source="custom", semester_id=semester.id, title_raw="Work shift", start_at=datetime(2026, 10, 20, 8),
                   end_at=datetime(2026, 10, 20, 12), kind="work", gcal_event_id="g123", gcal_hash="h")
    local = Event(source="custom", semester_id=semester.id, title_raw="Work shift", start_at=datetime(2026, 10, 21, 8),
                  end_at=datetime(2026, 10, 21, 12), kind="work")
    session.add_all([pushed, local])
    session.flush()
    delete_event_cascade(session, pushed)
    delete_event_cascade(session, local)
    session.commit()
    assert [t.gcal_event_id for t in session.scalars(select(GcalTombstone))] == ["g123"]


def test_google_account_defaults(session):
    account = GoogleAccount(id=1, email="me@example.com", connected_at=datetime(2026, 10, 15, 12))
    session.add(account)
    session.commit()
    assert (account.kinds, account.needs_reconnect, account.calendar_id, account.last_push_at) == ([], False, None, None)


def test_google_configured_needs_client_and_encryption_key():
    assert Settings(google_client_id="id", google_client_secret="s", token_encryption_key="k").google_configured
    assert not Settings(google_client_id="id", google_client_secret="", token_encryption_key="k").google_configured
    assert not Settings(google_client_id="id", google_client_secret="s", token_encryption_key="").google_configured
