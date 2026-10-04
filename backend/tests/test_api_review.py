from datetime import date, datetime

from app.models import Event, Note, Subject, Task
from app.services.review import default_week_start, paris_today
from tests.conftest import AUTH

T = datetime(2026, 10, 15, 12, 0)  # conftest NOW (Thursday)


def add(session, semester, uid, start, end, kind="class", source="zeus", subject=None, status="normal", changed=None):
    e = Event(source=source, zeus_uid=uid if source == "zeus" else None, semester_id=semester.id,
              subject_id=subject.id if subject else None, title_raw=uid, start_at=start, end_at=end,
              kind=kind, status=status, changed_at=changed)
    session.add(e)
    session.flush()
    return e


def test_paris_week_helpers():
    assert paris_today(datetime(2026, 10, 25, 22, 30)) == date(2026, 10, 25)  # 23:30 Paris (CET)
    assert paris_today(datetime(2026, 10, 25, 23, 30)) == date(2026, 10, 26)
    assert default_week_start(date(2026, 10, 17)) == date(2026, 10, 19)  # Saturday → next week
    assert default_week_start(date(2026, 10, 15)) == date(2026, 10, 12)  # Thursday → this week


def test_week_start_must_be_monday(client, semester):
    assert client.get("/api/review?week_start=2026-10-20", headers=AUTH).status_code == 422


def test_default_week_uses_today(client, semester):
    assert client.get("/api/review", headers=AUTH).json()["week_start"] == "2026-10-12"


def test_review_week_spans_dst_and_counts_hours(client, session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[])
    session.add(db)
    session.flush()
    add(session, semester, "mon", datetime(2026, 10, 19, 11), datetime(2026, 10, 19, 13), subject=db)
    add(session, semester, "sun-late", datetime(2026, 10, 25, 22, 30), datetime(2026, 10, 25, 23, 30), subject=db)  # Sun 23:30 CET → in week
    add(session, semester, "next-mon", datetime(2026, 10, 25, 23, 30), datetime(2026, 10, 26, 1, 0), subject=db)  # Mon 00:30 → next week
    add(session, semester, "work", datetime(2026, 10, 21, 10), datetime(2026, 10, 21, 14), kind="work", source="custom")
    add(session, semester, "hol", datetime(2026, 10, 22, 6), datetime(2026, 10, 22, 18), kind="holiday")
    session.commit()
    body = client.get("/api/review?week_start=2026-10-19", headers=AUTH).json()
    assert (body["week_start"], body["week_end"]) == ("2026-10-19", "2026-10-25")
    assert [e["title"] for e in body["week"]] == ["Relational Databases", "work", "hol", "Relational Databases"]
    assert body["hours"] == {"school": 3.0, "work": 4.0, "french_ext": 0.0, "other": 0.0}


def test_review_sections(client, session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[])
    session.add(db)
    session.flush()
    last_noted = add(session, semester, "a", datetime(2026, 10, 13, 7), datetime(2026, 10, 13, 9), subject=db)
    last_bare = add(session, semester, "b", datetime(2026, 10, 14, 7), datetime(2026, 10, 14, 9), subject=db)
    add(session, semester, "c", datetime(2026, 10, 14, 12), datetime(2026, 10, 14, 14), subject=db, status="cancelled")
    moved = add(session, semester, "d", datetime(2026, 10, 21, 7), datetime(2026, 10, 21, 9), subject=db,
                status="changed", changed=datetime(2026, 10, 15, 4))
    session.add(Note(event_id=last_noted.id, tab="after", body="Quiz next Thursday!", important=True, updated_at=T))
    session.add_all([
        Task(title="Old homework", status="todo", due_date=date(2026, 10, 14), source="manual", created_at=T),
        Task(title="Done thing", status="done", due_date=date(2026, 10, 14), source="manual", created_at=T),
        Task(title="Read ch. 4", status="doing", due_date=date(2026, 10, 22), source="manual", created_at=T),
        Task(title="Far future", status="todo", due_date=date(2026, 11, 30), source="manual", created_at=T),
    ])
    session.commit()
    body = client.get("/api/review?week_start=2026-10-19", headers=AUTH).json()
    assert [t["title"] for t in body["overdue"]] == ["Old homework"]
    assert [t["title"] for t in body["due_this_week"]] == ["Read ch. 4"]
    assert [(n["event_id"], n["body"]) for n in body["important"]] == [(last_noted.id, "Quiz next Thursday!")]
    assert [e["id"] for e in body["without_notes"]] == [last_bare.id]
    assert [(e["id"], e["status"]) for e in body["changes"]] == [(moved.id, "changed")]
    assert body["reviewed_at"] is None


def test_mark_week_reviewed(client, semester):
    first = client.post("/api/review/2026-10-19/done", headers=AUTH).json()
    assert first == {"week_start": "2026-10-19", "reviewed_at": "2026-10-15T12:00:00Z"}
    assert client.post("/api/review/2026-10-19/done", headers=AUTH).status_code == 200
    assert client.get("/api/review?week_start=2026-10-19", headers=AUTH).json()["reviewed_at"] == "2026-10-15T12:00:00Z"
    assert client.post("/api/review/2026-10-20/done", headers=AUTH).status_code == 422


def test_important_notes_skip_hidden_subjects(client, session, semester):
    hidden = Subject(semester_id=semester.id, display_name="GenAI 101", aliases=[], hidden=True)
    session.add(hidden)
    session.flush()
    event = add(session, semester, "g", datetime(2026, 10, 20, 7), datetime(2026, 10, 20, 9), subject=hidden)
    session.add(Note(event_id=event.id, tab="after", body="Secret", important=True, updated_at=T))
    session.commit()
    assert client.get("/api/review?week_start=2026-10-19", headers=AUTH).json()["important"] == []


def test_review_without_active_semester(client, session, semester):
    semester.is_active = False
    session.commit()
    body = client.get("/api/review?week_start=2026-10-19", headers=AUTH).json()
    assert (body["week"], body["important"], body["without_notes"]) == ([], [], [])
    assert body["hours"] == {"school": 0.0, "work": 0.0, "french_ext": 0.0, "other": 0.0}


def test_starred_class_without_text_is_in_important(client, session, semester):
    db = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[])
    session.add(db)
    session.flush()
    starred = add(session, semester, "s", datetime(2026, 10, 20, 7), datetime(2026, 10, 20, 9), subject=db)
    session.commit()
    client.put(f"/api/events/{starred.id}/important", headers=AUTH, json={"important": True})
    body = client.get("/api/review?week_start=2026-10-19", headers=AUTH).json()
    assert [(n["event_id"], n["body"]) for n in body["important"]] == [(starred.id, "")]


def test_review_marks_are_per_semester(client, session, semester):
    from app.models import Semester
    client.post("/api/review/2026-10-19/done", headers=AUTH)
    other = Semester(code="S2", name="Other", is_active=False)
    session.add(other)
    session.commit()
    semester.is_active = False
    other.is_active = True
    session.commit()
    assert client.get("/api/review?week_start=2026-10-19", headers=AUTH).json()["reviewed_at"] is None
    assert client.post("/api/review/2026-10-19/done", headers=AUTH).status_code == 200
    semester.is_active = True
    other.is_active = False
    session.commit()
    assert client.get("/api/review?week_start=2026-10-19", headers=AUTH).json()["reviewed_at"] == "2026-10-15T12:00:00Z"


def test_marking_a_week_needs_an_active_semester(client, session, semester):
    semester.is_active = False
    session.commit()
    assert client.post("/api/review/2026-10-19/done", headers=AUTH).status_code == 409
