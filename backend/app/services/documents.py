import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.gcal.api import ACCOUNT_ID, REFRESH_TOKEN_NAME, GoogleAuthError, GoogleError, GoogleNotFound
from app.gcal.push import _close
from app.gdrive.api import DRIVE_SCOPE, DriveFactory, GoogleDrive
from app.models import AppSetting, Document, DocumentUpload, Event, GoogleAccount, Semester, Subject
from app.schemas import DocumentOut, UploadStartIn
from app.secret_store import SecretStore
from app.timeutil import iso_utc

CHUNK_SIZE = 4 * 1024 * 1024
CHUNK_ALIGN = 256 * 1024  # Drive wants every chunk but the last to be a multiple of this
STALE_AFTER = timedelta(days=1)
ROOT_KEY = "drive_root_folder"
ROOT_NAME = "Timetable"
RECONNECT = "Reconnect Google to enable documents"


def google_error(exc: GoogleError) -> HTTPException:
    """Auth problems are fixed by reconnecting (409); anything else is Google's fault (502)."""
    return HTTPException(status_code=409 if isinstance(exc, GoogleAuthError) else 502, detail=str(exc))


def drive_enabled(account: GoogleAccount | None) -> bool:
    return account is not None and DRIVE_SCOPE in account.scopes.split()


def open_drive(session: Session, settings: Settings, factory: DriveFactory) -> GoogleDrive:
    """A Drive client for the connected account, or 409 when Drive was not allowed at connect time."""
    account = session.get(GoogleAccount, ACCOUNT_ID)
    if not drive_enabled(account):
        raise HTTPException(status_code=409, detail=RECONNECT)
    token = SecretStore(session, settings.token_encryption_key).get(REFRESH_TOKEN_NAME)
    if not token:
        raise HTTPException(status_code=409, detail=RECONNECT)
    return factory(token)


def close_drive(drive: object) -> None:
    _close(drive)


def event_for_subject(session: Session, event_id: int, subject_id: int) -> Event:
    event = session.get(Event, event_id)
    if event is None or event.subject_id != subject_id:
        raise HTTPException(status_code=422, detail="that class does not belong to this subject")
    return event


# --- folders -----------------------------------------------------------------------------------

def _root_id(session: Session) -> str | None:
    row = session.get(AppSetting, ROOT_KEY)
    return row.value if row is not None and isinstance(row.value, str) and row.value else None


def _set_root(session: Session, folder_id: str | None) -> None:
    row = session.get(AppSetting, ROOT_KEY)
    if folder_id is None:
        if row is not None:
            session.delete(row)
    elif row is None:
        session.add(AppSetting(key=ROOT_KEY, value=folder_id))
    else:
        row.value = folder_id


def ensure_folders(session: Session, drive: GoogleDrive, semester: Semester, subject: Subject) -> str:
    """The id of the subject's Drive folder, creating Timetable / semester / subject as needed.

    Every folder id is committed as soon as it exists so a later failure never leaves an orphan."""
    root = _root_id(session)
    if root is None:
        root = drive.create_folder(ROOT_NAME, None)
        _set_root(session, root)
        session.commit()
    if not semester.drive_folder_id:
        semester.drive_folder_id = drive.create_folder(semester.code, root)
        session.commit()
    if not subject.drive_folder_id:
        subject.drive_folder_id = drive.create_folder(subject.display_name, semester.drive_folder_id)
        session.commit()
    return subject.drive_folder_id


def forget_missing_folders(session: Session, drive: GoogleDrive, semester: Semester, subject: Subject) -> None:
    """Clear the stored ids of the folders that are gone in Drive, and of everything below them."""
    gone = False
    cleared = False
    root = _root_id(session)
    if root is not None and not drive.folder_exists(root):
        _set_root(session, None)
        gone = cleared = True
    if semester.drive_folder_id and (gone or not drive.folder_exists(semester.drive_folder_id)):
        semester.drive_folder_id = None
        gone = cleared = True
    if subject.drive_folder_id and (gone or not drive.folder_exists(subject.drive_folder_id)):
        subject.drive_folder_id = None
        cleared = True
    if not cleared:
        subject.drive_folder_id = None  # Drive said 404 but every folder looks fine: make a fresh one
    session.commit()


# --- uploads -----------------------------------------------------------------------------------

def begin_upload(session: Session, drive: GoogleDrive, body: UploadStartIn, subject: Subject,
                 now: datetime) -> DocumentUpload:
    semester = session.get(Semester, subject.semester_id)
    if semester is None:
        raise HTTPException(status_code=404, detail="semester not found")
    session.execute(delete(DocumentUpload).where(DocumentUpload.created_at < now - STALE_AFTER))
    session.commit()
    if subject.drive_folder_id and not drive.folder_exists(subject.drive_folder_id):
        forget_missing_folders(session, drive, semester, subject)  # binned or deleted by hand
    folder = ensure_folders(session, drive, semester, subject)
    try:
        uri = drive.start_upload(body.name, body.mime_type, body.size, folder)
    except GoogleNotFound:  # the folder was deleted in Drive by hand: recreate the missing ones, once
        forget_missing_folders(session, drive, semester, subject)
        folder = ensure_folders(session, drive, semester, subject)
        uri = drive.start_upload(body.name, body.mime_type, body.size, folder)
    upload = DocumentUpload(id=str(uuid.uuid4()), session_uri=uri, subject_id=subject.id, event_id=body.event_id,
                            tag=body.tag, name=body.name, mime_type=body.mime_type, size=body.size, received=0,
                            created_at=now)
    session.add(upload)
    session.commit()
    return upload


def check_chunk(upload: DocumentUpload, data: bytes, offset: int) -> None:
    if offset != upload.received:
        raise HTTPException(status_code=409, detail=f"expected offset {upload.received}")
    remaining = upload.size - upload.received
    if upload.size == 0 and not data:
        return  # a zero-byte file is finished by one empty request
    if not data:
        raise HTTPException(status_code=422, detail="empty chunk")
    if len(data) > CHUNK_SIZE:
        raise HTTPException(status_code=413, detail="chunk too large")
    if len(data) > remaining:
        raise HTTPException(status_code=422, detail="chunk is longer than the rest of the file")
    if len(data) < remaining and len(data) % CHUNK_ALIGN:
        raise HTTPException(status_code=422, detail="chunk size must be a multiple of 256 KiB")


def send_chunk(session: Session, drive: GoogleDrive, upload: DocumentUpload, data: bytes, offset: int,
               now: datetime) -> Document | None:
    """Forward one chunk; returns the new Document when it was the last one."""
    try:
        done, kept = drive.upload_chunk(upload.session_uri, data, offset, upload.size)
    except GoogleNotFound:  # the Drive session expired: this upload cannot continue
        session.delete(upload)
        session.commit()
        raise
    if done is None:
        upload.received = kept  # what Drive really holds: the browser resumes from there
        session.commit()
        return None
    document = Document(subject_id=upload.subject_id, event_id=upload.event_id, drive_file_id=done.id,
                        name=upload.name, mime_type=upload.mime_type, size=upload.size, tag=upload.tag,
                        web_view_link=done.web_view_link, created_at=now)
    session.add(document)
    session.delete(upload)
    session.commit()
    return document


# --- output ------------------------------------------------------------------------------------

def document_outs(session: Session, documents: list[Document]) -> list[DocumentOut]:
    ids = {d.event_id for d in documents if d.event_id is not None}
    starts = dict(session.execute(select(Event.id, Event.start_at).where(Event.id.in_(ids))).all()) if ids else {}
    return [
        DocumentOut(id=d.id, subject_id=d.subject_id, event_id=d.event_id,
                    event_start=iso_utc(starts[d.event_id]) if d.event_id in starts else None,
                    name=d.name, mime_type=d.mime_type, size=d.size, tag=d.tag, web_view_link=d.web_view_link,
                    created_at=iso_utc(d.created_at))
        for d in documents
    ]
