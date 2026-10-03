from datetime import datetime

from app.models import Event, MySection, Subject
from tests.conftest import AUTH

WEEK = "start=2026-10-18T22:00:00Z&end=2026-10-25T23:00:00Z"


def seed(session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[], color="#2E55E6")
    session.add(db)
    session.flush()
    first = Event(source="zeus", zeus_uid="db1", semester_id=semester.id, subject_id=db.id,
                  title_raw="Relational Databases", start_at=datetime(2026, 10, 19, 11, 0),
                  end_at=datetime(2026, 10, 19, 13, 0), room="KB602", kind="class")
    second = Event(source="zeus", zeus_uid="db2", semester_id=semester.id, subject_id=db.id,
                   title_raw="Relational Databases", start_at=datetime(2026, 11, 9, 12, 0),
                   end_at=datetime(2026, 11, 9, 14, 0), room="KB602", kind="class")
    session.add_all([first, second])
    session.commit()
    return first, second


def test_requires_login(client, session, semester):
    first, _ = seed(session, semester)
    assert client.get(f"/api/events/{first.id}").status_code == 401


def test_detail_of_unknown_event_is_404(client, semester):
    assert client.get("/api/events/999", headers=AUTH).status_code == 404


def test_detail_has_empty_notes_and_next_class(client, session, semester):
    first, second = seed(session, semester)
    body = client.get(f"/api/events/{first.id}", headers=AUTH).json()
    assert body["event"]["title"] == "Relational Databases"
    assert body["notes"]["after"] == {"tab": "after", "body": "", "important": False, "updated_at": None}
    assert body["notes"]["before"]["body"] == ""
    assert body["tasks"] == []
    assert (body["next_event_id"], body["next_event_start"]) == (second.id, "2026-11-09T12:00:00Z")


def test_save_note_creates_tasks_and_counts_show_in_week(client, session, semester):
    first, _ = seed(session, semester)
    resp = client.put(f"/api/events/{first.id}/notes/after", headers=AUTH,
                      json={"body": "Covered ER\n[ ] Redo ex 3 @2026-10-22\n[x] Install Postgres", "important": True})
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["notes"]["after"]["important"] is True
    assert detail["notes"]["after"]["updated_at"] == "2026-10-15T12:00:00Z"
    assert [(t["title"], t["status"], t["due_date"], t["subject_name"]) for t in detail["tasks"]] == [
        ("Redo ex 3", "todo", "2026-10-22", "Relational Databases"),
        ("Install Postgres", "done", None, "Relational Databases"),
    ]
    [event] = client.get(f"/api/events?{WEEK}", headers=AUTH).json()["events"]
    assert (event["note_count"], event["open_tasks"], event["important"]) == (1, 1, True)


def test_removing_a_line_removes_its_task(client, session, semester):
    first, _ = seed(session, semester)
    client.put(f"/api/events/{first.id}/notes/after", headers=AUTH, json={"body": "[ ] A\n[ ] B"})
    detail = client.put(f"/api/events/{first.id}/notes/after", headers=AUTH, json={"body": "[ ] B"}).json()
    assert [t["title"] for t in detail["tasks"]] == ["B"]


def test_invalid_tab_is_422(client, session, semester):
    first, _ = seed(session, semester)
    assert client.put(f"/api/events/{first.id}/notes/during", headers=AUTH, json={"body": "x"}).status_code == 422


def test_next_class_respects_section(client, session, semester):
    french = Subject(semester_id=semester.id, display_name="French for Fall 26 T1", aliases=[])
    session.add(french)
    session.flush()
    mine = Event(source="zeus", zeus_uid="f1", semester_id=semester.id, subject_id=french.id, section="GR5",
                 title_raw="GR5 - French", start_at=datetime(2026, 10, 20, 12, 30), end_at=datetime(2026, 10, 20, 14, 30), kind="class")
    other = Event(source="zeus", zeus_uid="f2", semester_id=semester.id, subject_id=french.id, section="GR1",
                  title_raw="GR1 - French", start_at=datetime(2026, 10, 21, 12, 30), end_at=datetime(2026, 10, 21, 14, 30), kind="class")
    next_mine = Event(source="zeus", zeus_uid="f3", semester_id=semester.id, subject_id=french.id, section="GR5",
                      title_raw="GR5 - French", start_at=datetime(2026, 10, 22, 12, 30), end_at=datetime(2026, 10, 22, 14, 30), kind="class")
    session.add_all([mine, other, next_mine, MySection(subject_id=french.id, section="GR5")])
    session.commit()
    assert client.get(f"/api/events/{mine.id}", headers=AUTH).json()["next_event_id"] == next_mine.id


def test_star_marks_a_class_important_without_any_note_text(client, session, semester):
    first, _ = seed(session, semester)
    detail = client.put(f"/api/events/{first.id}/important", headers=AUTH, json={"important": True}).json()
    assert detail["event"]["important"] is True
    assert detail["notes"]["after"]["body"] == ""
    week = client.get(f"/api/events?{WEEK}", headers=AUTH).json()["events"]
    assert [(e["id"], e["important"], e["note_count"]) for e in week] == [(first.id, True, 0)]
    cleared = client.put(f"/api/events/{first.id}/important", headers=AUTH, json={"important": False}).json()
    assert cleared["event"]["important"] is False
    assert client.put("/api/events/999/important", headers=AUTH, json={"important": True}).status_code == 404


def test_saving_a_note_keeps_the_star(client, session, semester):
    first, _ = seed(session, semester)
    client.put(f"/api/events/{first.id}/important", headers=AUTH, json={"important": True})
    detail = client.put(f"/api/events/{first.id}/notes/after", headers=AUTH, json={"body": "Covered ER"}).json()
    assert (detail["event"]["important"], detail["notes"]["after"]["body"]) == (True, "Covered ER")
