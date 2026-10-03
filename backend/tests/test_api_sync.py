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


def test_non_ascii_cron_secret_is_401_not_500(client, semester):
    use_feed(client)
    resp = client.post("/api/sync", headers={"X-Cron-Secret": "é".encode("latin-1")})
    assert resp.status_code == 401


def test_partial_run_counts_as_last_success(client, session, semester):
    from datetime import datetime
    from app.models import SyncRun

    session.add(SyncRun(started_at=datetime(2026, 10, 15, 4), finished_at=datetime(2026, 10, 15, 4),
                        status="partial", fetched=5, inserted=0, updated=0, cancelled=0, skipped=0,
                        error="kept 15 upcoming classes that disappeared from the feed"))
    session.commit()
    body = client.get("/api/sync/status", headers=AUTH).json()
    assert body["last_run"]["status"] == "partial"
    assert body["last_success_at"] == "2026-10-15T04:00:00Z"
