from datetime import datetime

from sqlalchemy import select

from app.deps import get_fetcher, get_gcal_factory
from app.gcal.api import GoogleAuthError, GoogleError
from app.models import AppSecret, AppSetting, Event, GoogleAccount, Subject
from tests.conftest import AUTH
from tests.gcal_fakes import FakeCalendar

TOKEN = "1//refresh-token-value-123"
REVOKED = "Google access was revoked or expired — reconnect Google in Settings"


def configure(client, settings, fake, tokens=None):
    settings.google_client_id, settings.google_client_secret = "cid", "csecret"

    def factory(token):
        if tokens is not None:
            tokens.append(token)
        return fake

    client.app.dependency_overrides[get_gcal_factory] = lambda: factory


def seed(session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[], color="#2E55E6")
    session.add(db)
    session.flush()
    for uid, start, kind in [("c1", datetime(2026, 10, 19, 11), "class"), ("x1", datetime(2027, 1, 26, 8), "exam")]:
        session.add(Event(source="zeus", zeus_uid=uid, semester_id=semester.id, subject_id=db.id, title_raw=uid,
                          start_at=start, end_at=start.replace(hour=start.hour + 2), room="KB602", kind=kind))
    session.commit()


def connect(client):
    return client.post("/api/google/connect", headers=AUTH, json={"refresh_token": TOKEN})


def test_requires_login(client):
    assert client.get("/api/google").status_code == 401
    assert client.post("/api/google/push").status_code == 401


def test_not_configured(client, semester):
    body = client.get("/api/google", headers=AUTH).json()
    assert (body["configured"], body["connected"], body["pending"]) == (False, False, 0)
    response = connect(client)
    assert response.status_code == 400 and "not set up" in response.json()["detail"]


def test_connect_push_and_status(client, settings, session, semester):
    fake, tokens = FakeCalendar(), []
    configure(client, settings, fake, tokens)
    seed(session, semester)
    body = connect(client).json()
    assert (body["connected"], body["email"], body["pending"], body["needs_reconnect"]) == (
        True, "me@example.com", 2, False)
    assert body["kinds"] == ["class", "exam", "holiday", "work", "french_ext"]
    assert tokens == [TOKEN] and fake.calendars == {"cal1": "My Timetable"}
    stored = session.get(AppSecret, "google_refresh_token")
    assert stored is not None and TOKEN not in stored.value_encrypted
    assert TOKEN not in client.get("/api/google", headers=AUTH).text
    result = client.post("/api/google/push", headers=AUTH).json()
    assert result == {"status": "ok", "done": 2, "failed": 0, "remaining": 0, "error": None}
    after = client.get("/api/google", headers=AUTH).json()
    assert (after["pending"], after["last_push_at"], after["last_push_error"]) == (0, "2026-10-15T12:00:00Z", None)


def test_kinds(client, settings, session, semester):
    configure(client, settings, FakeCalendar())
    seed(session, semester)
    assert client.put("/api/google/kinds", headers=AUTH, json={"kinds": ["exam"]}).status_code == 404
    connect(client)
    client.post("/api/google/push", headers=AUTH)
    body = client.put("/api/google/kinds", headers=AUTH, json={"kinds": ["exam", "exam", "class"]}).json()
    assert body["kinds"] == ["class", "exam"]
    body = client.put("/api/google/kinds", headers=AUTH, json={"kinds": ["exam"]}).json()
    assert body["pending"] == 1  # the class has to be removed from Google
    assert client.put("/api/google/kinds", headers=AUTH, json={"kinds": ["party"]}).status_code == 422


def test_disconnect_forgets_everything(client, settings, session, semester):
    configure(client, settings, FakeCalendar())
    seed(session, semester)
    connect(client)
    client.post("/api/google/push", headers=AUTH)
    assert client.delete("/api/google", headers=AUTH).status_code == 204
    assert client.delete("/api/google", headers=AUTH).status_code == 204
    assert client.get("/api/google", headers=AUTH).json()["connected"] is False
    session.expire_all()
    assert session.get(AppSecret, "google_refresh_token") is None
    assert all(e.gcal_event_id is None for e in session.scalars(select(Event)))


def test_revoked_access_shows_reconnect_and_reconnect_clears_it(client, settings, session, semester):
    fake = FakeCalendar(fail={"insert_event": [GoogleAuthError(REVOKED)]})
    configure(client, settings, fake)
    seed(session, semester)
    connect(client)
    assert client.post("/api/google/push", headers=AUTH).json()["status"] == "failed"
    body = client.get("/api/google", headers=AUTH).json()
    assert (body["needs_reconnect"], body["last_push_error"]) == (True, REVOKED)
    assert client.post("/api/google/push", headers=AUTH).json()["status"] == "skipped"
    assert connect(client).json()["needs_reconnect"] is False
    assert client.post("/api/google/push", headers=AUTH).json()["done"] == 2


def test_connect_reports_google_errors(client, settings, semester):
    configure(client, settings, FakeCalendar(fail={"create_calendar": [GoogleAuthError(REVOKED)]}))
    response = connect(client)
    assert response.status_code == 400
    assert response.json()["detail"].startswith("Google Calendar refused the connection: ")
    assert client.get("/api/google", headers=AUTH).json()["connected"] is False


def test_daily_sync_also_pushes(client, settings, semester):
    fake = FakeCalendar()
    configure(client, settings, fake)
    connect(client)
    ics = "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN", "BEGIN:VEVENT", "UID:z1",
                       "SUMMARY:Relational Databases", "DTSTART:20261102T080000Z", "DTEND:20261102T100000Z",
                       "LOCATION:KB602", "END:VEVENT", "END:VCALENDAR", ""])
    client.app.dependency_overrides[get_fetcher] = lambda: (lambda sem: ics)
    response = client.post("/api/sync", headers={"X-Cron-Secret": "cron-secret"})
    assert response.json()["status"] == "ok"
    assert [body["summary"] for body in fake.events.values()] == ["Relational Databases"]


def test_sync_still_works_when_google_is_not_connected(client, semester):
    ics = "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN", "BEGIN:VEVENT", "UID:z1",
                       "SUMMARY:Relational Databases", "DTSTART:20261102T080000Z", "DTEND:20261102T100000Z",
                       "END:VEVENT", "END:VCALENDAR", ""])
    client.app.dependency_overrides[get_fetcher] = lambda: (lambda sem: ics)
    assert client.post("/api/sync", headers={"X-Cron-Secret": "cron-secret"}).json()["status"] == "ok"


def test_short_token_is_422_and_never_echoed(client, settings, semester):
    configure(client, settings, FakeCalendar())
    response = client.post("/api/google/connect", headers=AUTH, json={"refresh_token": "1//short"})
    assert response.status_code == 422 and "1//short" not in response.text


def test_connect_clears_last_push_error_and_disconnect_revokes(client, settings, session, semester):
    from app.models import GoogleAccount
    fake = FakeCalendar()
    revoked = []
    fake.revoke = lambda: revoked.append(True)
    configure(client, settings, fake)
    connect(client)
    session.get(GoogleAccount, 1).last_push_error = "old"
    session.commit()
    connect(client)
    session.expire_all()
    assert session.get(GoogleAccount, 1).last_push_error is None
    client.delete("/api/google", headers=AUTH)
    assert revoked == [True]


def test_connect_records_granted_scopes_and_status_shows_drive(client, settings, session, semester):
    scopes = {"https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/calendar.app.created"}
    configure(client, settings, FakeCalendar(scopes=scopes))
    body = connect(client).json()
    assert body["drive_enabled"] is True
    assert session.get(GoogleAccount, 1).scopes == " ".join(sorted(scopes))
    assert client.get("/api/google", headers=AUTH).json()["drive_enabled"] is True


def test_connect_without_drive_scope_or_with_tokeninfo_error(client, settings, session, semester):
    configure(client, settings, FakeCalendar(scopes={"https://www.googleapis.com/auth/calendar.app.created"}))
    assert connect(client).json()["drive_enabled"] is False
    configure(client, settings, FakeCalendar(fail={"granted_scopes": [GoogleError("Could not reach Google")]}))
    body = connect(client)
    assert body.status_code == 200 and body.json()["drive_enabled"] is False
    session.expire_all()
    assert session.get(GoogleAccount, 1).scopes == ""


def test_reconnect_keeps_the_calendar_and_refreshes_scopes(client, settings, session, semester):
    calendar = "https://www.googleapis.com/auth/calendar.app.created"
    drive_scope = "https://www.googleapis.com/auth/drive.file"
    first = FakeCalendar(scopes={calendar})
    configure(client, settings, first)
    assert connect(client).json()["drive_enabled"] is False
    calendar_id = session.get(GoogleAccount, 1).calendar_id
    second = FakeCalendar(scopes={calendar, drive_scope})
    configure(client, settings, second)
    assert connect(client).json()["drive_enabled"] is True
    session.expire_all()
    account = session.get(GoogleAccount, 1)
    assert account.calendar_id == calendar_id and calendar_id
    assert drive_scope in account.scopes.split()
    assert not any(c[0] == "create_calendar" for c in second.calls)


def test_reconnect_after_disconnect_reuses_the_calendar(client, settings, session, semester):
    fake = FakeCalendar()
    configure(client, settings, fake)
    seed(session, semester)
    connect(client)
    client.post("/api/google/push", headers=AUTH)
    client.delete("/api/google", headers=AUTH)
    session.expire_all()
    assert session.get(AppSetting, "gcal_last_calendar_id").value == "cal1"
    assert connect(client).status_code == 200
    session.expire_all()
    assert session.get(GoogleAccount, 1).calendar_id == "cal1"
    assert fake.calendars == {"cal1": "My Timetable"}
    assert [c for c in fake.calls if c[0] == "create_calendar"] == [("create_calendar", "cal1")]
    result = client.post("/api/google/push", headers=AUTH).json()
    assert (result["status"], result["done"]) == ("ok", 2)
    assert len(fake.events) == 2  # the sweep removed the copies from before the disconnect


def test_reconnect_with_a_gone_calendar_recreates_it(client, settings, session, semester):
    configure(client, settings, FakeCalendar())
    seed(session, semester)
    connect(client)
    client.delete("/api/google", headers=AUTH)
    fresh = FakeCalendar()  # the old calendar no longer exists in Google
    configure(client, settings, fresh)
    connect(client)
    assert client.post("/api/google/push", headers=AUTH).json()["status"] == "failed"
    result = client.post("/api/google/push", headers=AUTH).json()
    assert (result["status"], result["done"]) == ("ok", 2)
    assert len(fresh.calendars) == 1 and len(fresh.events) == 2
