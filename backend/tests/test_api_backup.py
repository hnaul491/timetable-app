import json
from datetime import date, datetime, timedelta

import pytest

from app.deps import get_now
from app.gcal.api import GoogleError
from app.models import (AppSecret, AppSetting, ChatMessage, Document, DocumentUpload, Event, MySection, Note,
                        PendingAction, RecurringRule, Subject, Task, WeekReview)
from app.services import backup as backup_service
from tests.conftest import AUTH, NOW
from tests.gdrive_fakes import FakeDrive
from tests.test_api_sync import use_feed
from tests.test_api_documents import configure

CRON = {"X-Cron-Secret": "cron-secret"}
SECRET = "SUPER-SECRET-VALUE-XYZ"
SESSION_URI = "https://upload.example/SECRET-SESSION-URI"


@pytest.fixture
def seeded(session, semester):
    subject = Subject(semester_id=semester.id, display_name="Databases", aliases=["DB"], color="#2E55E6")
    session.add(subject)
    session.flush()
    session.add(MySection(subject_id=subject.id, section="B"))
    zeus = Event(source="zeus", zeus_uid="u1", semester_id=semester.id, subject_id=subject.id, title_raw="Class",
                 start_at=datetime(2026, 10, 19, 9), end_at=datetime(2026, 10, 19, 11), kind="class",
                 gcal_event_id="gcal-id-1", gcal_hash="h")
    custom = Event(source="custom", semester_id=semester.id, title_raw="Gym", start_at=datetime(2026, 10, 20, 9),
                   end_at=datetime(2026, 10, 20, 10), kind="personal")
    session.add_all([zeus, custom, RecurringRule(
        semester_id=semester.id, title="Gym", kind="personal", weekdays=[1], start_time="09:00", end_time="10:00",
        from_date=date(2026, 10, 19), until_date=date(2026, 12, 1))])
    session.flush()
    note = Note(event_id=zeus.id, tab="prep", body="read chapter 3", important=True, updated_at=NOW)
    session.add(note)
    session.flush()
    session.add_all([
        Task(note_id=note.id, event_id=zeus.id, subject_id=subject.id, title="Do exercise", source="note",
             created_at=NOW),
        WeekReview(semester_id=semester.id, week_start=date(2026, 10, 19), reviewed_at=NOW),
        AppSetting(key="language", value="vi"),
        AppSetting(key="internal_marker", value="internal-marker-value"),
        AppSecret(name="zeus_key", value_encrypted=SECRET),
        ChatMessage(role="user", content="hello chat", actions=[], created_at=NOW),
        PendingAction(kind="x", payload={"p": SECRET}, created_at=NOW, expires_at=NOW),
        DocumentUpload(id="u" * 36, session_uri=SESSION_URI, subject_id=subject.id, tag="slides", name="a.pdf",
                       mime_type="application/pdf", size=1, created_at=NOW),
        Document(subject_id=subject.id, drive_file_id="drive-file-1", name="a.pdf", mime_type="application/pdf",
                 size=5, tag="slides", web_view_link="https://drive/x", created_at=NOW),
    ])
    session.commit()
    return subject


def keys(value):
    if isinstance(value, dict):
        for k, v in value.items():
            yield k
            yield from keys(v)
    elif isinstance(value, list):
        for item in value:
            yield from keys(item)


def test_build_backup_content_and_no_secrets(session, seeded):
    data = backup_service.build_backup(session, NOW)
    assert data["format"] == "timetable-backup" and data["version"] == 1
    assert data["created_at"] == "2026-10-15T12:00:00Z"
    assert [s["display_name"] for s in data["subjects"]] == ["Databases"]
    assert data["subjects"][0]["aliases"] == ["DB"] and data["subjects"][0]["section"] == "B"
    assert [e["title_raw"] for e in data["events"]] == ["Gym"]
    assert len(data["rules"]) == 1
    assert data["notes"][0]["body"] == "read chapter 3" and data["notes"][0]["event_zeus_uid"] == "u1"
    assert data["tasks"][0]["title"] == "Do exercise"
    assert len(data["week_review"]) == 1
    assert data["settings"] == {"language": "vi"}
    assert data["documents"][0]["name"] == "a.pdf"
    banned = ("token", "secret", "key", "session_uri")
    assert not [k for k in keys(data) if any(b in k.lower() for b in banned)]
    text = json.dumps(data)
    for leaked in (SECRET, SESSION_URI, "gcal-id-1", "hello chat", "internal-marker-value"):
        assert leaked not in text


def test_download_headers(client, seeded):
    assert client.get("/api/backup").status_code == 401
    resp = client.get("/api/backup", headers=AUTH)
    assert resp.status_code == 200
    assert resp.headers["content-disposition"] == 'attachment; filename="timetable-backup-2026-10-15.json"'
    assert resp.json()["format"] == "timetable-backup"
    assert SECRET not in resp.text


def test_status_and_manual_409_without_drive(client, seeded):
    assert client.get("/api/backup/status").status_code == 401
    assert client.get("/api/backup/status", headers=AUTH).json() == {"drive_available": False, "last_at": None}
    resp = client.post("/api/backup/drive", headers=AUTH)
    assert resp.status_code == 409 and "Google" in resp.json()["detail"]
    assert client.post("/api/backup/drive").status_code == 401


def test_manual_backup_uploads_to_backups_folder(client, settings, seeded):
    drive = FakeDrive()
    configure(client, settings, drive)
    assert client.get("/api/backup/status", headers=AUTH).json()["drive_available"] is True
    resp = client.post("/api/backup/drive", headers=AUTH)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"file_name": "timetable-backup-2026-10-15.json", "created_at": "2026-10-15T12:00:00Z"}
    (file_id,) = list(drive.files)
    parent = drive.parents[file_id]
    assert drive.folders[parent][0] == "Backups"
    assert drive.folders[drive.folders[parent][1]] == ("Timetable", None)
    assert json.loads(drive.contents[file_id])["format"] == "timetable-backup"
    assert client.get("/api/backup/status", headers=AUTH).json()["last_at"] == "2026-10-15T12:00:00Z"
    assert SECRET.encode() not in drive.contents[file_id]


def test_manual_backup_drive_error_is_502(client, settings, seeded):
    drive = FakeDrive(fail={"upload_file": [GoogleError("boom")]})
    configure(client, settings, drive)
    assert client.post("/api/backup/drive", headers=AUTH).status_code == 502


def sync(client, headers=CRON):
    use_feed(client)
    return client.post("/api/sync", headers=headers)


def set_day(client, day):
    client.app.dependency_overrides[get_now] = lambda: NOW + timedelta(days=day)


def alive(drive):
    return sorted(f.name for fid, f in drive.files.items() if fid not in drive.trashed)


def test_cron_sync_backs_up_at_most_once_per_week(client, settings, seeded):
    drive = FakeDrive()
    configure(client, settings, drive)
    assert sync(client).status_code == 200
    assert alive(drive) == ["timetable-backup-2026-10-15.json"]
    set_day(client, 6)
    assert sync(client).status_code == 200
    assert len(drive.files) == 1  # still inside the 7 days
    set_day(client, 7)
    assert sync(client).status_code == 200
    assert alive(drive) == ["timetable-backup-2026-10-15.json", "timetable-backup-2026-10-22.json"]


def test_user_sync_does_not_back_up(client, settings, seeded):
    drive = FakeDrive()
    configure(client, settings, drive)
    assert sync(client, AUTH).status_code == 200
    assert not drive.files


def test_retention_keeps_newest_eight(client, settings, seeded):
    drive = FakeDrive()
    configure(client, settings, drive)
    for day in range(10):
        set_day(client, day)
        assert client.post("/api/backup/drive", headers=AUTH).status_code == 200
    names = alive(drive)
    assert len(names) == 8
    assert names[0] == "timetable-backup-2026-10-17.json" and names[-1] == "timetable-backup-2026-10-24.json"


def test_retention_ignores_other_files(client, settings, seeded):
    drive = FakeDrive()
    configure(client, settings, drive)
    for day in range(8):
        set_day(client, day)
        client.post("/api/backup/drive", headers=AUTH)
    folder = next(iter(drive.parents.values()))
    other = drive.upload_file("notes.txt", "text/plain", b"x", folder)
    set_day(client, 8)
    client.post("/api/backup/drive", headers=AUTH)
    assert other.id not in drive.trashed
    assert len(alive(drive)) == 9  # 8 backups + the unrelated file


@pytest.mark.parametrize("method", ["create_folder", "upload_file", "list_files"])
def test_drive_errors_do_not_fail_sync(client, settings, session, seeded, method):
    drive = FakeDrive(fail={method: [GoogleError("boom")] * 5})
    configure(client, settings, drive)
    resp = sync(client)
    assert resp.status_code == 200 and resp.json()["status"] == "ok"
    if method != "list_files":  # the upload itself succeeded before listing failed
        assert session.get(AppSetting, "backup_last_at") is None  # retried next time


def test_sync_skips_backup_when_budget_nearly_spent(client, settings, seeded, monkeypatch):
    drive = FakeDrive()
    configure(client, settings, drive)
    monkeypatch.setattr("app.routers.sync.SYNC_AND_PUSH_BUDGET_S", 5.0)
    assert sync(client).status_code == 200
    assert not drive.files


def test_sync_without_drive_scope_skips(client, settings, seeded):
    drive = FakeDrive()
    configure(client, settings, drive, scopes=("https://www.googleapis.com/auth/calendar.app.created",))
    assert sync(client).status_code == 200
    assert not drive.files


def test_documents_carry_zeus_uid_and_drive_file_id(session, seeded, semester):
    event = session.query(Event).filter_by(zeus_uid="u1").one()
    session.query(Document).update({"event_id": event.id})
    session.commit()
    doc = backup_service.build_backup(session, NOW)["documents"][0]
    assert doc["event_zeus_uid"] == "u1" and doc["drive_file_id"] == "drive-file-1"


def test_zeus_events_only_when_referenced(session, seeded, semester):
    session.add(Event(source="zeus", zeus_uid="u2", semester_id=semester.id, title_raw="Unreferenced",
                      start_at=datetime(2026, 10, 21, 9), end_at=datetime(2026, 10, 21, 10), kind="class"))
    session.commit()
    data = backup_service.build_backup(session, NOW)
    assert [e["zeus_uid"] for e in data["zeus_events"]] == ["u1"]
    ev = data["zeus_events"][0]
    assert set(ev) == {"zeus_uid", "semester_id", "subject_id", "title_raw", "start_at", "end_at", "kind", "room",
                       "status"}
    assert "gcal-id-1" not in json.dumps(data)


@pytest.mark.parametrize("lost", ["root", "backups"])
def test_missing_folders_are_recreated(client, settings, session, seeded, lost):
    drive = FakeDrive()
    configure(client, settings, drive)
    assert client.post("/api/backup/drive", headers=AUTH).status_code == 200
    folder = session.get(AppSetting, "backup_folder_id").value
    root = session.get(AppSetting, "drive_root_folder").value
    drive.trashed_folders.add(root if lost == "root" else folder)
    set_day(client, 1)
    assert client.post("/api/backup/drive", headers=AUTH).status_code == 200
    session.expire_all()
    new_folder = session.get(AppSetting, "backup_folder_id").value
    assert new_folder not in drive.trashed_folders and new_folder != folder
    assert drive.parents[max(drive.files, key=lambda f: int(f[4:]))] == new_folder
    new_root = session.get(AppSetting, "drive_root_folder").value
    assert new_root not in drive.trashed_folders
    assert (new_root != root) == (lost == "root")


@pytest.mark.parametrize("clock_value, pruned", [(100.0, False), (0.0, True)])
def test_prune_skipped_near_deadline(session, seeded, clock_value, pruned):
    drive = FakeDrive()
    root = drive.create_folder("Timetable", None)
    folder = drive.create_folder("Backups", root)
    session.add_all([AppSetting(key="drive_root_folder", value=root), AppSetting(key="backup_folder_id", value=folder)])
    session.commit()
    for day in range(10):
        drive.upload_file(f"timetable-backup-2026-10-{day + 1:02d}.json", "application/json", b"{}", folder)
    backup_service.upload_backup(session, drive, NOW, deadline=60.0, clock=lambda: clock_value)
    assert bool(drive.trashed) is pruned
