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


def test_all_groups_choice_shows_every_section(client, session, semester):
    seed_french(session, semester, choose="ALL")
    body = client.get(f"/api/events?{WEEK}", headers=AUTH).json()
    sections = sorted(str(e["section"]) for e in body["events"])
    assert sections == ["GR1", "GR5", "None"]
    assert body["missing_sections"] == []
