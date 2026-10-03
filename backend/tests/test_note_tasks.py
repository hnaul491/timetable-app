from datetime import date, datetime

from sqlalchemy import select

from app.models import Event, Note, Subject, Task
from app.services.note_tasks import TaskLine, parse_task_lines, render_line, sync_note_tasks, update_line

T0 = datetime(2026, 10, 19, 15, 0)


def test_parse_task_lines():
    body = "\n".join([
        "Covered: ER diagrams",
        "[ ] Redo exercises 3-5",
        "  [x] Install PostgreSQL @2026-10-18",
        "[ ] Read chapter 4 @2026-10-22",
        "[ ] Bad date stays @2026-13-40",
        "[]  not a task",
        "[ ]   ",
    ])
    assert parse_task_lines(body) == [
        TaskLine("Redo exercises 3-5", False, None),
        TaskLine("Install PostgreSQL", True, date(2026, 10, 18)),
        TaskLine("Read chapter 4", False, date(2026, 10, 22)),
        TaskLine("Bad date stays @2026-13-40", False, None),
    ]


def test_render_and_update_line_keep_other_lines_and_crlf():
    assert render_line("Read", True, date(2026, 10, 22)) == "[x] Read @2026-10-22"
    body = "Intro\r\n  [ ] Read\r\n[ ] Read\r\nEnd"
    updated = update_line(body, "Read", True, None, occurrence=1)
    assert updated == "Intro\r\n  [ ] Read\r\n[x] Read\r\nEnd"
    assert update_line(body, "Missing", True, None) == body


def make_note(session, semester, body: str) -> tuple[Note, Event]:
    subject = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[])
    session.add(subject)
    session.flush()
    event = Event(source="zeus", zeus_uid="db1", semester_id=semester.id, subject_id=subject.id,
                  title_raw="Relational Databases", start_at=datetime(2026, 10, 19, 11, 0),
                  end_at=datetime(2026, 10, 19, 13, 0), kind="class")
    session.add(event)
    session.flush()
    note = Note(event_id=event.id, tab="after", body=body, important=True, updated_at=T0)
    session.add(note)
    session.flush()
    return note, event


def test_sync_creates_tasks_from_lines(session, semester):
    note, event = make_note(session, semester, "[ ] Redo ex 3 @2026-10-22\n[x] Install Postgres")
    tasks = sync_note_tasks(session, note, event, T0)
    assert [(t.title, t.status, t.due_date, t.position) for t in tasks] == [
        ("Redo ex 3", "todo", date(2026, 10, 22), 0),
        ("Install Postgres", "done", None, 1),
    ]
    assert all(t.subject_id == event.subject_id and t.event_id == event.id and t.important for t in tasks)
    assert all(t.source == "note" for t in tasks)


def test_sync_keeps_doing_status_and_deletes_removed_lines(session, semester):
    note, event = make_note(session, semester, "[ ] A\n[ ] B\n[x] C")
    a, b, c = sync_note_tasks(session, note, event, T0)
    b.status = "doing"
    note.body = "[ ] B\n[ ] C"
    tasks = sync_note_tasks(session, note, event, T0)
    assert [(t.id, t.title, t.status) for t in tasks] == [(b.id, "B", "doing"), (c.id, "C", "todo")]
    assert session.scalar(select(Task).where(Task.title == "A")) is None


def test_sync_handles_duplicate_titles(session, semester):
    note, event = make_note(session, semester, "[ ] Read\n[x] Read")
    first, second = sync_note_tasks(session, note, event, T0)
    assert (first.status, second.status) == ("todo", "done")
    note.body = "[x] Read"
    [only] = sync_note_tasks(session, note, event, T0)
    assert only.id == first.id and only.status == "done"
    assert len(session.scalars(select(Task)).all()) == 1
