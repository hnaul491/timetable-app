from datetime import date, datetime

from app.models import Document, Event, Note, Semester, Subject, Task
from tests.conftest import AUTH, NOW


def make_event(session, semester, title, start, subject=None, room="", status="normal"):
    event = Event(source="zeus", zeus_uid=f"{title}-{start}", semester_id=semester.id,
                  subject_id=subject.id if subject else None, title_raw=title, start_at=start,
                  end_at=start.replace(hour=start.hour + 1), room=room, kind="class", status=status)
    session.add(event)
    session.flush()
    return event


def make_subject(session, semester, name, aliases=(), hidden=False):
    subject = Subject(semester_id=semester.id, display_name=name, aliases=list(aliases), hidden=hidden)
    session.add(subject)
    session.flush()
    return subject


def search(client, q, **params):
    return client.get("/api/search", headers=AUTH, params={"q": q, **params})


def test_requires_auth_and_valid_length(client, semester):
    assert client.get("/api/search?q=abc").status_code == 401
    assert search(client, "a").status_code == 422
    assert search(client, "x" * 101).status_code == 422
    assert search(client, "  a ").status_code == 422
    assert search(client, "ab").status_code == 200
    assert search(client, "ab", limit=0).status_code == 422
    assert search(client, "ab", limit=51).status_code == 422


def test_empty_groups(client, semester):
    assert search(client, "nothing").json() == {
        "events": [], "subjects": [], "notes": [], "tasks": [], "documents": []}


def test_events_by_title_room_and_subject_ordered_by_closeness(client, session, semester):
    py = make_subject(session, semester, "Python Programming")
    past = make_event(session, semester, "Algo lecture", datetime(2026, 10, 10, 8, 0), room="Room Python")
    old = make_event(session, semester, "Python lab", datetime(2026, 9, 1, 8, 0))
    soon = make_event(session, semester, "ZZ", datetime(2026, 10, 16, 8, 0), subject=py, status="cancelled")
    later = make_event(session, semester, "PYTHON exam", datetime(2026, 11, 20, 8, 0))
    make_event(session, semester, "Unrelated", datetime(2026, 10, 17, 8, 0))
    session.commit()
    events = search(client, "python").json()["events"]
    assert [e["id"] for e in events] == [soon.id, later.id, past.id, old.id]
    assert events[0]["cancelled"] is True and events[1]["cancelled"] is False
    assert events[2]["room"] == "Room Python"
    assert events[0]["start"] == "2026-10-16T08:00:00Z" and "end" in events[0]
    assert len(search(client, "python", limit=2).json()["events"]) == 2


def test_subjects_by_name_and_alias_skip_hidden(client, session, semester):
    a = make_subject(session, semester, "Databases", aliases=["SQL basics"])
    make_subject(session, semester, "Hidden SQL", hidden=True)
    make_subject(session, semester, "Networks")
    session.commit()
    assert search(client, "sql").json()["subjects"] == [{"id": a.id, "name": "Databases"}]
    assert [s["name"] for s in search(client, "DATAB").json()["subjects"]] == ["Databases"]


def test_notes_snippet_around_match(client, session, semester):
    event = make_event(session, semester, "Algo", datetime(2026, 10, 16, 8, 0))
    body = "x" * 100 + " Remember the Pigeonhole principle " + "y" * 100
    session.add(Note(event_id=event.id, tab="after", body=body, updated_at=NOW))
    session.commit()
    notes = search(client, "pigeonhole").json()["notes"]
    assert len(notes) == 1
    assert (notes[0]["event_id"], notes[0]["event_title"]) == (event.id, "Algo")
    assert "Pigeonhole" in notes[0]["snippet"] and len(notes[0]["snippet"]) <= 100


def test_tasks(client, session, semester):
    event = make_event(session, semester, "Algo", datetime(2026, 10, 16, 8, 0))
    hidden = make_subject(session, semester, "Gone", hidden=True)
    session.add_all([
        Task(event_id=event.id, title="Read chapter", status="done", due_date=date(2026, 10, 20),
             source="manual", created_at=NOW),
        Task(title="Read blog", status="todo", source="manual", created_at=NOW),
        Task(subject_id=hidden.id, title="Read hidden", status="todo", source="manual", created_at=NOW),
    ])
    session.commit()
    tasks = {t["title"]: t for t in search(client, "read").json()["tasks"]}
    assert set(tasks) == {"Read chapter", "Read blog"}
    assert tasks["Read chapter"]["done"] is True and tasks["Read chapter"]["due"] == "2026-10-20"
    assert tasks["Read chapter"]["event_id"] == event.id
    assert tasks["Read blog"]["done"] is False and tasks["Read blog"]["event_id"] is None


def test_documents(client, session, semester):
    subject = make_subject(session, semester, "Databases")
    session.add(Document(subject_id=subject.id, drive_file_id="f1", name="Lecture slides.pdf",
                         mime_type="application/pdf", size=1, tag="slides", web_view_link="https://drive/x",
                         created_at=NOW))
    session.commit()
    docs = search(client, "SLIDES").json()["documents"]
    assert docs == [{"id": docs[0]["id"], "name": "Lecture slides.pdf", "subject_id": subject.id,
                     "web_view_link": "https://drive/x"}]


def test_wildcards_match_literally(client, session, semester):
    make_event(session, semester, "100% effort", datetime(2026, 10, 16, 8, 0))
    make_event(session, semester, "1000 things", datetime(2026, 10, 16, 9, 0))
    make_event(session, semester, "snake_case", datetime(2026, 10, 16, 10, 0))
    make_event(session, semester, "snakeXcase", datetime(2026, 10, 16, 11, 0))
    session.commit()
    assert [e["title"] for e in search(client, "0%").json()["events"]] == ["100% effort"]
    assert [e["title"] for e in search(client, "e_c").json()["events"]] == ["snake_case"]


def test_semester_scoping(client, session, semester):
    other = Semester(code="S0", name="Old", is_active=False)
    session.add(other)
    session.flush()
    old_subject = make_subject(session, other, "Quantum Old")
    ev = make_event(session, other, "Quantum class", datetime(2026, 10, 16, 8, 0), subject=old_subject)
    session.add(Note(event_id=ev.id, tab="after", body="quantum note", updated_at=NOW))
    session.add(Task(event_id=ev.id, title="quantum task", source="manual", created_at=NOW))
    session.commit()
    assert search(client, "quantum").json() == {
        "events": [], "subjects": [], "notes": [], "tasks": [], "documents": []}


def test_no_active_semester(client, session):
    assert search(client, "anything").json()["events"] == []


def test_section_visibility_follows_the_calendar(client, session, semester):
    from app.models import MySection
    sub = make_subject(session, semester, "Physics")
    other = make_subject(session, semester, "Chemistry")
    mine = make_event(session, semester, "Quark A", datetime(2026, 10, 16, 8, 0), subject=sub)
    mine.section = "A"
    theirs = make_event(session, semester, "Quark B", datetime(2026, 10, 17, 8, 0), subject=sub)
    theirs.section = "B"
    unchosen = make_event(session, semester, "Quark C", datetime(2026, 10, 18, 8, 0), subject=other)
    unchosen.section = "C"
    plain = make_event(session, semester, "Quark plain", datetime(2026, 10, 19, 8, 0))
    session.add(MySection(subject_id=sub.id, section="A"))
    for ev in (mine, theirs, unchosen):
        session.add(Note(event_id=ev.id, tab="after", body="quark note", updated_at=NOW))
        session.add(Task(event_id=ev.id, title="quark task", source="manual", created_at=NOW))
        session.add(Document(subject_id=ev.subject_id, event_id=ev.id, drive_file_id=f"d{ev.id}",
                             name="quark doc", mime_type="x", size=1, tag="t", created_at=NOW))
    session.commit()
    body = search(client, "quark").json()
    assert {e["id"] for e in body["events"]} == {mine.id, plain.id}
    assert [n["event_id"] for n in body["notes"]] == [mine.id]
    assert [t["event_id"] for t in body["tasks"]] == [mine.id]
    assert len(body["documents"]) == 1
    assert "id" in body["notes"][0]


def test_hidden_subject_events_notes_documents_tasks(client, session, semester):
    hidden = make_subject(session, semester, "Secret", hidden=True)
    ev = make_event(session, semester, "Zebra class", datetime(2026, 10, 16, 8, 0), subject=hidden)
    session.add(Note(event_id=ev.id, tab="after", body="zebra note", updated_at=NOW))
    session.add(Task(event_id=ev.id, title="zebra task", source="manual", created_at=NOW))
    session.add(Document(subject_id=hidden.id, drive_file_id="h1", name="zebra doc", mime_type="x", size=1,
                         tag="t", created_at=NOW))
    session.commit()
    assert search(client, "zebra").json() == {
        "events": [], "subjects": [], "notes": [], "tasks": [], "documents": []}


def test_event_in_progress_counts_as_upcoming_and_past_fills_up(client, session, semester):
    running = make_event(session, semester, "Lab run", datetime(2026, 10, 15, 11, 30))  # ends 12:30, NOW 12:00
    old1 = make_event(session, semester, "Lab old1", datetime(2026, 10, 1, 8, 0))
    old2 = make_event(session, semester, "Lab old2", datetime(2026, 10, 2, 8, 0))
    soon = make_event(session, semester, "Lab soon", datetime(2026, 10, 20, 8, 0))
    session.commit()
    ids = [e["id"] for e in search(client, "lab", limit=3).json()["events"]]
    assert ids == [running.id, soon.id, old2.id]
    assert [e["id"] for e in search(client, "lab", limit=10).json()["events"]] == [
        running.id, soon.id, old2.id, old1.id]


def test_event_title_raw_returned_when_it_differs(client, session, semester):
    sub = make_subject(session, semester, "Databases")
    make_event(session, semester, "CM INF-DB groupe 3", datetime(2026, 10, 16, 8, 0), subject=sub)
    session.commit()
    ev = search(client, "groupe").json()["events"][0]
    assert ev["title"] == "Databases" and ev["title_raw"] == "CM INF-DB groupe 3"
