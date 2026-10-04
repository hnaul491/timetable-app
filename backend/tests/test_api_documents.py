from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.deps import get_drive_factory, get_gcal_factory
from app.gcal.api import GoogleAuthError, GoogleError
from app.gdrive.api import DRIVE_SCOPE
from app.models import AppSetting, Document, DocumentUpload, Event, Subject
from app.services.documents import CHUNK_SIZE
from tests.conftest import AUTH, NOW
from tests.gcal_fakes import FakeCalendar
from tests.gdrive_fakes import FakeDrive

TOKEN = "1//refresh-token-value-123"
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created"


def configure(client, settings, drive, scopes=(CALENDAR_SCOPE, DRIVE_SCOPE), tokens=None):
    settings.google_client_id, settings.google_client_secret = "cid", "csecret"
    client.app.dependency_overrides[get_gcal_factory] = lambda: (lambda token: FakeCalendar(scopes=set(scopes)))

    def factory(token):
        if tokens is not None:
            tokens.append(token)
        return drive

    client.app.dependency_overrides[get_drive_factory] = lambda: factory
    assert client.post("/api/google/connect", headers=AUTH, json={"refresh_token": TOKEN}).status_code == 200


@pytest.fixture
def subject(session, semester):
    s = Subject(semester_id=semester.id, display_name="Relational Databases", aliases=[], color="#2E55E6")
    session.add(s)
    session.commit()
    return s


def add_event(session, semester, subject, start=datetime(2026, 10, 19, 11)):
    event = Event(source="zeus", zeus_uid=f"u{start.isoformat()}{subject.id}", semester_id=semester.id,
                  subject_id=subject.id, title_raw="Class", start_at=start, end_at=start + timedelta(hours=2),
                  room="KB602", kind="class")
    session.add(event)
    session.commit()
    return event


def start(client, subject, size, **extra):
    body = {"subject_id": subject.id, "event_id": None, "tag": "slides", "name": "week1.pdf",
            "mime_type": "application/pdf", "size": size, **extra}
    return client.post("/api/documents/uploads", headers=AUTH, json=body)


def put(client, upload_id, data, offset):
    return client.put(f"/api/documents/uploads/{upload_id}?offset={offset}", headers=AUTH, content=data)


def upload(client, subject, data=b"hello world", **extra):
    started = start(client, subject, len(data), **extra)
    assert started.status_code == 200, started.text
    result = put(client, started.json()["upload_id"], data, 0)
    assert result.status_code == 200, result.text
    return result.json()["document"]


def test_requires_login(client):
    assert client.get("/api/subjects/1/documents").status_code == 401
    assert client.get("/api/events/1/documents").status_code == 401
    assert client.post("/api/documents/uploads", json={}).status_code == 401
    assert client.put("/api/documents/uploads/x?offset=0", content=b"a").status_code == 401
    assert client.patch("/api/documents/1", json={}).status_code == 401
    assert client.delete("/api/documents/1").status_code == 401


def test_two_chunk_upload_creates_folder_chain_once(client, settings, session, semester, subject):
    drive, tokens = FakeDrive(), []
    configure(client, settings, drive, tokens=tokens)
    event = add_event(session, semester, subject)
    data = bytes(range(256)) * ((CHUNK_SIZE + 10) // 256) + bytes(10)
    started = start(client, subject, len(data), event_id=event.id, tag="exercises")
    assert started.status_code == 200
    upload_id = started.json()["upload_id"]
    assert started.json()["chunk_size"] == CHUNK_SIZE == 4194304
    first = put(client, upload_id, data[:CHUNK_SIZE], 0)
    assert first.json() == {"received": CHUNK_SIZE, "document": None}
    last = put(client, upload_id, data[CHUNK_SIZE:], CHUNK_SIZE)
    document = last.json()["document"]
    assert last.json()["received"] == len(data)
    assert document["name"] == "week1.pdf" and document["tag"] == "exercises"
    assert (document["subject_id"], document["event_id"], document["size"]) == (subject.id, event.id, len(data))
    assert document["event_start"] == "2026-10-19T11:00:00Z"
    assert document["web_view_link"].startswith("https://drive.example/")
    assert drive.folders == {"folder1": ("Timetable", None), "folder2": ("S1", "folder1"),
                             "folder3": ("Relational Databases", "folder2")}
    assert drive.contents["file1"] == data
    assert tokens and set(tokens) == {TOKEN}
    session.expire_all()
    assert session.scalar(select(DocumentUpload)) is None
    assert session.get(AppSetting, "drive_root_folder").value == "folder1"
    assert session.get(Subject, subject.id).drive_folder_id == "folder3"
    for text in (started.text, first.text, last.text):
        assert TOKEN not in text and "upload.example" not in text


def test_second_upload_reuses_folders(client, settings, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    upload(client, subject)
    upload(client, subject, name="two.pdf")
    assert len(drive.folders) == 3
    assert [c for c in drive.calls if c[0] == "create_folder"] == [
        ("create_folder", "folder1"), ("create_folder", "folder2"), ("create_folder", "folder3")]


def test_deleted_folder_is_recreated(client, settings, session, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    upload(client, subject)
    del drive.folders["folder3"]
    document = upload(client, subject, name="two.pdf")
    assert document["name"] == "two.pdf"
    assert drive.folders["folder4"] == ("Relational Databases", "folder2")
    assert set(drive.folders) == {"folder1", "folder2", "folder4"}
    session.expire_all()
    assert session.get(Subject, subject.id).drive_folder_id == "folder4"


def test_deleted_root_folder_is_recreated_too(client, settings, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    upload(client, subject)
    drive.folders.clear()
    upload(client, subject, name="two.pdf")
    assert [f[0] for f in drive.folders.values()] == ["Timetable", "S1", "Relational Databases"]


def test_offset_mismatch_is_rejected(client, settings, session, subject):
    configure(client, settings, FakeDrive())
    started = start(client, subject, 10)
    upload_id = started.json()["upload_id"]
    response = put(client, upload_id, b"abc", 5)
    assert response.status_code == 409 and response.json()["detail"] == "expected offset 0"
    assert put(client, "nope", b"abc", 0).status_code == 404


def test_chunk_longer_than_remaining_or_empty_is_rejected(client, settings, subject):
    configure(client, settings, FakeDrive())
    upload_id = start(client, subject, 4).json()["upload_id"]
    assert put(client, upload_id, b"abcde", 0).status_code == 422
    assert put(client, upload_id, b"", 0).status_code == 422
    assert put(client, upload_id, b"abcd", 0).status_code == 200


def test_too_large_is_rejected(client, settings, subject):
    configure(client, settings, FakeDrive())
    assert start(client, subject, 104857601).status_code == 422
    assert start(client, subject, -1).status_code == 422
    assert start(client, subject, 0).status_code == 200
    assert start(client, subject, 104857600).status_code == 200


def test_uploads_need_the_drive_scope(client, settings, subject):
    drive = FakeDrive()
    configure(client, settings, drive, scopes=(CALENDAR_SCOPE,))
    response = start(client, subject, 10)
    assert response.status_code == 409 and response.json()["detail"] == "Reconnect Google to enable documents"
    assert drive.folders == {}
    assert client.get("/api/google", headers=AUTH).json()["drive_enabled"] is False


def test_uploads_need_a_google_connection(client, settings, subject):
    drive = FakeDrive()
    client.app.dependency_overrides[get_drive_factory] = lambda: (lambda token: drive)
    response = start(client, subject, 10)
    assert response.status_code == 409 and response.json()["detail"] == "Reconnect Google to enable documents"


def test_event_of_another_subject_is_rejected(client, settings, session, semester, subject):
    configure(client, settings, FakeDrive())
    other = Subject(semester_id=semester.id, display_name="Algorithms", aliases=[], color="#2E55E6")
    session.add(other)
    session.commit()
    foreign = add_event(session, semester, other)
    assert start(client, subject, 10, event_id=foreign.id).status_code == 422
    assert start(client, subject, 10, event_id=9999).status_code == 422
    assert start(client, SimpleNamespace(id=9999), 10).status_code == 404


def test_stale_uploads_are_deleted_at_start(client, settings, session, subject):
    configure(client, settings, FakeDrive())
    session.add(DocumentUpload(id="old", session_uri="https://upload.example/old", subject_id=subject.id,
                               event_id=None, tag="other", name="x", mime_type="text/plain", size=1, received=0,
                               created_at=NOW - timedelta(days=2)))
    session.commit()
    start(client, subject, 10)
    session.expire_all()
    assert session.get(DocumentUpload, "old") is None


def test_list_by_subject_and_event(client, settings, session, semester, subject):
    configure(client, settings, FakeDrive())
    event = add_event(session, semester, subject)
    linked = upload(client, subject, event_id=event.id, name="linked.pdf")
    loose = upload(client, subject, name="loose.pdf", tag="other")
    listed = client.get(f"/api/subjects/{subject.id}/documents", headers=AUTH).json()
    assert [d["id"] for d in listed] == [loose["id"], linked["id"]]
    assert listed[0]["event_id"] is None and listed[0]["event_start"] is None
    assert listed[1]["event_start"] == "2026-10-19T11:00:00Z"
    by_event = client.get(f"/api/events/{event.id}/documents", headers=AUTH).json()
    assert [d["id"] for d in by_event] == [linked["id"]]
    assert client.get("/api/subjects/9999/documents", headers=AUTH).status_code == 404
    assert client.get("/api/events/9999/documents", headers=AUTH).status_code == 404


def test_patch_tag_and_event(client, settings, session, semester, subject):
    configure(client, settings, FakeDrive())
    event = add_event(session, semester, subject)
    other = Subject(semester_id=semester.id, display_name="Algorithms", aliases=[], color="#2E55E6")
    session.add(other)
    session.commit()
    foreign = add_event(session, semester, other)
    document = upload(client, subject)
    url = f"/api/documents/{document['id']}"
    body = client.patch(url, headers=AUTH, json={"tag": "exercises", "event_id": event.id}).json()
    assert (body["tag"], body["event_id"], body["event_start"]) == ("exercises", event.id, "2026-10-19T11:00:00Z")
    body = client.patch(url, headers=AUTH, json={"event_id": None}).json()
    assert (body["tag"], body["event_id"]) == ("exercises", None)
    body = client.patch(url, headers=AUTH, json={}).json()
    assert body["tag"] == "exercises"
    assert client.patch(url, headers=AUTH, json={"event_id": foreign.id}).status_code == 422
    assert client.patch(url, headers=AUTH, json={"tag": "party"}).status_code == 422
    assert client.patch("/api/documents/9999", headers=AUTH, json={"tag": "other"}).status_code == 404


def test_delete_trashes_the_file(client, settings, session, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    document = upload(client, subject)
    assert client.delete(f"/api/documents/{document['id']}", headers=AUTH).status_code == 204
    assert drive.trashed == {"file1"}
    assert session.scalars(select(Document)).all() == []
    assert client.delete(f"/api/documents/{document['id']}", headers=AUTH).status_code == 404


def test_delete_tolerates_a_file_gone_in_drive(client, settings, session, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    document = upload(client, subject)
    del drive.files["file1"]
    assert client.delete(f"/api/documents/{document['id']}", headers=AUTH).status_code == 204
    assert session.scalars(select(Document)).all() == []


def test_delete_keeps_the_row_when_drive_fails(client, settings, session, subject):
    drive = FakeDrive(fail={"trash": [GoogleError("Google Drive returned 500 (backendError)")]})
    configure(client, settings, drive)
    document = upload(client, subject)
    response = client.delete(f"/api/documents/{document['id']}", headers=AUTH)
    assert response.status_code == 502 and "500" in response.json()["detail"]
    session.expire_all()
    assert len(session.scalars(select(Document)).all()) == 1


def test_google_errors_map_to_502_and_409(client, settings, session, subject):
    drive = FakeDrive(fail={"create_folder": [GoogleError("Google Drive returned 500 (backendError)"),
                                              GoogleAuthError("Google access was revoked or expired")]})
    configure(client, settings, drive)
    response = start(client, subject, 10)
    assert response.status_code == 502 and response.json()["detail"] == "Google Drive returned 500 (backendError)"
    response = start(client, subject, 10)
    assert response.status_code == 409 and "revoked" in response.json()["detail"]
    assert TOKEN not in response.text


def test_expired_session_drops_the_upload(client, settings, session, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    upload_id = start(client, subject, 3).json()["upload_id"]
    drive.sessions.clear()
    assert put(client, upload_id, b"abc", 0).status_code == 502
    session.expire_all()
    assert session.get(DocumentUpload, upload_id) is None


def test_zero_byte_file_uploads_with_one_empty_request(client, settings, session, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    upload_id = start(client, subject, 0).json()["upload_id"]
    result = put(client, upload_id, b"", 0)
    assert result.status_code == 200 and result.json()["document"]["size"] == 0
    assert put(client, start(client, subject, 0).json()["upload_id"], b"x", 0).status_code == 422


def test_mime_type_must_be_printable_ascii(client, settings, subject):
    configure(client, settings, FakeDrive())
    assert start(client, subject, 1, mime_type="text/pl\u00e9in").status_code == 422
    assert start(client, subject, 1, mime_type="").status_code == 422
    assert start(client, subject, 1, mime_type="application/octet-stream").status_code == 200


def test_binned_subject_folder_is_recreated_before_the_upload(client, settings, session, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    upload(client, subject)
    drive.trashed_folders.add("folder3")
    upload(client, subject, name="two.pdf")
    assert drive.sessions["https://upload.example/session2"]["parent"] == "folder4"
    session.expire_all()
    assert session.get(Subject, subject.id).drive_folder_id == "folder4"


def test_received_is_what_drive_kept(client, settings, session, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    data = bytes(CHUNK_SIZE) + b"tail"
    upload_id = start(client, subject, len(data)).json()["upload_id"]
    drive.keep_limit = 262144
    first = put(client, upload_id, data[:CHUNK_SIZE], 0)
    assert first.json() == {"received": 262144, "document": None}
    assert put(client, upload_id, data[CHUNK_SIZE:], CHUNK_SIZE).json()["detail"] == "expected offset 262144"
    drive.keep_limit = None
    last = put(client, upload_id, data[262144:], 262144)
    assert last.json()["document"]["size"] == len(data)
    assert drive.contents["file1"] == data


def test_empty_web_view_link_falls_back_to_the_drive_viewer(client, settings, session, subject):
    configure(client, settings, FakeDrive())
    document = upload(client, subject)
    session.get(Document, document["id"]).web_view_link = ""
    session.commit()
    listed = client.get(f"/api/subjects/{subject.id}/documents", headers=AUTH).json()
    assert listed[0]["web_view_link"] == "https://drive.google.com/file/d/file1/view"


def folder_of(session, subject):
    session.expire_all()
    return session.get(Subject, subject.id).drive_folder_id


def test_renaming_a_subject_renames_its_drive_folder(client, settings, session, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    upload(client, subject)
    folder = folder_of(session, subject)
    assert drive.folders[folder][0] == "Relational Databases"
    response = client.patch(f"/api/subjects/{subject.id}", headers=AUTH, json={"display_name": "Databases"})
    assert response.status_code == 200
    assert drive.folders[folder] == ("Databases", drive.folders[folder][1])
    assert ("rename", folder) in drive.calls


def test_rename_without_a_drive_folder_or_drive_touches_nothing(client, settings, session, subject):
    drive = FakeDrive()
    configure(client, settings, drive)  # connected, but the subject has no folder yet
    assert client.patch(f"/api/subjects/{subject.id}", headers=AUTH, json={"display_name": "Databases"}).status_code == 200
    assert not [c for c in drive.calls if c[0] == "rename"]
    configure(client, settings, drive, scopes=(CALENDAR_SCOPE,))  # no Drive scope
    subject_row = session.get(Subject, subject.id)
    subject_row.drive_folder_id = "folderX"
    session.commit()
    assert client.patch(f"/api/subjects/{subject.id}", headers=AUTH, json={"display_name": "DB"}).status_code == 200
    assert not [c for c in drive.calls if c[0] == "rename"]


def test_other_patches_do_not_rename_the_folder(client, settings, session, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    upload(client, subject)
    assert client.patch(f"/api/subjects/{subject.id}", headers=AUTH, json={"color": "#112233"}).status_code == 200
    assert not [c for c in drive.calls if c[0] == "rename"]


@pytest.mark.parametrize("error", [GoogleError("boom"), GoogleAuthError("revoked"), RuntimeError("odd")])
def test_rename_failure_does_not_fail_the_patch(client, settings, session, subject, error):
    drive = FakeDrive(fail={"rename": [error]})
    configure(client, settings, drive)
    upload(client, subject)
    response = client.patch(f"/api/subjects/{subject.id}", headers=AUTH, json={"display_name": "Databases"})
    assert response.status_code == 200 and response.json()["display_name"] == "Databases"


def test_session_uri_is_encrypted_at_rest(client, settings, session, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    started = start(client, subject, 10)
    stored = session.get(DocumentUpload, started.json()["upload_id"]).session_uri
    assert stored not in drive.sessions and "upload.example" not in stored
    done = put(client, started.json()["upload_id"], b"0123456789", 0)
    assert done.status_code == 200 and done.json()["document"] is not None


def test_plaintext_session_uri_is_treated_as_expired(client, settings, session, subject):
    configure(client, settings, FakeDrive())
    session.add(DocumentUpload(id="legacy", session_uri="https://upload.example/legacy", subject_id=subject.id,
                               event_id=None, tag="other", name="x", mime_type="text/plain", size=1, received=0,
                               created_at=NOW))
    session.commit()
    assert put(client, "legacy", b"a", 0).status_code == 404
    session.expire_all()
    assert session.get(DocumentUpload, "legacy") is None


def _other_subject(session, semester, name="Algorithms"):
    other = Subject(semester_id=semester.id, display_name=name, aliases=[], color="#2E55E6")
    session.add(other)
    session.commit()
    return other


def test_merging_subjects_moves_the_drive_files(client, settings, session, semester, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    other = _other_subject(session, semester)
    moved = upload(client, subject)
    kept = upload(client, other, name="kept.pdf")
    source_folder, target_folder = folder_of(session, subject), folder_of(session, other)
    source_id, other_id = subject.id, other.id
    response = client.post(f"/api/subjects/{source_id}/merge", headers=AUTH, json={"into_id": other_id})
    assert response.status_code == 200
    file_id = session.get(Document, moved["id"]).drive_file_id
    assert drive.parents[file_id] == target_folder
    assert drive.parents[session.get(Document, kept["id"]).drive_file_id] == target_folder
    assert ("move", file_id) in drive.calls and source_folder != target_folder


def test_merge_creates_the_target_folder_when_missing(client, settings, session, semester, subject):
    drive = FakeDrive()
    configure(client, settings, drive)
    other = _other_subject(session, semester)
    doc = upload(client, subject)
    other_id = other.id
    assert client.post(f"/api/subjects/{subject.id}/merge", headers=AUTH, json={"into_id": other_id}).status_code == 200
    session.expire_all()
    target_folder = session.get(Subject, other_id).drive_folder_id
    assert target_folder and drive.parents[session.get(Document, doc["id"]).drive_file_id] == target_folder


def test_merge_survives_a_drive_failure(client, settings, session, semester, subject):
    drive = FakeDrive(fail={"move": [GoogleError("Google Drive returned 500")]})
    configure(client, settings, drive)
    other = _other_subject(session, semester)
    upload(client, subject)
    other_id = other.id
    response = client.post(f"/api/subjects/{subject.id}/merge", headers=AUTH, json={"into_id": other_id})
    assert response.status_code == 200
    session.expire_all()
    assert session.scalar(select(Document)).subject_id == other_id


def test_merge_without_drive_touches_nothing(client, settings, session, semester, subject):
    drive = FakeDrive()
    other = _other_subject(session, semester)
    client.app.dependency_overrides[get_drive_factory] = lambda: (lambda token: drive)
    assert client.post(f"/api/subjects/{subject.id}/merge", headers=AUTH, json={"into_id": other.id}).status_code == 200
    assert not [c for c in drive.calls if c[0] == "move"]
