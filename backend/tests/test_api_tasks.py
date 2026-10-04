from datetime import datetime

from app.models import Event, Note, Subject
from tests.conftest import AUTH


def class_with_note(client, session, semester, body: str) -> int:
    subject = Subject(semester_id=semester.id, display_name="Introduction to Python", aliases=[])
    session.add(subject)
    session.flush()
    event = Event(source="zeus", zeus_uid="py1", semester_id=semester.id, subject_id=subject.id,
                  title_raw="Introduction to Python", start_at=datetime(2026, 10, 21, 15, 0),
                  end_at=datetime(2026, 10, 21, 18, 0), kind="class")
    session.add(event)
    session.commit()
    client.put(f"/api/events/{event.id}/notes/after", headers=AUTH, json={"body": body})
    return event.id


def test_list_orders_by_due_date_then_position(client, session, semester):
    class_with_note(client, session, semester, "[ ] No date\n[ ] Later @2026-10-30\n[ ] Soon @2026-10-22")
    client.post("/api/tasks", headers=AUTH, json={"title": "Buy notebook", "due_date": "2026-10-25"})
    titles = [t["title"] for t in client.get("/api/tasks", headers=AUTH).json()]
    assert titles == ["Soon", "Buy notebook", "Later", "No date"]
    assert [t["title"] for t in client.get("/api/tasks?status=todo", headers=AUTH).json()] == titles
    assert client.get("/api/tasks?status=done", headers=AUTH).json() == []


def test_create_manual_task(client, semester):
    resp = client.post("/api/tasks", headers=AUTH, json={"title": "  Buy notebook  ", "important": True})
    assert resp.status_code == 201
    task = resp.json()
    assert (task["title"], task["source"], task["status"], task["important"], task["event_id"]) == (
        "Buy notebook", "manual", "todo", True, None)
    assert client.post("/api/tasks", headers=AUTH, json={"title": "x", "subject_id": 999}).status_code == 422


def test_status_change_writes_back_to_note(client, session, semester):
    event_id = class_with_note(client, session, semester, "Lab notes\n[ ] Set up venv\n[ ] Read PEP 8")
    venv = client.get("/api/tasks", headers=AUTH).json()[0]
    assert venv["title"] == "Set up venv"

    done = client.patch(f"/api/tasks/{venv['id']}", headers=AUTH, json={"status": "done"}).json()
    assert done["status"] == "done"
    note_body = client.get(f"/api/events/{event_id}", headers=AUTH).json()["notes"]["after"]["body"]
    assert note_body == "Lab notes\n[x] Set up venv\n[ ] Read PEP 8"

    # re-saving the note as shown keeps the task done
    client.put(f"/api/events/{event_id}/notes/after", headers=AUTH, json={"body": note_body})
    statuses = {t["title"]: t["status"] for t in client.get("/api/tasks", headers=AUTH).json()}
    assert statuses == {"Set up venv": "done", "Read PEP 8": "todo"}


def test_doing_and_due_date_write_back(client, session, semester):
    event_id = class_with_note(client, session, semester, "[ ] Read PEP 8")
    task = client.get("/api/tasks", headers=AUTH).json()[0]
    client.patch(f"/api/tasks/{task['id']}", headers=AUTH, json={"status": "doing", "due_date": "2026-10-24"})
    body = client.get(f"/api/events/{event_id}", headers=AUTH).json()["notes"]["after"]["body"]
    assert body == "[ ] Read PEP 8 @2026-10-24"
    cleared = client.patch(f"/api/tasks/{task['id']}", headers=AUTH, json={"due_date": None}).json()
    assert (cleared["status"], cleared["due_date"]) == ("doing", None)


def test_note_tasks_cannot_be_renamed_or_deleted(client, session, semester):
    class_with_note(client, session, semester, "[ ] Read PEP 8")
    task = client.get("/api/tasks", headers=AUTH).json()[0]
    assert client.patch(f"/api/tasks/{task['id']}", headers=AUTH, json={"title": "Other"}).status_code == 422
    assert client.delete(f"/api/tasks/{task['id']}", headers=AUTH).status_code == 400


def test_manual_task_rename_and_delete(client, semester):
    task = client.post("/api/tasks", headers=AUTH, json={"title": "Buy notebook"}).json()
    renamed = client.patch(f"/api/tasks/{task['id']}", headers=AUTH, json={"title": "Buy 2 notebooks"}).json()
    assert renamed["title"] == "Buy 2 notebooks"
    assert client.delete(f"/api/tasks/{task['id']}", headers=AUTH).json() == {"deleted": True}
    assert client.get("/api/tasks", headers=AUTH).json() == []
    assert client.patch("/api/tasks/999", headers=AUTH, json={"status": "done"}).status_code == 404


def test_whitespace_only_titles_rejected(client, semester):
    assert client.post("/api/tasks", headers=AUTH, json={"title": "   "}).status_code == 422
    task = client.post("/api/tasks", headers=AUTH, json={"title": "Buy notebook"}).json()
    assert client.patch(f"/api/tasks/{task['id']}", headers=AUTH, json={"title": "   "}).status_code == 422


def test_task_can_link_to_an_event_of_the_same_subject(client, session, semester):
    event_id = class_with_note(client, session, semester, "")
    event = session.get(Event, event_id)
    other = Subject(semester_id=semester.id, display_name="Other", aliases=[])
    session.add(other)
    session.commit()
    ok = client.post("/api/tasks", headers=AUTH, json={"title": "Prep", "event_id": event_id})
    assert ok.status_code == 201
    assert (ok.json()["event_id"], ok.json()["subject_id"], ok.json()["source"]) == (event_id, event.subject_id, "manual")
    same = client.post("/api/tasks", headers=AUTH, json={"title": "Prep", "event_id": event_id,
                                                         "subject_id": event.subject_id})
    assert same.status_code == 201
    assert client.post("/api/tasks", headers=AUTH, json={"title": "x", "event_id": event_id,
                                                          "subject_id": other.id}).status_code == 422
    assert client.post("/api/tasks", headers=AUTH, json={"title": "x", "event_id": 9999}).status_code == 422
