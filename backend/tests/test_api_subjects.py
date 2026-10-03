from datetime import datetime

from sqlalchemy import select

from datetime import date

from app.models import Event, MySection, Note, Semester, Subject, Task
from tests.conftest import AUTH

T = datetime(2026, 10, 15, 12, 0)  # conftest NOW


def ev(session, semester, subject, uid, start, kind="class", section=None, status="normal", room="KB602"):
    e = Event(source="zeus", zeus_uid=uid, semester_id=semester.id, subject_id=subject.id, section=section,
              title_raw=uid, start_at=start, end_at=start.replace(hour=start.hour + 2), room=room, kind=kind, status=status)
    session.add(e)
    session.flush()
    return e


def seed(session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[], color="#2E55E6")
    fr = Subject(semester_id=semester.id, display_name="French for Fall 26 T1", aliases=[], color="#0E7F72")
    spring = Subject(semester_id=semester.id, display_name="French for Spring F26 T1", aliases=[], color="#6A45D8")
    session.add_all([db, fr, spring])
    session.flush()
    past = ev(session, semester, db, "db1", datetime(2026, 10, 12, 11))
    ev(session, semester, db, "db2", datetime(2026, 11, 9, 12))
    ev(session, semester, db, "db3", datetime(2026, 11, 16, 12), status="cancelled")
    ev(session, semester, db, "dbx", datetime(2027, 1, 26, 8), kind="exam", room="KB003 (amphi 3)")
    ev(session, semester, fr, "f5", datetime(2026, 10, 20, 12), section="GR5")
    ev(session, semester, fr, "f1", datetime(2026, 10, 20, 12), section="GR1")
    sp = ev(session, semester, spring, "s2", datetime(2026, 10, 21, 12), section="GR2")
    session.add(MySection(subject_id=fr.id, section="GR5"))
    session.add(Note(event_id=past.id, tab="after", body="Covered ER diagrams " + "y" * 200, important=True, updated_at=T))
    session.add(Task(subject_id=db.id, event_id=past.id, title="Draw ER diagram", status="todo", source="manual", created_at=T))
    session.add(Task(subject_id=spring.id, title="Spring vocab", status="todo", source="manual", created_at=T))
    session.commit()
    return db, fr, spring, sp


def test_requires_login(client, semester):
    assert client.get("/api/subjects").status_code == 401


def test_list_counts(client, session, semester):
    db, fr, spring, _ = seed(session, semester)
    rows = {r["display_name"]: r for r in client.get("/api/subjects", headers=AUTH).json()}
    assert list(rows) == ["French for Fall 26 T1", "French for Spring F26 T1", "Relational Databases"]
    r = rows["Relational Databases"]
    assert (r["sessions"], r["sessions_done"], r["open_tasks"], r["note_count"]) == (3, 1, 1, 1)
    assert r["next_start"] == "2026-11-09T12:00:00Z"
    assert (r["exam_start"], r["exam_room"]) == ("2027-01-26T08:00:00Z", "KB003 (amphi 3)")
    assert rows["French for Fall 26 T1"]["sessions"] == 1  # only my group GR5
    assert rows["French for Spring F26 T1"]["sessions"] == 0  # group not chosen yet


def test_detail_has_sessions_snippets_and_tasks(client, session, semester):
    db, *_ = seed(session, semester)
    body = client.get(f"/api/subjects/{db.id}", headers=AUTH).json()
    assert body["subject"]["display_name"] == "Relational Databases"
    assert [s["start"] for s in body["sessions"]] == [
        "2026-10-12T11:00:00Z", "2026-11-09T12:00:00Z", "2026-11-16T12:00:00Z", "2027-01-26T08:00:00Z"]
    first = body["sessions"][0]
    assert first["note_snippet"].startswith("Covered ER diagrams") and len(first["note_snippet"]) == 160
    assert (first["note_count"], first["important"]) == (1, True)
    assert body["sessions"][2]["status"] == "cancelled"
    assert [t["title"] for t in body["tasks"]] == ["Draw ER diagram"]
    assert client.get("/api/subjects/999", headers=AUTH).status_code == 404


def test_patch_rename_colour_hide(client, session, semester):
    db, fr, *_ = seed(session, semester)
    r = client.patch(f"/api/subjects/{db.id}", headers=AUTH,
                     json={"display_name": "  Databases ", "color": "#AA00FF", "hidden": True}).json()
    assert (r["display_name"], r["color"], r["hidden"], r["sessions"]) == ("Databases", "#AA00FF", True, 0)
    assert client.patch(f"/api/subjects/{db.id}", headers=AUTH, json={"display_name": "french for fall 26 t1"}).status_code == 409
    assert client.patch(f"/api/subjects/{db.id}", headers=AUTH, json={"color": "blue"}).status_code == 422
    assert client.patch(f"/api/subjects/{db.id}", headers=AUTH, json={"display_name": "   "}).status_code == 422


def test_merge_moves_events_tasks_and_names(client, session, semester):
    db, fr, spring, spring_event = seed(session, semester)
    spring_id, spring_event_id = spring.id, spring_event.id
    resp = client.post(f"/api/subjects/{spring.id}/merge", headers=AUTH, json={"into_id": fr.id})
    assert resp.status_code == 200
    merged = resp.json()
    assert merged["display_name"] == "French for Fall 26 T1"
    assert merged["aliases"] == ["French for Spring F26 T1"]
    session.expire_all()
    assert session.get(Subject, spring_id) is None
    assert session.get(Event, spring_event_id).subject_id == fr.id
    assert session.scalar(select(Task).where(Task.title == "Spring vocab")).subject_id == fr.id
    assert session.get(MySection, fr.id).section == "GR5"


def test_merge_validation(client, session, semester):
    db, fr, *_ = seed(session, semester)
    assert client.post(f"/api/subjects/{db.id}/merge", headers=AUTH, json={"into_id": db.id}).status_code == 422
    assert client.post(f"/api/subjects/{db.id}/merge", headers=AUTH, json={"into_id": 999}).status_code == 404


def test_merge_keeps_target_group_choice(client, session, semester):
    db, fr, spring, _ = seed(session, semester)
    session.add(MySection(subject_id=spring.id, section="GR2"))
    session.commit()
    fr_id, spring_id = fr.id, spring.id
    assert client.post(f"/api/subjects/{spring_id}/merge", headers=AUTH, json={"into_id": fr_id}).status_code == 200
    session.expire_all()
    assert session.get(MySection, fr_id).section == "GR5"
    assert session.get(MySection, spring_id) is None


def test_merge_moves_source_group_choice_when_target_has_none(client, session, semester):
    db, fr, spring, _ = seed(session, semester)
    session.delete(session.get(MySection, fr.id))
    session.add(MySection(subject_id=spring.id, section="GR2"))
    session.commit()
    fr_id, spring_id = fr.id, spring.id
    assert client.post(f"/api/subjects/{spring_id}/merge", headers=AUTH, json={"into_id": fr_id}).status_code == 200
    session.expire_all()
    assert session.get(MySection, fr_id).section == "GR2"
    assert session.get(MySection, spring_id) is None


def test_merge_into_other_semester_rejected(client, session, semester):
    db, *_ = seed(session, semester)
    other = Semester(code="S2", name="Other", start_date=date(2027, 2, 1), end_date=date(2027, 6, 1), is_active=False)
    session.add(other)
    session.flush()
    foreign = Subject(semester_id=other.id, display_name="Elsewhere", aliases=[], color="#2E55E6")
    session.add(foreign)
    session.commit()
    assert client.post(f"/api/subjects/{db.id}/merge", headers=AUTH, json={"into_id": foreign.id}).status_code == 422
