from datetime import datetime

from sqlalchemy import select

from app.models import Event, Note
from tests.conftest import AUTH

ONE_OFF = {"title": "Work shift", "kind": "work", "start": "2026-10-21T10:00:00Z",
           "end": "2026-10-21T14:00:00Z", "room": "Café"}
WEEKLY = {"title": "French (external)", "kind": "french_ext", "weekdays": [0, 3], "start_time": "19:30",
          "end_time": "21:00", "from_date": "2026-10-19", "until_date": "2026-11-01", "location": "Alliance"}


def test_create_one_off_event_shows_in_week(client, semester):
    resp = client.post("/api/events", headers=AUTH, json=ONE_OFF)
    assert resp.status_code == 201
    created = resp.json()
    assert (created["source"], created["kind"], created["title"], created["room"]) == ("custom", "work", "Work shift", "Café")
    events = client.get("/api/events?start=2026-10-18T22:00:00Z&end=2026-10-25T23:00:00Z", headers=AUTH).json()["events"]
    assert [e["id"] for e in events] == [created["id"]]


def test_create_validates_times_and_semester(client, session):
    from app.models import Semester

    assert client.post("/api/events", headers=AUTH, json=ONE_OFF).status_code == 409  # no active semester yet
    session.add(Semester(code="S1", name="SE S1", is_active=True))
    session.commit()
    assert client.post("/api/events", headers=AUTH, json={**ONE_OFF, "end": "2026-10-21T09:00:00Z"}).status_code == 422
    assert client.post("/api/events", headers=AUTH, json={**ONE_OFF, "end": "2026-10-23T10:00:00Z"}).status_code == 422
    assert client.post("/api/events", headers=AUTH, json={**ONE_OFF, "kind": "class"}).status_code == 422


def test_update_and_delete_custom_event(client, session, semester):
    created = client.post("/api/events", headers=AUTH, json=ONE_OFF).json()
    updated = client.put(f"/api/events/{created['id']}", headers=AUTH,
                         json={**ONE_OFF, "title": "Long shift", "end": "2026-10-21T16:00:00Z"}).json()
    assert (updated["title"], updated["end"]) == ("Long shift", "2026-10-21T16:00:00Z")
    client.put(f"/api/events/{created['id']}/notes/after", headers=AUTH, json={"body": "[ ] Return keys"})
    assert client.delete(f"/api/events/{created['id']}", headers=AUTH).json() == {"deleted": True}
    assert session.scalar(select(Event)) is None
    assert session.scalar(select(Note)) is None


def test_school_events_cannot_be_edited_or_deleted(client, session, semester):
    school = Event(source="zeus", zeus_uid="z1", semester_id=semester.id, title_raw="Harmonization",
                   start_at=datetime(2026, 10, 20, 7, 0), end_at=datetime(2026, 10, 20, 10, 0), kind="class")
    session.add(school)
    session.commit()
    assert client.put(f"/api/events/{school.id}", headers=AUTH, json=ONE_OFF).status_code == 400
    assert client.delete(f"/api/events/{school.id}", headers=AUTH).status_code == 400
    assert client.delete("/api/events/999", headers=AUTH).status_code == 404


def test_weekly_rule_crud(client, session, semester):
    resp = client.post("/api/recurring", headers=AUTH, json=WEEKLY)
    assert resp.status_code == 201
    rule = resp.json()
    assert (rule["weekdays"], rule["occurrences"]) == ([0, 3], 4)  # Mon 19, Thu 22, Mon 26, Thu 29 Oct
    assert [r["id"] for r in client.get("/api/recurring", headers=AUTH).json()] == [rule["id"]]

    changed = client.put(f"/api/recurring/{rule['id']}", headers=AUTH, json={**WEEKLY, "weekdays": [0]}).json()
    assert changed["occurrences"] == 2

    assert client.delete(f"/api/recurring/{rule['id']}", headers=AUTH).json() == {"deleted": True}
    assert client.get("/api/recurring", headers=AUTH).json() == []
    assert session.scalars(select(Event)).all() == []
    assert client.delete(f"/api/recurring/{rule['id']}", headers=AUTH).status_code == 404


def test_weekly_rule_validation(client, semester):
    for bad in ({**WEEKLY, "weekdays": []}, {**WEEKLY, "weekdays": [7]}, {**WEEKLY, "start_time": "25:00"},
                {**WEEKLY, "end_time": "19:30"}, {**WEEKLY, "until_date": "2026-10-01"},
                {**WEEKLY, "until_date": "2028-01-01"}):
        assert client.post("/api/recurring", headers=AUTH, json=bad).status_code == 422, bad


def test_blank_titles_are_rejected(client, semester):
    assert client.post("/api/events", headers=AUTH, json={**ONE_OFF, "title": "   "}).status_code == 422
    assert client.post("/api/recurring", headers=AUTH, json={**WEEKLY, "title": "   "}).status_code == 422


def test_noted_occurrence_survives_rule_edit_and_delete(client, session, semester):
    rule = client.post("/api/recurring", headers=AUTH, json=WEEKLY).json()
    events = client.get("/api/events?start=2026-10-18T22:00:00Z&end=2026-11-01T23:00:00Z", headers=AUTH).json()["events"]
    by_day = {e["start"][:10]: e["id"] for e in events if e["start"][:10] in ("2026-10-19", "2026-10-26")}
    monday_19, monday_26 = by_day["2026-10-19"], by_day["2026-10-26"]
    assert client.put(f"/api/events/{monday_26}/notes/after", headers=AUTH, json={"body": "[ ] homework"}).status_code == 200

    # Thursdays only: un-noted Monday 19 goes away, noted Monday 26 is kept
    assert client.put(f"/api/recurring/{rule['id']}", headers=AUTH, json={**WEEKLY, "weekdays": [3]}).status_code == 200
    assert client.get(f"/api/events/{monday_26}", headers=AUTH).status_code == 200
    assert client.get(f"/api/events/{monday_19}", headers=AUTH).status_code == 404

    assert client.delete(f"/api/recurring/{rule['id']}", headers=AUTH).json() == {"deleted": True}
    detail = client.get(f"/api/events/{monday_26}", headers=AUTH)
    assert detail.status_code == 200
    assert detail.json()["recurring_rule_id"] is None
